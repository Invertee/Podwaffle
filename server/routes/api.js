'use strict';

const express = require('express');
const fetch = require('node-fetch');

/**
 * Factory function that creates and returns the main API router.
 *
 * @param {Object}   feedService  - feedService module
 * @param {Object}   userService  - userService module
 * @param {Object}   castService  - castService module
 * @param {Function} broadcastWs  - function(msg) broadcasts to all WS clients
 * @param {Object}   options      - runtime options
 */
function createApiRouter(feedService, userService, castService, broadcastWs, options = {}) {
  const router = express.Router();
  const disableNewUserSessions = !!options.disableNewUserSessions;

  // =========================================================================
  // UTILITY
  // =========================================================================

  function sendError(res, statusCode, error, details = '') {
    console.error(`[api] HTTP ${statusCode}: ${error}${details ? ' — ' + details : ''}`);
    return res.status(statusCode).json({ error, details });
  }

  function mapPlaybackToHaState(status, isPlaying) {
    const s = String(status || '').toLowerCase();
    if (s === 'playing' || isPlaying === true) return 'playing';
    if (s === 'paused' || isPlaying === false) return 'paused';
    return 'idle';
  }

  function toNumber(value, fallback = 0) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function buildHaEntityPayload(guid, playbackSession, castState) {
    const hasSession = !!(playbackSession && playbackSession.episodeGuid);
    const sessionMode = hasSession ? (playbackSession.mode === 'cast' ? 'cast' : 'local') : null;
    const castAligned = !!(
      sessionMode === 'cast' &&
      castState &&
      castState.activeDeviceId &&
      (!castState.episodeGuid || castState.episodeGuid === playbackSession.episodeGuid)
    );

    const rawStatus = castAligned
      ? castState.status
      : (playbackSession ? (playbackSession.isPlaying ? 'playing' : 'paused') : 'idle');

    const mediaPosition = hasSession
      ? Math.max(0, Math.floor(castAligned ? toNumber(castState.position, playbackSession.position || 0) : toNumber(playbackSession.position, 0)))
      : 0;

    const mediaDuration = hasSession
      ? Math.max(0, Math.floor(castAligned ? toNumber(castState.duration, playbackSession.duration || 0) : toNumber(playbackSession.duration, 0)))
      : 0;

    return {
      guid,
      entity_id: `media_player.podwaffle_${String(guid).replace(/[^a-zA-Z0-9_]/g, '_')}`,
      state: mapPlaybackToHaState(rawStatus, playbackSession && playbackSession.isPlaying),
      mode: sessionMode || 'idle',
      episode_guid: hasSession ? playbackSession.episodeGuid : null,
      media_title: hasSession ? (playbackSession.title || null) : null,
      media_series_title: hasSession ? (playbackSession.podcastTitle || null) : null,
      media_content_id: hasSession ? (playbackSession.episodeGuid || null) : null,
      media_position: mediaPosition,
      media_duration: mediaDuration,
      media_image_url: hasSession ? (playbackSession.podcastImageUrl || playbackSession.imageUrl || null) : null,
      volume_level: castAligned ? toNumber(castState.volume, null) : null,
      is_volume_muted: false,
      supported_commands: ['play', 'pause', 'play_pause', 'stop', 'seek', 'set_volume', 'next', 'previous'],
      updated_at: (playbackSession && playbackSession.updatedAt) || new Date().toISOString(),
    };
  }

  // =========================================================================
  // HEALTH
  // =========================================================================

  // GET /health — simple connectivity and runtime snapshot
  router.get('/health', async (_req, res) => {
    try {
      const castState = castService.getState();
      res.json({
        ok: true,
        service: 'podwaffle-server',
        time: new Date().toISOString(),
        cast: {
          status: castState.status || 'idle',
          activeDeviceId: castState.activeDeviceId || null,
        },
      });
    } catch (err) {
      sendError(res, 500, 'Failed to get health status', err.message);
    }
  });

  // =========================================================================
  // USERS
  // =========================================================================

  // POST /users — create a new user
  router.post('/users', async (req, res) => {
    if (disableNewUserSessions) {
      return sendError(
        res,
        403,
        'New user sessions are disabled',
        'User profile creation is currently locked by server configuration.'
      );
    }

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

  // GET /users/:guid/sync/snapshot
  router.get('/users/:guid/sync/snapshot', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/sync/snapshot`);
    try {
      const snapshot = await userService.getSyncSnapshot(guid);
      res.json({ ok: true, guid, snapshot });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to fetch sync snapshot', err.message);
    }
  });

  // GET /users/:guid/sync/bootstrap
  router.get('/users/:guid/sync/bootstrap', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/sync/bootstrap`);
    try {
      const payload = await userService.getBootstrapSyncState(guid);
      res.json({ ok: true, guid, ...payload });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to fetch bootstrap sync state', err.message);
    }
  });

  // POST /users/:guid/sync/push
  router.post('/users/:guid/sync/push', async (req, res) => {
    const { guid } = req.params;
    const incomingState = req.body || {};
    console.log(`[api] POST /users/${guid}/sync/push`);
    try {
      const merged = await userService.mergeAndSaveSyncState(guid, incomingState);
      broadcastWs({
        type: 'user:sync',
        data: {
          guid,
          summary: merged.summary,
        }
      });
      res.json({
        ok: true,
        guid,
        summary: merged.summary,
        snapshot: merged.snapshot,
      });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to push sync state', err.message);
    }
  });

  // POST /users/:guid/sync/pull
  router.post('/users/:guid/sync/pull', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] POST /users/${guid}/sync/pull`);
    try {
      const snapshot = await userService.getSyncSnapshot(guid);
      res.json({ ok: true, guid, snapshot });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to pull sync state', err.message);
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
            description: null,
            hasRecentEpisode: false,
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
          description: cached.description,
          hasRecentEpisode: feedService.hasRecentEpisode(cached, 12),
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
        hasRecentEpisode: feedService.hasRecentEpisode(feedData, 12),
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

  // POST /users/:guid/feeds/refresh — check all subscribed feeds for new episodes
  router.post('/users/:guid/feeds/refresh', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] POST /users/${guid}/feeds/refresh`);

    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);

      const feedUrls = profile.subscriptions || [];
      const newEpisodesFound = {};
      let feedsChecked = 0;
      let errors = [];

      console.log(`[api] Refreshing ${feedUrls.length} feed(s) for user ${guid}...`);

      // Check each feed for updates
      for (const feedUrl of feedUrls) {
        try {
          feedsChecked++;
          const feedData = await feedService.fetchAndCacheFeed(feedUrl);
          const feedId = feedData.feedId;

          // Count new episodes since last refresh
          const episodesBefore = (feedData.episodeCountBefore || 0);
          const episodesNow = (feedData.episodes || []).length;
          const newCount = Math.max(0, episodesNow - episodesBefore);

          if (newCount > 0) {
            newEpisodesFound[feedId] = newCount;
            console.log(`[api] Feed ${feedData.title}: ${newCount} new episode(s)`);
          }
        } catch (feedErr) {
          console.warn(`[api] Failed to refresh feed ${feedUrl}:`, feedErr.message);
          errors.push(`${feedUrl}: ${feedErr.message}`);
        }
      }

      const totalNewEpisodes = Object.values(newEpisodesFound).reduce((sum, count) => sum + count, 0);

      res.json({
        ok: true,
        guid,
        feedsChecked,
        newEpisodesFound,
        totalNewEpisodes,
        errors: errors.length > 0 ? errors : undefined,
        checkedAt: new Date().toISOString(),
      });

      // Broadcast that feeds were refreshed
      broadcastWs({
        type: 'feeds:refreshed',
        data: {
          guid,
          feedsChecked,
          newEpisodesFound,
          totalNewEpisodes,
        },
      });
    } catch (err) {
      sendError(res, 500, 'Failed to refresh feeds', err.message);
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
      const { position, duration, played, feedId, skipStats } = req.body || {};
      const progressData = {
        position: typeof position === 'number' ? position : parseFloat(position) || 0,
        duration: typeof duration === 'number' ? duration : parseFloat(duration) || 0,
        played: !!played,
        feedId: feedId || '',
        skipStats: !!skipStats,
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

  // GET /users/:guid/playback-session
  router.get('/users/:guid/playback-session', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/playback-session`);
    try {
      const session = await userService.getPlaybackSession(guid);
      res.json(session || null);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to get playback session', err.message);
    }
  });

  // PUT /users/:guid/playback-session
  router.put('/users/:guid/playback-session', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] PUT /users/${guid}/playback-session`, req.body);
    try {
      const session = await userService.updatePlaybackSession(guid, req.body || {});
      res.json(session);
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to update playback session', err.message);
    }
  });

  // DELETE /users/:guid/playback-session
  router.delete('/users/:guid/playback-session', async (req, res) => {
    const { guid } = req.params;
    const { episodeGuid } = req.query;
    console.log(`[api] DELETE /users/${guid}/playback-session?episodeGuid=${episodeGuid || ''}`);
    try {
      await userService.clearPlaybackSession(guid, episodeGuid || undefined);
      res.status(204).send();
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to clear playback session', err.message);
    }
  });

  // GET /users/:guid/queue
  router.get('/users/:guid/queue', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/queue`);
    try {
      const queueState = await userService.getQueue(guid);
      res.json(queueState || { queue: [], mode: 'local', currentEpisodeGuid: '', updatedAt: null });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to get queue', err.message);
    }
  });

  // PUT /users/:guid/queue
  router.put('/users/:guid/queue', async (req, res) => {
    const { guid } = req.params;
    const payload = req.body;
    const queue = Array.isArray(payload) ? payload : (Array.isArray(payload?.queue) ? payload.queue : null);
    const metadata = {
      mode: payload?.mode,
      currentEpisodeGuid: payload?.currentEpisodeGuid,
      updatedAt: payload?.updatedAt,
    };
    console.log(`[api] PUT /users/${guid}/queue`, {
      count: Array.isArray(queue) ? queue.length : 'invalid',
      mode: metadata.mode || null,
      currentEpisodeGuid: metadata.currentEpisodeGuid || null,
    });

    if (!Array.isArray(queue)) {
      return sendError(res, 400, 'queue must be an array');
    }

    try {
      const updatedQueue = await userService.updateQueue(guid, queue, metadata);
      res.json({
        queue: updatedQueue,
        mode: metadata.mode || null,
        currentEpisodeGuid: metadata.currentEpisodeGuid || null,
        updatedAt: metadata.updatedAt || new Date().toISOString(),
      });
      broadcastWs({
        type: 'user:queue',
        data: {
          guid,
          count: updatedQueue.length,
          mode: metadata.mode || null,
          currentEpisodeGuid: metadata.currentEpisodeGuid || null,
          updatedAt: metadata.updatedAt || new Date().toISOString(),
        }
      });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to update queue', err.message);
    }
  });

  // =========================================================================
  // HOME ASSISTANT BRIDGE
  // =========================================================================

  // GET /ha/users
  router.get('/ha/users', async (req, res) => {
    console.log('[api] GET /ha/users');
    try {
      const guids = await userService.getAllUserGuids();
      res.json({ users: guids.map((guid) => ({ guid })) });
    } catch (err) {
      sendError(res, 500, 'Failed to list users', err.message);
    }
  });

  // GET /ha/media-player/:guid/state
  router.get('/ha/media-player/:guid/state', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /ha/media-player/${guid}/state`);
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);

      const playbackSession = await userService.getPlaybackSession(guid);
      const castState = castService.getState();
      res.json(buildHaEntityPayload(guid, playbackSession, castState));
    } catch (err) {
      sendError(res, 500, 'Failed to get media player state', err.message);
    }
  });

  // POST /ha/media-player/:guid/command
  router.post('/ha/media-player/:guid/command', async (req, res) => {
    const { guid } = req.params;
    const { command, value, position, volume } = req.body || {};
    const normalized = String(command || '').trim().toLowerCase();
    console.log(`[api] POST /ha/media-player/${guid}/command`, req.body);

    if (!normalized) {
      return sendError(res, 400, 'command is required');
    }

    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);

      const playbackSession = await userService.getPlaybackSession(guid);
      const castState = castService.getState();
      const targetMode = playbackSession?.mode === 'cast' ? 'cast' : 'local';
      const castActive = targetMode === 'cast' && !!castState.activeDeviceId;

      if (castActive) {
        let result = { status: castState.status || 'idle' };
        switch (normalized) {
          case 'play':
            result = await castService.resume();
            break;
          case 'pause':
            result = await castService.pause();
            break;
          case 'play_pause':
            result = castState.status === 'playing'
              ? await castService.pause()
              : await castService.resume();
            break;
          case 'stop':
            result = await castService.stop();
            break;
          case 'seek': {
            const seekTo = toNumber(position, toNumber(value, NaN));
            if (!Number.isFinite(seekTo)) {
              return sendError(res, 400, 'position or value is required for seek');
            }
            result = await castService.seek(seekTo);
            break;
          }
          case 'set_volume': {
            const nextVolume = toNumber(volume, toNumber(value, NaN));
            if (!Number.isFinite(nextVolume)) {
              return sendError(res, 400, 'volume or value is required for set_volume');
            }
            result = await castService.setVolume(nextVolume);
            break;
          }
          case 'next':
          case 'previous':
            break;
          default:
            return sendError(res, 400, `Unsupported command: ${normalized}`);
        }

        return res.json({ accepted: true, target: 'cast', command: normalized, result });
      }

      broadcastWs({
        type: 'ha:command',
        data: {
          guid,
          command: normalized,
          value,
          position,
          volume,
          issuedAt: new Date().toISOString(),
        }
      });

      return res.json({ accepted: true, target: 'local', command: normalized });
    } catch (err) {
      sendError(res, 500, 'Failed to execute media command', err.message);
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
        hasRecentEpisode: feedService.hasRecentEpisode(feed, 12),
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
      // Use iTunes Search API exclusively
      console.log('[api] /search → using iTunes Search API');
      const itunesUrl = `https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(q)}&limit=20`;
      console.log(`[api] /search → fetching: ${itunesUrl}`);

      const itunesRes = await fetch(itunesUrl);
      if (!itunesRes.ok) {
        throw new Error(`iTunes API returned HTTP ${itunesRes.status}`);
      }

      const itunesData = await itunesRes.json();
      console.log(`[api] /search → iTunes returned ${(itunesData.results || []).length} results`);

      const results = (itunesData.results || []).map(item => ({
        feedUrl: item.feedUrl,
        title: item.trackName,
        author: item.artistName,
        imageUrl: item.artworkUrl600,
        description: item.description || '',
        episodeCount: item.trackCount || 0
      }));

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
    const CAST_PERSIST_MIN_INTERVAL_MS = 5000;
    let lastCastPersistAt = 0;
    let lastPersistedPosition = null;
    let lastPersistedStatus = null;
    let castPersistInFlight = false;

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
          if (castPersistInFlight) {
            return;
          }

          const nowMs = Date.now();
          const statusChanged = lastPersistedStatus !== statusObj.status;
          const movedSeconds = lastPersistedPosition === null ? Infinity : Math.abs(safePosition - lastPersistedPosition);
          const intervalElapsed = (nowMs - lastCastPersistAt) >= CAST_PERSIST_MIN_INTERVAL_MS;
          const shouldPersist = statusChanged || intervalElapsed || movedSeconds >= 15;

          if (!shouldPersist) {
            return;
          }

          castPersistInFlight = true;
          lastCastPersistAt = nowMs;
          lastPersistedPosition = safePosition;
          lastPersistedStatus = statusObj.status;

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

              await userService.updatePlaybackSession(userGuid, {
                episodeGuid,
                feedId,
                title: title || '',
                podcastTitle: podcastTitle || '',
                audioUrl: mediaUrl || '',
                podcastImageUrl: imageUrl || '',
                imageUrl: imageUrl || '',
                position: safePosition,
                duration: safeDuration,
                isPlaying: statusObj.status === 'playing',
                mode: 'cast',
                updatedAt: new Date().toISOString(),
              });

              broadcastWs({ type: 'user:progress', data: { guid: userGuid, episodeGuid } });
            }
          } catch (progressErr) {
            console.error('[api] cast onStatusUpdate → failed to persist in-progress:', progressErr.message);
          } finally {
            castPersistInFlight = false;
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

              broadcastWs({ type: 'user:progress', data: { guid: userGuid, episodeGuid } });
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
