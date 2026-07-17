/* One durable client cache and mutation outbox. The server remains
   authoritative whenever it is reachable. */
(function initializeOfflineStore(root) {
  'use strict';

  const api = root.api;
  if (!api) return;

  const PREFIX = 'podwaffle_cache_v4_';
  const status = {
    lastRefreshAt: null,
    lastFlushAt: null,
    lastError: null,
    source: 'cache',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(`${PREFIX}${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value)); }
    catch (err) { console.warn('[offlineStore] Cache write failed:', key, err?.message || err); }
    return value;
  }

  function profileKey(guid, field) { return `profile_${guid}_${field}`; }
  function podcastKey(feedId) { return `podcast_${encodeURIComponent(String(feedId || ''))}`; }

  function cachedProfile(guid) {
    const base = read(profileKey(guid, 'user'), null);
    if (!base) return null;
    return {
      ...base,
      subscriptions: read(profileKey(guid, 'subscriptions'), base.subscriptions || []),
      progress: read(profileKey(guid, 'progress'), base.progress || {}),
      history: read(profileKey(guid, 'history'), base.history || []),
      stats: read(profileKey(guid, 'stats'), base.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 }),
      queue: read(profileKey(guid, 'queue'), base.queue || []),
      playbackSession: read(profileKey(guid, 'playback'), base.playbackSession || null),
    };
  }

  function rememberProfile(guid, profile = {}) {
    if (!guid || !profile) return profile;
    const current = cachedProfile(guid) || { guid };
    const merged = { ...current, ...profile, guid };
    write(profileKey(guid, 'user'), merged);
    for (const field of ['subscriptions', 'progress', 'history', 'stats']) {
      if (profile[field] !== undefined) write(profileKey(guid, field), profile[field]);
    }
    if (profile.queue !== undefined) write(profileKey(guid, 'queue'), profile.queue);
    if (profile.playbackSession !== undefined) write(profileKey(guid, 'playback'), profile.playbackSession);
    return merged;
  }

  function rememberPodcast(podcast, offset = 0) {
    if (!podcast) return null;
    const feedId = podcast.feedId || podcast.feedUrl;
    if (!feedId) return podcast;
    const existing = read(podcastKey(feedId), {});
    const incomingEpisodes = Array.isArray(podcast.episodes) ? podcast.episodes : [];
    let episodes = Array.isArray(existing.episodes) ? [...existing.episodes] : [];
    if (incomingEpisodes.length) {
      if (offset > 0) incomingEpisodes.forEach((episode, index) => { episodes[offset + index] = episode; });
      else {
        const incomingIds = new Set(incomingEpisodes.map((episode) => episode?.guid).filter(Boolean));
        episodes = [...incomingEpisodes, ...episodes.filter((episode) => !incomingIds.has(episode?.guid))];
      }
    }
    const merged = {
      ...existing,
      ...podcast,
      feedId,
      episodes: episodes.filter(Boolean),
      cachedAt: new Date().toISOString(),
    };
    write(podcastKey(feedId), merged);
    if (podcast.feedUrl && podcast.feedUrl !== feedId) write(podcastKey(podcast.feedUrl), merged);
    return merged;
  }

  function rememberEpisode(episode) {
    if (!episode) return null;
    const feedId = episode.feedId || episode.feedUrl;
    const podcast = read(podcastKey(feedId), {
      feedId,
      feedUrl: episode.feedUrl || '',
      title: episode.podcastTitle || 'Podcast',
      imageUrl: episode.podcastImageUrl || episode.imageUrl || 'icons/icon-192.png',
      episodes: [],
    });
    const episodes = Array.isArray(podcast.episodes) ? [...podcast.episodes] : [];
    const index = episodes.findIndex((item) => item?.guid === episode.guid);
    if (index >= 0) episodes[index] = { ...episodes[index], ...episode };
    else episodes.unshift(episode);
    return rememberPodcast({ ...podcast, episodes });
  }

  function networkFailure(error) {
    return !error?.status || error?.name === 'TypeError';
  }

  function outbox() { return read('outbox', []); }
  function saveOutbox(items) { return write('outbox', items); }

  function queueMutation(method, args, key = '') {
    const items = outbox();
    const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, method, args, key, queuedAt: new Date().toISOString() };
    if (key) {
      const index = items.findIndex((item) => item.key === key);
      if (index >= 0) items[index] = entry;
      else items.push(entry);
    } else items.push(entry);
    saveOutbox(items.slice(-500));
    root.dispatchEvent(new CustomEvent('podwaffle:outbox-changed', { detail: getStatus() }));
    return entry;
  }

  const remote = {};
  const methodNames = [
    'getUser', 'getSubscriptions', 'getProgress', 'getPlaybackSession', 'getQueue', 'getHistory', 'getStats', 'getPodcast',
    'updateSettings', 'subscribe', 'unsubscribe', 'reorderSubscriptions', 'updateProgress', 'updatePlaybackSession',
    'clearPlaybackSession', 'updateQueue', 'addHistory', 'updateStats', 'markEpisodesSeen',
  ];
  methodNames.forEach((name) => { if (typeof api[name] === 'function') remote[name] = api[name].bind(api); });

  async function refreshProfile(guid) {
    if (!guid) return null;
    try {
      const bootstrap = await api.getBootstrapSyncState(guid);
      hydrateSyncState({ guid, ...bootstrap });
      status.lastRefreshAt = new Date().toISOString();
      status.source = 'server';
      status.lastError = null;
      return bootstrap;
    } catch (err) {
      status.lastError = err.message || String(err);
      if (!networkFailure(err)) throw err;
      return null;
    }
  }

  function hydrateSyncState(payload = {}) {
    const guid = payload.guid || payload.snapshot?.guid || localStorage.getItem('podwaffle_guid');
    if (!guid) return;
    const snapshot = payload.snapshot || {};
    const enrichedSubscriptions = Array.isArray(payload.feeds) && payload.feeds.length
      ? payload.feeds
      : snapshot.subscriptions;
    rememberProfile(guid, {
      ...snapshot,
      guid,
      ...(enrichedSubscriptions !== undefined ? { subscriptions: enrichedSubscriptions } : {}),
      ...(payload.queue !== undefined ? { queue: payload.queue } : {}),
      ...(payload.playbackSession !== undefined ? { playbackSession: payload.playbackSession } : {}),
    });
    for (const feed of payload.feeds || []) rememberPodcast(feed);
    status.lastRefreshAt = new Date().toISOString();
    status.source = 'server';
    status.lastError = null;
  }

  api.getUser = async function getUserOffline(guid) {
    const cached = cachedProfile(guid);
    if (cached) {
      refreshProfile(guid).catch(() => {});
      return cached;
    }
    const user = await remote.getUser(guid);
    return rememberProfile(guid, user);
  };

  api.getSubscriptions = async function getSubscriptionsOffline(guid) {
    const cached = read(profileKey(guid, 'subscriptions'), null);
    if (cached) {
      remote.getSubscriptions(guid).then((value) => write(profileKey(guid, 'subscriptions'), value)).catch(() => {});
      return cached;
    }
    const value = await remote.getSubscriptions(guid);
    write(profileKey(guid, 'subscriptions'), value);
    return value;
  };

  api.getProgress = async function getProgressOffline(guid) {
    const cached = read(profileKey(guid, 'progress'), null);
    if (cached) return cached;
    const value = await remote.getProgress(guid);
    write(profileKey(guid, 'progress'), value);
    return value;
  };

  api.getHistory = async function getHistoryOffline(guid, limit = 50, offset = 0) {
    const cached = read(profileKey(guid, 'history'), null);
    if (cached) {
      remote.getHistory(guid, limit, offset).then((value) => write(profileKey(guid, 'history'), value)).catch(() => {});
      return cached.slice(offset, offset + limit);
    }
    const value = await remote.getHistory(guid, limit, offset);
    write(profileKey(guid, 'history'), value);
    return value;
  };

  api.getStats = async function getStatsOffline(guid) {
    const cached = read(profileKey(guid, 'stats'), null);
    if (cached) return cached;
    const value = await remote.getStats(guid);
    write(profileKey(guid, 'stats'), value);
    return value;
  };

  api.getQueue = async function getQueueOffline(guid) {
    try {
      const value = await remote.getQueue(guid);
      write(profileKey(guid, 'queue'), value);
      return value;
    } catch (err) {
      const cached = read(profileKey(guid, 'queue'), null);
      if (cached !== null && networkFailure(err)) return cached;
      throw err;
    }
  };

  api.getPlaybackSession = async function getPlaybackOffline(guid) {
    try {
      const value = await remote.getPlaybackSession(guid);
      write(profileKey(guid, 'playback'), value);
      return value;
    } catch (err) {
      const cached = read(profileKey(guid, 'playback'), null);
      if (networkFailure(err)) return cached;
      throw err;
    }
  };

  api.getPodcast = async function getPodcastOffline(feedId, limit = 100, offset = 0) {
    const cached = read(podcastKey(feedId), null);
    if (cached) {
      remote.getPodcast(feedId, limit, offset).then((value) => {
        rememberPodcast(value, offset);
        root.dispatchEvent(new CustomEvent('podwaffle:podcast-refreshed', { detail: { feedId, podcast: value } }));
      }).catch(() => {});
      return { ...cached, episodes: (cached.episodes || []).slice(offset, offset + limit) };
    }
    return rememberPodcast(await remote.getPodcast(feedId, limit, offset), offset);
  };

  function installWrite(name, localUpdate, keyFor, reconcile) {
    api[name] = async (...args) => {
      const guid = args[0];
      const before = typeof guid === 'string' ? cachedProfile(guid) : null;
      const optimistic = localUpdate ? localUpdate(...args) : null;
      try {
        const result = await remote[name](...args);
        if (reconcile) reconcile(result, ...args);
        status.source = 'server';
        status.lastError = null;
        return result ?? optimistic;
      } catch (err) {
        if (!networkFailure(err)) {
          if (before) rememberProfile(guid, before);
          throw err;
        }
        status.source = 'offline';
        status.lastError = err.message || String(err);
        queueMutation(name, args, keyFor ? keyFor(...args) : '');
        return optimistic;
      }
    };
  }

  installWrite('updateSettings', (guid, settings) => {
    const profile = cachedProfile(guid) || { guid, settings: {} };
    return rememberProfile(guid, { ...profile, settings: { ...(profile.settings || {}), ...settings } }).settings;
  }, (guid) => `settings:${guid}`);

  installWrite('updateProgress', (guid, episodeGuid, data) => {
    const progress = read(profileKey(guid, 'progress'), {});
    progress[episodeGuid] = { ...(progress[episodeGuid] || {}), ...data };
    write(profileKey(guid, 'progress'), progress);
    return progress[episodeGuid];
  }, (guid, episodeGuid) => `progress:${guid}:${episodeGuid}`, (result, guid, episodeGuid) => {
    if (!result) return;
    const progress = read(profileKey(guid, 'progress'), {});
    progress[episodeGuid] = result;
    write(profileKey(guid, 'progress'), progress);
  });

  installWrite(
    'updatePlaybackSession',
    (guid, session) => write(profileKey(guid, 'playback'), session),
    (guid) => `playback:${guid}`,
    (result, guid) => { if (result) write(profileKey(guid, 'playback'), result); }
  );
  installWrite('updateQueue', (guid, queue, metadata) => {
    const value = { queue: Array.isArray(queue) ? queue : [], ...(metadata || {}) };
    write(profileKey(guid, 'queue'), value);
    return value;
  }, (guid) => `queue:${guid}`, (result, guid) => { if (result) write(profileKey(guid, 'queue'), result); });

  installWrite('clearPlaybackSession', (guid) => write(profileKey(guid, 'playback'), null), (guid) => `playback:${guid}`);
  installWrite('reorderSubscriptions', (guid, feedIds) => {
    const items = read(profileKey(guid, 'subscriptions'), []);
    const byId = new Map(items.map((item) => [item.feedId || item.feedUrl, item]));
    const value = [...feedIds.map((id) => byId.get(id)).filter(Boolean), ...items.filter((item) => !feedIds.includes(item.feedId || item.feedUrl))];
    write(profileKey(guid, 'subscriptions'), value);
    return value;
  }, (guid) => `subscription-order:${guid}`);

  installWrite('subscribe', (guid, feedUrl, metadata = {}) => {
    const items = read(profileKey(guid, 'subscriptions'), []);
    const entry = { feedUrl, ...metadata };
    const value = [...items.filter((item) => (item.feedUrl || item) !== feedUrl), entry];
    write(profileKey(guid, 'subscriptions'), value);
    rememberPodcast(entry);
    return entry;
  });
  const subscribeWithOutbox = api.subscribe.bind(api);
  api.subscribe = async (guid, feedUrl, metadata = {}) => {
    const result = await subscribeWithOutbox(guid, feedUrl, metadata);
    if (result && (result.feedId || result.feedUrl)) {
      const resolvedUrl = result.feedUrl || feedUrl;
      const items = read(profileKey(guid, 'subscriptions'), []);
      const reconciled = {
        ...metadata,
        ...result,
        feedUrl: resolvedUrl,
      };
      write(profileKey(guid, 'subscriptions'), [
        ...items.filter((item) => (item.feedUrl || item) !== feedUrl && item.feedId !== result.feedId),
        reconciled,
      ]);
      rememberPodcast(reconciled);
    }
    return result;
  };

  installWrite('unsubscribe', (guid, feedId) => {
    const value = read(profileKey(guid, 'subscriptions'), []).filter((item) => item.feedId !== feedId && item.feedUrl !== feedId && item !== feedId);
    write(profileKey(guid, 'subscriptions'), value);
    return { ok: true };
  });
  installWrite('addHistory', (guid, entry) => {
    const value = [{ ...entry, listenedAt: entry.listenedAt || new Date().toISOString() }, ...read(profileKey(guid, 'history'), [])].slice(0, 1000);
    write(profileKey(guid, 'history'), value);
    return value[0];
  });
  installWrite('updateStats', null);
  const updateStatsWithOutbox = api.updateStats.bind(api);
  api.updateStats = (guid, listenedDelta, skippedDelta, mutationId = '') => updateStatsWithOutbox(
    guid,
    listenedDelta,
    skippedDelta,
    mutationId || `${root.getPodwaffleClientId?.() || 'client'}:${Date.now()}:${Math.random().toString(16).slice(2)}`
  );
  installWrite('markEpisodesSeen', null);

  let flushPromise = null;
  async function flushOutbox() {
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      const items = outbox();
      const remaining = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const method = remote[item.method];
        if (!method) continue;
        try {
          await method(...(item.args || []));
        } catch (err) {
          if (err?.status === 409 && (item.method === 'updatePlaybackSession' || item.method === 'clearPlaybackSession')) {
            // Another online client owns the lease. This offline snapshot is
            // obsolete and must not block later progress/subscription writes.
            continue;
          }
          remaining.push(item, ...items.slice(index + 1));
          status.lastError = err.message || String(err);
          break;
        }
      }
      saveOutbox(remaining);
      if (!remaining.length) {
        status.lastFlushAt = new Date().toISOString();
        status.lastError = null;
        status.source = 'server';
      }
      root.dispatchEvent(new CustomEvent('podwaffle:outbox-changed', { detail: getStatus() }));
      return { flushed: items.length - remaining.length, remaining: remaining.length };
    })().finally(() => { flushPromise = null; });
    return flushPromise;
  }

  function getStatus() {
    return { ...status, online: navigator.onLine, queuedMutations: outbox().length };
  }

  const offlineStore = {
    read,
    write,
    cachedProfile,
    rememberProfile,
    rememberPodcast,
    rememberEpisode,
    refreshProfile,
    hydrateSyncState,
    flushOutbox,
    getStatus,
    getSubscriptions(guid) { return read(profileKey(guid, 'subscriptions'), []); },
    pinnedAudio() { return new Set(read('pinned_audio', [])); },
    isAudioPinned(url) { return this.pinnedAudio().has(String(url || '')); },
    pinAudio(url) { const values = this.pinnedAudio(); if (url) values.add(String(url)); write('pinned_audio', [...values]); },
    unpinAudio(url) { const values = this.pinnedAudio(); values.delete(String(url || '')); write('pinned_audio', [...values]); },
  };
  root.offlineStore = offlineStore;

  root.addEventListener('online', () => flushOutbox().then(() => refreshProfile(localStorage.getItem('podwaffle_guid'))).catch(() => {}));
  root.addEventListener('podwaffle:websocket-connected', () => flushOutbox().catch(() => {}));

  if (root.cacheManager) {
    const manager = root.cacheManager;
    const download = manager.downloadEpisode?.bind(manager);
    if (download) manager.downloadEpisode = async function downloadAndPin(episode) {
      rememberEpisode(episode);
      const result = await download(episode);
      const url = this._resolveUrl(episode);
      if (url && result === 'cached') offlineStore.pinAudio(url);
      return result;
    };
    const remove = manager.deleteEpisode?.bind(manager);
    if (remove) manager.deleteEpisode = async function removeAndUnpin(episode) {
      const url = this._resolveUrl(episode);
      const result = await remove(episode);
      offlineStore.unpinAudio(url);
      return result;
    };
    const expired = manager._isExpired?.bind(manager);
    if (expired) manager._isExpired = (url) => offlineStore.isAudioPinned(url) ? false : expired(url);
  }
})(window);
