'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const _dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const USERS_DIR = path.join(_dataRoot, 'users');

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function userFilePath(guid) {
  return path.join(USERS_DIR, `${guid}.json`);
}

function defaultProfile(guid) {
  const now = new Date().toISOString();
  return {
    guid,
    createdAt: now,
    updatedAt: now,
    settings: {
      skipBack: 15,
      skipForward: 45,
      podcastIndexApiKey: '',
      podcastIndexApiSecret: ''
    },
    subscriptions: [],
    seenEpisodes: {},
    progress: {},
    history: [],
    stats: {
      totalListenedSeconds: 0,
      totalSkippedSeconds: 0
    }
  };
}

// ---------------------------------------------------------------------------
// Core I/O
// ---------------------------------------------------------------------------

/**
 * Read a user profile from disk. Returns null on any error.
 */
async function getUser(guid) {
  const filePath = userFilePath(guid);
  console.log(`[userService] getUser(${guid}) → reading ${filePath}`);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const profile = JSON.parse(raw);
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
 */
async function saveUser(profile) {
  profile.updatedAt = new Date().toISOString();
  const filePath = userFilePath(profile.guid);
  console.log(`[userService] saveUser(${profile.guid}) → writing ${filePath}`);
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf8');
    console.log(`[userService] saveUser(${profile.guid}) → saved OK`);
    return profile;
  } catch (err) {
    console.error(`[userService] saveUser(${profile.guid}) → write error:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a brand-new user with default settings.
 */
async function createUser() {
  const guid = uuidv4();
  console.log(`[userService] createUser() → new guid: ${guid}`);
  const profile = defaultProfile(guid);
  await saveUser(profile);
  console.log(`[userService] createUser() → created user ${guid}`);
  return profile;
}

/**
 * Merge-update user settings.
 */
async function updateSettings(guid, settings) {
  console.log(`[userService] updateSettings(${guid})`, settings);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);
  profile.settings = { ...profile.settings, ...settings };
  await saveUser(profile);
  console.log(`[userService] updateSettings(${guid}) → done`);
  return profile.settings;
}

/**
 * Add a feed URL to subscriptions if not already present.
 */
async function addSubscription(guid, feedUrl) {
  console.log(`[userService] addSubscription(${guid}, ${feedUrl})`);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);
  if (!profile.subscriptions.includes(feedUrl)) {
    profile.subscriptions.push(feedUrl);
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
  console.log(`[userService] removeSubscription(${guid}, ${feedIdOrUrl})`);
  const crypto = require('crypto');
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);

  const before = profile.subscriptions.length;
  profile.subscriptions = profile.subscriptions.filter(url => {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return hash !== feedIdOrUrl && url !== feedIdOrUrl;
  });

  const after = profile.subscriptions.length;
  console.log(`[userService] removeSubscription(${guid}) → removed ${before - after} entries`);
  await saveUser(profile);
  return profile.subscriptions;
}

/**
 * Reorder subscriptions. orderedFeedIds is an array of feedId (MD5 hash)
 * values in the desired order.
 */
async function reorderSubscriptions(guid, orderedFeedIds) {
  console.log(`[userService] reorderSubscriptions(${guid}) → ${orderedFeedIds.length} entries`);
  const crypto = require('crypto');
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);

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
  await saveUser(profile);
  console.log(`[userService] reorderSubscriptions(${guid}) → done`);
  return profile.subscriptions;
}

/**
 * Return the list of subscribed feed URLs for a user.
 */
async function getSubscriptions(guid) {
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
 * (most-recent write wins). Increments totalListenedSeconds based on position delta.
 */
async function updateProgress(guid, episodeGuid, progressData) {
  console.log(`[userService] updateProgress(${guid}, ${episodeGuid})`, progressData);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);

  const existing = profile.progress[episodeGuid];

  // Conflict resolution: most recent updatedAt wins
  if (existing && progressData.updatedAt && existing.updatedAt) {
    const existingTime = new Date(existing.updatedAt).getTime();
    const incomingTime = new Date(progressData.updatedAt).getTime();
    if (existingTime >= incomingTime) {
      console.log(`[userService] updateProgress(${guid}, ${episodeGuid}) → skipping, existing record is newer`);
      return existing;
    }
  }

  // Calculate listened delta
  const oldPosition = existing ? (existing.position || 0) : 0;
  const newPosition = typeof progressData.position === 'number' ? progressData.position : oldPosition;
  const delta = Math.max(0, newPosition - oldPosition);

  const now = new Date().toISOString();
  profile.progress[episodeGuid] = {
    position: newPosition,
    duration: progressData.duration !== undefined ? progressData.duration : (existing ? existing.duration : 0),
    updatedAt: progressData.updatedAt || now,
    played: progressData.played !== undefined ? progressData.played : (existing ? existing.played : false),
    feedId: progressData.feedId || (existing ? existing.feedId : '')
  };

  // Update stats
  if (delta > 0) {
    profile.stats = profile.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 };
    profile.stats.totalListenedSeconds = (profile.stats.totalListenedSeconds || 0) + delta;
    console.log(`[userService] updateProgress → listened delta: +${delta.toFixed(1)}s (total: ${profile.stats.totalListenedSeconds.toFixed(1)}s)`);
  }

  await saveUser(profile);
  console.log(`[userService] updateProgress(${guid}, ${episodeGuid}) → saved, position=${newPosition}`);
  return profile.progress[episodeGuid];
}

/**
 * Return all progress records for a user.
 */
async function getProgress(guid) {
  console.log(`[userService] getProgress(${guid})`);
  const profile = await getUser(guid);
  if (!profile) {
    console.warn(`[userService] getProgress(${guid}) → user not found`);
    return {};
  }
  const count = Object.keys(profile.progress).length;
  console.log(`[userService] getProgress(${guid}) → ${count} records`);
  return profile.progress;
}

/**
 * Return paginated history entries.
 */
async function getHistory(guid, limit = 50, offset = 0) {
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
  console.log(`[userService] addHistoryEntry(${guid})`, entry);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);

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
  console.log(`[userService] updateStats(${guid}, listened+${listenedDelta}, skipped+${skippedDelta})`);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);

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
  console.log(`[userService] markEpisodesSeen(${guid}, feedId=${feedId}, count=${episodeGuids.length})`);
  const profile = await getUser(guid);
  if (!profile) throw new Error(`User ${guid} not found`);

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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  createUser,
  getUser,
  saveUser,
  updateSettings,
  addSubscription,
  removeSubscription,
  reorderSubscriptions,
  getSubscriptions,
  updateProgress,
  getProgress,
  getHistory,
  addHistoryEntry,
  updateStats,
  getAllUserGuids,
  markEpisodesSeen,
  getSeenEpisodes
};
