'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DAY_MS = 86400000;
const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_PREPROCESS_LIMIT = 5;

const int = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};
const digest = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

function normalizeChapters(value, duration = 0) {
  const input = Array.isArray(value) ? value : (Array.isArray(value?.chapters) ? value.chapters : []);
  const end = Math.max(0, Number(duration) || 0);
  const chapters = input.map((chapter, index) => {
    const startTime = Number(chapter?.startTime ?? chapter?.start ?? chapter?.time);
    const rawType = String(chapter?.type || 'content').toLowerCase();
    const confidence = Number(chapter?.confidence);
    return {
      startTime,
      title: String(chapter?.title || chapter?.name || `Chapter ${index + 1}`).trim().slice(0, 160),
      type: ['content', 'advertisement', 'intro', 'outro'].includes(rawType) ? rawType : 'content',
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
      imageUrl: String(chapter?.imageUrl || chapter?.image || chapter?.img || ''),
      url: String(chapter?.url || chapter?.href || ''),
    };
  }).filter((chapter) => Number.isFinite(chapter.startTime) && chapter.startTime >= 0 && chapter.title && (!end || chapter.startTime < end));

  chapters.sort((a, b) => a.startTime - b.startTime);
  const unique = chapters.filter((chapter, index) => index === 0 || chapter.startTime > chapters[index - 1].startTime + 0.25);
  if (unique.length && unique[0].startTime <= 30) unique[0].startTime = 0;
  else if (unique.length) unique.unshift({ startTime: 0, title: 'Introduction', type: 'intro', confidence: 0.5, imageUrl: '', url: '' });
  return unique.slice(0, 200);
}

function createChapterStore(options = {}) {
  const clock = options.now || Date.now;
  const dataRoot = options.dataRoot || process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const root = path.join(dataRoot, 'chapters');
  const resultsRoot = path.join(root, 'results');
  const policiesPath = path.join(root, 'policies.json');
  const workerUrl = String(options.workerUrl ?? process.env.CHAPTER_WORKER_URL ?? '').trim().replace(/\/+$/, '');
  const retentionDays = int(options.retentionDays ?? process.env.CHAPTER_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 1, 3650);
  const defaultLimit = int(options.preprocessLimit ?? process.env.CHAPTER_PREPROCESS_LIMIT, DEFAULT_PREPROCESS_LIMIT, 1, 50);

  const resultPath = (feedId, episodeGuid) => path.join(resultsRoot, digest(feedId), `${digest(episodeGuid)}.json`);
  const audioHash = (url) => digest(url);
  const iso = () => new Date(clock()).toISOString();
  const episodeTime = (episode) => {
    const timestamp = new Date(episode?.pubDate || episode?.publishedAt || episode?.isoDate || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  const isOutsideRetention = (episode) => {
    const timestamp = episodeTime(episode);
    return !!timestamp && timestamp < clock() - retentionDays * DAY_MS;
  };

  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
    catch (err) {
      if (err.code !== 'ENOENT') console.warn('[chapters] JSON read failed:', file, err.message);
      return fallback;
    }
  }

  async function writeJson(file, value) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.promises.rename(temporary, file);
    return value;
  }

  async function policies() {
    const state = await readJson(policiesPath, { version: 1, podcasts: {} });
    if (!state.podcasts || typeof state.podcasts !== 'object') state.podcasts = {};
    return state;
  }

  async function getPolicy(feedId) {
    const stored = (await policies()).podcasts[String(feedId)] || {};
    return {
      feedId: String(feedId),
      enabled: !!stored.enabled,
      detectAds: stored.detectAds !== false,
      preprocessLimit: int(stored.preprocessLimit, defaultLimit, 1, 50),
      title: String(stored.title || ''),
      feedUrl: String(stored.feedUrl || ''),
      updatedAt: stored.updatedAt || null,
      workerConfigured: !!workerUrl,
      retentionDays,
    };
  }

  async function listPolicies() {
    const state = await policies();
    return Promise.all(Object.keys(state.podcasts).map(getPolicy));
  }

  async function setPolicy(feedId, patch = {}) {
    const state = await policies();
    const id = String(feedId);
    const previous = state.podcasts[id] || {};
    state.podcasts[id] = {
      enabled: patch.enabled === undefined ? !!previous.enabled : !!patch.enabled,
      detectAds: patch.detectAds === undefined ? previous.detectAds !== false : !!patch.detectAds,
      preprocessLimit: int(patch.preprocessLimit ?? previous.preprocessLimit, defaultLimit, 1, 50),
      title: String(patch.title ?? previous.title ?? '').trim().slice(0, 300),
      feedUrl: String(patch.feedUrl ?? previous.feedUrl ?? '').trim(),
      updatedAt: iso(),
    };
    await writeJson(policiesPath, state);
    return getPolicy(id);
  }

  async function readResult(feedId, episodeGuid, expectedAudioUrl = '') {
    const file = resultPath(feedId, episodeGuid);
    const result = await readJson(file, null);
    if (!result) return null;
    const expiry = new Date(result.expiresAt || 0).getTime();
    if (!Number.isFinite(expiry) || expiry <= clock() || (expectedAudioUrl && result.audioUrlHash !== audioHash(expectedAudioUrl))) {
      await fs.promises.unlink(file).catch(() => {});
      return null;
    }
    const chapters = normalizeChapters(result.chapters, result.duration);
    return chapters.length ? { ...result, chapters } : null;
  }

  async function saveResult(job, payload) {
    const chapters = normalizeChapters(payload?.chapters, job.episode.duration || payload?.duration);
    if (!chapters.length) throw new Error('Worker returned no usable chapters');
    const generatedAt = clock();
    return writeJson(resultPath(job.feedId, job.episode.guid), {
      version: 1,
      feedId: job.feedId,
      episodeGuid: job.episode.guid,
      title: job.episode.title || '',
      audioUrlHash: audioHash(job.episode.audioUrl),
      duration: Number(job.episode.duration || payload?.duration || 0),
      generatedAt: new Date(generatedAt).toISOString(),
      expiresAt: new Date(generatedAt + retentionDays * DAY_MS).toISOString(),
      generator: payload?.generator || null,
      chapters,
    });
  }

  async function cleanupExpired() {
    await fs.promises.mkdir(resultsRoot, { recursive: true });
    let removed = 0;
    const directories = await fs.promises.readdir(resultsRoot, { withFileTypes: true }).catch(() => []);
    for (const directory of directories.filter((entry) => entry.isDirectory())) {
      const folder = path.join(resultsRoot, directory.name);
      const files = await fs.promises.readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))) {
        const target = path.join(folder, file.name);
        const result = await readJson(target, null);
        const expiry = new Date(result?.expiresAt || 0).getTime();
        if (!Number.isFinite(expiry) || expiry <= clock()) {
          await fs.promises.unlink(target).catch(() => {});
          removed += 1;
        }
      }
      await fs.promises.rmdir(folder).catch(() => {});
    }
    if (removed) console.log(`[chapters] Removed ${removed} expired chapter result(s)`);
    return removed;
  }

  return {
    DAY_MS,
    workerUrl,
    retentionDays,
    defaultLimit,
    clock,
    iso,
    episodeTime,
    isOutsideRetention,
    resultPath,
    getPolicy,
    listPolicies,
    setPolicy,
    readResult,
    saveResult,
    cleanupExpired,
  };
}

module.exports = {
  DAY_MS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_PREPROCESS_LIMIT,
  int,
  normalizeChapters,
  createChapterStore,
};
