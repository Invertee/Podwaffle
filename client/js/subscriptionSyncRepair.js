/* Repairs subscription identity, metadata hydration, and native podcast search. */
(function installSubscriptionSyncRepair(root) {
  'use strict';

  const api = root && root.api;
  if (!api || api.__subscriptionSyncRepairInstalled) return;

  const pending = new Map();
  const SUBS_PREFIX = 'podwaffle_subscriptions_';
  const OFFLINE_SUBS_PREFIX = 'podwaffle_offline_subscriptions_';
  const CATALOG_KEY = 'podwaffle_podcast_catalog';

  function readJson(key, fallback) {
    try {
      const raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      root.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[subscriptionSyncRepair] Failed to persist:', key, err?.message || err);
    }
    return value;
  }

  function feedUrlOf(entry) {
    if (typeof entry === 'string') return entry.trim();
    return String(entry?.feedUrl || entry?.url || '').trim();
  }

  function canonicalFeedUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      url.hash = '';
      url.hostname = url.hostname.toLowerCase();
      if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
        url.port = '';
      }
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
      return url.toString();
    } catch (_) {
      return raw;
    }
  }

  function isServerFeedId(value) {
    return /^[a-f0-9]{32}$/i.test(String(value || ''));
  }

  function isPlaceholder(field, value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return true;
    if (field === 'title') return text === 'podcast' || text === 'unknown podcast' || text === 'untitled podcast';
    if (field === 'imageUrl') return text.endsWith('/icons/icon-192.png') || text === 'icons/icon-192.png';
    return false;
  }

  function mergeSubscriptionEntry(existing, incoming) {
    const left = typeof existing === 'object' && existing ? existing : { feedUrl: feedUrlOf(existing) };
    const right = typeof incoming === 'object' && incoming ? incoming : { feedUrl: feedUrlOf(incoming) };
    const merged = { ...left, ...right };
    const feedUrl = feedUrlOf(right) || feedUrlOf(left);
    if (feedUrl) merged.feedUrl = feedUrl;

    const leftId = String(left.feedId || '');
    const rightId = String(right.feedId || '');
    merged.feedId = isServerFeedId(rightId)
      ? rightId
      : (isServerFeedId(leftId) ? leftId : (rightId || leftId));

    for (const field of ['title', 'author', 'description', 'imageUrl']) {
      if (isPlaceholder(field, right[field]) && !isPlaceholder(field, left[field])) {
        merged[field] = left[field];
      }
    }

    if (!merged.title) merged.title = 'Podcast';
    if (!merged.imageUrl) merged.imageUrl = 'icons/icon-192.png';
    return merged;
  }

  function dedupeSubscriptions(items) {
    const result = [];
    const indexes = new Map();

    for (const item of Array.isArray(items) ? items : []) {
      if (!item) continue;
      const feedUrl = feedUrlOf(item);
      const feedId = typeof item === 'object' ? String(item.feedId || '').trim() : '';
      const key = canonicalFeedUrl(feedUrl) || (feedId ? `id:${feedId}` : '');
      if (!key) continue;

      if (!indexes.has(key)) {
        indexes.set(key, result.length);
        result.push(mergeSubscriptionEntry(null, item));
      } else {
        const index = indexes.get(key);
        result[index] = mergeSubscriptionEntry(result[index], item);
      }
    }

    return result;
  }

  function subscriptionUrls(items) {
    const seen = new Set();
    const urls = [];
    for (const item of Array.isArray(items) ? items : []) {
      const url = feedUrlOf(item);
      const key = canonicalFeedUrl(url);
      if (!url || !key || seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
    }
    return urls;
  }

  function subscriptionSignature(items) {
    return JSON.stringify(dedupeSubscriptions(items).map((item) => ({
      feedId: item.feedId || '',
      feedUrl: canonicalFeedUrl(item.feedUrl),
      title: item.title || '',
      imageUrl: item.imageUrl || '',
      author: item.author || '',
      description: item.description || '',
      episodeCount: Number(item.episodeCount || item.totalEpisodes || 0),
    })));
  }

  function repairCatalog(preferredItems = []) {
    const catalog = readJson(CATALOG_KEY, {}) || {};
    const all = [...Object.values(catalog), ...preferredItems].filter(Boolean);
    const repaired = {};

    for (const item of dedupeSubscriptions(all)) {
      const fallbackKey = api._makeFeedId?.(item.feedUrl, item.title) || item.feedUrl || item.title;
      const key = item.feedId || fallbackKey;
      if (!key) continue;
      repaired[key] = {
        ...(catalog[key] || {}),
        ...item,
        feedId: key,
      };
    }

    writeJson(CATALOG_KEY, repaired);
    return repaired;
  }

  function persistSubscriptions(guid, items, options = {}) {
    if (!guid) return [];
    const normalized = dedupeSubscriptions(items);
    const before = dedupeSubscriptions([
      ...readJson(`${OFFLINE_SUBS_PREFIX}${guid}`, []),
      ...readJson(`${SUBS_PREFIX}${guid}`, []),
    ]);

    normalized.forEach((item) => root.offlineStore?.rememberPodcast?.(item));
    repairCatalog(normalized);
    writeJson(`${SUBS_PREFIX}${guid}`, normalized);
    writeJson(`${OFFLINE_SUBS_PREFIX}${guid}`, normalized);

    if (root.appState?.guid === guid) {
      root.appState.subscriptions = normalized;
      if (root.appState.user) root.appState.user.subscriptions = normalized;
    }

    if (options.notify && subscriptionSignature(before) !== subscriptionSignature(normalized)) {
      root.dispatchEvent(new CustomEvent('podwaffle:subscriptions-refreshed', {
        detail: { guid, subscriptions: normalized, reason: options.reason || 'remote-refresh' },
      }));
    }
    return normalized;
  }

  function backendConfigured() {
    const cfg = api.getServerConnectionConfig?.();
    return !!(cfg?.enabled && cfg?.host);
  }

  function refreshSubscriptions(guid, reason = 'background') {
    const remoteGet = api.__remoteReads?.getSubscriptions;
    if (!guid || !backendConfigured() || typeof remoteGet !== 'function') return Promise.resolve(null);
    const key = `subscriptions:${guid}`;
    if (pending.has(key)) return pending.get(key);

    const task = Promise.resolve()
      .then(() => remoteGet(guid))
      .then((items) => persistSubscriptions(guid, items, { notify: true, reason }))
      .catch((err) => {
        console.warn('[subscriptionSyncRepair] Subscription metadata refresh failed:', err?.message || err);
        return null;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  const originalGetSubscriptions = api.getSubscriptions.bind(api);
  api.getSubscriptions = async function getSubscriptionsDeduped(guid) {
    const local = await originalGetSubscriptions(guid);
    const normalized = persistSubscriptions(guid, local, { notify: false });
    refreshSubscriptions(guid, 'subscriptions-read');
    return normalized;
  };

  if (typeof api.subscribe === 'function') {
    const originalSubscribe = api.subscribe.bind(api);
    api.subscribe = async function subscribeWithCanonicalMetadata(guid, feedUrl, metadata) {
      const result = await originalSubscribe(guid, feedUrl, metadata);
      const serverEntry = {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        ...(result && typeof result === 'object' ? result : {}),
        feedUrl: result?.feedUrl || feedUrl,
      };
      const current = [
        ...readJson(`${OFFLINE_SUBS_PREFIX}${guid}`, []),
        ...readJson(`${SUBS_PREFIX}${guid}`, []),
        serverEntry,
      ];
      persistSubscriptions(guid, current, { notify: true, reason: 'subscribe' });
      refreshSubscriptions(guid, 'subscribe');
      return result;
    };
  }

  if (root.syncManager) {
    const manager = root.syncManager;
    if (typeof manager.getLocalState === 'function') {
      const originalGetLocalState = manager.getLocalState.bind(manager);
      manager.getLocalState = async function getLocalStateWithCanonicalSubscriptions(guid) {
        const state = await originalGetLocalState(guid);
        return { ...state, subscriptions: subscriptionUrls(state?.subscriptions) };
      };
    }

    manager.mergeSubscriptions = function mergeCanonicalSubscriptions(local = [], remote = [], preferLocal = false) {
      return subscriptionUrls(preferLocal ? [...local, ...remote] : [...remote, ...local]);
    };

    if (typeof manager.performSync === 'function') {
      const originalPerformSync = manager.performSync.bind(manager);
      manager.performSync = async function performSyncAndHydrate(guid) {
        const result = await originalPerformSync(guid);
        if (result?.ok) refreshSubscriptions(guid, 'sync-complete');
        return result;
      };
    }
  }

  if (typeof api._searchAppleCatalog === 'function') {
    const browserAppleSearch = api._searchAppleCatalog.bind(api);
    api._searchAppleCatalog = async function searchAppleWithNativeFallback(query) {
      try {
        return await browserAppleSearch(query);
      } catch (browserError) {
        const nativeHttp = root.Capacitor?.Plugins?.CapacitorHttp;
        if (!nativeHttp || typeof nativeHttp.get !== 'function') throw browserError;

        const q = String(query || '').trim();
        if (!q) return [];
        const response = await nativeHttp.get({
          url: `https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(q)}&limit=20`,
          headers: { Accept: 'application/json' },
        });
        const payload = typeof response?.data === 'string' ? JSON.parse(response.data) : (response?.data || {});
        const results = (payload.results || [])
          .map((item) => api._mapApplePodcastResult(item))
          .filter((item) => item.feedUrl);
        return api._saveCachedPodcasts(results);
      }
    };
  }

  if (typeof api.search === 'function') {
    api.search = async function searchWithReliableFallback(query, guid) {
      const q = String(query || '').trim();
      if (!q) return [];

      if (backendConfigured()) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const url = api._buildUrl(`/api/search?q=${encodeURIComponent(q)}&guid=${encodeURIComponent(guid || '')}`);
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (!Array.isArray(payload)) throw new Error('Invalid search response');
          return api._saveCachedPodcasts(payload);
        } catch (err) {
          console.warn('[subscriptionSyncRepair] Backend search failed; using Apple search:', err?.message || err);
        } finally {
          clearTimeout(timer);
        }
      }

      return api._searchAppleCatalog(q);
    };
  }

  let podcastRefreshScheduled = false;
  root.addEventListener('podwaffle:podcast-refreshed', (event) => {
    const detail = event?.detail || {};
    const routeFeedId = String(root.location?.hash || '').replace(/^#\/podcast\//, '');
    if (!routeFeedId || routeFeedId === String(root.location?.hash || '')) return;
    if (detail.feedId && String(detail.feedId) !== routeFeedId) return;
    if (podcastRefreshScheduled || typeof root.renderPodcastDetail !== 'function') return;

    podcastRefreshScheduled = true;
    setTimeout(() => {
      podcastRefreshScheduled = false;
      if (String(root.location?.hash || '') !== `#/podcast/${routeFeedId}`) return;
      const container = root.document?.getElementById('main-content');
      if (container) root.renderPodcastDetail(container, routeFeedId);
    }, 0);
  });

  let subscriptionRefreshScheduled = false;
  root.addEventListener('podwaffle:subscriptions-refreshed', (event) => {
    if (event?.detail?.guid && event.detail.guid !== root.appState?.guid) return;
    const hash = String(root.location?.hash || '');
    if (hash && hash !== '#/' && hash !== '#/podcasts') return;
    if (subscriptionRefreshScheduled || typeof root.renderPodcasts !== 'function') return;

    subscriptionRefreshScheduled = true;
    setTimeout(() => {
      subscriptionRefreshScheduled = false;
      const currentHash = String(root.location?.hash || '');
      if (currentHash && currentHash !== '#/' && currentHash !== '#/podcasts') return;
      const container = root.document?.getElementById('main-content');
      if (container) root.renderPodcasts(container);
    }, 0);
  });

  api.__subscriptionSyncRepairInstalled = true;
  api.__subscriptionSyncRepair = {
    canonicalFeedUrl,
    dedupeSubscriptions,
    subscriptionUrls,
    persistSubscriptions,
    refreshSubscriptions,
  };
})(window);
