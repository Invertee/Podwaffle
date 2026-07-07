'use strict';

const { Bonjour } = require('bonjour-service');

// ---------------------------------------------------------------------------
// Device registry (in-memory)
// ---------------------------------------------------------------------------
/** @type {Map<string, {id: string, name: string, host: string, port: number, status: string}>} */
const devices = new Map();

// ---------------------------------------------------------------------------
// Cast session state
// ---------------------------------------------------------------------------
const state = {
  activeDeviceId: null,
  mediaUrl: null,
  episodeGuid: null,
  title: null,
  podcastTitle: null,
  imageUrl: null,
  position: 0,
  duration: 0,
  volume: 1.0,
  status: 'idle', // idle | playing | paused | connecting | error
  client: null,
  player: null,
  statusPoller: null,
  idleTimeoutTimer: null,
  ownerGuid: null, // The user GUID who initiated the cast session
  broadcastFn: null // Callback to broadcast state to WS clients
};

// ---------------------------------------------------------------------------
// mDNS Discovery
// ---------------------------------------------------------------------------

let bonjourInstance = null;
let browser = null;

function getFriendlyDeviceName(service) {
  const txt = service && service.txt ? service.txt : null;
  const candidates = [
    txt && (txt.fn || txt.FriendlyName || txt.friendlyName || txt.name || txt.Name),
    service && (service.friendlyName || service.name),
    service && service.host
  ].filter(Boolean);

  const raw = candidates.find((value) => typeof value === 'string' && value.trim());
  if (!raw) return 'Unknown Cast Device';

  const clean = String(raw).trim();
  return clean
    .replace(/^Google-Cast-Group-/i, '')
    .replace(/^Google-Cast-/i, '')
    .replace(/^Chromecast/i, '')
    .trim() || 'Cast Device';
}

/**
 * Start discovering Google Cast devices on the local network via mDNS.
 *
 * @param {Function} onDeviceFound - called with device info object when a device appears
 * @param {Function} onDeviceLost  - called with device id when a device disappears
 */
function startDiscovery(onDeviceFound, onDeviceLost) {
  console.log('[castService] startDiscovery() → starting mDNS browse for _googlecast._tcp');

  try {
    bonjourInstance = new Bonjour();

    browser = bonjourInstance.find({ type: 'googlecast' }, (service) => {
      console.log('[castService] startDiscovery() → raw service found:', {
        name: service.name,
        host: service.host,
        port: service.port,
        addresses: service.addresses
      });

      // Build a stable device ID from the service name (md5 of name)
      const crypto = require('crypto');
      const deviceId = crypto.createHash('md5').update(service.name || service.host).digest('hex');
      const host = (service.addresses && service.addresses[0]) || service.host;

      const deviceInfo = {
        id: deviceId,
        name: getFriendlyDeviceName(service),
        host,
        port: service.port || 8009,
        status: 'idle'
      };

      devices.set(deviceId, deviceInfo);
      console.log(`[castService] startDiscovery() → device added: "${deviceInfo.name}" @ ${deviceInfo.host}:${deviceInfo.port} (id=${deviceId})`);

      if (typeof onDeviceFound === 'function') {
        onDeviceFound(deviceInfo);
      }
    });

    browser.on('down', (service) => {
      console.log('[castService] startDiscovery() → service went down:', service.name);
      // Find device by name and remove
      for (const [id, dev] of devices.entries()) {
        if (dev.name === service.name) {
          devices.delete(id);
          console.log(`[castService] startDiscovery() → device removed: "${dev.name}" (id=${id})`);
          if (typeof onDeviceLost === 'function') {
            onDeviceLost(id);
          }
          // If this was our active device, reset state
          if (state.activeDeviceId === id) {
            console.log('[castService] startDiscovery() → active device lost, resetting state');
            _resetState();
          }
          break;
        }
      }
    });

    console.log('[castService] startDiscovery() → mDNS browser started');
  } catch (err) {
    console.error('[castService] startDiscovery() → failed to start Bonjour browser:', err);
  }
}

// ---------------------------------------------------------------------------
// Device list
// ---------------------------------------------------------------------------

/**
 * Return all known cast devices as an array.
 */
function getDevices() {
  const list = Array.from(devices.values());
  console.log(`[castService] getDevices() → ${list.length} devices known`);
  return list;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _clearStatusPoller() {
  if (state.statusPoller) {
    clearInterval(state.statusPoller);
    state.statusPoller = null;
  }
}

function _clearIdleTimeoutTimer() {
  if (state.idleTimeoutTimer) {
    clearTimeout(state.idleTimeoutTimer);
    state.idleTimeoutTimer = null;
  }
}

function _armIdleTimeout(reason = 'idle') {
  _clearIdleTimeoutTimer();
  if (!state.activeDeviceId) return;
  if (state.status === 'playing') return;

  state.idleTimeoutTimer = setTimeout(() => {
    state.idleTimeoutTimer = null;
    if (!state.activeDeviceId || state.status === 'playing') {
      return;
    }
    console.log('[castService] inactivity timeout reached, stopping cast session');
    stop({ reason: 'timeout' }).catch((err) => {
      console.error('[castService] idle timeout stop failed:', err.message);
    });
  }, 18 * 60 * 1000);
  console.log(`[castService] idle timeout armed (${reason}) for 18 minutes`);
}

function _resetState() {
  console.log('[castService] _resetState() → clearing cast session state');
  _clearStatusPoller();
  _clearIdleTimeoutTimer();
  const previousActiveDeviceId = state.activeDeviceId;
  if (previousActiveDeviceId && devices.has(previousActiveDeviceId)) {
    const device = devices.get(previousActiveDeviceId);
    if (device) {
      device.status = 'idle';
      devices.set(previousActiveDeviceId, device);
    }
  }
  state.activeDeviceId = null;
  state.mediaUrl = null;
  state.episodeGuid = null;
  state.title = null;
  state.podcastTitle = null;
  state.imageUrl = null;
  state.position = 0;
  state.duration = 0;
  state.volume = 1.0;
  state.status = 'idle';
  state.client = null;
  state.player = null;
  state.ownerGuid = null;
}

function _disconnectClient() {
  _clearStatusPoller();
  if (state.client) {
    console.log('[castService] _disconnectClient() → closing existing client');
    try {
      state.client.close();
    } catch (err) {
      console.error('[castService] _disconnectClient() → error closing client:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Cast control
// ---------------------------------------------------------------------------

/**
 * Connect to a cast device and start playing media.
 *
 * @param {string}   deviceId        - id from device registry
 * @param {string}   userGuid        - the user initiating this cast session (for ownership)
 * @param {string}   mediaUrl        - URL of the audio/video to cast
 * @param {number}   startPosition   - start position in seconds
 * @param {Function} onStatusUpdate  - called with {position, duration, status}
 * @param {Object}   metadata        - optional {episodeGuid, title, podcastTitle, imageUrl, duration}
 */
async function castTo(deviceId, userGuid, mediaUrl, startPosition = 0, onStatusUpdate, metadata = {}) {
  console.log(`[castService] castTo(${deviceId}, user=${userGuid}) → mediaUrl=${mediaUrl}, startPos=${startPosition}, episodeGuid=${metadata.episodeGuid}`);

  const device = devices.get(deviceId);
  if (!device) {
    const msg = `Device ${deviceId} not found in registry`;
    console.error('[castService] castTo() →', msg);
    throw new Error(msg);
  }

  // Disconnect any existing session
  _disconnectClient();

  state.activeDeviceId = deviceId;
  state.ownerGuid = userGuid;
  state.mediaUrl = mediaUrl;
  state.episodeGuid = metadata.episodeGuid || null;
  state.title = metadata.title || null;
  state.podcastTitle = metadata.podcastTitle || null;
  state.imageUrl = metadata.imageUrl || null;
  state.position = startPosition;
  state.status = 'connecting';
  _clearStatusPoller();
  _clearIdleTimeoutTimer();
  broadcastState();

  // Update device status
  device.status = 'connecting';
  devices.set(deviceId, device);

  let Client, DefaultMediaReceiver;
  try {
    const castv2 = require('castv2-client');
    Client = castv2.Client;
    DefaultMediaReceiver = castv2.DefaultMediaReceiver;
    console.log('[castService] castTo() → castv2-client loaded OK');
  } catch (err) {
    const msg = `castv2-client is not available: ${err.message}`;
    console.error('[castService] castTo() →', msg);
    state.status = 'error';
    device.status = 'error';
    throw new Error(msg);
  }

  return new Promise((resolve, reject) => {
    const client = new Client();
    state.client = client;

    client.on('error', (err) => {
      console.error(`[castService] castTo() → client error on ${device.name}:`, err.message);
      _clearStatusPoller();
      state.status = 'error';
      device.status = 'error';
      devices.set(deviceId, device);
      broadcastState();
      if (typeof onStatusUpdate === 'function') {
        onStatusUpdate({
          position: state.position,
          duration: state.duration,
          status: 'error',
          mediaUrl: state.mediaUrl,
          episodeGuid: state.episodeGuid,
          title: state.title,
          podcastTitle: state.podcastTitle,
          imageUrl: state.imageUrl,
          volume: state.volume
        });
      }
    });

    console.log(`[castService] castTo() → connecting to ${device.host}:${device.port}`);
    client.connect({ host: device.host, port: device.port }, () => {
      console.log(`[castService] castTo() → connected to ${device.name}, launching media receiver`);

      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          const msg = `Failed to launch DefaultMediaReceiver on ${device.name}: ${err.message}`;
          console.error('[castService] castTo() →', msg);
          state.status = 'error';
          device.status = 'error';
          devices.set(deviceId, device);
          reject(new Error(msg));
          return;
        }

        state.player = player;
        console.log(`[castService] castTo() → media receiver launched on ${device.name}`);

        const applyPlayerStatus = (playerStatus) => {
          if (!playerStatus) return;

          const newPosition = playerStatus.currentTime || 0;
          const newDuration = (playerStatus.media && playerStatus.media.duration) || state.duration || 0;
          const playerState = playerStatus.playerState || 'IDLE';

          let mappedStatus;
          switch (playerState) {
            case 'PLAYING':  mappedStatus = 'playing';  break;
            case 'PAUSED':   mappedStatus = 'paused';   break;
            case 'BUFFERING':mappedStatus = 'playing';  break;
            case 'IDLE':     mappedStatus = 'idle';     break;
            default:         mappedStatus = 'idle';
          }

          state.position = newPosition;
          state.duration = newDuration;
          state.status = mappedStatus;
          device.status = mappedStatus;
          devices.set(deviceId, device);
          if (mappedStatus === 'playing') {
            _clearIdleTimeoutTimer();
          } else if (mappedStatus === 'paused' || mappedStatus === 'idle') {
            _armIdleTimeout(mappedStatus);
          }

          console.log(`[castService] player status → state=${playerState}, pos=${newPosition.toFixed(1)}s, dur=${newDuration.toFixed(1)}s`);
          
          broadcastState();

          if (typeof onStatusUpdate === 'function') {
            onStatusUpdate({
              position: newPosition,
              duration: newDuration,
              status: mappedStatus,
              mediaUrl: state.mediaUrl,
              episodeGuid: state.episodeGuid,
              title: state.title,
              podcastTitle: state.podcastTitle,
              imageUrl: state.imageUrl,
              volume: state.volume
            });
          }
        };

        // Listen for player status updates
        player.on('status', (playerStatus) => {
          applyPlayerStatus(playerStatus);
        });

        const pollStatus = () => {
          if (!state.player || state.player !== player) return;
          player.getStatus((statusErr, latestStatus) => {
            if (statusErr) {
              console.warn('[castService] status poll failed:', statusErr.message);
              return;
            }
            applyPlayerStatus(latestStatus);
          });
        };

        _clearStatusPoller();
        pollStatus();
        state.statusPoller = setInterval(pollStatus, 1000);

        // Load the media
        const metadataImages = [];
        if (metadata.imageUrl) {
          metadataImages.push({ url: metadata.imageUrl });
        }

        const explicitDuration = Number(metadata.duration || 0);
        const mediaInfo = {
          contentId: mediaUrl,
          contentType: 'audio/mpeg',
          streamType: 'BUFFERED',
          duration: explicitDuration > 0 ? explicitDuration : undefined,
          metadata: {
            type: 3,
            metadataType: 0,
            title: metadata.title || 'Podwaffle',
            subtitle: metadata.podcastTitle || 'Podwaffle',
            images: metadataImages
          }
        };

        const loadOptions = {
          autoplay: true
        };
        if (startPosition > 0) {
          loadOptions.currentTime = startPosition;
        }

        player.load(mediaInfo, loadOptions, (loadErr, status) => {
          if (loadErr) {
            const msg = `Failed to load media on ${device.name}: ${loadErr.message}`;
            console.error('[castService] castTo() →', msg);
            state.status = 'error';
            device.status = 'error';
            devices.set(deviceId, device);
            broadcastState();
            reject(new Error(msg));
            return;
          }

          state.status = 'playing';
          device.status = 'playing';
          devices.set(deviceId, device);
          _clearIdleTimeoutTimer();
          broadcastState();
          console.log(`[castService] castTo() → media loaded and playing on ${device.name}`);
          resolve({ status: 'playing', deviceId, mediaUrl });
        });
      });
    });
  });
}

/**
 * Pause the current cast session.
 */
async function pause() {
  console.log('[castService] pause()');
  if (!state.player) {
    throw new Error('No active cast session to pause');
  }
  return new Promise((resolve, reject) => {
    state.player.pause((err) => {
      if (err) {
        console.error('[castService] pause() → error:', err.message);
        reject(new Error(`Pause failed: ${err.message}`));
        return;
      }
      state.status = 'paused';
      _armIdleTimeout('paused');
      broadcastState();
      console.log('[castService] pause() → OK');
      resolve({ status: 'paused' });
    });
  });
}

/**
 * Resume the current cast session.
 */
async function resume() {
  console.log('[castService] resume()');
  if (!state.player) {
    return { status: state.status === 'idle' ? 'idle' : 'paused' };
  }
  if (!state.mediaUrl) {
    console.log('[castService] resume() → no media loaded, returning idle');
    return { status: 'idle' };
  }
  return new Promise((resolve, reject) => {
    state.player.play((err) => {
      if (err) {
        const msg = String(err && err.message ? err.message : err);
        if (msg.toLowerCase().includes('mediasessionid')) {
          console.warn('[castService] resume() → no active media session, returning idle');
          state.status = 'idle';
          broadcastState();
          resolve({ status: 'idle' });
          return;
        }
        console.error('[castService] resume() → error:', msg);
        reject(new Error(`Resume failed: ${msg}`));
        return;
      }
      state.status = 'playing';
      _clearIdleTimeoutTimer();
      broadcastState();
      console.log('[castService] resume() → OK');
      resolve({ status: 'playing' });
    });
  });
}

/**
 * Stop and fully disconnect the current cast session.
 */
async function stop(options = {}) {
  console.log('[castService] stop()');
  if (!state.player && !state.client) {
    console.log('[castService] stop() → nothing to stop');
    return { status: 'idle' };
  }

  return new Promise((resolve) => {
    if (state.player) {
      state.player.stop((err) => {
        if (err) {
          console.error('[castService] stop() → player stop error:', err.message);
        } else {
          console.log('[castService] stop() → player stopped');
        }
        _disconnectClient();
        _resetState();
        broadcastState(options.reason || 'stopped');
        resolve({ status: 'idle' });
      });
    } else {
      _disconnectClient();
      _resetState();
      broadcastState(options.reason || 'stopped');
      resolve({ status: 'idle' });
    }
  });
}

/**
 * Seek to a position in seconds.
 */
async function seek(position) {
  console.log(`[castService] seek(${position})`);
  if (!state.player) {
    throw new Error('No active cast session to seek');
  }
  return new Promise((resolve, reject) => {
    state.player.seek(position, (err) => {
      if (err) {
        console.error('[castService] seek() → error:', err.message);
        reject(new Error(`Seek failed: ${err.message}`));
        return;
      }
      state.position = position;
      broadcastState();
      console.log(`[castService] seek() → seeked to ${position}s`);
      resolve({ position });
    });
  });
}

/**
 * Set volume on the active cast session (0–1).
 */
async function setVolume(level) {
  console.log(`[castService] setVolume(${level})`);
  if (!state.client) {
    throw new Error('No active cast client to set volume on');
  }

  const clampedLevel = Math.max(0, Math.min(1, level));

  return new Promise((resolve, reject) => {
    state.client.setVolume({ level: clampedLevel }, (err) => {
      if (err) {
        console.error('[castService] setVolume() → error:', err.message);
        reject(new Error(`Set volume failed: ${err.message}`));
        return;
      }
      state.volume = clampedLevel;
      broadcastState();
      console.log(`[castService] setVolume() → set to ${clampedLevel}`);
      resolve({ volume: clampedLevel });
    });
  });
}

/**
 * Return the current cast state snapshot.
 */
function getState() {
  return {
    activeDeviceId: state.activeDeviceId,
    mediaUrl: state.mediaUrl,
    episodeGuid: state.episodeGuid,
    title: state.title,
    podcastTitle: state.podcastTitle,
    imageUrl: state.imageUrl,
    position: state.position,
    duration: state.duration,
    volume: state.volume,
    status: state.status
  };
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

/**
 * Initialize cast discovery with a broadcast callback.
 * Called once on server startup.
 *
 * @param {Function} broadcastFn - function to call with {type: 'cast:...', data: {...}}
 */
function init(broadcastFn) {
  console.log('[castService] init() → starting discovery and setting broadcast callback');
  state.broadcastFn = broadcastFn;
  
  startDiscovery(
    (device) => {
      if (broadcastFn) {
        broadcastFn({
          type: 'cast:device_found',
          data: device
        });
      }
    },
    (deviceId) => {
      if (broadcastFn) {
        broadcastFn({
          type: 'cast:device_lost',
          data: { deviceId }
        });
      }
    }
  );
}

/**
 * Get the current active cast session info (if any).
 * Does NOT include the full mediaUrl or status — only basic info for UI.
 */
function getSession() {
  if (!state.activeDeviceId) {
    return null;
  }
  const device = devices.get(state.activeDeviceId);
  return {
    deviceId: state.activeDeviceId,
    deviceName: device?.name || 'Unknown Device',
    ownerGuid: state.ownerGuid,
    mediaUrl: state.mediaUrl,
    episodeGuid: state.episodeGuid,
    title: state.title,
    podcastTitle: state.podcastTitle,
    imageUrl: state.imageUrl,
    position: state.position,
    duration: state.duration,
    volume: state.volume,
    status: state.status
  };
}

/**
 * Check if a user owns (can control) the current cast session.
 * Only the user who initiated the session can control it.
 */
function canControl(userGuid) {
  if (!state.activeDeviceId || !state.ownerGuid) {
    return false;
  }
  return state.ownerGuid === userGuid;
}

/**
 * Broadcast current state to all connected WS clients.
 */
function broadcastState(reason = null) {
  if (typeof state.broadcastFn !== 'function') {
    return;
  }

  state.broadcastFn({
    type: 'cast:status',
    data: {
      activeDeviceId: state.activeDeviceId,
      deviceName: state.activeDeviceId ? (devices.get(state.activeDeviceId)?.name || 'Unknown') : null,
      ownerGuid: state.ownerGuid,
      mediaUrl: state.mediaUrl,
      episodeGuid: state.episodeGuid,
      title: state.title,
      podcastTitle: state.podcastTitle,
      imageUrl: state.imageUrl,
      position: Math.round(state.position * 100) / 100,
      duration: Math.round(state.duration * 100) / 100,
      volume: Math.round(state.volume * 100) / 100,
      status: state.status,
      reason
    }
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  init,
  startDiscovery,
  getDevices,
  getSession,
  canControl,
  castTo,
  pause,
  resume,
  stop,
  seek,
  setVolume,
  getState
};
