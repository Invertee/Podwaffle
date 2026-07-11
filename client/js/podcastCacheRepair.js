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

