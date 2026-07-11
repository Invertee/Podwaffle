/* Resolve podcast episodes through the configured backend without blocking local reads. */
(function installPodcastDataRuntimeV2(root) {
  'use strict';
  const api = root.api;
  if (!api || api.__podcastDataRuntimeV2Installed) return;

  const CATALOG = 'podwaffle_podcast_catalog';
  const tasks = new Map();

  function read(key, fallback) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null') ?? fallback; }
    catch (_) { return fallback; }
  }

  function feedUrlFor(feedId) {
    const catalog = read(CATALOG, {});
    const direct = catalog[feedId];
    if (direct?.feedUrl) return direct.feedUrl;
    for (const item of Object.values(catalog)) {
      if (item?.feedId === feedId && item.feedUrl) return item.feedUrl;
    }
    for (let i = 0; i < root.localStorage.length; i += 1) {
      const key = root.localStorage.key(i);
      if (!key?.startsWith('podwaffle_subscriptions_') && !key?.startsWith('podwaffle_offline_subscriptions_')) continue;
      const items = read(key, []);
      const match = Array.isArray(items) && items.find((item) => item && typeof item === 'object' && item.feedId === feedId);
      if (match?.feedUrl) return match.feedUrl;
    }
    return '';
  }

  function persist(podcast, routeFeedId) {
    if (!podcast || typeof podcast !== 'object') return podcast;
    const catalog = read(CATALOG, {});
    const previous = catalog[podcast.feedId] || catalog[routeFeedId] || {};
    const stored = {
      ...previous,
      ...podcast,
      episodes: Array.isArray(podcast.episodes) ? podcast.episodes : (previous.episodes || []),
    };
    stored.totalEpisodes = Math.max(Number(stored.totalEpisodes || 0), stored.episodes.length);
    stored.episodeCount = Math.max(Number(stored.episodeCount || 0), stored.episodes.length);
    if (stored.feedId) catalog[stored.feedId] = stored;
    if (routeFeedId) catalog[routeFeedId] = stored;
    if (stored.feedUrl) catalog[stored.feedUrl] = stored;
    root.localStorage.setItem(CATALOG, JSON.stringify(catalog));
    try { root.offlineStore?.rememberPodcast?.(stored); } catch (_) {}
    return stored;
  }

  function configured() {
    const cfg = api.getServerConnectionConfig?.();
    return !!(cfg?.enabled && cfg?.host);
  }

  async function backendPodcast(feedId, force) {
    const guid = root.appState?.guid || root.localStorage.getItem('podwaffle_guid');
    if (!guid) throw new Error('No user profile is selected.');
    if (force) {
      await api._fetch(`/api/users/${guid}/feeds/refresh`, { method: 'POST' });
    }
    const subscriptions = await api.__remoteReads?.getSubscriptions?.(guid) || await api._fetch(`/api/users/${guid}/subscriptions`);
    const wantedUrl = feedUrlFor(feedId);
    const match = (subscriptions || []).find((item) => item?.feedId === feedId || (wantedUrl && item?.feedUrl === wantedUrl));
    const serverFeedId = match?.feedId || feedId;
    const podcast = await api._fetch(`/api/podcasts/${encodeURIComponent(serverFeedId)}?limit=500&offset=0`);
    return persist({ ...podcast, feedUrl: podcast.feedUrl || match?.feedUrl || wantedUrl }, feedId);
  }

  async function browserPodcast(feedId) {
    const seed = api._getCachedPodcast?.(feedId) || { feedId, feedUrl: feedUrlFor(feedId) };
    if (!seed.feedUrl) throw new Error('No feed URL is stored for this podcast.');
    const xml = await api._fetchFeedXml(seed.feedUrl);
    return persist(api._parseExternalPodcastFeed(xml, seed), feedId);
  }

  async function refresh(feedId) {
    const podcast = configured() ? await backendPodcast(feedId, true) : await browserPodcast(feedId);
    if (!Array.isArray(podcast?.episodes) || podcast.episodes.length === 0) {
      throw new Error('The feed was refreshed but returned no playable episodes.');
    }
    return { ok: true, feedId, refreshedAt: new Date().toISOString(), episodeCount: podcast.episodes.length };
  }

  const priorGet = api.getPodcast.bind(api);
  api.getPodcast = async function getPodcastV2(feedId, limit = 100, offset = 0) {
    const local = await priorGet(feedId, limit, offset);
    if (Array.isArray(local?.episodes) && local.episodes.length > 0) return local;
    if (!configured()) return local;
    const key = `${feedId}:${offset}`;
    if (!tasks.has(key)) tasks.set(key, backendPodcast(feedId, false).finally(() => tasks.delete(key)));
    const podcast = await tasks.get(key);
    return { ...podcast, episodes: (podcast.episodes || []).slice(offset, offset + limit) };
  };

  api.refreshPodcast = refresh;
  api.__podcastDataRuntimeV2Installed = true;
})(window);
