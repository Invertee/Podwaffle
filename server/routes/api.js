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
  const pushService = options.pushService || null;
  const profileRegistry = options.profileRegistry || null;
  const diagnostics = options.diagnostics || null;
  const realtimeSync = options.realtimeSync || null;
  const GUID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

  // =========================================================================
  // UTILITY
  // =========================================================================

  function sendError(res, statusCode, error, details = '') {
    console.error(`[api] HTTP ${statusCode}: ${error}${details ? ' — ' + details : ''}`);
    return res.status(statusCode).json({ error, details });
  }

  function normalizeGuid(value) {
    const guid = String(value || '').trim();
    if (!GUID_PATTERN.test(guid) || guid.includes('/') || guid.includes('\\') || guid.includes('..')) {
      return null;
    }
    return guid;
  }

  function requireGuidParam(req, res, next, value) {
    const guid = normalizeGuid(value);
    if (!guid) {
      return sendError(res, 400, 'Invalid GUID');
    }
    if (profileRegistry && !profileRegistry.has(guid)) {
      return sendError(res, 404, 'Profile not configured');
    }
    req.params.guid = guid;
    next();
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

  router.param('guid', requireGuidParam);

  router.get('/profiles', (_req, res) => {
    res.json({
      profiles: profileRegistry ? profileRegistry.list() : [],
      serverTime: new Date().toISOString(),
    });
  });

  router.get('/admin/status', async (_req, res) => {
    const push = pushService?.getDiagnostics ? await pushService.getDiagnostics() : { configured: false, profiles: {} };
    const profiles = (profileRegistry ? profileRegistry.list() : []).map((profile) => ({
      ...profile,
      sync: realtimeSync?.status ? realtimeSync.status(profile.id) : null,
    }));
    res.json(diagnostics?.snapshot ? diagnostics.snapshot({
      profiles,
      notifications: push,
    }) : { profiles, notifications: push });
  });

  // Firebase is initialized dynamically by the sideloaded Android app. Only
  // public app identifiers are returned here; service-account credentials stay
  // on the backend.
  router.get('/push/config', (req, res) => {
    res.json(pushService ? pushService.getPublicConfig() : { enabled: false });
  });

  router.post('/users/:guid/push/register', async (req, res) => {
    if (!pushService) return sendError(res, 503, 'Push service unavailable');
    try {
      const result = await pushService.registerDevice(req.params.guid, String(req.body?.token || ''), String(req.body?.clientId || ''));
      res.json(result);
    } catch (err) {
      sendError(res, 400, 'Failed to register push device', err.message);
    }
  });

  router.delete('/users/:guid/push/register', async (req, res) => {
    if (!pushService) return sendError(res, 503, 'Push service unavailable');
    await pushService.unregisterDevice(req.params.guid, String(req.body?.token || ''));
    res.status(204).send();
  });

  // Supports background media controls and opt-in device operations such as
  // caching an episode/feed for offline playback.
  router.post('/users/:guid/push/command', async (req, res) => {
    if (!pushService) return sendError(res, 503, 'Push service unavailable');
    const command = String(req.body?.command || '').trim();
    if (!command) return sendError(res, 400, 'command is required');
    try {
      const result = await pushService.sendToGuid(req.params.guid, {
        type: 'podwaffle_command',
        command,
        payload: req.body?.data || {},
        issuedAt: new Date().toISOString(),
      });
      res.json({ accepted: true, ...result });
    } catch (err) {
      sendError(res, 502, 'Failed to send push command', err.message);
    }
  });

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

  // GET /users/:guid
  router.get('/users/:guid', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}`);
    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);
      const progress = await userService.getProgress(guid);
      res.json({ ...profile, progress });
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
      broadcastWs({ type: 'user:settings', data: { guid, settings } });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to update settings', err.message);
    }
  });

  // GET /users/:guid/sync/bootstrap
  router.get('/users/:guid/sync/bootstrap', async (req, res) => {
    const { guid } = req.params;
    console.log(`[api] GET /users/${guid}/sync/bootstrap`);
    try {
      const payload = await userService.getBootstrapSyncState(guid);
      const subscriptions = payload?.snapshot?.subscriptions || [];
      const feeds = await feedService.getCachedFeedsByUrls(subscriptions);
      res.json({ ok: true, guid, ...payload, feeds });
    } catch (err) {
      if (err.message && err.message.includes('not found')) {
        return sendError(res, 404, 'User not found', err.message);
      }
      sendError(res, 500, 'Failed to fetch bootstrap sync state', err.message);
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
      const subscriptions = await userService.reorderSubscriptions(guid, order);
      broadcastWs({ type: 'user:subscriptions', data: { guid } });
      res.json({
        success: true,
        subscriptions,
        subscriptionsUpdatedAt: new Date().toISOString(),
      });
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
      const refreshedFeeds = [];
      let feedsChecked = 0;
      let errors = [];

      console.log(`[api] Refreshing ${feedUrls.length} feed(s) for user ${guid}...`);

      // Check each feed for updates
      for (const feedUrl of feedUrls) {
        try {
          feedsChecked++;
          const feedData = await feedService.fetchAndCacheFeed(feedUrl);
          refreshedFeeds.push(feedData);
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

      // Feed cache changes are server state too. Send the refreshed snapshots
      // so every client updates without starting its own RSS request.
      broadcastWs({
        type: 'feeds:updated',
        data: {
          guid,
          feedsChecked,
          newEpisodesFound,
          totalNewEpisodes,
          updatedFeeds: refreshedFeeds.map((feed) => feed.feedId),
          feeds: refreshedFeeds,
          refreshedAt: new Date().toISOString(),
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
        skipStats: !!skipStats
      };
      const updated = await userService.updateProgress(guid, episodeGuid, progressData);
      res.json(updated);
      broadcastWs({ type: 'user:progress', data: { guid, episodeGuid, progress: updated } });
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
      if (session.ignoredNonOwner || session.ignoredStaleLease) {
        diagnostics?.record?.('playback-update-rejected', {
          profileId: guid,
          requesterClientId: req.body?.ownerClientId || req.body?.clientId || '',
          ownerClientId: session.ownerClientId || session.clientId || '',
          reason: session.ignoredStaleLease ? 'stale-lease' : 'non-owner',
        });
        return res.status(409).json({ error: 'Playback lease is owned by another client', session });
      }
      const previousOwnerClientId = session.previousOwnerClientId || '';
      delete session.previousOwnerClientId;
      res.json(session);
      diagnostics?.record?.(previousOwnerClientId ? 'playback-takeover' : 'playback-updated', {
        profileId: guid,
        ownerClientId: session.ownerClientId || session.clientId || '',
        previousOwnerClientId,
        episodeGuid: session.episodeGuid || '',
        isPlaying: !!session.isPlaying,
        mode: session.mode || 'local',
        position: session.position || 0,
      });
      if (previousOwnerClientId) {
        broadcastWs({
          type: 'session:revoked',
          data: { guid, targetClientId: previousOwnerClientId, session },
        });
      }
      broadcastWs({ type: 'user:playback-session', data: { guid, session } });
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
      const requesterClientId = String(req.query.clientId || req.get('x-podwaffle-client') || '');
      const session = await userService.clearPlaybackSession(guid, episodeGuid || undefined, requesterClientId);
      if (session?.ignoredNonOwner || session?.ignoredEpisodeMismatch) {
        return res.status(409).json({ error: 'Playback session was not cleared', session });
      }
      diagnostics?.record?.('playback-cleared', { profileId: guid, requesterClientId, episodeGuid: episodeGuid || '' });
      broadcastWs({ type: 'user:playback-session', data: { guid, session, episodeGuid: episodeGuid || null } });
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
      const profiles = profileRegistry ? profileRegistry.list() : (await userService.getAllUserGuids()).map((guid) => ({ id: guid, name: guid }));
      res.json({ users: profiles.map((profile) => ({ guid: profile.id, name: profile.name })) });
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
    const { command, value, position, volume, targetClientId } = req.body || {};
    const normalized = String(command || '').trim().toLowerCase();
    console.log(`[api] POST /ha/media-player/${guid}/command`, req.body);

    if (!normalized) {
      return sendError(res, 400, 'command is required');
    }

    try {
      const profile = await userService.getUser(guid);
      if (!profile) return sendError(res, 404, 'User not found', `guid=${guid}`);
      const playbackSession = await userService.getPlaybackSession(guid);
      const resolvedTargetClientId = targetClientId
        || playbackSession?.ownerClientId
        || playbackSession?.clientId
        || '';

      if (playbackSession?.mode === 'cast' && castService.canControl(guid)) {
        const castState = castService.getState();
        const numeric = toNumber(position ?? volume ?? value, 0);
        let result;
        if (normalized === 'play') result = await castService.resume();
        else if (normalized === 'pause') result = await castService.pause();
        else if (normalized === 'play_pause') result = String(castState.status).toLowerCase() === 'playing' ? await castService.pause() : await castService.resume();
        else if (normalized === 'stop') {
          result = await castService.stop();
          await userService.clearPlaybackSession(guid);
          broadcastWs({ type: 'user:playback-session', data: { guid, session: null } });
        } else if (normalized === 'seek') result = await castService.seek(Math.max(0, numeric));
        else if (normalized === 'set_volume') result = await castService.setVolume(Math.max(0, Math.min(1, numeric)));
        else if (normalized === 'next') result = await castService.seek(Math.max(0, toNumber(castState.position, 0) + toNumber(profile.settings?.skipForward, 45)));
        else if (normalized === 'previous') result = await castService.seek(Math.max(0, toNumber(castState.position, 0) - toNumber(profile.settings?.skipBack, 15)));
        else return sendError(res, 400, 'Unsupported command');
        diagnostics?.record?.('cast-command', { profileId: guid, command: normalized });
        return res.json({ accepted: true, command: normalized, transport: 'cast', result });
      }

      if (!resolvedTargetClientId) {
        return sendError(res, 409, 'No local playback client currently owns this profile');
      }

      // Local controls are delivered only to the client holding the playback
      // lease. Broadcasting to every profile client could start two players.
      broadcastWs({
        type: 'ha:command',
        data: {
          guid,
          command: normalized,
          value,
          position,
          volume,
          targetClientId: resolvedTargetClientId || null,
          issuedAt: new Date().toISOString(),
        }
      });

      if (pushService) {
        pushService.sendToGuid(guid, {
          type: 'media_command',
          command: normalized,
          value: value == null ? '' : value,
          position: position == null ? '' : position,
          volume: volume == null ? '' : volume,
          targetClientId: resolvedTargetClientId,
          issuedAt: new Date().toISOString(),
        }).catch((err) => console.warn('[api] Background command delivery failed:', err.message));
      }

      diagnostics?.record?.('local-command', { profileId: guid, command: normalized, targetClientId: resolvedTargetClientId });
      return res.json({ accepted: true, command: normalized, transport: 'client', targetClientId: resolvedTargetClientId || null });
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
      const result = await userService.addHistoryEntry(guid, req.body);
      res.status(result.duplicate ? 200 : 201).json(result.entry);
      if (!result.duplicate) broadcastWs({ type: 'user:history', data: { guid, entry: result.entry } });
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
    const { listenedDelta, skippedDelta, mutationId } = req.body || {};
    console.log(`[api] PUT /users/${guid}/stats`, { listenedDelta, skippedDelta });
    try {
      const result = await userService.updateStats(guid, listenedDelta || 0, skippedDelta || 0, mutationId || '');
      res.json(result.stats);
      if (!result.duplicate) broadcastWs({ type: 'user:stats', data: { guid, stats: result.stats } });
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
      if (profileRegistry && !profileRegistry.has(userGuid)) {
        return sendError(res, 404, 'Profile not configured');
      }
      const seen = await userService.markEpisodesSeen(userGuid, feedId, episodeGuids);

      // Also clear the newEpisodesAvailable flag on the feed
      await feedService.clearNewFlag(feedId);

      res.json({ feedId, seenCount: seen.length });
      broadcastWs({ type: 'user:seen', data: { guid: userGuid, feedId, seenCount: seen.length } });
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
  // CAST — Server-driven device discovery and playback control
  // =========================================================================
  // All cast control is now server-side. Devices are discovered via mDNS.
  // Only the user who initiates a cast session can control it.

  // GET /cast/devices — list all available cast devices on the network
  router.get('/cast/devices', (req, res) => {
    console.log('[api] GET /cast/devices');
    try {
      const devices = castService.getDevices();
      res.json({ devices });
    } catch (err) {
      sendError(res, 500, 'Failed to list cast devices', err.message);
    }
  });

  // GET /cast/session — get current active cast session (if any)
  router.get('/cast/session', (req, res) => {
    console.log('[api] GET /cast/session');
    try {
      const session = castService.getSession();
      res.json({ session });
    } catch (err) {
      sendError(res, 500, 'Failed to get cast session', err.message);
    }
  });

  // POST /cast/play — start casting an episode to a device
  router.post('/cast/play', async (req, res) => {
    const { userGuid, deviceId, mediaUrl, episodeGuid, title, podcastTitle, imageUrl, duration, startPosition, feedId } = req.body || {};
    console.log(`[api] POST /cast/play user=${userGuid} device=${deviceId}`);

    if (!userGuid || !deviceId || !mediaUrl) {
      return sendError(res, 400, 'Missing required fields: userGuid, deviceId, mediaUrl');
    }
    if (profileRegistry && !profileRegistry.has(userGuid)) {
      return sendError(res, 404, 'Profile not configured');
    }
    const castLeaseClientId = `cast:${deviceId}`;

    try {
      // Claim the playback lease before the potentially slow Cast connection.
      // This pauses any previous online owner before receiver playback starts.
      const claimedSession = await userService.updatePlaybackSession(userGuid, {
        episodeGuid,
        feedId: feedId || '',
        title: title || '',
        podcastTitle: podcastTitle || '',
        audioUrl: mediaUrl,
        podcastImageUrl: imageUrl || '',
        imageUrl: imageUrl || '',
        position: Number(startPosition) || 0,
        duration: Number(duration) || 0,
        isPlaying: true,
        mode: 'cast',
        transport: 'cast',
        castDeviceId: deviceId,
        clientId: castLeaseClientId,
        forceTakeover: true,
      });
      const previousOwnerClientId = claimedSession.previousOwnerClientId || '';
      delete claimedSession.previousOwnerClientId;
      if (previousOwnerClientId) {
        broadcastWs({ type: 'session:revoked', data: { guid: userGuid, targetClientId: previousOwnerClientId, session: claimedSession } });
      }
      broadcastWs({ type: 'user:playback-session', data: { guid: userGuid, session: claimedSession } });

      let lastCastProgressPersistAt = 0;
      let lastKnownCastPosition = typeof startPosition === 'number' ? startPosition : parseFloat(startPosition) || 0;
      let lastKnownCastDuration = typeof duration === 'number' ? duration : parseFloat(duration) || 0;
      let castMarkedPlayed = false;

      const persistCastStatus = async (status = {}) => {
        if (!userGuid || !episodeGuid) return;
        if (castMarkedPlayed) return;

        const now = Date.now();
        const rawPosition = Math.max(0, Math.floor(status.position ?? 0));
        const pos = rawPosition > 0
          ? rawPosition
          : Math.max(0, Math.floor(lastKnownCastPosition || 0));
        const dur = Math.max(0, Math.floor(status.duration ?? lastKnownCastDuration ?? 0));
        const mappedStatus = String(status.status || '').toLowerCase();
        const ratio = dur > 0 ? pos / dur : 0;
        const nearEnd = dur > 0 && pos >= dur - 15;
        const shouldMarkPlayed = dur > 0 && (ratio >= 0.95 || nearEnd);
        const shouldPersistPosition = now - lastCastProgressPersistAt >= 15000;
        const shouldClearCastSession = mappedStatus === 'idle' || mappedStatus === 'error';
        const shouldPersistTerminal = shouldClearCastSession || shouldMarkPlayed;

        if (pos > 0) lastKnownCastPosition = pos;
        if (dur > 0) lastKnownCastDuration = dur;

        if (!shouldPersistPosition && !shouldPersistTerminal) return;

        lastCastProgressPersistAt = now;
        const updateTimestamp = new Date(now).toISOString();
        const progressData = {
          position: shouldMarkPlayed ? (dur || pos) : pos,
          duration: dur,
          played: shouldMarkPlayed || castMarkedPlayed,
          feedId: feedId || '',
          updatedAt: updateTimestamp,
        };

        try {
          const updated = await userService.updateProgress(userGuid, episodeGuid, progressData);
          broadcastWs({ type: 'user:progress', data: { guid: userGuid, episodeGuid, progress: updated } });

          if (shouldMarkPlayed && !castMarkedPlayed) {
            castMarkedPlayed = true;
            await userService.clearPlaybackSession(userGuid, episodeGuid).catch(() => null);
            broadcastWs({ type: 'user:playback-session', data: { guid: userGuid, session: null, episodeGuid } });
            await userService.addHistoryEntry(userGuid, {
              episodeGuid,
              feedId: feedId || '',
              title: title || '',
              podcastTitle: podcastTitle || '',
              imageUrl: imageUrl || '',
              listenedAt: updateTimestamp,
              duration: dur,
            }).catch((err) => {
              console.warn('[api] Cast history update failed:', err.message);
            });
            return;
          }

          if (shouldClearCastSession) {
            await userService.clearPlaybackSession(userGuid, episodeGuid).catch(() => null);
            broadcastWs({ type: 'user:playback-session', data: { guid: userGuid, session: null, episodeGuid } });
            return;
          }

          await userService.updatePlaybackSession(userGuid, {
            episodeGuid,
            feedId: feedId || '',
            title: title || '',
            podcastTitle: podcastTitle || '',
            audioUrl: mediaUrl || '',
            podcastImageUrl: imageUrl || '',
            imageUrl: imageUrl || '',
            position: pos,
            duration: dur,
            isPlaying: mappedStatus === 'playing',
            mode: 'cast',
            transport: 'cast',
            castDeviceId: deviceId || '',
            clientId: `cast:${deviceId}`,
            ownerClientId: `cast:${deviceId}`,
            updatedAt: updateTimestamp,
          }).then((session) => {
            broadcastWs({ type: 'user:playback-session', data: { guid: userGuid, session } });
          }).catch((err) => {
            console.warn('[api] Cast playback session update failed:', err.message);
          });
        } catch (err) {
          console.warn('[api] Cast progress persist failed:', err.message);
        }
      };

      await castService.castTo(
        deviceId,
        userGuid,
        mediaUrl,
        startPosition || 0,
        persistCastStatus,
        { episodeGuid, title, podcastTitle, imageUrl, duration, feedId }
      );
      const activeLease = await userService.getPlaybackSession(userGuid);
      const activeOwner = activeLease?.ownerClientId || activeLease?.clientId || '';
      if (activeOwner !== castLeaseClientId) {
        await castService.stop().catch(() => null);
        throw new Error('Cast start was superseded by another playback owner');
      }
      diagnostics?.record?.('cast-started', { profileId: userGuid, deviceId, episodeGuid, previousOwnerClientId });
      res.json({ ok: true, message: 'Cast started' });
    } catch (err) {
      const remainingSession = await userService.clearPlaybackSession(userGuid, episodeGuid, castLeaseClientId).catch(() => null);
      broadcastWs({ type: 'user:playback-session', data: { guid: userGuid, session: remainingSession } });
      sendError(res, 500, 'Failed to start cast', err.message);
    }
  });

  // POST /cast/pause — pause the current cast session
  router.post('/cast/pause', async (req, res) => {
    const { userGuid } = req.body || {};
    console.log(`[api] POST /cast/pause user=${userGuid}`);

    if (!userGuid || !castService.canControl(userGuid)) return sendError(res, 409, 'Profile does not own the active Cast session');
    try {
      const result = await castService.pause();
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Failed to pause cast', err.message);
    }
  });

  // POST /cast/resume — resume the current cast session
  router.post('/cast/resume', async (req, res) => {
    const { userGuid } = req.body || {};
    console.log(`[api] POST /cast/resume user=${userGuid}`);

    if (!userGuid || !castService.canControl(userGuid)) return sendError(res, 409, 'Profile does not own the active Cast session');
    try {
      const result = await castService.resume();
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Failed to resume cast', err.message);
    }
  });

  // POST /cast/seek — seek to a position
  router.post('/cast/seek', async (req, res) => {
    const { userGuid, position } = req.body || {};
    console.log(`[api] POST /cast/seek user=${userGuid} position=${position}`);

    if (!Number.isFinite(position)) {
      return sendError(res, 400, 'Missing or invalid position');
    }
    if (!userGuid || !castService.canControl(userGuid)) return sendError(res, 409, 'Profile does not own the active Cast session');

    try {
      const result = await castService.seek(position);
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Failed to seek cast', err.message);
    }
  });

  // POST /cast/setVolume — set cast device volume (0-1)
  router.post('/cast/setVolume', async (req, res) => {
    const { userGuid, level } = req.body || {};
    console.log(`[api] POST /cast/setVolume user=${userGuid} level=${level}`);

    if (!Number.isFinite(level) || level < 0 || level > 1) {
      return sendError(res, 400, 'Invalid volume level (must be 0-1)');
    }
    if (!userGuid || !castService.canControl(userGuid)) return sendError(res, 409, 'Profile does not own the active Cast session');

    try {
      const result = await castService.setVolume(level);
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Failed to set cast volume', err.message);
    }
  });

  // POST /cast/stop — stop and disconnect the current cast session
  router.post('/cast/stop', async (req, res) => {
    const { userGuid } = req.body || {};
    console.log(`[api] POST /cast/stop user=${userGuid}`);

    if (!userGuid || !castService.canControl(userGuid)) return sendError(res, 409, 'Profile does not own the active Cast session');
    try {
      const result = await castService.stop();
      await userService.clearPlaybackSession(userGuid).catch(() => null);
      diagnostics?.record?.('cast-stopped', { profileId: userGuid });
      res.json(result);
    } catch (err) {
      sendError(res, 500, 'Failed to stop cast', err.message);
    }
  });

  // =========================================================================
  // RETURN ROUTER
  // =========================================================================
  return router;
}

module.exports = createApiRouter;
