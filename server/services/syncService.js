'use strict';

function toIsoNow() {
  return new Date().toISOString();
}

function sanitizeSettings(settings) {
  const next = settings && typeof settings === 'object' ? { ...settings } : {};
  delete next.podcastIndexApiKey;
  delete next.podcastIndexApiSecret;
  return next;
}

function safeIso(value, fallback) {
  const n = Date.parse(value || '');
  if (!Number.isNaN(n)) return new Date(n).toISOString();
  return fallback;
}

function normalizeProgressMap(progress) {
  if (!progress || typeof progress !== 'object') return {};
  const normalized = {};
  for (const [episodeGuid, entry] of Object.entries(progress)) {
    if (!entry || typeof entry !== 'object') continue;
    const existingPosition = typeof entry.position === 'number' ? entry.position : parseFloat(entry.position) || 0;
    const existingDuration = typeof entry.duration === 'number' ? entry.duration : parseFloat(entry.duration) || 0;
    normalized[String(episodeGuid)] = {
      position: Math.max(0, existingPosition),
      duration: Math.max(0, existingDuration),
      played: !!entry.played,
      feedId: entry.feedId ? String(entry.feedId) : '',
      updatedAt: safeIso(entry.updatedAt, toIsoNow()),
    };
  }
  return normalized;
}

function normalizeSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const seen = new Set();
  const merged = [];
  for (const entry of subscriptions) {
    const value = typeof entry === 'string'
      ? entry.trim()
      : (entry && typeof entry === 'object'
        ? String(entry.feedUrl || entry.url || '').trim()
        : '');
    if (value === '[object Object]') continue;
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    merged.push(value);
  }
  return merged;
}

function safeUpdatedAt(value, fallback = toIsoNow()) {
  const ts = Date.parse(value || '');
  return Number.isNaN(ts) ? fallback : new Date(ts).toISOString();
}

function compareTimestamps(a, b) {
  const aTs = Date.parse(a || '');
  const bTs = Date.parse(b || '');
  if (Number.isNaN(aTs) && Number.isNaN(bTs)) return 0;
  if (Number.isNaN(aTs)) return -1;
  if (Number.isNaN(bTs)) return 1;
  return aTs - bTs;
}

function mergeSubscriptions(local, remote) {
  const normalizedRemote = normalizeSubscriptions(remote);
  const remoteSet = new Set(normalizedRemote);
  const localNormalized = normalizeSubscriptions(local);
  for (const feedUrl of localNormalized) {
    if (!remoteSet.has(feedUrl)) {
      normalizedRemote.push(feedUrl);
      remoteSet.add(feedUrl);
    }
  }
  return normalizedRemote;
}

function mergeProgress(localProgress, remoteProgress) {
  const local = normalizeProgressMap(localProgress);
  const remote = normalizeProgressMap(remoteProgress);
  const merged = {};
  const allEpisodeGuids = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const episodeGuid of allEpisodeGuids) {
    const localEntry = local[episodeGuid];
    const remoteEntry = remote[episodeGuid];

    if (!localEntry) {
      merged[episodeGuid] = remoteEntry;
      continue;
    }
    if (!remoteEntry) {
      merged[episodeGuid] = localEntry;
      continue;
    }

    const localTs = Date.parse(localEntry.updatedAt || '');
    const remoteTs = Date.parse(remoteEntry.updatedAt || '');
    if (Number.isFinite(localTs) && Number.isFinite(remoteTs)) {
      merged[episodeGuid] = remoteTs >= localTs ? remoteEntry : localEntry;
    } else {
      merged[episodeGuid] = remoteEntry;
    }
  }

  return merged;
}

function mergeStats(localStats, remoteStats) {
  const local = localStats && typeof localStats === 'object' ? localStats : {};
  const remote = remoteStats && typeof remoteStats === 'object' ? remoteStats : {};
  return {
    totalListenedSeconds: Math.max(
      0,
      typeof remote.totalListenedSeconds === 'number' ? remote.totalListenedSeconds : (typeof local.totalListenedSeconds === 'number' ? local.totalListenedSeconds : 0)
    ),
    totalSkippedSeconds: Math.max(
      0,
      typeof remote.totalSkippedSeconds === 'number' ? remote.totalSkippedSeconds : (typeof local.totalSkippedSeconds === 'number' ? local.totalSkippedSeconds : 0)
    ),
  };
}

function buildSnapshot(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const subscriptionsUpdatedAt = safeUpdatedAt(source.subscriptionsUpdatedAt, safeIso(source.updatedAt, toIsoNow()));
  return {
    guid: source.guid || '',
    updatedAt: safeIso(source.updatedAt, toIsoNow()),
    subscriptionsUpdatedAt,
    settings: sanitizeSettings(source.settings),
    subscriptions: normalizeSubscriptions(source.subscriptions),
    progress: normalizeProgressMap(source.progress),
    stats: mergeStats({}, source.stats),
    queue: Array.isArray(source.queue) ? source.queue : [],
    playbackSession: source.playbackSession && typeof source.playbackSession === 'object'
      ? source.playbackSession
      : null,
  };
}

function buildSyncResult(profile, incomingState) {
  const remoteSnapshot = buildSnapshot(profile);
  const incoming = incomingState && typeof incomingState === 'object' ? incomingState : {};
  const incomingSubscriptionsUpdatedAt = safeUpdatedAt(
    incoming.subscriptionsUpdatedAt,
    remoteSnapshot.subscriptionsUpdatedAt
  );

  const mergedSubscriptions = mergeSubscriptions(
    compareTimestamps(incomingSubscriptionsUpdatedAt, remoteSnapshot.subscriptionsUpdatedAt) >= 0
      ? incoming.subscriptions
      : remoteSnapshot.subscriptions,
    compareTimestamps(incomingSubscriptionsUpdatedAt, remoteSnapshot.subscriptionsUpdatedAt) >= 0
      ? remoteSnapshot.subscriptions
      : incoming.subscriptions
  );

  const mergedProgress = mergeProgress(
    incoming.progress,
    remoteSnapshot.progress
  );

  const mergedStats = mergeStats(incoming.stats, remoteSnapshot.stats);
  const incomingPlaybackSession = incoming.playbackSession && typeof incoming.playbackSession === 'object'
    ? incoming.playbackSession
    : null;
  const remotePlaybackSession = remoteSnapshot.playbackSession && typeof remoteSnapshot.playbackSession === 'object'
    ? remoteSnapshot.playbackSession
    : null;
  const useIncomingPlaybackSession = !!incomingPlaybackSession && (
    !remotePlaybackSession
    || compareTimestamps(incomingPlaybackSession.updatedAt, remotePlaybackSession.updatedAt) >= 0
  );
  const mergedPlaybackSession = useIncomingPlaybackSession
    ? incomingPlaybackSession
    : remotePlaybackSession;
  const mergedQueue = useIncomingPlaybackSession && Array.isArray(incoming.queue)
    ? incoming.queue
    : remoteSnapshot.queue;

  return {
    guid: remoteSnapshot.guid,
    mergedState: {
      settings: sanitizeSettings({
        ...remoteSnapshot.settings,
        ...(incoming.settings && typeof incoming.settings === 'object' ? incoming.settings : {}),
      }),
      subscriptions: mergedSubscriptions,
      progress: mergedProgress,
      stats: mergedStats,
      subscriptionsUpdatedAt: compareTimestamps(incomingSubscriptionsUpdatedAt, remoteSnapshot.subscriptionsUpdatedAt) >= 0
        ? incomingSubscriptionsUpdatedAt
        : remoteSnapshot.subscriptionsUpdatedAt,
      queue: mergedQueue,
      playbackSession: mergedPlaybackSession,
    },
    summary: {
      remoteSubscriptions: remoteSnapshot.subscriptions.length,
      incomingSubscriptions: Array.isArray(incoming.subscriptions) ? incoming.subscriptions.length : 0,
      mergedSubscriptions: mergedSubscriptions.length,
      remoteProgressEntries: Object.keys(remoteSnapshot.progress).length,
      incomingProgressEntries: incoming.progress && typeof incoming.progress === 'object' ? Object.keys(incoming.progress).length : 0,
      mergedProgressEntries: Object.keys(mergedProgress).length,
      subscriptionsUpdatedAt: compareTimestamps(incomingSubscriptionsUpdatedAt, remoteSnapshot.subscriptionsUpdatedAt) >= 0
        ? incomingSubscriptionsUpdatedAt
        : remoteSnapshot.subscriptionsUpdatedAt,
      mergedAt: toIsoNow(),
    },
  };
}

module.exports = {
  buildSnapshot,
  buildSyncResult,
  mergeSubscriptions,
  mergeProgress,
  mergeStats,
};
