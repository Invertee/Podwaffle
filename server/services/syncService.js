'use strict';

function nowIso() {
  return new Date().toISOString();
}

function safeIso(value, fallback = nowIso()) {
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
}

function sanitizeSettings(settings) {
  const next = settings && typeof settings === 'object' ? { ...settings } : {};
  delete next.podcastIndexApiKey;
  delete next.podcastIndexApiSecret;
  return next;
}

function normalizeSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of subscriptions) {
    const feedUrl = typeof entry === 'string'
      ? entry.trim()
      : String(entry?.feedUrl || entry?.url || '').trim();
    if (!feedUrl || feedUrl === '[object Object]' || seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    result.push(feedUrl);
  }
  return result;
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object') return {};
  const result = {};
  for (const [episodeGuid, entry] of Object.entries(progress)) {
    if (!entry || typeof entry !== 'object') continue;
    result[String(episodeGuid)] = {
      position: Math.max(0, Number(entry.position) || 0),
      duration: Math.max(0, Number(entry.duration) || 0),
      played: !!entry.played,
      feedId: entry.feedId ? String(entry.feedId) : '',
      updatedAt: safeIso(entry.updatedAt),
    };
  }
  return result;
}

// Bootstrap is deliberately one-way: the server is authoritative and clients
// replay explicit queued mutations through the normal API. There is no generic
// client snapshot merge because it can revive deleted subscriptions or let a
// stale device take over the playback lease.
function buildSnapshot(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const updatedAt = safeIso(source.updatedAt);
  return {
    guid: source.guid || '',
    updatedAt,
    subscriptionsUpdatedAt: safeIso(source.subscriptionsUpdatedAt, updatedAt),
    settings: sanitizeSettings(source.settings),
    subscriptions: normalizeSubscriptions(source.subscriptions),
    progress: normalizeProgress(source.progress),
    stats: {
      totalListenedSeconds: Math.max(0, Number(source.stats?.totalListenedSeconds) || 0),
      totalSkippedSeconds: Math.max(0, Number(source.stats?.totalSkippedSeconds) || 0),
    },
    queue: Array.isArray(source.queue) ? source.queue : [],
    playbackSession: source.playbackSession && typeof source.playbackSession === 'object'
      ? source.playbackSession
      : null,
  };
}

module.exports = { buildSnapshot };
