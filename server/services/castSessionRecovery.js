'use strict';

const DEFAULT_STOP_TIMEOUT_MS = 4000;
const DEFAULT_PAUSED_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_IDLE_GRACE_MS = 15000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 5000;

function installCastSessionRecovery(castService, options = {}) {
  if (!castService || castService.__castSessionRecoveryInstalled) return castService;

  const stopTimeoutMs = Number(options.stopTimeoutMs) >= 0 ? Number(options.stopTimeoutMs) : DEFAULT_STOP_TIMEOUT_MS;
  const pausedTimeoutMs = Number(options.pausedTimeoutMs) >= 0 ? Number(options.pausedTimeoutMs) : DEFAULT_PAUSED_TIMEOUT_MS;
  const idleGraceMs = Number(options.idleGraceMs) >= 0 ? Number(options.idleGraceMs) : DEFAULT_IDLE_GRACE_MS;
  const watchdogIntervalMs = Number(options.watchdogIntervalMs) > 0 ? Number(options.watchdogIntervalMs) : DEFAULT_WATCHDOG_INTERVAL_MS;

  const original = {
    init: typeof castService.init === 'function' ? castService.init.bind(castService) : null,
    stop: typeof castService.stop === 'function' ? castService.stop.bind(castService) : null,
    getSession: typeof castService.getSession === 'function' ? castService.getSession.bind(castService) : null,
    getState: typeof castService.getState === 'function' ? castService.getState.bind(castService) : null,
    castTo: typeof castService.castTo === 'function' ? castService.castTo.bind(castService) : null,
  };

  let broadcastFn = null;
  let pausedSince = 0;
  let idleSince = 0;
  let forcedSession = null;
  let watchdog = null;

  function identity(snapshot = {}) {
    return {
      activeDeviceId: snapshot.activeDeviceId || snapshot.deviceId || null,
      episodeGuid: snapshot.episodeGuid || null,
      mediaUrl: snapshot.mediaUrl || null,
    };
  }

  function sameIdentity(a, b) {
    return !!(a && b)
      && a.activeDeviceId === b.activeDeviceId
      && a.episodeGuid === b.episodeGuid
      && a.mediaUrl === b.mediaUrl;
  }

  function idlePayload(reason) {
    return {
      activeDeviceId: null,
      deviceId: null,
      deviceName: null,
      ownerGuid: null,
      mediaUrl: null,
      episodeGuid: null,
      title: null,
      podcastTitle: null,
      imageUrl: null,
      position: 0,
      duration: 0,
      volume: 1,
      status: 'idle',
      reason,
    };
  }

  function broadcastIdle(reason) {
    if (typeof broadcastFn !== 'function') return;
    try {
      broadcastFn({ type: 'cast:status', data: idlePayload(reason) });
    } catch (err) {
      console.warn('[castSessionRecovery] Failed to broadcast recovered idle state:', err?.message || err);
    }
  }

  function clearForcedSession(reason = 'new-session') {
    if (forcedSession) {
      console.log('[castSessionRecovery] Clearing forced idle guard:', reason);
    }
    forcedSession = null;
    pausedSince = 0;
    idleSince = 0;
  }

  function forceSessionIdle(reason, snapshot = null) {
    if (forcedSession) return false;
    const current = snapshot || original.getState?.() || original.getSession?.() || {};
    forcedSession = identity(current);
    console.warn('[castSessionRecovery] Forcing stale cast session to idle:', reason, forcedSession);
    broadcastIdle(reason);
    return true;
  }

  if (original.init) {
    castService.init = function initWithRecovery(nextBroadcastFn) {
      broadcastFn = nextBroadcastFn;
      return original.init(nextBroadcastFn);
    };
  }

  if (original.castTo) {
    castService.castTo = function castToWithRecovery(...args) {
      clearForcedSession('cast-started');
      return original.castTo(...args);
    };
  }

  if (original.getSession) {
    castService.getSession = function getSessionWithRecovery() {
      const session = original.getSession();
      if (!session) {
        clearForcedSession('server-session-cleared');
        return null;
      }

      if (forcedSession) {
        const currentIdentity = identity(session);
        const status = String(session.status || '').toLowerCase();
        if (status === 'connecting' || !sameIdentity(currentIdentity, forcedSession)) {
          clearForcedSession('replacement-session-detected');
        } else {
          return null;
        }
      }

      const status = String(session.status || '').toLowerCase();
      if (status === 'idle' || status === 'error') {
        if (!idleSince) idleSince = Date.now();
        if ((Date.now() - idleSince) >= idleGraceMs) {
          forceSessionIdle(status === 'error' ? 'recovery-error' : 'recovery-idle', session);
          return null;
        }
      } else {
        idleSince = 0;
      }

      return session;
    };
  }

  if (original.stop) {
    castService.stop = async function stopWithRecovery(stopOptions = {}) {
      const reason = stopOptions.reason || 'stopped';
      let timer = null;
      const timeoutResult = new Promise((resolve) => {
        timer = setTimeout(() => {
          forceSessionIdle(reason === 'timeout' ? 'timeout' : 'recovery-timeout');
          resolve({ status: 'idle', forced: true, reason });
        }, stopTimeoutMs);
      });

      try {
        return await Promise.race([
          Promise.resolve(original.stop(stopOptions)),
          timeoutResult,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
  }

  watchdog = setInterval(() => {
    try {
      const snapshot = original.getState?.();
      if (!snapshot?.activeDeviceId) {
        if (forcedSession) clearForcedSession('watchdog-session-cleared');
        pausedSince = 0;
        idleSince = 0;
        return;
      }

      if (forcedSession) {
        const status = String(snapshot.status || '').toLowerCase();
        if (status === 'connecting' || !sameIdentity(identity(snapshot), forcedSession)) {
          clearForcedSession('watchdog-replacement-session');
        }
        return;
      }

      const status = String(snapshot.status || '').toLowerCase();
      const now = Date.now();

      if (status === 'paused') {
        if (!pausedSince) pausedSince = now;
        if ((now - pausedSince) >= pausedTimeoutMs && forceSessionIdle('timeout', snapshot)) {
          Promise.resolve(original.stop?.({ reason: 'timeout' })).catch((err) => {
            console.warn('[castSessionRecovery] Best-effort timeout stop failed:', err?.message || err);
          });
        }
      } else {
        pausedSince = 0;
      }

      if (status === 'idle' || status === 'error') {
        if (!idleSince) idleSince = now;
        if ((now - idleSince) >= idleGraceMs) {
          forceSessionIdle(status === 'error' ? 'recovery-error' : 'recovery-idle', snapshot);
        }
      } else {
        idleSince = 0;
      }
    } catch (err) {
      console.warn('[castSessionRecovery] Watchdog failed:', err?.message || err);
    }
  }, watchdogIntervalMs);
  watchdog.unref?.();

  castService.__castSessionRecoveryInstalled = true;
  castService.__castSessionRecovery = {
    forceSessionIdle,
    clearForcedSession,
    destroy() {
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
    },
  };

  return castService;
}

module.exports = { installCastSessionRecovery };

if (process.env.PODWAFFLE_DISABLE_CAST_RECOVERY_AUTO !== '1') {
  try {
    installCastSessionRecovery(require('./castService'));
  } catch (err) {
    console.error('[castSessionRecovery] Failed to install:', err);
  }
}
