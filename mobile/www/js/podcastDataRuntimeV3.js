/* Local-first podcast detail runtime with durable episodes and automatic hydration. */
(function installPodcastDataRuntimeV3(root) {
  'use strict';

  const api = root && root.api;
  if (!api || api.__podcastDataRuntimeV3Installed) return;

  const GENERAL_CATALOG_KEY = 'podwaffle_podcast_catalog';
  const EPISODE_CATALOG_KEY = 'podwaffle_episode_catalog_v3';
  const tasks = new Map();

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
      console.warn('[podcastDataRuntimeV3] Failed to persist:', key, err?.message || err);
    }
    return value;
  }

  function canonicalFeedUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      parsed.hash = '';
      parsed.hostname = parsed.hostname.toLowerCase();
      if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
        parsed.port = '';
      }
      if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      return parsed.toString();
    } catch (_) {
      return raw;
    }
  }

  function hasEpisodes(podcast) {
    return Array.isArray(podcast?.episodes) && podcast.episodes.length > 0;
  }

  function findInCatalog(catalog, identifier) {
    const needle = String(identifier || '').trim();
    if (!needle || !catalog || typeof catalog !== 'object') return null;
    if (catalog[needle]) return catalog[needle];

    const canonicalNeedle = canonicalFeedUrl(needle);
    return Object.values(catalog).find((item) => {
      if (!item || typeof item !== 'object') return false;
      if (String(item.feedId || '') === needle) return true;
      if (canonicalNeedle && canonicalFeedUrl(item.feedUrl) === canonicalNeedle) return true;
      return api._makeFeedId?.(item.feedUrl, item.title || 'podcast') === needle;
    }) || null;
  }

  function findStoredPodcast(feedId) {
    return findInCatalog(readJson(EPISODE_CATALOG_KEY, {}), feedId)
      || findInCatalog(readJson(GENERAL_CATALOG_KEY, {}), feedId)
      || null;
  }

  function feedUrlFor(feedId) {
    const stored = findStoredPodcast(feedId);
    if (stored?.feedUrl) return stored.feedUrl;

    for (let index = 0; index < root.localStorage.length; index += 1) {
      const key = root.localStorage.key(index);
      if (!key?.startsWith('podwaffle_subscriptions_') && !key?.startsWith('podwaffle_offline_subscriptions_')) continue;
      const items = readJson(key, []);
      if (!Array.isArray(items)) continue;
      const match = items.find((item) => item && typeof item === 'object' && (
        String(item.feedId || '') === String(feedId)
        || api._makeFeedId?.(item.feedUrl, item.title || 'podcast') === String(feedId)
      ));
      if (match?.feedUrl) return match.feedUrl;
    }
    return '';
  }

  function identifiersFor(podcast, routeFeedId) {
    const identifiers = new Set();
    const routeId = String(routeFeedId || '').trim();
    const feedId = String(podcast?.feedId || '').trim();
    const feedUrl = String(podcast?.feedUrl || '').trim();
    if (routeId) identifiers.add(routeId);
    if (feedId) identifiers.add(feedId);
    if (feedUrl) {
      identifiers.add(feedUrl);
      const generated = api._makeFeedId?.(feedUrl, podcast?.title || 'podcast');
      if (generated) identifiers.add(generated);
    }
    return [...identifiers];
  }

  function persistPodcast(podcast, routeFeedId) {
    if (!podcast || typeof podcast !== 'object') return podcast;

    const existing = findStoredPodcast(podcast.feedId || routeFeedId) || {};
    const incomingEpisodes = Array.isArray(podcast.episodes) ? podcast.episodes : [];
    const existingEpisodes = Array.isArray(existing.episodes) ? existing.episodes : [];
    const episodes = incomingEpisodes.length > 0 ? incomingEpisodes : existingEpisodes;
    const stored = {
      ...existing,
      ...podcast,
      feedId: podcast.feedId || existing.feedId || String(routeFeedId || ''),
      feedUrl: podcast.feedUrl || existing.feedUrl || feedUrlFor(routeFeedId),
      imageUrl: podcast.imageUrl || existing.imageUrl || 'icons/icon-192.png',
      episodes,
      totalEpisodes: Math.max(
        Number(existing.totalEpisodes || existing.episodeCount || 0),
        Number(podcast.totalEpisodes || podcast.episodeCount || 0),
        episodes.length
      ),
      episodeCount: Math.max(
        Number(existing.episodeCount || existing.totalEpisodes || 0),
        Number(podcast.episodeCount || podcast.totalEpisodes || 0),
        episodes.length
      ),
    };

    const identifiers = identifiersFor(stored, routeFeedId);
    const generalCatalog = readJson(GENERAL_CATALOG_KEY, {});
    identifiers.forEach((identifier) => { generalCatalog[identifier] = stored; });
    writeJson(GENERAL_CATALOG_KEY, generalCatalog);

    if (episodes.length > 0) {
      const episodeCatalog = readJson(EPISODE_CATALOG_KEY, {});
      identifiers.forEach((identifier) => { episodeCatalog[identifier] = stored; });
      writeJson(EPISODE_CATALOG_KEY, episodeCatalog);
    }

    try { root.offlineStore?.rememberPodcast?.(stored); } catch (_) {}
    return stored;
  }

  function slicePodcast(podcast, limit, offset) {
    const episodes = Array.isArray(podcast?.episodes) ? podcast.episodes : [];
    return {
      ...(podcast || {}),
      episodes: episodes.slice(offset, offset + limit),
      totalEpisodes: Math.max(Number(podcast?.totalEpisodes || podcast?.episodeCount || 0), episodes.length),
    };
  }

  function backendConfigured() {
    const config = api.getServerConnectionConfig?.();
    return !!(config?.enabled && config?.host);
  }

  async function getRemoteSubscriptions(guid) {
    const reader = api.__remoteReads?.getSubscriptions;
    return typeof reader === 'function'
      ? reader(guid)
      : api._fetch(`/api/users/${guid}/subscriptions`);
  }

  function matchSubscription(subscriptions, feedId, wantedUrl) {
    const canonicalWanted = canonicalFeedUrl(wantedUrl);
    return (Array.isArray(subscriptions) ? subscriptions : []).find((item) => item && typeof item === 'object' && (
      String(item.feedId || '') === String(feedId)
      || (canonicalWanted && canonicalFeedUrl(item.feedUrl) === canonicalWanted)
      || api._makeFeedId?.(item.feedUrl, item.title || 'podcast') === String(feedId)
    )) || null;
  }

  async function loadFromBackend(feedId, forceRefresh) {
    const guid = root.appState?.guid || root.localStorage.getItem('podwaffle_guid');
    if (!guid) throw new Error('No user profile is selected.');

    if (forceRefresh) {
      await api._fetch(`/api/users/${guid}/feeds/refresh`, { method: 'POST' });
    }

    const subscriptions = await getRemoteSubscriptions(guid);
    const wantedUrl = feedUrlFor(feedId);
    const match = matchSubscription(subscriptions, feedId, wantedUrl);
    const serverFeedId = match?.feedId || feedId;
    const podcast = await api._fetch(`/api/podcasts/${encodeURIComponent(serverFeedId)}?limit=500&offset=0`);
    return persistPodcast({
      ...(podcast || {}),
      feedUrl: podcast?.feedUrl || match?.feedUrl || wantedUrl,
    }, feedId);
  }

  async function loadFromBrowser(feedId) {
    const seed = findStoredPodcast(feedId)
      || api._getCachedPodcast?.(feedId)
      || { feedId, feedUrl: feedUrlFor(feedId) };
    if (!seed.feedUrl) throw new Error('No feed URL is stored for this podcast.');
    const xml = await api._fetchFeedXml(seed.feedUrl);
    return persistPodcast(api._parseExternalPodcastFeed(xml, seed), feedId);
  }

  async function hydratePodcast(feedId, forceRefresh) {
    const errors = [];

    if (backendConfigured()) {
      try {
        let podcast = await loadFromBackend(feedId, !!forceRefresh);
        if (hasEpisodes(podcast)) return podcast;
        if (!forceRefresh) {
          podcast = await loadFromBackend(feedId, true);
          if (hasEpisodes(podcast)) return podcast;
        }
      } catch (err) {
        errors.push(err);
        console.warn('[podcastDataRuntimeV3] Backend hydration failed:', err?.message || err);
      }
    }

    try {
      const podcast = await loadFromBrowser(feedId);
      if (hasEpisodes(podcast)) return podcast;
      errors.push(new Error('The RSS feed contained no playable episodes.'));
    } catch (err) {
      errors.push(err);
      console.warn('[podcastDataRuntimeV3] Browser hydration failed:', err?.message || err);
    }

    const message = errors.map((err) => err?.message).filter(Boolean).join('; ');
    throw new Error(message || 'Unable to load podcast episodes.');
  }

  function scheduleHydration(feedId) {
    const taskKey = `hydrate:${feedId}`;
    if (tasks.has(taskKey)) return tasks.get(taskKey);

    const task = hydratePodcast(feedId, false)
      .then((podcast) => {
        root.dispatchEvent(new CustomEvent('podwaffle:podcast-refreshed', {
          detail: { feedId, limit: 500, offset: 0, podcast, reason: 'automatic-hydration' },
        }));
        return podcast;
      })
      .catch((err) => {
        console.warn('[podcastDataRuntimeV3] Automatic hydration failed:', err?.message || err);
        return null;
      })
      .finally(() => tasks.delete(taskKey));

    tasks.set(taskKey, task);
    return task;
  }

  const priorGetPodcast = api.getPodcast.bind(api);
  api.getPodcast = async function getPodcastWithDurableEpisodes(feedId, limit = 100, offset = 0) {
    const durable = findInCatalog(readJson(EPISODE_CATALOG_KEY, {}), feedId);
    if (hasEpisodes(durable)) return slicePodcast(durable, limit, offset);

    let local = findInCatalog(readJson(GENERAL_CATALOG_KEY, {}), feedId);
    if (!local) {
      try {
        local = await priorGetPodcast(feedId, limit, offset);
      } catch (err) {
        console.warn('[podcastDataRuntimeV3] Existing podcast loader failed:', err?.message || err);
      }
    }

    if (hasEpisodes(local)) {
      return slicePodcast(persistPodcast(local, feedId), limit, offset);
    }

    // Return metadata immediately, then rerender the open route when hydration completes.
    scheduleHydration(feedId);
    return slicePodcast(local || {
      feedId,
      feedUrl: feedUrlFor(feedId),
      title: 'Podcast',
      author: '',
      description: '',
      imageUrl: 'icons/icon-192.png',
      episodes: [],
      totalEpisodes: 0,
    }, limit, offset);
  };

  api.refreshPodcast = async function refreshPodcastWithDurableEpisodes(feedId) {
    const taskKey = `refresh:${feedId}`;
    if (!tasks.has(taskKey)) {
      tasks.set(taskKey, hydratePodcast(feedId, true).finally(() => tasks.delete(taskKey)));
    }
    const podcast = await tasks.get(taskKey);
    if (!hasEpisodes(podcast)) throw new Error('The feed was refreshed but returned no playable episodes.');

    root.dispatchEvent(new CustomEvent('podwaffle:podcast-refreshed', {
      detail: { feedId, limit: 500, offset: 0, podcast, reason: 'manual-refresh' },
    }));
    return {
      ok: true,
      feedId,
      refreshedAt: new Date().toISOString(),
      episodeCount: podcast.episodes.length,
    };
  };

  root.addEventListener('podwaffle:podcast-refreshed', (event) => {
    const detail = event?.detail || {};
    if (detail.podcast) persistPodcast(detail.podcast, detail.feedId || '');
  });

  // Preserve episodes already fetched by older builds before metadata sync can rewrite the general catalog.
  Object.values(readJson(GENERAL_CATALOG_KEY, {})).forEach((podcast) => {
    if (hasEpisodes(podcast)) persistPodcast(podcast, podcast.feedId || '');
  });

  api.__podcastDataRuntimeV3Installed = true;
  api.__podcastDataRuntimeV3 = {
    findStoredPodcast,
    persistPodcast,
    hydratePodcast,
    scheduleHydration,
  };
})(window);
