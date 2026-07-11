'use strict';

const {
  DAY_MS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_PREPROCESS_LIMIT,
  int,
  normalizeChapters,
  createChapterStore,
} = require('./chapterGenerationStore');
const { DEFAULT_FAILED_RETRY_MINUTES, createChapterQueue } = require('./chapterGenerationQueue');

const DEFAULT_SCAN_INTERVAL_MINUTES = 10;

function createChapterGenerationService(options = {}) {
  const feedService = options.feedService;
  if (!feedService?.getCachedFeed) throw new Error('feedService.getCachedFeed is required');

  const store = createChapterStore(options);
  const scanMinutes = int(
    options.scanIntervalMinutes ?? process.env.CHAPTER_SCAN_INTERVAL_MINUTES,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    1,
    1440
  );
  const queue = createChapterQueue({ ...options, feedService, store });
  let initialTimer = null;
  let scanTimer = null;
  let cleanupTimer = null;
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;
    await store.cleanupExpired();
    initialTimer = setTimeout(() => {
      queue.scanEnabledPodcasts().catch((err) => console.warn('[chapters] Initial scan failed:', err.message));
    }, 15000);
    scanTimer = setInterval(() => {
      queue.scanEnabledPodcasts().catch((err) => console.warn('[chapters] Scan failed:', err.message));
    }, scanMinutes * 60000);
    cleanupTimer = setInterval(() => {
      store.cleanupExpired().catch((err) => console.warn('[chapters] Cleanup failed:', err.message));
    }, DAY_MS);
    initialTimer.unref?.();
    scanTimer.unref?.();
    cleanupTimer.unref?.();
  }

  function stop() {
    clearTimeout(initialTimer);
    clearInterval(scanTimer);
    clearInterval(cleanupTimer);
    initialTimer = scanTimer = cleanupTimer = null;
    initialized = false;
  }

  async function getStatus() {
    return { ...(await queue.getStatus()), scanIntervalMinutes: scanMinutes };
  }

  return {
    init,
    stop,
    getPolicy: store.getPolicy,
    listPolicies: store.listPolicies,
    setPolicy: store.setPolicy,
    getEpisodeState: queue.getEpisodeState,
    queueSpecificEpisode: queue.queueSpecificEpisode,
    scanFeed: queue.scanFeed,
    scanEnabledPodcasts: queue.scanEnabledPodcasts,
    cleanupExpired: store.cleanupExpired,
    getStatus,
    waitForIdle: queue.waitForIdle,
    resultPath: store.resultPath,
    readResult: store.readResult,
  };
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_PREPROCESS_LIMIT,
  DEFAULT_SCAN_INTERVAL_MINUTES,
  DEFAULT_FAILED_RETRY_MINUTES,
  createChapterGenerationService,
  normalizeChapters,
};
