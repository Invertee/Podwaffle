/* Make route rendering local-first while remote reads and sync continue in the background. */
(function initLocalFirstRuntime() {
  const api = window.api;
  if (!api || api.__localFirstRuntimeInstalled) return;

  const tasks = new Map();
  const lastStartedAt = new Map();
  const SYNC_COOLDOWN_MS = 15000;
  const READ_COOLDOWN_MS = 10000;
  const PODCAST_COOLDOWN_MS = 30000;

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[localFirstRuntime] Failed to persist local state:', key, err?.message || err);
    }
    return value;
  };

  const runBackground = (key, task, cooldownMs = READ_COOLDOWN_MS) => {
    const existing = tasks.get(key);
    if (existing) return existing;

    const now = Date.now();
    const last = lastStartedAt.get(key) || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return Promise.resolve(null);
    lastStartedAt.set(key, now);

    const promise = Promise.resolve()
      .then(task)
      .catch((err) => {
        console.warn(`[localFirstRuntime] Background task failed (${key}):`, err?.message || err);
        return null;
      })
      .finally(() => tasks.delete(key));

    tasks.set(key, promise);
    return promise;
  };

  const localProfile = (guid) => {
    const resolvedGuid = guid || window.appState?.guid || localStorage.getItem('podwaffle_guid');
    const profile = api._getLocalProfile?.(resolvedGuid) || {
      guid: resolvedGuid,
      subscriptions: readJson(`podwaffle_subscriptions_${resolvedGuid}`, []),
      progress: readJson(`podwaffle_progress_${resolvedGuid}`, {}),
      settings: readJson(`podwaffle_settings_${resolvedGuid}`, {}),
      stats: readJson(`podwaffle_stats_${resolvedGuid}`, { totalListenedSeconds: 0, totalSkippedSeconds: 0 }),
      queue: readJson(`podwaffle_queue_state_${resolvedGuid}`, { queue: [], mode: 'local', currentEpisodeGuid: '', updatedAt: null }),
      playbackSession: readJson('podwaffle_playback_session', null),
    };

    return {
      ...profile,
      guid: resolvedGuid,
      history: readJson(`podwaffle_history_${resolvedGuid}`, []),
    };
  };

  const localSubscriptions = (guid) => {
    const profileItems = localProfile(guid)?.subscriptions || [];
    const offlineItems = window.offlineStore?.getSubscriptions?.(guid) || [];
    const combined = [...offlineItems, ...profileItems];
    const seen = new Set();
    const deduped = combined.filter((item) => {
      const key = typeof item === 'string'
        ? item
        : String(item?.feedId || item?.feedUrl || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return window.offlineStore?.hydrateSubscriptions?.(guid, deduped) || deduped;
  };

  const localPodcast = (feedId, limit = 100, offset = 0) => {
    const cached = api._getCachedPodcast?.(feedId)
      || api._findLocalPodcast?.(feedId)
      || localSubscriptions(window.appState?.guid || localStorage.getItem('podwaffle_guid'))
        .find((item) => item?.feedId === feedId || item?.feedUrl === feedId)
      || null;

    if (!cached) {
      return {
        feedId,
        feedUrl: '',
        title: 'Podcast',
        author: '',
        description: '',
        imageUrl: 'icons/icon-192.png',
        episodes: [],
        totalEpisodes: 0,
      };
    }

    const episodes = Array.isArray(cached.episodes) ? cached.episodes : [];
    return {
      ...cached,
      feedId: cached.feedId || feedId,
      title: cached.title || 'Podcast',
      imageUrl: cached.imageUrl || 'icons/icon-192.png',
      episodes: episodes.slice(offset, offset + limit),
      totalEpisodes: Number(cached.totalEpisodes) || episodes.length,
    };
  };

  const remote = {
    ensureUserOnBackend: api.ensureUserOnBackend?.bind(api),
    getSubscriptions: api.getSubscriptions?.bind(api),
    getProgress: api.getProgress?.bind(api),
    getPlaybackSession: api.getPlaybackSession?.bind(api),
    getQueue: api.getQueue?.bind(api),
    getHistory: api.getHistory?.bind(api),
    getStats: api.getStats?.bind(api),
    getPodcast: api.getPodcast?.bind(api),
    refreshPodcast: api.refreshPodcast?.bind(api),
    markEpisodesSeen: api.markEpisodesSeen?.bind(api),
    getCastSession: api.getCastSession?.bind(api),
  };

  api.__remoteReads = remote;

  const scheduleSync = (guid, reason = 'route-read') => {
    const cfg = api.getServerConnectionConfig?.();
    if (!guid || !cfg?.enabled || !cfg?.host || !window.syncManager?.performSync) {
      return Promise.resolve(null);
    }

    return runBackground(`profile-sync:${guid}`, async () => {
      const result = await window.syncManager.performSync(guid);
      window.dispatchEvent(new CustomEvent('podwaffle:background-sync-complete', {
        detail: { guid, reason, result },
      }));
      return result;
    }, SYNC_COOLDOWN_MS);
  };

  if (remote.ensureUserOnBackend) {
    api.ensureUserOnBackend = function ensureUserOnBackendInBackground(guid) {
      runBackground(`ensure-user:${guid}`, () => remote.ensureUserOnBackend(guid), 30000);
      return Promise.resolve({ queued: true, guid });
    };
  }

  if (remote.getSubscriptions) {
    api.getSubscriptions = function getSubscriptionsLocalFirst(guid) {
      scheduleSync(guid, 'subscriptions-read');
      return Promise.resolve(localSubscriptions(guid));
    };
  }

  if (remote.getProgress) {
    api.getProgress = function getProgressLocalFirst(guid) {
      scheduleSync(guid, 'progress-read');
      return Promise.resolve(localProfile(guid)?.progress || {});
    };
  }

  if (remote.getStats) {
    api.getStats = function getStatsLocalFirst(guid) {
      scheduleSync(guid, 'stats-read');
      return Promise.resolve(localProfile(guid)?.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 });
    };
  }

  if (remote.getPlaybackSession) {
    api.getPlaybackSession = function getPlaybackSessionLocalFirst(guid) {
      runBackground(`playback-session:${guid}`, async () => {
        const session = await remote.getPlaybackSession(guid);
        if (!session) return null;
        const local = readJson('podwaffle_playback_session', null);
        const remoteTs = new Date(session.updatedAt || 0).getTime();
        const localTs = new Date(local?.updatedAt || 0).getTime();
        if (!local || remoteTs >= localTs) {
          writeJson('podwaffle_playback_session', session);
          if (window.player?.applyRemotePlaybackSession) {
            window.player.applyRemotePlaybackSession(session);
          }
        }
        return session;
      });
      return Promise.resolve(localProfile(guid)?.playbackSession || null);
    };
  }

  if (remote.getQueue) {
    api.getQueue = function getQueueLocalFirst(guid) {
      runBackground(`queue:${guid}`, async () => {
        const queueState = await remote.getQueue(guid);
        if (!queueState) return null;
        const normalized = Array.isArray(queueState)
          ? { queue: queueState, mode: 'local', currentEpisodeGuid: '', updatedAt: new Date().toISOString() }
          : queueState;
        const key = `podwaffle_queue_state_${guid}`;
        const local = readJson(key, null);
        const remoteTs = new Date(normalized.updatedAt || 0).getTime();
        const localTs = new Date(local?.updatedAt || 0).getTime();
        if (!local || remoteTs >= localTs) {
          writeJson(key, normalized);
          if (window.player) {
            window.player.queue = window.player._sanitizeQueue
              ? window.player._sanitizeQueue(normalized.queue || [])
              : (normalized.queue || []);
            window.player._queueStateUpdatedAt = normalized.updatedAt || window.player._queueStateUpdatedAt;
            window.player._notifyStateChange?.();
          }
        }
        return normalized;
      });
      return Promise.resolve(localProfile(guid)?.queue || { queue: [], mode: 'local', currentEpisodeGuid: '', updatedAt: null });
    };
  }

  if (remote.getHistory) {
    api.getHistory = function getHistoryLocalFirst(guid, limit = 50, offset = 0) {
      runBackground(`history:${guid}:${limit}:${offset}`, async () => {
        const history = await remote.getHistory(guid, limit, offset);
        if (Array.isArray(history)) {
          writeJson(`podwaffle_history_${guid}`, history);
          window.dispatchEvent(new CustomEvent('podwaffle:history-refreshed', { detail: { guid, history } }));
        }
        return history;
      });
      const history = localProfile(guid)?.history || [];
      return Promise.resolve(history.slice(offset, offset + limit));
    };
  }

  if (remote.getPodcast) {
    api.getPodcast = function getPodcastLocalFirst(feedId, limit = 100, offset = 0) {
      const local = localPodcast(feedId, limit, offset);
      runBackground(`podcast:${feedId}:${offset}:${limit}`, async () => {
        const podcast = await remote.getPodcast(feedId, limit, offset);
        window.dispatchEvent(new CustomEvent('podwaffle:podcast-refreshed', {
          detail: { feedId, limit, offset, podcast },
        }));
        return podcast;
      }, PODCAST_COOLDOWN_MS);
      return Promise.resolve(local);
    };

    api.refreshPodcast = async function refreshPodcastFromBackend(feedId) {
      const podcast = await remote.getPodcast(feedId, 500, 0);
      return {
        ok: true,
        feedId,
        refreshedAt: new Date().toISOString(),
        episodeCount: Array.isArray(podcast?.episodes) ? podcast.episodes.length : 0,
      };
    };
  }

  if (remote.markEpisodesSeen) {
    api.markEpisodesSeen = function markEpisodesSeenInBackground(feedId, guid, episodeGuids) {
      runBackground(
        `episodes-seen:${guid}:${feedId}`,
        () => remote.markEpisodesSeen(feedId, guid, episodeGuids),
        0
      );
      return Promise.resolve({ ok: true, feedId, seenCount: Array.isArray(episodeGuids) ? episodeGuids.length : 0 });
    };
  }

  const originalRenderProfile = window.renderProfile;
  if (typeof originalRenderProfile === 'function') {
    window.renderProfile = async function renderProfileLocalFirst(container) {
      const guid = window.appState?.guid || localStorage.getItem('podwaffle_guid');
      const originalGetUser = api.getUser;
      api.getUser = async (requestedGuid) => localProfile(requestedGuid || guid);
      try {
        return await originalRenderProfile(container);
      } finally {
        api.getUser = originalGetUser;
        scheduleSync(guid, 'profile-route');
      }
    };
  }

  let startupCastReadPending = true;
  let domReady = false;
  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(() => { domReady = true; }, 0);
  }, { once: true });

  const applyBackgroundCastSession = (response) => {
    const state = response?.session || response || null;
    const activeDeviceId = state?.activeDeviceId || state?.deviceId || null;
    if (!state || !activeDeviceId) return;
    if (window.player?.mode === 'cast' && window.player?._activeCastDeviceId && window.player._activeCastDeviceId !== activeDeviceId) {
      return;
    }

    if (window.googleCastSender) {
      window.googleCastSender._currentSession = {
        ...state,
        activeDeviceId,
        deviceId: state.deviceId || activeDeviceId,
      };
    }

    if (window.player) {
      window.player.audio?.pause?.();
      window.player.mode = 'cast';
      window.player._activeCastDeviceId = activeDeviceId;
      window.player.position = Number(state.position) || 0;
      window.player.duration = Number(state.duration) || 0;
      window.player.isPlaying = state.status === 'playing';
      window.player.currentEpisode = {
        ...(window.player.currentEpisode || {}),
        guid: state.episodeGuid || window.player.currentEpisode?.guid || null,
        title: state.title || window.player.currentEpisode?.title || 'Casting session',
        podcastTitle: state.podcastTitle || window.player.currentEpisode?.podcastTitle || 'Casting',
        audioUrl: state.mediaUrl || window.player.currentEpisode?.audioUrl || '',
        podcastImageUrl: state.imageUrl || window.player.currentEpisode?.podcastImageUrl || null,
      };
      window.player._notifyStateChange?.();
    }
  };

  if (remote.getCastSession) {
    api.getCastSession = function getCastSessionNonBlockingAtStartup(...args) {
      const cfg = api.getServerConnectionConfig?.();
      if (!cfg?.enabled || !cfg?.host) {
        return Promise.resolve({ session: null });
      }
      if (!domReady && startupCastReadPending) {
        startupCastReadPending = false;
        runBackground('startup-cast-session', async () => {
          const response = await remote.getCastSession(...args);
          applyBackgroundCastSession(response);
          return response;
        }, 0);
        return Promise.resolve({ session: null });
      }
      return remote.getCastSession(...args);
    };
  }

  window.addEventListener('podwaffle:podcast-refreshed', (event) => {
    const feedId = event.detail?.feedId;
    const route = window.location.hash || '';
    if (!feedId || route !== `#/podcast/${feedId}`) return;
    const main = document.getElementById('main-content');
    if (!main || typeof window.renderPodcastDetail !== 'function') return;
    window.requestAnimationFrame(() => window.renderPodcastDetail(main, feedId));
  });

  api.__localFirstRuntimeInstalled = true;
  window.podwaffleLocalFirstRuntime = {
    localProfile,
    localSubscriptions,
    localPodcast,
    scheduleSync,
    runBackground,
  };
})();