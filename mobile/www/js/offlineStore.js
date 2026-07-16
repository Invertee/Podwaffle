/* Durable offline metadata and explicit-download state. */
(function initOfflineStore() {
  const SUBS_PREFIX = 'podwaffle_offline_subscriptions_';
  const CATALOG_KEY = 'podwaffle_podcast_catalog';
  const PINNED_AUDIO_KEY = 'podwaffle_pinned_audio_v1';

  const read = (key, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[offlineStore] Persist failed:', key, err);
    }
    return value;
  };

  const feedUrlOf = (entry) => typeof entry === 'string'
    ? entry.trim()
    : String(entry?.feedUrl || entry?.url || '').trim();

  const makeFeedId = (value) => {
    const input = String(value || '').trim();
    if (!input) return 'podcast';
    let source = input;
    try {
      const parsed = new URL(input);
      source = `${parsed.hostname}${parsed.pathname}`;
    } catch (_) {}
    return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'podcast';
  };

  const fallbackTitle = (feedUrl) => {
    try {
      return new URL(feedUrl).hostname.replace(/^www\./, '') || 'Podcast';
    } catch (_) {
      return 'Podcast';
    }
  };

  const getCatalog = () => read(CATALOG_KEY, {}) || {};
  const saveCatalog = (catalog) => write(CATALOG_KEY, catalog || {});

  const findPodcast = (catalog, identifier) => {
    const needle = String(identifier || '').trim().toLowerCase();
    if (!needle) return null;
    if (catalog[identifier]) return catalog[identifier];
    return Object.values(catalog).find((item) => item && (
      String(item.feedId || '').toLowerCase() === needle
      || String(item.feedUrl || '').toLowerCase() === needle
      || String(item.title || '').toLowerCase() === needle
    )) || null;
  };

  const normalizePodcast = (podcast = {}, fallback = {}) => {
    const merged = { ...fallback, ...podcast };
    const feedUrl = feedUrlOf(merged);
    return {
      ...merged,
      feedId: String(merged.feedId || makeFeedId(feedUrl || merged.title)),
      feedUrl,
      title: merged.title || fallbackTitle(feedUrl),
      author: merged.author || '',
      description: merged.description || '',
      imageUrl: merged.imageUrl || merged.podcastImageUrl || 'icons/icon-192.png',
      episodes: Array.isArray(merged.episodes) ? merged.episodes : [],
      lastRefreshed: merged.lastRefreshed || new Date().toISOString(),
    };
  };

  function rememberPodcast(podcast, offset = 0) {
    if (!podcast) return null;
    const incoming = normalizePodcast(podcast);
    const catalog = getCatalog();
    const existing = findPodcast(catalog, incoming.feedId) || findPodcast(catalog, incoming.feedUrl) || {};
    const merged = normalizePodcast(incoming, existing);
    const incomingEpisodes = Array.isArray(podcast.episodes) ? podcast.episodes : [];
    const existingEpisodes = Array.isArray(existing.episodes) ? existing.episodes : [];

    if (!incomingEpisodes.length) {
      merged.episodes = existingEpisodes;
    } else if (offset > 0 && existingEpisodes.length) {
      merged.episodes = [...existingEpisodes];
      incomingEpisodes.forEach((episode, index) => {
        merged.episodes[offset + index] = episode;
      });
      merged.episodes = merged.episodes.filter(Boolean);
    } else {
      const incomingGuids = new Set(incomingEpisodes.map((episode) => episode?.guid).filter(Boolean));
      merged.episodes = [...incomingEpisodes, ...existingEpisodes.filter((episode) => !episode?.guid || !incomingGuids.has(episode.guid))];
    }

    merged.totalEpisodes = Math.max(Number(merged.totalEpisodes) || 0, Number(existing.totalEpisodes) || 0, merged.episodes.length);
    catalog[merged.feedId] = merged;
    saveCatalog(catalog);
    return merged;
  }

  function rememberEpisode(episode) {
    if (!episode) return null;
    const feedId = String(episode.feedId || makeFeedId(episode.feedUrl || episode.podcastTitle));
    const catalog = getCatalog();
    const existing = findPodcast(catalog, feedId) || findPodcast(catalog, episode.feedUrl) || {};
    const podcast = normalizePodcast({
      ...existing,
      feedId,
      feedUrl: episode.feedUrl || existing.feedUrl || '',
      title: episode.podcastTitle || existing.title || 'Podcast',
      imageUrl: episode.podcastImageUrl || episode.imageUrl || existing.imageUrl,
    });
    const episodes = [...podcast.episodes];
    const index = episodes.findIndex((item) => item?.guid === episode.guid);
    const saved = {
      ...(index >= 0 ? episodes[index] : {}),
      ...episode,
      feedId,
      podcastTitle: episode.podcastTitle || podcast.title,
      podcastImageUrl: episode.podcastImageUrl || podcast.imageUrl,
      imageUrl: episode.imageUrl || episode.podcastImageUrl || podcast.imageUrl,
    };
    if (index >= 0) episodes[index] = saved;
    else episodes.unshift(saved);
    podcast.episodes = episodes;
    podcast.totalEpisodes = Math.max(Number(podcast.totalEpisodes) || 0, episodes.length);
    catalog[podcast.feedId] = podcast;
    saveCatalog(catalog);
    return saved;
  }

  const getSubscriptions = (guid) => read(`${SUBS_PREFIX}${guid}`, []) || [];

  function hydrateSubscriptions(guid, subscriptions = []) {
    const catalog = getCatalog();
    const cached = getSubscriptions(guid);
    return subscriptions.map((entry) => {
      const feedUrl = feedUrlOf(entry);
      const suppliedFeedId = typeof entry === 'object' ? String(entry?.feedId || '') : '';
      const fallback = cached.find((item) => (suppliedFeedId && item?.feedId === suppliedFeedId) || item?.feedUrl === feedUrl)
        || findPodcast(catalog, suppliedFeedId)
        || findPodcast(catalog, feedUrl)
        || {};
      const feedId = suppliedFeedId || fallback.feedId || makeFeedId(feedUrl);
      return normalizePodcast(typeof entry === 'object' ? entry : { feedId, feedUrl }, fallback);
    });
  }

  function saveSubscriptions(guid, subscriptions) {
    const normalized = (subscriptions || []).filter(Boolean).map((item) => normalizePodcast(item));
    normalized.forEach((item) => rememberPodcast(item));
    return write(`${SUBS_PREFIX}${guid}`, normalized);
  }

  const offlineStore = {
    rememberPodcast,
    rememberEpisode,
    hydrateSubscriptions,
    getSubscriptions,
    pinnedAudio() {
      return new Set(read(PINNED_AUDIO_KEY, []) || []);
    },
    isAudioPinned(url) {
      return this.pinnedAudio().has(String(url || ''));
    },
    pinAudio(url) {
      const urls = this.pinnedAudio();
      if (url) urls.add(String(url));
      write(PINNED_AUDIO_KEY, [...urls]);
    },
    unpinAudio(url) {
      const urls = this.pinnedAudio();
      if (url) urls.delete(String(url));
      write(PINNED_AUDIO_KEY, [...urls]);
    },
  };
  window.offlineStore = offlineStore;

  if (window.api) {
    const api = window.api;
    const originalGetSubscriptions = api.getSubscriptions.bind(api);
    api.getSubscriptions = async (guid) => {
      try {
        const hydrated = hydrateSubscriptions(guid, await originalGetSubscriptions(guid));
        if (hydrated.length) saveSubscriptions(guid, hydrated);
        return hydrated;
      } catch (err) {
        const cached = getSubscriptions(guid);
        if (cached.length) return cached;
        throw err;
      }
    };

    const originalGetPodcast = api.getPodcast.bind(api);
    api.getPodcast = async (feedId, limit = 100, offset = 0) => {
      try {
        const podcast = await originalGetPodcast(feedId, limit, offset);
        rememberPodcast(podcast, offset);
        return podcast;
      } catch (err) {
        const cached = findPodcast(getCatalog(), feedId);
        if (!cached) throw err;
        return { ...cached, episodes: (cached.episodes || []).slice(offset, offset + limit) };
      }
    };

    const originalSubscribe = api.subscribe.bind(api);
    api.subscribe = async (guid, feedUrl, metadata) => {
      const result = await originalSubscribe(guid, feedUrl, metadata);
      const added = rememberPodcast(metadata || result || { feedUrl });
      const all = hydrateSubscriptions(guid, [...getSubscriptions(guid), added || { feedUrl }]);
      const deduped = all.filter((item, index) => all.findIndex((candidate) => (candidate.feedUrl || candidate.feedId) === (item.feedUrl || item.feedId)) === index);
      saveSubscriptions(guid, deduped);
      return result;
    };

    const originalUnsubscribe = api.unsubscribe.bind(api);
    api.unsubscribe = async (guid, feedId) => {
      const result = await originalUnsubscribe(guid, feedId);
      saveSubscriptions(guid, getSubscriptions(guid).filter((item) => item.feedId !== feedId && item.feedUrl !== feedId));
      return result;
    };
  }

  if (window.cacheManager) {
    const manager = window.cacheManager;
    const originalDownload = manager.downloadEpisode.bind(manager);
    manager.downloadEpisode = async function downloadAndPin(episode) {
      rememberEpisode(episode);
      const status = await originalDownload(episode);
      const url = this._resolveUrl(episode);
      if (url && status === 'cached') offlineStore.pinAudio(url);
      return status;
    };

    const originalDelete = manager.deleteEpisode.bind(manager);
    manager.deleteEpisode = async function deleteAndUnpin(episode) {
      const url = this._resolveUrl(episode);
      const deleted = await originalDelete(episode);
      offlineStore.unpinAudio(url);
      return deleted;
    };

    const originalIsExpired = manager._isExpired.bind(manager);
    manager._isExpired = (url) => offlineStore.isAudioPinned(url) ? false : originalIsExpired(url);

    manager.cleanupExpired = async function cleanupTransientAudio() {
      if (!this.isSupported()) return;
      const cache = await this._getCache();
      const requests = await cache.keys();
      const now = Date.now();
      for (const request of requests) {
        const url = request.url;
        if (offlineStore.isAudioPinned(url)) continue;
        const cachedAt = this._cacheIndex?.[url];
        if (!cachedAt || !Number.isFinite(cachedAt)) this._cacheIndex[url] = now;
        else if ((now - cachedAt) > this.TTL_MS) {
          await cache.delete(request);
          this._setStatus(url, 'uncached');
          delete this._cacheIndex[url];
        }
      }
      const existing = new Set(requests.map((request) => request.url));
      Object.keys(this._cacheIndex || {}).forEach((url) => {
        if (!existing.has(url)) delete this._cacheIndex[url];
      });
      this._saveIndex();
    };
  }
})();
