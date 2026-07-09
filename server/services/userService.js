'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const syncService = require('./syncService');

const _dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const USERS_DIR = path.join(_dataRoot, 'users');
const PROGRESS_DIR = path.join(_dataRoot, 'progress');
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const userWriteQueues = new Map();
const progressWriteQueues = new Map();

// ---------------------------------------------------------------------------
// Directory bootstrap
// ---------------------------------------------------------------------------
(async () => {
  try {
    await fs.promises.mkdir(USERS_DIR, { recursive: true });
    console.log(`[userService] Users directory ready: ${USERS_DIR}`);
  } catch (err) {
    console.error('[userService] Failed to create users directory:', err);
  }
})();

(async () => {
  try {
    await fs.promises.mkdir(PROGRESS_DIR, { recursive: true });
    console.log(`[userService] Progress directory ready: ${PROGRESS_DIR}`);
  } catch (err) {
    console.error('[userService] Failed to create progress directory:', err);
  }
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assertSafeGuid(guid) {
  const value = String(guid || '').trim();
  if (!GUID_PATTERN.test(value) || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`Invalid GUID: ${guid}`);
  }
  return value;
}

function userFilePath(guid) {
  const safeGuid = assertSafeGuid(guid);
  return path.join(USERS_DIR, `${safeGuid}.json`);
}

function defaultProfile(guid) {
  const now = new Date().toISOString();
  return {
    guid,
    createdAt: now,
    updatedAt: now,
    subscriptionsUpdatedAt: now,
    settings: {
      skipBack: 15,
      skipForward: 45
    },
    subscriptions: [],
    seenEpisodes: {},
    progress: {},
    queue: [],
    history: [],
    stats: {
      totalListenedSeconds: 0,
      totalSkippedSeconds: 0
    },
    playbackSession: null
  };
}

function ensureProfileShape(profile) {
  if (!profile || typeof profile !== 'object') return profile;

  const incomingSettings = profile.settings && typeof profile.settings === 'object'
    ? { ...profile.settings }
    : {};
  delete incomingSettings.podcastIndexApiKey;
  delete incomingSettings.podcastIndexApiSecret;

  profile.settings = {
    skipBack: 15,
    skipForward: 45,
    ...incomingSettings
  };
  profile.subscriptions = normalizeSubscriptions(profile.subscriptions);
  profile.seenEpisodes = profile.seenEpisodes && typeof profile.seenEpisodes === 'object' ? profile.seenEpisodes : {};
  profile.progress = profile.progress && typeof profile.progress === 'object' ? profile.progress : {};
  profile.queue = Array.isArray(profile.queue) ? normalizeQueue(profile.queue) : [];
  profile.history = Array.isArray(profile.history) ? profile.history : [];
  profile.stats = {
    totalListenedSeconds: 0,
    totalSkippedSeconds: 0,
    ...(profile.stats || {})
  };
  profile.playbackSession = profile.playbackSession && typeof profile.playbackSession === 'object'
    ? profile.playbackSession
    : null;
  profile.subscriptionsUpdatedAt = profile.subscriptionsUpdatedAt || profile.updatedAt || new Date().toISOString();

  return profile;
}

function normalizeQueueItem(item) {
  if (!item || typeof item !== 'object') return null;
  const audioUrl = item.audioUrl ? String(item.audioUrl) : '';
  if (!audioUrl) return null;

  const duration = typeof item.duration === 'number' ? item.duration : parseFloat(item.duration) || 0;
  return {
    guid: item.guid ? String(item.guid) : '',
    title: item.title ? String(item.title) : '',
    podcastTitle: item.podcastTitle ? String(item.podcastTitle) : '',
    audioUrl,
    imageUrl: item.imageUrl ? String(item.imageUrl) : '',
    podcastImageUrl: item.podcastImageUrl ? String(item.podcastImageUrl) : '',
    feedId: item.feedId ? String(item.feedId) : '',
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
}

function normalizeSubscriptionValue(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') {
    const value = entry.trim();
    return value && value !== '[object Object]' ? value : '';
  }
  if (typeof entry === 'object') {
    const feedUrl = typeof entry.feedUrl === 'string' ? entry.feedUrl.trim() : '';
    if (feedUrl) return feedUrl;
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (url) return url;
  }
  return '';
}

function normalizeSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of subscriptions) {
    const value = normalizeSubscriptionValue(entry);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeQueue(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  for (const item of items) {
    const next = normalizeQueueItem(item);
    if (next) normalized.push(next);
  }
  return normalized;
}

async function atomicWriteFile(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.promises.writeFile(tempPath, content, 'utf8');
  try {
    await fs.promises.rename(tempPath, targetPath);
  } catch (err) {
    if (err && (err.code === 'EEXIST' || err.code === 'EPERM')) {
      await fs.promises.unlink(targetPath).catch(() => {});
      await fs.promises.rename(tempPath, targetPath);
    } else {
      await fs.promises.unlink(tempPath).catch(() => {});
      throw err;
    }
  }
}

async function queueUserWrite(guid, writeOperation) {
  const previous = userWriteQueues.get(guid) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(writeOperation);

  userWriteQueues.set(guid, next);

  try {
    return await next;
  } finally {
    if (userWriteQueues.get(guid) === next) {
      userWriteQueues.delete(guid);
    }
  }
}

function progressFilePath(guid) {
  const safeGuid = assertSafeGuid(guid);
  return path.join(PROGRESS_DIR, `${safeGuid}.json`);
}

async function queueProgressWrite(guid, writeOperation) {
  const previous = progressWriteQueues.get(guid) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(writeOperation);

  progressWriteQueues.set(guid, next);

  try {
    return await next;
  } finally {
    if (progressWriteQueues.get(guid) === next) {
      progressWriteQueues.delete(guid);
    }
  }
}

/**
 * Load the progress map for a user from the dedicated progress file.
 * Falls back to the user profile file (migration path for existing users).
 */
async function loadProgressForUser(guid) {
  // Try dedicated progress file first
  try {
    const raw = await fs.promises.readFile(progressFilePath(guid), 'utf8');
    return JSON.parse(raw) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') return {};
  }
  // Fall back to user profile file (pre-migration)
  try {
    const raw = await fs.promises.readFile(userFilePath(guid), 'utf8');
    const profile = JSON.parse(raw);
    return (profile && typeof profile.progress === 'object') ? profile.progress : {};
  } catch (_) {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Core I/O
// ---------------------------------------------------------------------------

/**
 * Read a user profile from disk. Returns null on any error.
 */
async function getUser(guid) {
  guid = assertSafeGuid(guid);
  const filePath = userFilePath(guid);
  console.log(`[userService] getUser(${guid}) → reading ${filePath}`);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const profile = ensureProfileShape(JSON.parse(raw));
    console.log(`[userService] getUser(${guid}) → loaded OK`);
    return profile;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[userService] getUser(${guid}) → file not found`);
    } else {
      console.error(`[userService] getUser(${guid}) → read error:`, err);
    }
    return null;
  }
}

/**
 * Persist a user profile to disk, bumping updatedAt.
 * Progress is stored in a separate file and is stripped from the user file.
 */
async function saveUser(profile) {
  profile.guid = assertSafeGuid(profile.guid);
  ensureProfileShape(profile);
  profile.updatedAt = new Date().toISOString();
  // Strip progress — it lives in data/progress/{guid}.json, not the user file.
  // This prevents bulk progress writes from racing with subscription/settings writes.
  const filePath = userFilePath(profile.guid);
  const profileForDisk = { ...profile, progress: {} };
  console.log(`[userService] saveUser(${profile.guid}) → writing ${filePath}`);
  return queueUserWrite(profile.guid, async () => {
    try {
      await atomicWriteFile(filePath, JSON.stringify(profileForDisk, null, 2));
      console.log(`[userService] saveUser(${profile.guid}) → saved OK`);
      return profile;
    } catch (err) {
      console.error(`[userService] saveUser(${profile.guid}) → write error:`, err);
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a brand-new user with default settings.
 */
async function createUser() {
  const guid = randomUUID();
  console.log(`[userService] createUser() → new guid: ${guid}`);
  const profile = defaultProfile(guid);
  await saveUser(profile);
  console.log(`[userService] createUser() → created user ${guid}`);
  return profile;
}

/**
 * Ensure a user profile exists for the given GUID.
 * If no profile file exists, one is created with default values.
 * This is an idempotent upsert — safe to call at any time.
 */
async function ensureUser(guid) {
  guid = assertSafeGuid(guid);
  const existing = await getUser(guid);
  if (existing) return existing;
  console.log(`[userService] ensureUser(${guid}) → no profile found, creating default`);
  const profile = defaultProfile(guid);
  await saveUser(profile);
  console.log(`[userService] ensureUser(${guid}) → created`);
  return profile;
}

/**
 * Merge-update user settings.
 */
async function updateSettings(guid, settings) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] updateSettings(${guid})`, settings);
  const profile = await ensureUser(guid);
  profile.settings = { ...profile.settings, ...settings };
  await saveUser(profile);
  console.log(`[userService] updateSettings(${guid}) → done`);
  return profile.settings;
}

/**
 * Add a feed URL to subscriptions if not already present.
 */
async function addSubscription(guid, feedUrl) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] addSubscription(${guid}, ${feedUrl})`);
  const profile = await ensureUser(guid);
  if (!profile.subscriptions.includes(feedUrl)) {
    profile.subscriptions.push(feedUrl);
    profile.subscriptionsUpdatedAt = new Date().toISOString();
    await saveUser(profile);
    console.log(`[userService] addSubscription(${guid}) → added ${feedUrl}`);
  } else {
    console.log(`[userService] addSubscription(${guid}) → already subscribed to ${feedUrl}`);
  }
  return profile.subscriptions;
}

/**
 * Remove a subscription by feedId (MD5 hash of URL) or feedUrl.
 */
async function removeSubscription(guid, feedIdOrUrl) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] removeSubscription(${guid}, ${feedIdOrUrl})`);
  const crypto = require('crypto');
  const profile = await ensureUser(guid);

  const before = profile.subscriptions.length;
  profile.subscriptions = profile.subscriptions.filter(url => {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return hash !== feedIdOrUrl && url !== feedIdOrUrl;
  });

  const after = profile.subscriptions.length;
  console.log(`[userService] removeSubscription(${guid}) → removed ${before - after} entries`);
  if (before !== after) {
    profile.subscriptionsUpdatedAt = new Date().toISOString();
  }
  await saveUser(profile);
  return profile.subscriptions;
}

/**
 * Reorder subscriptions. orderedFeedIds is an array of feedId (MD5 hash)
 * values in the desired order.
 */
async function reorderSubscriptions(guid, orderedFeedIds) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] reorderSubscriptions(${guid}) → ${orderedFeedIds.length} entries`);
  const crypto = require('crypto');
  const profile = await ensureUser(guid);

  // Build feedId → feedUrl map from current subscriptions
  const urlByFeedId = {};
  for (const url of profile.subscriptions) {
    const feedId = crypto.createHash('md5').update(url).digest('hex');
    urlByFeedId[feedId] = url;
  }

  // Rebuild array in new order; append any not mentioned
  const reordered = orderedFeedIds
    .filter(id => urlByFeedId[id])
    .map(id => urlByFeedId[id]);
  for (const url of profile.subscriptions) {
    if (!reordered.includes(url)) reordered.push(url);
  }

  profile.subscriptions = reordered;
  profile.subscriptionsUpdatedAt = new Date().toISOString();
  await saveUser(profile);
  console.log(`[userService] reorderSubscriptions(${guid}) → done`);
  return profile.subscriptions;
}

/**
 * Return the list of subscribed feed URLs for a user.
 */
async function getSubscriptions(guid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getSubscriptions(${guid})`);
  const profile = await getUser(guid);
  if (!profile) {
    console.warn(`[userService] getSubscriptions(${guid}) → user not found, returning []`);
    return [];
  }
  console.log(`[userService] getSubscriptions(${guid}) → ${profile.subscriptions.length} feeds`);
  return profile.subscriptions;
}

/**
 * Update playback progress for an episode. Uses updatedAt for conflict resolution
 * (most-recent write wins).
 *
 * Progress is stored in data/progress/{guid}.json (separate from the user profile)
 * so bulk progress writes cannot corrupt subscriptions or settings.
 * The read-modify-write all happens inside the progress write queue so concurrent
 * bulk operations (e.g. marking 30 episodes played at once) are fully serialised.
 */
async function updateProgress(guid, episodeGuid, progressData) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] updateProgress(${guid}, ${episodeGuid})`, progressData);
  await ensureUser(guid);

  return queueProgressWrite(guid, async () => {
    const progressMap = await loadProgressForUser(guid);
    const existing = progressMap[episodeGuid];

    // Conflict resolution: most recent updatedAt wins
    if (existing && progressData.updatedAt && existing.updatedAt) {
      const existingTime = new Date(existing.updatedAt).getTime();
      const incomingTime = new Date(progressData.updatedAt).getTime();
      if (existingTime >= incomingTime) {
        console.log(`[userService] updateProgress(${guid}, ${episodeGuid}) → skipping, existing record is newer`);
        return existing;
      }
    }

    const oldPosition = existing ? (existing.position || 0) : 0;
    const newPosition = typeof progressData.position === 'number' ? progressData.position : oldPosition;
    const delta = Math.max(0, newPosition - oldPosition);

    const now = new Date().toISOString();
    progressMap[episodeGuid] = {
      position: newPosition,
      duration: progressData.duration !== undefined ? progressData.duration : (existing ? existing.duration : 0),
      updatedAt: progressData.updatedAt || now,
      played: progressData.played !== undefined ? progressData.played : (existing ? existing.played : false),
      feedId: progressData.feedId || (existing ? existing.feedId : '')
    };

    await atomicWriteFile(progressFilePath(guid), JSON.stringify(progressMap, null, 2));
    console.log(`[userService] updateProgress(${guid}, ${episodeGuid}) → saved, position=${newPosition}`);

    // Update stats on the user file (non-blocking; queued separately so it never
    // races with subscription/settings writes on the main user write queue).
    if (delta > 0 && !progressData.skipStats) {
      queueUserWrite(guid, async () => {
        const profile = await getUser(guid);
        if (!profile) return;
        profile.stats = profile.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 };
        profile.stats.totalListenedSeconds = (profile.stats.totalListenedSeconds || 0) + delta;
        console.log(`[userService] updateProgress → stats +${delta.toFixed(1)}s (total: ${profile.stats.totalListenedSeconds.toFixed(1)}s)`);
        const profileForDisk = { ...profile, progress: {} };
        await atomicWriteFile(userFilePath(guid), JSON.stringify(profileForDisk, null, 2));
      }).catch((err) => {
        console.warn(`[userService] updateProgress → stats update failed (non-fatal): ${err.message}`);
      });
    }

    return progressMap[episodeGuid];
  });
}

/**
 * Return the active playback session for a user.
 */
async function getPlaybackSession(guid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getPlaybackSession(${guid})`);
  const profile = await getUser(guid);
  if (!profile) {
    console.warn(`[userService] getPlaybackSession(${guid}) → user not found`);
    return null;
  }
  return profile.playbackSession || null;
}

/**
 * Persist the latest playback session snapshot for local playback recovery.
 */
async function updatePlaybackSession(guid, sessionData) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] updatePlaybackSession(${guid})`, sessionData);
  const profile = await ensureUser(guid);

  const existing = profile.playbackSession;
  if (existing && sessionData.updatedAt && existing.updatedAt) {
    const existingTime = new Date(existing.updatedAt).getTime();
    const incomingTime = new Date(sessionData.updatedAt).getTime();
    if (existingTime > incomingTime) {
      console.log(`[userService] updatePlaybackSession(${guid}) → skipping, existing session is newer`);
      return existing;
    }
  }

  const now = new Date().toISOString();
  const normalizedQueue = normalizeQueue(sessionData.queue !== undefined
    ? sessionData.queue
    : (existing && Array.isArray(existing.queue) ? existing.queue : []));
  profile.playbackSession = {
    episodeGuid: sessionData.episodeGuid || '',
    feedId: sessionData.feedId || '',
    title: sessionData.title || '',
    podcastTitle: sessionData.podcastTitle || '',
    audioUrl: sessionData.audioUrl || '',
    podcastImageUrl: sessionData.podcastImageUrl || '',
    imageUrl: sessionData.imageUrl || '',
    position: typeof sessionData.position === 'number' ? sessionData.position : parseFloat(sessionData.position) || 0,
    duration: typeof sessionData.duration === 'number' ? sessionData.duration : parseFloat(sessionData.duration) || 0,
    isPlaying: !!sessionData.isPlaying,
    mode: sessionData.mode === 'cast' ? 'cast' : 'local',
    transport: sessionData.transport || '',
    castDeviceId: sessionData.castDeviceId || '',
    castDeviceName: sessionData.castDeviceName || '',
    clientId: sessionData.clientId || '',
    currentEpisodeGuid: sessionData.currentEpisodeGuid || sessionData.episodeGuid || '',
    queue: normalizedQueue,
    updatedAt: sessionData.updatedAt || now
  };

  profile.queue = normalizedQueue;

  await saveUser(profile);
  console.log(`[userService] updatePlaybackSession(${guid}) → saved ${profile.playbackSession.episodeGuid} @ ${profile.playbackSession.position}s`);
  return profile.playbackSession;
}

/**
 * Clear the active playback session.
 */
async function clearPlaybackSession(guid, episodeGuid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] clearPlaybackSession(${guid}, ${episodeGuid || '*'})`);
  const profile = await ensureUser(guid);

  if (!profile.playbackSession) {
    return null;
  }

  if (episodeGuid && profile.playbackSession.episodeGuid && profile.playbackSession.episodeGuid !== episodeGuid) {
    console.log(`[userService] clearPlaybackSession(${guid}) → skipped, different active episode`);
    return profile.playbackSession;
  }

  profile.playbackSession = null;
  await saveUser(profile);
  console.log(`[userService] clearPlaybackSession(${guid}) → cleared`);
  return null;
}

async function getQueue(guid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getQueue(${guid})`);
  const profile = await getUser(guid);
  if (!profile) {
    console.warn(`[userService] getQueue(${guid}) → user not found`);
    return {
      queue: [],
      mode: 'local',
      currentEpisodeGuid: '',
      updatedAt: null,
    };
  }
  if (profile.playbackSession && typeof profile.playbackSession === 'object') {
    profile.playbackSession.queue = normalizeQueue(profile.playbackSession.queue || profile.queue || []);
    profile.queue = profile.playbackSession.queue;
    return {
      queue: profile.playbackSession.queue,
      mode: profile.playbackSession.mode === 'cast' ? 'cast' : 'local',
      currentEpisodeGuid: profile.playbackSession.currentEpisodeGuid || profile.playbackSession.episodeGuid || '',
      updatedAt: profile.playbackSession.updatedAt || null,
    };
  }

  profile.queue = normalizeQueue(profile.queue);
  return {
    queue: profile.queue,
    mode: 'local',
    currentEpisodeGuid: '',
    updatedAt: profile.updatedAt || null,
  };
}

async function updateQueue(guid, queueItems, metadata = {}) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] updateQueue(${guid}) → ${Array.isArray(queueItems) ? queueItems.length : 0} items`);
  const profile = await ensureUser(guid);

  const normalizedQueue = normalizeQueue(queueItems);
  const now = new Date().toISOString();
  const existingSession = profile.playbackSession && typeof profile.playbackSession === 'object'
    ? profile.playbackSession
    : null;
  const incomingUpdatedAt = metadata.updatedAt ? new Date(metadata.updatedAt).getTime() : NaN;
  const existingUpdatedAt = existingSession && existingSession.updatedAt ? new Date(existingSession.updatedAt).getTime() : NaN;

  if (Number.isFinite(incomingUpdatedAt) && Number.isFinite(existingUpdatedAt) && incomingUpdatedAt < existingUpdatedAt) {
    console.log(`[userService] updateQueue(${guid}) → skipped stale update (${incomingUpdatedAt} < ${existingUpdatedAt})`);
    return normalizeQueue(existingSession.queue || profile.queue || []);
  }

  const nextMode = metadata.mode === 'cast'
    ? 'cast'
    : (metadata.mode === 'local'
      ? 'local'
      : (existingSession ? existingSession.mode : 'local'));

  profile.playbackSession = {
    episodeGuid: existingSession ? (existingSession.episodeGuid || '') : '',
    feedId: existingSession ? (existingSession.feedId || '') : '',
    title: existingSession ? (existingSession.title || '') : '',
    podcastTitle: existingSession ? (existingSession.podcastTitle || '') : '',
    audioUrl: existingSession ? (existingSession.audioUrl || '') : '',
    podcastImageUrl: existingSession ? (existingSession.podcastImageUrl || '') : '',
    imageUrl: existingSession ? (existingSession.imageUrl || '') : '',
    position: existingSession ? (existingSession.position || 0) : 0,
    duration: existingSession ? (existingSession.duration || 0) : 0,
    isPlaying: existingSession ? !!existingSession.isPlaying : false,
    mode: nextMode,
    currentEpisodeGuid: metadata.currentEpisodeGuid || (existingSession ? (existingSession.currentEpisodeGuid || existingSession.episodeGuid || '') : ''),
    queue: normalizedQueue,
    updatedAt: metadata.updatedAt || now,
  };

  profile.queue = normalizedQueue;
  await saveUser(profile);
  return profile.playbackSession.queue;
}

/**
 * Return all progress records for a user (from the dedicated progress file).
 */
async function getProgress(guid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getProgress(${guid})`);
  const progressMap = await loadProgressForUser(guid);
  const count = Object.keys(progressMap).length;
  console.log(`[userService] getProgress(${guid}) → ${count} records`);
  return progressMap;
}

/**
 * Return paginated history entries.
 */
async function getHistory(guid, limit = 50, offset = 0) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getHistory(${guid}, limit=${limit}, offset=${offset})`);
  const profile = await getUser(guid);
  if (!profile) {
    console.warn(`[userService] getHistory(${guid}) → user not found`);
    return [];
  }
  const slice = (profile.history || []).slice(offset, offset + limit);
  console.log(`[userService] getHistory(${guid}) → returning ${slice.length} entries (of ${profile.history.length} total)`);
  return slice;
}

/**
 * Prepend an entry to history (max 1000 entries kept).
 */
async function addHistoryEntry(guid, entry) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] addHistoryEntry(${guid})`, entry);
  const profile = await ensureUser(guid);

  profile.history = profile.history || [];
  profile.history.unshift({
    ...entry,
    listenedAt: entry.listenedAt || new Date().toISOString()
  });

  // Cap at 1000 entries
  if (profile.history.length > 1000) {
    const removed = profile.history.length - 1000;
    profile.history = profile.history.slice(0, 1000);
    console.log(`[userService] addHistoryEntry(${guid}) → trimmed ${removed} old entries`);
  }

  await saveUser(profile);
  console.log(`[userService] addHistoryEntry(${guid}) → history length: ${profile.history.length}`);
  return profile.history[0];
}

/**
 * Increment listened/skipped stats by the given deltas.
 */
async function updateStats(guid, listenedDelta, skippedDelta) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] updateStats(${guid}, listened+${listenedDelta}, skipped+${skippedDelta})`);
  const profile = await ensureUser(guid);

  profile.stats = profile.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 };
  if (typeof listenedDelta === 'number' && listenedDelta > 0) {
    profile.stats.totalListenedSeconds = (profile.stats.totalListenedSeconds || 0) + listenedDelta;
  }
  if (typeof skippedDelta === 'number' && skippedDelta > 0) {
    profile.stats.totalSkippedSeconds = (profile.stats.totalSkippedSeconds || 0) + skippedDelta;
  }

  await saveUser(profile);
  console.log(`[userService] updateStats(${guid}) → total listened: ${profile.stats.totalListenedSeconds}s, skipped: ${profile.stats.totalSkippedSeconds}s`);
  return profile.stats;
}

/**
 * Return all GUIDs discovered from filenames in data/users/.
 */
async function getAllUserGuids() {
  console.log(`[userService] getAllUserGuids()`);
  try {
    const files = await fs.promises.readdir(USERS_DIR);
    const guids = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    console.log(`[userService] getAllUserGuids() → ${guids.length} users`);
    return guids;
  } catch (err) {
    console.error('[userService] getAllUserGuids() → error reading directory:', err);
    return [];
  }
}

/**
 * Mark episodes as seen for a given feed (adds guids to seenEpisodes[feedId]).
 */
async function markEpisodesSeen(guid, feedId, episodeGuids) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] markEpisodesSeen(${guid}, feedId=${feedId}, count=${episodeGuids.length})`);
  const profile = await ensureUser(guid);

  profile.seenEpisodes = profile.seenEpisodes || {};
  profile.seenEpisodes[feedId] = profile.seenEpisodes[feedId] || [];

  let added = 0;
  for (const epGuid of episodeGuids) {
    if (!profile.seenEpisodes[feedId].includes(epGuid)) {
      profile.seenEpisodes[feedId].push(epGuid);
      added++;
    }
  }

  await saveUser(profile);
  console.log(`[userService] markEpisodesSeen(${guid}, ${feedId}) → added ${added} new guids`);
  return profile.seenEpisodes[feedId];
}

/**
 * Return the array of seen episode GUIDs for a given feed.
 */
async function getSeenEpisodes(guid, feedId) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getSeenEpisodes(${guid}, ${feedId})`);
  const profile = await getUser(guid);
  if (!profile) {
    console.warn(`[userService] getSeenEpisodes(${guid}) → user not found`);
    return [];
  }
  const seen = (profile.seenEpisodes || {})[feedId] || [];
  console.log(`[userService] getSeenEpisodes(${guid}, ${feedId}) → ${seen.length} seen guids`);
  return seen;
}

async function getSyncSnapshot(guid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getSyncSnapshot(${guid})`);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);
  const progress = await loadProgressForUser(guid);
  return syncService.buildSnapshot({ ...profile, progress });
}

async function mergeAndSaveSyncState(guid, incomingState) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] mergeAndSaveSyncState(${guid})`);
  const profile = await ensureUser(guid);
  const existingProgress = await loadProgressForUser(guid);

  // Build the sync result with actual progress from the progress file
  const syncResult = syncService.buildSyncResult({ ...profile, progress: existingProgress }, incomingState || {});
  const merged = syncResult.mergedState;
  const mergedSettings = merged.settings && typeof merged.settings === 'object'
    ? { ...merged.settings }
    : {};
  delete mergedSettings.podcastIndexApiKey;
  delete mergedSettings.podcastIndexApiSecret;

  profile.settings = {
    ...profile.settings,
    ...mergedSettings,
  };

  const existingSubsUpdatedAt = profile.subscriptionsUpdatedAt || profile.updatedAt || null;
  const incomingSubsUpdatedAt = merged.subscriptionsUpdatedAt || incomingState?.subscriptionsUpdatedAt || null;
  const existingSubsTs = existingSubsUpdatedAt ? new Date(existingSubsUpdatedAt).getTime() : NaN;
  const incomingSubsTs = incomingSubsUpdatedAt ? new Date(incomingSubsUpdatedAt).getTime() : NaN;
  const useIncomingSubscriptions = Number.isFinite(incomingSubsTs) && (!Number.isFinite(existingSubsTs) || incomingSubsTs >= existingSubsTs);
  if (Array.isArray(merged.subscriptions)) {
    profile.subscriptions = useIncomingSubscriptions ? merged.subscriptions : profile.subscriptions;
  }
  profile.subscriptionsUpdatedAt = useIncomingSubscriptions
    ? (incomingSubsUpdatedAt || profile.subscriptionsUpdatedAt || profile.updatedAt)
    : (profile.subscriptionsUpdatedAt || profile.updatedAt);

  // Progress is intentionally NOT written to profile — it lives in the progress file
  profile.stats = {
    ...(profile.stats || {}),
    ...(merged.stats || {}),
  };

  if (Array.isArray(merged.queue)) {
    profile.queue = normalizeQueue(merged.queue);
  }

  if (merged.playbackSession && typeof merged.playbackSession === 'object') {
    profile.playbackSession = {
      ...profile.playbackSession,
      ...merged.playbackSession,
      queue: normalizeQueue(
        merged.playbackSession.queue !== undefined
          ? merged.playbackSession.queue
          : (profile.playbackSession && profile.playbackSession.queue)
      ),
    };
  }

  // Save user profile (without progress)
  await saveUser(profile);

  // Save merged progress to the dedicated progress file
  if (merged.progress && typeof merged.progress === 'object') {
    await queueProgressWrite(guid, async () => {
      await atomicWriteFile(progressFilePath(guid), JSON.stringify(merged.progress, null, 2));
    });
  }

  const finalProgress = merged.progress || existingProgress;
  return {
    snapshot: syncService.buildSnapshot({ ...profile, progress: finalProgress }),
    summary: syncResult.summary,
  };
}

async function getBootstrapSyncState(guid) {
  guid = assertSafeGuid(guid);
  console.log(`[userService] getBootstrapSyncState(${guid})`);
  const profile = await ensureUser(guid);
  const progress = await loadProgressForUser(guid);

  const snapshot = syncService.buildSnapshot({ ...profile, progress });
  const queueState = await getQueue(guid);
  const playbackSession = await getPlaybackSession(guid);

  return {
    guid,
    snapshot,
    queue: queueState || { queue: [], mode: 'local', currentEpisodeGuid: '', updatedAt: null },
    playbackSession: playbackSession || null,
    serverTime: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  createUser,
  ensureUser,
  getUser,
  saveUser,
  updateSettings,
  addSubscription,
  removeSubscription,
  reorderSubscriptions,
  getSubscriptions,
  updateProgress,
  getProgress,
  getPlaybackSession,
  updatePlaybackSession,
  clearPlaybackSession,
  getQueue,
  updateQueue,
  getHistory,
  addHistoryEntry,
  updateStats,
  getAllUserGuids,
  markEpisodesSeen,
  getSeenEpisodes,
  getSyncSnapshot,
  mergeAndSaveSyncState,
  getBootstrapSyncState
};
