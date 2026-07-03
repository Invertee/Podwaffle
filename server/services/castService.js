'use strict';

// ---------------------------------------------------------------------------
// External Cast State
// ---------------------------------------------------------------------------
// This module now only manages state mirroring from the browser's Google Cast sender.
// Server-side device discovery and media playback control have been removed.
// All cast control is now handled client-side via the Google Cast sender SDK.

const externalState = {
  activeDeviceId: null,
  deviceName: null,
  ownerGuid: null,
  mediaUrl: null,
  episodeGuid: null,
  title: null,
  podcastTitle: null,
  imageUrl: null,
  position: 0,
  duration: 0,
  volume: 1.0,
  status: 'idle',
  transport: null,
  source: null,
  updatedAt: null,
};

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

/**
 * Return the current cast state snapshot.
 * If external state is active (from browser), return that; otherwise return idle state.
 */
function getState() {
  if (externalState.activeDeviceId) {
    return {
      activeDeviceId: externalState.activeDeviceId,
      deviceName: externalState.deviceName,
      ownerGuid: externalState.ownerGuid,
      mediaUrl: externalState.mediaUrl,
      episodeGuid: externalState.episodeGuid,
      title: externalState.title,
      podcastTitle: externalState.podcastTitle,
      imageUrl: externalState.imageUrl,
      position: externalState.position,
      duration: externalState.duration,
      volume: externalState.volume,
      status: externalState.status,
      transport: externalState.transport,
      source: externalState.source,
      updatedAt: externalState.updatedAt,
    };
  }

  return {
    activeDeviceId: null,
    deviceName: null,
    ownerGuid: null,
    mediaUrl: null,
    episodeGuid: null,
    title: null,
    podcastTitle: null,
    imageUrl: null,
    position: 0,
    duration: 0,
    volume: 1.0,
    status: 'idle',
    transport: null,
    source: null,
    updatedAt: null,
  };
}

/**
 * Update the external (browser-driven) cast state.
 * Called when the browser sends an update via PUT /cast/state.
 * Idempotent — stores the provided state snapshot.
 */
function setExternalState(nextState = {}) {
  const updatedAt = nextState.updatedAt || new Date().toISOString();
  externalState.activeDeviceId = nextState.activeDeviceId || null;
  externalState.deviceName = nextState.deviceName || null;
  externalState.ownerGuid = nextState.ownerGuid || null;
  externalState.mediaUrl = nextState.mediaUrl || null;
  externalState.episodeGuid = nextState.episodeGuid || null;
  externalState.title = nextState.title || null;
  externalState.podcastTitle = nextState.podcastTitle || null;
  externalState.imageUrl = nextState.imageUrl || null;
  externalState.position = Number.isFinite(Number(nextState.position)) ? Number(nextState.position) : 0;
  externalState.duration = Number.isFinite(Number(nextState.duration)) ? Number(nextState.duration) : 0;
  externalState.volume = Number.isFinite(Number(nextState.volume)) ? Number(nextState.volume) : 1.0;
  externalState.status = nextState.status || 'idle';
  externalState.transport = nextState.transport || 'google_cast_sender';
  externalState.source = nextState.source || 'browser';
  externalState.updatedAt = updatedAt;

  console.log(`[castService] setExternalState() → device=${externalState.activeDeviceId || 'none'}, status=${externalState.status}`);
  return getState();
}

/**
 * Clear the external (browser-driven) cast state.
 * If ownerGuid is specified, only clear if it matches the current owner.
 */
function clearExternalState(ownerGuid = null) {
  if (ownerGuid && externalState.ownerGuid && externalState.ownerGuid !== ownerGuid) {
    console.log(`[castService] clearExternalState() → ownership mismatch, skipping clear`);
    return getState();
  }

  console.log(`[castService] clearExternalState()`);
  externalState.activeDeviceId = null;
  externalState.deviceName = null;
  externalState.ownerGuid = null;
  externalState.mediaUrl = null;
  externalState.episodeGuid = null;
  externalState.title = null;
  externalState.podcastTitle = null;
  externalState.imageUrl = null;
  externalState.position = 0;
  externalState.duration = 0;
  externalState.volume = 1.0;
  externalState.status = 'idle';
  externalState.transport = null;
  externalState.source = null;
  externalState.updatedAt = null;

  return getState();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getState,
  setExternalState,
  clearExternalState,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getState,
  setExternalState,
  clearExternalState,
};
