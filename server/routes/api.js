'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');

/**
 * Factory function that creates and returns the main API router.
 *
 * @param {Object}   feedService  - feedService module
 * @param {Object}   userService  - userService module
 * @param {Object}   castService  - castService module
 * @param {Function} broadcastWs  - function(msg) broadcasts to all WS clients
 */
function createApiRouter(feedService, userService, castService, broadcastWs) {
  const router = express.Router();

  // =========================================================================
  // UTILITY
  // =========================================================================

  function sendError(res, statusCode, error, details = '') {
    console.error(`[api] HTTP ${statusCode}: ${error}${details ? ' — ' + details : ''}`);
    return res.status(statusCode).json({ error, details });
  }

  // =========================================================================
  // USERS
  // =========================================================================

  // POST /users — create a new user
  router.post('/users', async (req, res) => {
    console.log('[api] POST /users → creating new user');
    try {
      const profile = await userService.createUser();
      console.log(`[api] POST /users → created user ${profile.guid}`);
      res.status(201).json({ guid: profile.guid, profile });
    } catch (err) {
      sendError(res, 500, 'Failed to create user', err.message);
    }
  });

  // GET /users/:guid
  router.get('/users/:guid', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}`);
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);
      res.json(profile);
    } catch (err) {
      sendError(res, 500, 'Failed to get user', err.message);
    }
  });

  // PUT /users/:guid/settings
  router.put('/users/:guid/settings', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] PUT /users/${guid}/settings`, req.body);
    try {
      const settings = await userService.updateSettings(guid, req.body || {});
      res.json({ settings });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to update settings', err.message);
    }
  });

  // =========================================================================
  // SUBSCRIPTIONS
  // =========================================================================

  // GET /users/:guid/subscriptions
  router.get('/users/:guid/subscriptions', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/subscriptions`);
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);

      const feedUrls = profile.subscriptions || [];
      console.log(`[api] GET /users/${guid}/subscriptions → ${feedUrls.length} feeds`);

      // Enrich each subscription with cached feed metadata
      const enriched = await Promise.all(feedUrls.map(async (feedUrl) => {
        const feedId = feedService.getFeedId(feedUrl);
        const cached = await feedService.getCachedFeed(feedId);
        if (!cached) {
          return {
            feedId,
            feedUrl,
            title: null,
            imageUrl: null,
            author: null,
            newEpisodesAvailable: false,
            lastRefreshed: null,
            episodeCount: 0
          };
        }
        return {
          feedId: cached.feedId,
          feedUrl: cached.feedUrl,
          title: cached.title,
          imageUrl: cached.imageUrl,
          author: cached.author,
          newEpisodesAvailable: cached.newEpisodesAvailable,
          lastRefreshed: cached.lastRefreshed,
          episodeCount: (cached.episodes || []).length
        };
      }));

      res.json(enriched);
    } catch (err) {
      sendError(res, 500, 'Failed to get subscriptions', err.message);
    }
  });

  // POST /users/:guid/subscriptions
  router.post('/users/:guid/subscriptions', async (req, res) => {
    const { guid } = req.params;
    const { feedUrl } = req.body || {};
    console.log(`[api] POST /users/${guid}/subscriptions → feedUrl=${feedUrl}`);

    if (!feedUrl || typeof feedUrl !== 'string') {
      return sendError(res, 400, 'feedUrl is required and must be a string');
    }

    try {
      // Verify user exists
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);

      // Fetch & cache the feed immediately
      console.log(`[api] POST /users/${guid}/subscriptions → fetching feed...`);
      let feedData;
      try {
        feedData = await feedService.fetchAndCacheFeed(feedUrl);
      } catch (fetchErr) {
        return sendError(res, 422, 'Failed to fetch or parse podcast feed', fetchErr.message);
      }

      // Add the subscription
      await userService.addSubscription(guid, feedUrl);
      console.log(`[api] POST /users/${guid}/subscriptions → subscribed to "${feedData.title}"`);
      broadcastWs({ type: 'user:subscriptions', data: { guid } });

      res.json({
        feedId: feedData.feedId,
        feedUrl: feedData.feedUrl,
        title: feedData.title,
        imageUrl: feedData.imageUrl,
        author: feedData.author,
        description: feedData.description,
        episodeCount: (feedData.episodes || []).length,
        lastRefreshed: feedData.lastRefreshed
      });
    } catch (err) {
      sendError(res, 500, 'Failed to subscribe', err.message);
    }
  });

  // DELETE /users/:guid/subscriptions/:feedId
  router.delete('/users/:guid/subscriptions/:feedId', async (req, res) => {
    const { guid, feedId } = req.params;
    console.log(`[api] DELETE /users/${guid}/subscriptions/${feedId}`);
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);

      await userService.removeSubscription(guid, feedId);
      console.log(`[api] DELETE /users/${guid}/subscriptions/${feedId} → done`);
      broadcastWs({ type: 'user:subscriptions', data: { guid } });
      res.json({ success: true, feedId });
    } catch (err) {
      sendError(res, 500, 'Failed to unsubscribe', err.message);
    }
  });

  // PATCH /users/:guid/subscriptions — reorder
  router.patch('/users/:guid/subscriptions', async (req, res) => {
    const { guid } = req.params;
    const { order } = req.body || {};
    console.log(`[api] PATCH /users/${guid}/subscriptions → reorder ${(order || []).length} items`);
    if (!Array.isArray(order)) {
      return sendError(res, 400, '"order" must be an array of feedIds');
    }
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);
      await userService.reorderSubscriptions(guid, order);
      broadcastWs({ type: 'user:subscriptions', data: { guid } });
      res.json({ success: true });
    } catch (err) {
      sendError(res, 500, 'Failed to reorder subscriptions', err.message);
    }
  });

  // =========================================================================
  // PROGRESS
  // =========================================================================

  // GET /users/:guid/progress
  router.get('/users/:guid/progress', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/progress`);
    try {
      const progress = await userService.getProgress(guid);
      res.json(progress);
    } catch (err) {
      sendError(res, 500, 'Failed to get progress', err.message);
    }
  });

  // PUT /users/:guid/progress/:episodeGuid
  router.put('/users/:guid/progress/:episodeGuid', async (req, res) => {
    const { guid, episodeGuid } = req.params;
    console.log(`[api] PUT /users/${guid}/progress/${episodeGuid}`, req.body);
    try {
      const { position, duration, played, feedId } = req.body || {};
      const progressData = {
        position: typeof position === 'number' ? position : parseFloat(position) || 0,
        duration: typeof duration === 'number' ? duration : parseFloat(duration) || 0,
        played: !!played,
        feedId: feedId || '',
        updatedAt: new Date().toISOString()
      };
      const updated = await userService.updateProgress(guid, episodeGuid, progressData);
      res.json(updated);
      broadcastWs({ type: 'user:progress', data: { guid, episodeGuid } });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to update progress', err.message);
    }
  });

  // =========================================================================
  // HISTORY
  // =========================================================================

  // GET /users/:guid/history
  router.get('/users/:guid/history', async (req, res) => {
    const { guid } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    console.log(`[api] GET /users/${guid}/history?limit=${limit}&offset=${offset}`);
    try {
      const history = await userService.getHistory(guid, limit, offset);
      res.json({ history, limit, offset, count: history.length });
    } catch (err) {
      sendError(res, 500, 'Failed to get history', err.message);
    }
  });

  // POST /users/:guid/history
  router.post('/users/:guid/history', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] POST /users/${guid}/history`, req.body);
    try {
      if (!req.body || !req.body.episodeGuid) {
        return sendError(res, 400, 'episodeGuid is required in the history entry');
      }
      const entry = await userService.addHistoryEntry(guid, req.body);
      res.status(201).json(entry);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to add history entry', err.message);
    }
  });

  // =========================================================================
  // STATS
  // =========================================================================

  // GET /users/:guid/stats
  router.get('/users/:guid/stats', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/stats`);
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);
      res.json(profile.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 });
    } catch (err) {
      sendError(res, 500, 'Failed to get stats', err.message);
    }
  });

  // PUT /users/:guid/stats
  router.put('/users/:guid/stats', async (req, res) => {
    const { guid } = req.params;
    const { listenedDelta, skippedDelta } = req.body || {};
    console.log(`[api] PUT /users/${guid}/stats`, { listenedDelta, skippedDelta });
    try {
      const stats = await userService.updateStats(guid, listenedDelta || 0, skippedDelta || 0);
      res.json(stats);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to update stats', err.message);
    }
  });

  // =========================================================================
  // PODCASTS (feed cache)
  // =========================================================================

  // GET /podcasts/:feedId?limit=100&offset=0
  router.get('/podcasts/:feedId', async (req, res) => {
    const { feedId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    console.log(`[api] GET /podcasts/${feedId}?limit=${limit}&offset=${offset}`);
    try {
      const feed = await feedService.getCachedFeed(feedId);
      if (!feed) {
        return sendError(res, 404, 'Podcast not cached', `feedId=${feedId}`);
      }
      const episodes = (feed.episodes || []).slice(offset, offset + limit);
      res.json({
        feedId: feed.feedId,
        feedUrl: feed.feedUrl,
        title: feed.title,
        description: feed.description,
        imageUrl: feed.imageUrl,
        author: feed.author,
        link: feed.link,
        lastRefreshed: feed.lastRefreshed,
        newEpisodesAvailable: feed.newEpisodesAvailable,
        totalEpisodes: (feed.episodes || []).length,
        episodes,
        limit,
        offset
      });
    } catch (err) {
      sendError(res, 500, 'Failed to get podcast', err.message);
    }
  });

  // POST /podcasts/:feedId/seen
  router.post('/podcasts/:feedId/seen', async (req, res) => {
    const { feedId } = req.params;
    const { guid: userGuid, episodeGuids = [] } = req.body || {};
    console.log(`[api] POST /podcasts/${feedId}/seen → user=${userGuid}, episodes=${episodeGuids.length}`);
    try {
      if (!userGuid) {
        return sendError(res, 400, 'guid (user guid) is required');
      }
      const seen = await userService.markEpisodesSeen(userGuid, feedId, episodeGuids);

      // Also clear the newEpisodesAvailable flag on the feed
      await feedService.clearNewFlag(feedId);

      res.json({ feedId, seenCount: seen.length });
    } catch (err) {
      sendError(res, 500, 'Failed to mark episodes seen', err.message);
    }
  });

  // =========================================================================
  // SEARCH
  // =========================================================================

  // GET /search?q=term&guid=userGuid
  router.get('/search', async (req, res) => {
    const { q, guid } = req.query;
    console.log(`[api] GET /search?q=${q}&guid=${guid}`);

    if (!q || q.trim() === '') {
      return sendError(res, 400, 'Search query "q" is required');
    }

    try {
      let results = [];

      // Attempt PodcastIndex search if user has API keys
      if (guid) {
        try {
          const profile = await userService.getUser(guid);
          if (profile && profile.settings && profile.settings.podcastIndexApiKey && profile.settings.podcastIndexApiSecret) {
            console.log(`[api] /search → using PodcastIndex API for user ${guid}`);

            const apiKey = profile.settings.podcastIndexApiKey;
            const apiSecret = profile.settings.podcastIndexApiSecret;
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const authHash = crypto.createHash('sha1')
              .update(apiKey + apiSecret + timestamp)
              .digest('hex');

            const piUrl = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(q)}&max=20`;
            console.log(`[api] /search → fetching: ${piUrl}`);

            const piRes = await fetch(piUrl, {
              headers: {
                'User-Agent': 'Podwaffle/1.0',
                'X-Auth-Key': apiKey,
                'X-Auth-Date': timestamp,
                'Authorization': authHash
              }
            });

            if (!piRes.ok) {
              throw new Error(`PodcastIndex returned HTTP ${piRes.status}`);
            }

            const piData = await piRes.json();
            console.log(`[api] /search → PodcastIndex returned ${(piData.feeds || []).length} results`);

            results = (piData.feeds || []).map(feed => ({
              feedUrl: feed.url,
              title: feed.title,
              author: feed.author,
              imageUrl: feed.image,
              description: feed.description,
              episodeCount: feed.episodeCount || 0,
              podcastIndexId: feed.id
            }));
          } else {
            console.log(`[api] /search → user ${guid} has no PodcastIndex keys, falling back to iTunes`);
          }
        } catch (piErr) {
          console.error('[api] /search → PodcastIndex search failed, falling back to iTunes:', piErr.message);
          results = [];
        }
      }

      // Fall back to iTunes Search API
      if (results.length === 0) {
        console.log('[api] /search → using iTunes Search API');
        const itunesUrl = `https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(q)}&limit=20`;
        console.log(`[api] /search → fetching: ${itunesUrl}`);

        const itunesRes = await fetch(itunesUrl);
        if (!itunesRes.ok) {
          throw new Error(`iTunes API returned HTTP ${itunesRes.status}`);
        }

        const itunesData = await itunesRes.json();
        console.log(`[api] /search → iTunes returned ${(itunesData.results || []).length} results`);

        results = (itunesData.results || []).map(item => ({
          feedUrl: item.feedUrl,
          title: item.trackName,
          author: item.artistName,
          imageUrl: item.artworkUrl600,
          description: item.description || '',
          episodeCount: item.trackCount || 0,
          podcastIndexId: null
        }));
      }

      console.log(`[api] /search → returning ${results.length} results`);
      res.json(results);
    } catch (err) {
      sendError(res, 500, 'Search failed', err.message);
    }
  });

  // =========================================================================
  // CAST
  // =========================================================================

  // GET /cast/devices
  router.get('/cast/devices', (req, res) => {
    console.log('[api] GET /cast/devices');
    try {
      const devices = castService.getDevices();
      console.log(`[api] GET /cast/devices → ${devices.length} devices`);
      res.json(devices);
    } catch (err) {
      sendError(res, 500, 'Failed to get cast devices', err.message);
    }
  });

  // POST /cast/play
  router.post('/cast/play', async (req, res) => {
    const { deviceId, mediaUrl, startPosition = 0, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration = 0 } = req.body || {};
    console.log('[api] POST /cast/play', { deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle });

    if (!deviceId) return sendError(res, 400, 'deviceId is required');
    if (!mediaUrl) return sendError(res, 400, 'mediaUrl is required');

    try {
      // onStatusUpdate callback: broadcasts state + handles completion
      const onStatusUpdate = async (statusObj) => {
        console.log('[api] cast onStatusUpdate:', statusObj);

        const safePosition = Math.max(0, Math.floor(statusObj.position || 0));
        const safeDuration = Math.max(0, Math.floor(statusObj.duration || 0));

        // Broadcast to all WebSocket clients
        broadcastWs({
          type: 'cast:state',
          data: {
            deviceId,
            mediaUrl,
            episodeGuid,
            title,
            podcastTitle,
            imageUrl,
            position: safePosition,
            duration: safeDuration,
            status: statusObj.status,
            volume: statusObj.volume
          }
        });

        // Persist in-progress state while casting
        if (userGuid && episodeGuid && statusObj.status !== 'idle') {
          try {
            const profile = await userService.getUser(userGuid);
            if (profile) {
              const existing = profile.progress[episodeGuid];
              const feedId = existing ? existing.feedId : '';
              await userService.updateProgress(userGuid, episodeGuid, {
                position: safePosition,
                duration: safeDuration,
                played: false,
                feedId,
                updatedAt: new Date().toISOString()
              });
            }
          } catch (progressErr) {
            console.error('[api] cast onStatusUpdate → failed to persist in-progress:', progressErr.message);
          }
        }

        // If playback finished (IDLE after playing), mark as played for the user
        if (statusObj.status === 'idle' && userGuid && episodeGuid) {
          console.log(`[api] cast finished → marking episode ${episodeGuid} as played for user ${userGuid}`);
          try {
            const profile = await userService.getUser(userGuid);
            if (profile) {
              const existing = profile.progress[episodeGuid];
              const feedId = existing ? existing.feedId : '';
              await userService.updateProgress(userGuid, episodeGuid, {
                position: safeDuration,
                duration: safeDuration,
                played: true,
                feedId,
                updatedAt: new Date().toISOString()
              });
            }
          } catch (progressErr) {
            console.error('[api] cast onStatusUpdate → failed to update progress:', progressErr.message);
          }
        }
      };

      const result = await castService.castTo(deviceId, mediaUrl, startPosition, onStatusUpdate, { episodeGuid, title, podcastTitle, imageUrl, duration });
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Cast play failed', err.message);
    }
  });

  // POST /cast/pause
  router.post('/cast/pause', async (req, res) => {
    console.log('[api] POST /cast/pause');
    try {
      const result = await castService.pause();
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Cast pause failed', err.message);
    }
  });

  // POST /cast/resume
  router.post('/cast/resume', async (req, res) => {
    console.log('[api] POST /cast/resume');
    try {
      const result = await castService.resume();
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Cast resume failed', err.message);
    }
  });

  // POST /cast/stop
  router.post('/cast/stop', async (req, res) => {
    console.log('[api] POST /cast/stop');
    try {
      const result = await castService.stop();
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Cast stop failed', err.message);
    }
  });

  // PUT /cast/volume
  router.put('/cast/volume', async (req, res) => {
    const { volume } = req.body || {};
    console.log(`[api] PUT /cast/volume → ${volume}`);
    if (typeof volume !== 'number' && typeof volume !== 'string') {
      return sendError(res, 400, 'volume (0-1) is required');
    }
    try {
      const result = await castService.setVolume(parseFloat(volume));
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Set volume failed', err.message);
    }
  });

  // PUT /cast/seek
  router.put('/cast/seek', async (req, res) => {
    const { position } = req.body || {};
    console.log(`[api] PUT /cast/seek → ${position}`);
    if (position === undefined || position === null) {
      return sendError(res, 400, 'position (seconds) is required');
    }
    try {
      const result = await castService.seek(parseFloat(position));
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Cast seek failed', err.message);
    }
  });

  // GET /cast/state
  router.get('/cast/state', (req, res) => {
    console.log('[api] GET /cast/state');
    try {
      const state = castService.getState();
      res.json(state);
    } catch (err) {
      sendError(res, 500, 'Failed to get cast state', err.message);
    }
  });

  // =========================================================================
  // RETURN ROUTER
  // =========================================================================
  return router;
}

module.exports = createApiRouter;
