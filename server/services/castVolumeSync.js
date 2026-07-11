'use strict';

const Module = require('module');

function normalizeVolume(rawVolume) {
  if (rawVolume == null) return null;
  if (typeof rawVolume === 'number' && Number.isFinite(rawVolume)) {
    return Math.max(0, Math.min(1, rawVolume));
  }
  if (typeof rawVolume === 'object') {
    if (rawVolume.level != null) return normalizeVolume(rawVolume.level);
    if (rawVolume.volume != null) return normalizeVolume(rawVolume.volume);
  }
  const parsed = Number(rawVolume);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function installCastVolumeSync(castService, options = {}) {
  if (!castService || castService.__castVolumeSyncInstalled) return castService;

  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 1000);
  const original = {
    init: castService.init?.bind(castService),
    getState: castService.getState?.bind(castService),
    getSession: castService.getSession?.bind(castService),
    getDevices: castService.getDevices?.bind(castService),
    setVolume: castService.setVolume?.bind(castService),
  };

  let broadcastFn = null;
  let receiverVolume = null;
  let suppressReceiverUntil = 0;
  let monitorClient = null;
  let monitorDeviceId = null;
  let monitorConnected = false;
  let monitorConnecting = false;
  let pollTimer = null;

  const getClientCtor = () => options.Client || require('castv2-client').Client;
  const roundVolume = (value) => Math.round(value * 100) / 100;

  function getActiveDeviceId() {
    const state = original.getState ? original.getState() : null;
    const session = original.getSession ? original.getSession() : null;
    return state?.activeDeviceId || session?.activeDeviceId || session?.deviceId || null;
  }

  function buildStatusData(reason = 'receiver-volume') {
    const state = original.getState ? original.getState() : {};
    const session = original.getSession ? original.getSession() : {};
    const activeDeviceId = state?.activeDeviceId || session?.activeDeviceId || session?.deviceId || null;
    return {
      ...(session || {}),
      ...(state || {}),
      activeDeviceId,
      deviceId: session?.deviceId || activeDeviceId,
      deviceName: session?.deviceName || null,
      ownerGuid: session?.ownerGuid || null,
      volume: receiverVolume == null ? normalizeVolume(state?.volume) ?? 1 : roundVolume(receiverVolume),
      reason,
    };
  }

  function emitVolumeStatus(reason = 'receiver-volume') {
    if (typeof broadcastFn !== 'function' || receiverVolume == null || !getActiveDeviceId()) return;
    broadcastFn({ type: 'cast:status', data: buildStatusData(reason) });
  }

  function closeMonitor() {
    if (monitorClient) {
      try { monitorClient.close(); } catch (_) {}
    }
    monitorClient = null;
    monitorDeviceId = null;
    monitorConnected = false;
    monitorConnecting = false;
  }

  function acceptReceiverVolume(rawVolume, reason = 'receiver-volume') {
    const nextVolume = normalizeVolume(rawVolume);
    if (nextVolume == null) return;
    if (Date.now() < suppressReceiverUntil && receiverVolume != null && Math.abs(nextVolume - receiverVolume) > 0.005) {
      return;
    }
    const changed = receiverVolume == null || Math.abs(nextVolume - receiverVolume) > 0.005;
    receiverVolume = nextVolume;
    if (changed) emitVolumeStatus(reason);
  }

  function sampleReceiverVolume() {
    if (!monitorClient || !monitorConnected || typeof monitorClient.getVolume !== 'function') return;
    monitorClient.getVolume((err, volumeState) => {
      if (err) {
        console.warn('[castVolumeSync] Receiver volume poll failed:', err.message);
        return;
      }
      acceptReceiverVolume(volumeState);
    });
  }

  function connectMonitor(device) {
    closeMonitor();
    if (!device?.id || !device?.host) return;

    let Client;
    try {
      Client = getClientCtor();
    } catch (err) {
      console.warn('[castVolumeSync] castv2-client unavailable:', err.message);
      return;
    }

    monitorDeviceId = device.id;
    monitorConnecting = true;
    const client = new Client();
    monitorClient = client;

    client.on?.('error', (err) => {
      console.warn('[castVolumeSync] Monitor connection error:', err.message);
      if (monitorClient === client) closeMonitor();
    });

    client.connect({ host: device.host, port: device.port || 8009 }, () => {
      if (monitorClient !== client) {
        try { client.close(); } catch (_) {}
        return;
      }
      monitorConnecting = false;
      monitorConnected = true;
      sampleReceiverVolume();
    });
  }

  function poll() {
    const activeDeviceId = getActiveDeviceId();
    if (!activeDeviceId) {
      closeMonitor();
      receiverVolume = null;
      return;
    }

    const devices = original.getDevices ? original.getDevices() : [];
    const device = Array.isArray(devices) ? devices.find((item) => item?.id === activeDeviceId) : null;
    if (!device) return;

    if (monitorDeviceId !== activeDeviceId || (!monitorClient && !monitorConnecting)) {
      connectMonitor(device);
      return;
    }

    if (monitorConnected) sampleReceiverVolume();
  }

  if (original.init) {
    castService.init = function initWithReceiverVolume(broadcast) {
      broadcastFn = broadcast;
      const wrappedBroadcast = (message) => {
        if (message?.type === 'cast:status' && message?.data?.activeDeviceId && receiverVolume != null) {
          return broadcast({ ...message, data: { ...message.data, volume: roundVolume(receiverVolume) } });
        }
        return broadcast(message);
      };

      const result = original.init(wrappedBroadcast);
      if (!pollTimer) {
        pollTimer = setInterval(poll, pollIntervalMs);
        pollTimer.unref?.();
      }
      poll();
      return result;
    };
  }

  if (original.setVolume) {
    castService.setVolume = async function setVolumeWithReceiverState(level) {
      const normalized = normalizeVolume(level);
      if (normalized != null) {
        receiverVolume = normalized;
        suppressReceiverUntil = Date.now() + 1500;
      }
      const result = await original.setVolume(level);
      if (normalized != null) emitVolumeStatus('volume-command');
      return result;
    };
  }

  if (original.getState) {
    castService.getState = function getStateWithReceiverVolume() {
      const state = original.getState();
      return receiverVolume == null || !state?.activeDeviceId ? state : { ...state, volume: roundVolume(receiverVolume) };
    };
  }

  if (original.getSession) {
    castService.getSession = function getSessionWithReceiverVolume() {
      const session = original.getSession();
      return receiverVolume == null || !session ? session : { ...session, volume: roundVolume(receiverVolume) };
    };
  }

  castService.__castVolumeSyncInstalled = true;
  castService.__castVolumeSync = {
    poll,
    stop() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      closeMonitor();
    },
    getReceiverVolume: () => receiverVolume,
  };
  return castService;
}

function installRequireHook() {
  if (global.__podwaffleCastVolumeRequireHookInstalled) return;
  global.__podwaffleCastVolumeRequireHookInstalled = true;
  const originalLoad = Module._load;
  Module._load = function loadWithCastVolumeRepair(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    const parentFile = String(parent?.filename || '').replace(/\\/g, '/');
    if (request === './services/castService' && /\/server\/server\.js$/.test(parentFile) && loaded && typeof loaded.init === 'function') {
      installCastVolumeSync(loaded);
    }
    return loaded;
  };
}

installRequireHook();

module.exports = { installCastVolumeSync, normalizeVolume };
