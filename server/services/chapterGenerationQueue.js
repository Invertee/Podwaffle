'use strict';

const { int } = require('./chapterGenerationStore');

const DEFAULT_FAILED_RETRY_MINUTES = 360;
const defaultFetch = (...args) => (global.fetch ? global.fetch(...args) : require('node-fetch')(...args));

function createChapterQueue(options = {}) {
  const feedService = options.feedService;
  const store = options.store;
  if (!feedService?.getCachedFeed) throw new Error('feedService.getCachedFeed is required');
  if (!store) throw new Error('chapter store is required');

  const fetchImpl = options.fetchImpl || defaultFetch;
  const workerUrl = store.workerUrl;
  const timeoutMs = int(options.workerTimeoutMs ?? process.env.CHAPTER_WORKER_TIMEOUT_MS, 21600000, 60000, 86400000);
  const failedRetryMs = int(options.failedRetryMinutes ?? process.env.CHAPTER_FAILED_RETRY_MINUTES, DEFAULT_FAILED_RETRY_MINUTES, 5, 10080) * 60000;
  const broadcast = options.broadcast || (() => {});
  const queue = [];
  const queued = new Set();
  const errors = new Map();
  let active = null;

  const keyFor = (feedId, episodeGuid) => `${feedId}:${episodeGuid}`;

  async function findEpisode(feedId, episodeGuid) {
    const feed = await feedService.getCachedFeed(feedId);
    const episode = (feed?.episodes || []).find((item) => String(item?.guid || '') === String(episodeGuid || '')) || null;
    return { feed, episode };
  }

  async function getEpisodeState(feedId, episodeGuid) {
    const { episode } = await findEpisode(feedId, episodeGuid);
    if (!episode) return { status: 'missing', feedId, episodeGuid, chapters: [] };
    const result = await store.readResult(feedId, episodeGuid, episode.audioUrl);
    if (result) return { status: 'ready', ...result };
    const key = keyFor(feedId, episodeGuid);
    if (active?.key === key) return { status: 'processing', feedId, episodeGuid, chapters: [] };
    if (queued.has(key)) return { status: 'queued', feedId, episodeGuid, chapters: [] };
    const policy = await store.getPolicy(feedId);
    if (!policy.enabled) return { status: 'disabled', feedId, episodeGuid, chapters: [] };
    if (!workerUrl) return { status: 'waiting-for-worker', feedId, episodeGuid, chapters: [] };
    const failure = errors.get(key);
    if (failure && store.clock() - failure.failedAt < failedRetryMs) {
      return {
        status: 'failed', feedId, episodeGuid, chapters: [], error: failure.message,
        retryAt: new Date(failure.failedAt + failedRetryMs).toISOString(),
      };
    }
    if (failure) errors.delete(key);
    return { status: 'pending-scan', feedId, episodeGuid, chapters: [] };
  }

  async function callWorker(job) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${workerUrl}/v1/generate`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          feedId: job.feedId,
          episodeGuid: job.episode.guid,
          title: job.episode.title || '',
          podcastTitle: job.feed.title || '',
          audioUrl: job.episode.audioUrl,
          duration: Number(job.episode.duration || 0),
          detectAds: job.policy.detectAds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || payload.error || `Worker returned HTTP ${response.status}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async function processQueue() {
    if (active || !workerUrl || !queue.length) return;
    active = queue.shift();
    queued.delete(active.key);
    errors.delete(active.key);
    broadcast({ type: 'chapters:processing', data: { feedId: active.feedId, episodeGuid: active.episode.guid } });
    try {
      const result = await store.saveResult(active, await callWorker(active));
      broadcast({
        type: 'chapters:ready',
        data: { feedId: active.feedId, episodeGuid: active.episode.guid, generatedAt: result.generatedAt, expiresAt: result.expiresAt },
      });
      console.log(`[chapters] Generated ${result.chapters.length} chapters for ${active.feedId}/${active.episode.guid}`);
    } catch (err) {
      const message = err?.name === 'AbortError' ? 'Chapter worker timed out' : (err.message || String(err));
      errors.set(active.key, { message, failedAt: store.clock() });
      broadcast({ type: 'chapters:failed', data: { feedId: active.feedId, episodeGuid: active.episode.guid, error: message } });
      console.warn(`[chapters] Generation failed for ${active.feedId}/${active.episode.guid}:`, message);
    } finally {
      active = null;
      setImmediate(processQueue);
    }
  }

  async function queueEpisode(feedId, feed, episode) {
    const policy = await store.getPolicy(feedId);
    if (!policy.enabled) return { status: 'disabled' };
    if (!workerUrl) return { status: 'waiting-for-worker' };
    if (!episode?.guid || !episode?.audioUrl) return { status: 'missing-audio' };
    if (await store.readResult(feedId, episode.guid, episode.audioUrl)) return { status: 'ready' };
    const key = keyFor(feedId, episode.guid);
    const failure = errors.get(key);
    if (failure && store.clock() - failure.failedAt < failedRetryMs) return { status: 'retry-delayed' };
    if (failure) errors.delete(key);
    if (active?.key === key) return { status: 'processing' };
    if (queued.has(key)) return { status: 'queued' };
    queued.add(key);
    queue.push({ key, feedId: String(feedId), feed, episode, policy, queuedAt: store.iso() });
    processQueue();
    return { status: 'queued' };
  }

  async function scanFeed(feedId) {
    const policy = await store.getPolicy(feedId);
    if (!policy.enabled) return { feedId, status: 'disabled', queued: 0, considered: 0 };
    const feed = await feedService.getCachedFeed(feedId);
    if (!feed) return { feedId, status: 'feed-missing', queued: 0, considered: 0 };
    const episodes = [...(feed.episodes || [])]
      .filter((episode) => episode?.guid && episode?.audioUrl)
      .sort((a, b) => store.episodeTime(b) - store.episodeTime(a))
      .slice(0, policy.preprocessLimit);
    if (!workerUrl) return { feedId, status: 'waiting-for-worker', queued: 0, considered: episodes.length };
    let count = 0;
    for (const episode of episodes) {
      if ((await queueEpisode(feedId, feed, episode)).status === 'queued') count += 1;
    }
    return { feedId, status: 'ok', queued: count, considered: episodes.length };
  }

  async function scanEnabledPodcasts() {
    const policies = await store.listPolicies();
    const output = [];
    for (const policy of policies.filter((item) => item.enabled)) {
      try { output.push(await scanFeed(policy.feedId)); }
      catch (err) { output.push({ feedId: policy.feedId, status: 'failed', error: err.message }); }
    }
    return output;
  }

  async function queueSpecificEpisode(feedId, episodeGuid) {
    const { feed, episode } = await findEpisode(feedId, episodeGuid);
    return episode ? queueEpisode(feedId, feed, episode) : { status: 'missing' };
  }

  async function getStatus() {
    const enabled = (await store.listPolicies()).filter((policy) => policy.enabled).length;
    return {
      workerConfigured: !!workerUrl,
      retentionDays: store.retentionDays,
      defaultPreprocessLimit: store.defaultLimit,
      enabledPodcasts: enabled,
      queuedJobs: queue.length,
      activeJob: active ? {
        feedId: active.feedId,
        episodeGuid: active.episode.guid,
        title: active.episode.title || '',
        queuedAt: active.queuedAt,
      } : null,
    };
  }

  async function waitForIdle(timeout = 10000) {
    const start = Date.now();
    while (active || queue.length) {
      if (Date.now() - start > timeout) throw new Error('Timed out waiting for chapter queue');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return {
    getEpisodeState,
    queueSpecificEpisode,
    scanFeed,
    scanEnabledPodcasts,
    getStatus,
    waitForIdle,
  };
}

module.exports = { DEFAULT_FAILED_RETRY_MINUTES, createChapterQueue };
