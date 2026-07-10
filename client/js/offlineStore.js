/* ============================================================
   Podwaffle - offlineStore.js
   Durable metadata and explicit-download helpers for offline use.
   Loaded after api.js, cacheManager.js, and syncManager.js.
   ============================================================ */

(function initOfflineStore() {
  const SUBSCRIPTIONS_KEY_PREFIX = 'podwaffle_offline_subscriptions_';
  const PODCAST_CATALOG_KEY = 'podwaffle_podcast_catalog';
  const PINNED_AUDIO_KEY = 'podwaffle_pinned_audio_v1';

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[offlineStore] Failed to persist', key, err);
    }
    return value;
  }

  function subscriptionUrl(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    return String(entry.feedUrl || entry.url || '').trim();
  }

  function makeFeedId(value) {
    const input = String(value || '').trim();
    if (!input) return 'podcast';
    try {
      const parsed = new URL(input);
      return `${parsed.hostname}${parsed.pathname}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'podcast';
    } catch (_) {
      return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'podcast';
    }
  }

  function fallbackTitle(feedUrl) {
    try {
      const parsed = new URL(feedUrl);
      return parsed.hostname.replace(/^www\./, '') || 'Podcast';
    } catch (_) {
      return 'Podcast';
    }
  }

  function getCatalog() {
    return readJson(PODCAST_CATALOG_KEY, {}) || {};
  }

  function saveCatalog(catalog) {
    return writeJson(PODCAST_CATALOG_KEY, catalog || {});
  }

  function findCatalogEntry(catalog, identifier) {
    const needle = String(identifier || '').trim().toLowerCase();
    if (!needle) return null;
    if (catalog[identifier]) return catalog[identifier];
    return Object.values(catalog).find((entry) => entry && (
      String(entry.feedId || '').toLowerCase() === needle
      || String(entry.feedUrl || '').toLowerCase() === needle
      || String(entry.title || '').toLowerCase() === needle
    )) || null;
  }

  function normalizePodcast(podcast, fallback = {}) {
    if (!podcast && !fallback) return null;
    const merged = { ...(fallback || {}), ...(podcast || {}) };
    const feedUrl = subscriptionUrl(merged);
    const feedId = String(merged.feedId || makeFeedId(feedUrl || merged.title || 'podcast'));
    return {
      ...merged,
      feedId,
      feedUrl,
      title: merged.title || fallbackTitle(feedUrl),
      author: merged.author || '',
      description: merged.description || '',
      imageUrl: merged.imageUrl || merged.podcastImageUrl || 'icons/icon-192.png',
      episodes: Array.isArray(merged.episodes) ? merged.episodes : [],
      lastRefreshed: merged.lastRefreshed || new Date().toISOString(),
    };
  }

  function rememberPodcast(podcast) {
    const normalized = normalizePodcast(podcast);
    if (!normalized) return null;
    const catalog = getCatalog();
    const existing = findCatalogEntry(catalog, normalized.feedId)
      || findCatalogEntry(catalog, normalized.feedUrl)
      || {};
    const merged = normalizePodcast(normalized, existing);
    catalog[merged.feedId] = merged;
    saveCatalog(catalog);
    return merged;
  }

  function rememberEpisode(episode) {
    if (!episode) return null;
    const feedId = String(episode.feedId || makeFeedId(episode.feedUrl || episode.podcastTitle || 'podcast'));
    const catalog = getCatalog();
    const existing = findCatalogEntry(catalog, feedId)
      || findCatalogEntry(catalog, episode.feedUrl)
      || {};
    const podcast = normalizePodcast({
      ...existing,
      feedId,
      feedUrl: episode.feedUrl || existing.feedUrl || '',
      title: episode.podcastTitle || existing.title || 'Podcast',
      imageUrl: episode.podcastImageUrl || episode.imageUrl || existing.imageUrl,
    });
    const episodes = Array.isArray(podcast.episodes) ? [...podcast.episodes] : [];
    const index = episodes.findIndex((item) => item && item.guid === episode.guid);
    const normalizedEpisode = {
      ...(index >= 0 ? episodes[index] : {}),
      ...episode,
      feedId,
      podcastTitle: episode.podcastTitle || podcast.title,
      podcastImageUrl: episode.podcastImageUrl || podcast.imageUrl,
      imageUrl: episode.imageUrl || episode.podcastImageUrl || podcast.imageUrl,
    };
    if (index >= 0) episodes[index] = normalizedEpisode;
    else episodes.unshift(normalizedEpisode);
    podcast.episodes = episodes;
    podcast.totalEpisodes = Math.max(Number(podcast.totalEpisodes) || 0, episodes.length);
    catalog[podcast.feedId] = podcast;
    saveCatalog(catalog);
    return normalizedEpisode;
  }

  function getOfflineSubscriptions(guid) {
    return readJson(`${SUBSCRIPTIONS_KEY_PREFIX}${guid}`, []) || [];
  }

  function saveOfflineSubscriptions(guid, subscriptions) {
    const normalized = (subscriptions || []).filter(Boolean).map((entry) => normalizePodcast(entry));
    normalized.forEach(rememberPodcast);
    return writeJson(`${SUBSCRIPTIONS_KEY_PREFIX}${guid}`, normalized);
  }

  function hydrateSubscriptions(guid, subscriptions) {
    const catalog = getCatalog();
    const offline = getOfflineSubscriptions(guid);
    const offlineByUrl = new Map();
    const offlineById = new Map();
    offline.forEach((entry) => {
      if (!entry) return;
      if (entry.feedUrl) offlineByUrl.set(String(entry.feedUrl).toLowerCase(), entry);
      if (entry.feedId) offlineById.set(String(entry.feedId).toLowerCase(), entry);
    });

    return (subscriptions || []).map((entry) => {
      const feedUrl = subscriptionUrl(entry);
      const feedId = typeof entry === 'object' && entry
        ? String(entry.feedId || makeFeedId(feedUrl))
        : makeFeedId(feedUrl);
      const cached = offlineById.get(feedId.toLowerCase())
        || offlineByUrl.get(feedUrl.toLowerCase())
        || findCatalogEntry(catalog, feedId)
        || findCatalogEntry(catalog, feedUrl)
        || {};
      return normalizePodcast(typeof entry === 'object' ? entry : { feedUrl, feedId }, cached);
    });
  }

  const offlineStore = {
    rememberPodcast,
    rememberEpisode,
    hydrateSubscriptions,
    getOfflineSubscriptions,
    getPinnedAudioUrls() {
      return new Set(readJson(PINNED_AUDIO_KEY, []) || []);
    },
    isAudioPinned(url) {
      return this.getPinnedAudioUrls().has(String(url || ''));
    },
    pinAudio(url) {
      if (!url) return;
      const urls = this.getPinnedAudioUrls();
      urls.add(String(url));
      writeJson(PINNED_AUDIO_KEY, [...urls]);
    },
    unpinAudio(url) {
      if (!url) return;
      const urls = this.getPinnedAudioUrls();
      urls.delete(String(url));
      writeJson(PINNED_AUDIO_KEY, [...urls]);
    },
  };

  window.offlineStore = offlineStore;

  if (window.api) {
    const originalGetSubscriptions = window.api.getSubscriptions.bind(window.api);
    window.api.getSubscriptions = async function getSubscriptionsOfflineFirst(guid) {
      try {
        const subscriptions = await originalGetSubscriptions(guid);
        const hydrated = hydrateSubscriptions(guid, subscriptions);
        if (hydrated.length > 0) saveOfflineSubscriptions(guid, hydrated);
        return hydrated;
      } catch (err) {
        const cached = getOfflineSubscriptions(guid);
        if (cached.length > 0) {
          console.warn('[offlineStore] Using cached subscriptions:', err?.message || err);
          return cached;
        }
        throw err;
      }
    };

    const originalGetPodcast = window.api.getPodcast.bind(window.api);
    window.api.getPodcast = async function getPodcastOfflineFirst(feedId, limit = 100, offset = 0) {
      try {
        const podcast = await originalGetPodcast(feedId, limit, offset);
        const remembered = rememberPodcast(podcast);
        if (!remembered) return podcast;
        return {
          ...remembered,
          episodes: (remembered.episodes || []).slice(offset, offset + limit),
        };
      } catch (err) {
        const cached = findCatalogEntry(getCatalog(), feedId);
        if (cached) {
          console.warn('[offlineStore] Using cached podcast:', feedId, err?.message || err);
          return {
            ...cached,
            episodes: (cached.episodes || []).slice(offset, offset + limit),
          };
        }
        throw err;
      }
    };

    const originalSubscribe = window.api.subscribe.bind(window.api);
    window.api.subscribe = async function subscribeOfflineFirst(guid, feedUrl, metadata) {
      const result = await originalSubscribe(guid, feedUrl, metadata);
      const remembered = rememberPodcast(metadata || result || { feedUrl });
      const current = hydrateSubscriptions(guid, [
        ...getOfflineSubscriptions(guid),
        remembered || { feedUrl },
      ]);
      saveOfflineSubscriptions(guid, current.filter((entry, index, all) => {
        const key = entry.feedUrl || entry.feedId;
        return all.findIndex((candidate) => (candidate.feedUrl || candidate.feedId) === key) === index;
      }));
      return result;
    };

    const originalUnsubscribe = window.api.unsubscribe.bind(window.api);
    window.api.unsubscribe = async function unsubscribeOfflineFirst(guid, feedId) {
      const result = await originalUnsubscribe(guid, feedId);
      const remaining = getOfflineSubscriptions(guid).filter((entry) => (
        entry.feedId !== feedId && entry.feedUrl !== feedId
      ));
      saveOfflineSubscriptions(guid, remaining);
      return result;
    };
  }

  if (window.cacheManager) {
    const manager = window.cacheManager;
    const originalDownloadEpisode = manager.downloadEpisode.bind(manager);
    manager.downloadEpisode = async function downloadEpisodeAndPin(episode) {
      rememberEpisode(episode);
      const status = await originalDownloadEpisode(episode);
      const url = this._resolveUrl(episode);
      if (url && status === 'cached') offlineStore.pinAudio(url);
      return status;
    };

    const originalDeleteEpisode = manager.deleteEpisode.bind(manager);
    manager.deleteEpisode = async function deleteEpisodeAndUnpin(episode) {
      const url = this._resolveUrl(episode);
      const deleted = await originalDeleteEpisode(episode);
      if (url) offlineStore.unpinAudio(url);
      return deleted;
    };

    const originalIsExpired = manager._isExpired.bind(manager);
    manager._isExpired = function isExpiredUnlessPinned(url) {
      if (offlineStore.isAudioPinned(url)) return false;
      return originalIsExpired(url);
    };

    manager.cleanupExpired = async function cleanupExpiredUnlessPinned() {
      if (!this.isSupported()) return;
      const cache = await this._getCache();
      const requests = await cache.keys();
      const now = Date.now();

      for (const request of requests) {
        const url = request.url;
        if (offlineStore.isAudioPinned(url)) continue;
        const cachedAt = this._cacheIndex ? this._cacheIndex[url] : null;
        if (!cachedAt || !Number.isFinite(cachedAt)) {
          this._cacheIndex[url] = now;
          continue;
        }
        if ((now - cachedAt) > this.TTL_MS) {
          await cache.delete(request);
          this._setStatus(url, 'uncached');
          delete this._cacheIndex[url];
        }
      }

      const existingUrlSet = new Set(requests.map((request) => request.url));
      Object.keys(this._cacheIndex || {}).forEach((url) => {
        if (!existingUrlSet.has(url)) delete this._cacheIndex[url];
      });
      this._saveIndex();
    };
  }
})();
