/* Persist backend podcast pages so local-first route reads retain episodes across navigation. */
(function installPodcastCacheRepair(root) {
  'use strict';

  const api = root && root.api;
  if (!api || api.__podcastCacheRepairInstalled) return;

  const CATALOG_KEY = 'podwaffle_podcast_catalog';

  function readCatalog() {
    try {
      const raw = root.localStorage.getItem(CATALOG_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeCatalog(catalog) {
    try {
      root.localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog || {}));
    } catch (err) {
      console.warn('[podcastCacheRepair] Failed to persist podcast catalog:', err?.message || err);
    }
  }

  function episodeKey(episode, index = 0) {
    if (!episode || typeof episode !== 'object') return `missing:${index}`;
    return String(
      episode.guid
      || episode.episodeGuid
      || episode.audioUrl
      || episode.enclosureUrl
      || `${episode.title || 'episode'}|${episode.publishedAt || episode.pubDate || index}`
    );
  }

  function mergeEpisodes(existingEpisodes, incomingEpisodes, offset = 0) {
    const existing = Array.isArray(existingEpisodes) ? existingEpisodes : [];
    const incoming = Array.isArray(incomingEpisodes) ? incomingEpisodes : [];
    const ordered = offset > 0 ? [...existing, ...incoming] : [...incoming, ...existing];
    const seen = new Set();
    return ordered.filter((episode, index) => {
      const key = episodeKey(episode, index);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function persistPodcastPage(podcast, requestedFeedId, offset = 0) {
    if (!podcast || typeof podcast !== 'object') return null;

    const routeFeedId = String(requestedFeedId || '').trim();
    const incomingFeedId = String(podcast.feedId || '').trim();
    const existing = api._getCachedPodcast?.(incomingFeedId || routeFeedId)
      || api._getCachedPodcast?.(routeFeedId)
      || {};
    const feedId = incomingFeedId || String(existing.feedId || routeFeedId).trim();
    if (!feedId && !podcast.feedUrl) return null;

    const episodes = mergeEpisodes(existing.episodes, podcast.episodes, Number(offset) || 0);
    const stored = {
      ...existing,
      ...podcast,
      feedId: feedId || existing.feedId,
      feedUrl: podcast.feedUrl || existing.feedUrl || '',
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
      lastRefreshed: podcast.lastRefreshed || existing.lastRefreshed || new Date().toISOString(),
    };

    const catalog = readCatalog();
    const primaryKey = stored.feedId || routeFeedId || stored.feedUrl;
    if (primaryKey) catalog[primaryKey] = stored;
    if (routeFeedId && routeFeedId !== primaryKey) catalog[routeFeedId] = stored;
    writeCatalog(catalog);

    try { root.offlineStore?.rememberPodcast?.(stored); } catch (_) {}
    return stored;
  }

  root.addEventListener('podwaffle:podcast-refreshed', (event) => {
    const detail = event?.detail || {};
    persistPodcastPage(detail.podcast, detail.feedId, detail.offset || 0);
  });

  if (typeof api.getPodcast === 'function') {
    const originalGetPodcast = api.getPodcast.bind(api);
    api.getPodcast = async function getPodcastWithPersistentPages(feedId, limit = 100, offset = 0) {
      const podcast = await originalGetPodcast(feedId, limit, offset);
      if (Array.isArray(podcast?.episodes) && podcast.episodes.length > 0) {
        return persistPodcastPage(podcast, feedId, offset) || podcast;
      }
      return podcast;
    };
  }

  if (typeof api.refreshPodcast === 'function') {
    const originalRefreshPodcast = api.refreshPodcast.bind(api);
    api.refreshPodcast = async function refreshPodcastAndPersist(feedId) {
      const remoteGetPodcast = api.__remoteReads?.getPodcast;
      if (typeof remoteGetPodcast !== 'function') {
        return originalRefreshPodcast(feedId);
      }

      const podcast = await remoteGetPodcast(feedId, 500, 0);
      const stored = persistPodcastPage(podcast, feedId, 0) || podcast;
      root.dispatchEvent(new CustomEvent('podwaffle:podcast-refreshed', {
        detail: { feedId, limit: 500, offset: 0, podcast: stored, reason: 'manual-refresh' },
      }));
      return {
        ok: true,
        feedId,
        refreshedAt: new Date().toISOString(),
        episodeCount: Array.isArray(stored?.episodes) ? stored.episodes.length : 0,
      };
    };
  }

  api.__podcastCacheRepairInstalled = true;
  api.__podcastCacheRepair = { episodeKey, mergeEpisodes, persistPodcastPage };
})(window);
