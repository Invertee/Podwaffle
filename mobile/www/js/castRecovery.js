/* ============================================================
   Podwaffle - castRecovery.js
   Makes cast teardown local-first and prevents stale cast state
   from leaving clients stuck in cast mode.
   ============================================================ */

(function initCastRecovery() {
  if (window.__podwaffleCastRecoveryInstalled) return;
  window.__podwaffleCastRecoveryInstalled = true;

  const config = window.PODWAFFLE_CAST_RECOVERY_CONFIG || {};
  const STOP_TIMEOUT_MS = Number(config.stopTimeoutMs) >= 0 ? Number(config.stopTimeoutMs) : 4000;
  const IDLE_SESSION_GRACE_MS = Number(config.idleSessionGraceMs) >= 0 ? Number(config.idleSessionGraceMs) : 15000;
  const PAUSED_IDLE_GRACE_MS = Number(config.pausedIdleGraceMs) >= 0 ? Number(config.pausedIdleGraceMs) : 60000;
  const TERMINAL_REASONS = new Set([
    'timeout',
    'health-reset',
    'device-lost',
    'poll',
    'stopped',
    'stop-requested',
    'recovery-timeout',
    'recovery-idle',
  ]);

  const recoveryState = {
    lastStatus: 'idle',
    pausedSince: 0,
    apiIdleSince: 0,
    transitionPromise: null,
  };

  function emptyCastState(volume = 1) {
    return {
      status: 'idle',
      position: 0,
      duration: 0,
      activeDeviceId: null,
      deviceName: null,
      ownerGuid: null,
      episodeGuid: null,
      title: null,
      podcastTitle: null,
      imageUrl: null,
      mediaUrl: null,
      volume: Number.isFinite(Number(volume)) ? Number(volume) : 1,
    };
  }

  function clearClientCastState(reason = 'client-reset') {
    const sender = window.googleCastSender;
    const castClient = window.castClient;

    if (sender) {
      sender._currentSession = null;
    }

    if (castClient) {
      if (typeof castClient._clearIdleTimer === 'function') {
        castClient._clearIdleTimer();
      }
      const volume = castClient._castState?.volume ?? window.player?.volume ?? 1;
      castClient._castState = emptyCastState(volume);
    }

    window.__castActive = false;
    console.log('[castRecovery] Cleared local cast state:', reason);
  }

  function isTerminalSession(session) {
    if (!session) return true;
    const activeDeviceId = session.activeDeviceId || session.deviceId || null;
    return !activeDeviceId;
  }

  if (window.api && typeof window.api.getCastSession === 'function' && !window.api.__castRecoveryWrapped) {
    const originalGetCastSession = window.api.getCastSession.bind(window.api);
    window.api.getCastSession = async function getCastSessionWithRecovery() {
      const response = await originalGetCastSession();
      const hasEnvelope = !!(response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'session'));
      const session = hasEnvelope ? response.session : response;
      const status = String(session?.status || '').toLowerCase();
      const activeDeviceId = session?.activeDeviceId || session?.deviceId || null;

      if (isTerminalSession(session)) {
        recoveryState.apiIdleSince = 0;
        return hasEnvelope ? { ...response, session: null } : null;
      }

      if (status === 'idle' || status === 'error') {
        if (!recoveryState.apiIdleSince) recoveryState.apiIdleSince = Date.now();
        if ((Date.now() - recoveryState.apiIdleSince) >= IDLE_SESSION_GRACE_MS) {
          console.warn('[castRecovery] Ignoring stale idle cast session returned by the server.');
          return hasEnvelope ? { ...response, session: null } : null;
        }
      } else {
        recoveryState.apiIdleSince = 0;
      }

      if (!activeDeviceId) {
        return hasEnvelope ? { ...response, session: null } : null;
      }
      return response;
    };
    window.api.__castRecoveryWrapped = true;
  }

  const sender = window.googleCastSender;
  if (sender && typeof sender.stop === 'function' && !sender.__castRecoveryWrapped) {
    sender.stop = async function stopCastLocalFirst() {
      this._resolveApiBaseUrl?.();
      clearClientCastState('stop-requested');

      const stopRemotely = async () => {
        if (window.api?.castStop) {
          await window.api.castStop();
          return;
        }

        if (window.castClient?.isConnected?.() && typeof window.castClient.send === 'function') {
          if (!window.castClient.send('cast:stop', {})) {
            throw new Error('Failed to send cast:stop over WebSocket');
          }
        }
      };

      Promise.resolve()
        .then(stopRemotely)
        .catch((err) => console.warn('[castRecovery] Remote cast stop failed after local reset:', err?.message || err));

      return { status: 'idle', localReset: true };
    };
    sender.__castRecoveryWrapped = true;
  }

  const player = window.player;
  if (player && typeof player.switchToLocal === 'function' && !player.__castRecoveryWrapped) {
    player.switchToLocal = async function switchToLocalWithoutAutoplay(options = {}) {
      if (recoveryState.transitionPromise) return recoveryState.transitionPromise;

      recoveryState.transitionPromise = (async () => {
        const stopCast = options.stopCast !== false;
        // An explicit stop-casting action is a transport handoff. Preserve the
        // current play/pause state unless a recovery caller overrides it.
        const autoplay = options.autoplay === undefined
          ? !!this.isPlaying
          : options.autoplay === true;
        const reason = options.reason || 'switch-to-local';
        const wasCast = this.mode === 'cast';
        const resumeAt = Math.max(0, Math.floor(this.position || 0));
        const episode = this.currentEpisode ? { ...this.currentEpisode } : null;

        this._castStopInProgress = true;
        try {
          if (stopCast && window.googleCastSender?.stop) {
            await window.googleCastSender.stop();
          } else {
            clearClientCastState(reason);
          }
        } catch (err) {
          console.warn('[castRecovery] Cast stop failed; continuing with local reset:', err?.message || err);
          clearClientCastState(`${reason}-after-error`);
        }

        this.mode = 'local';
        this._activeCastDeviceId = null;
        this._lastCastStatus = 'idle';
        this.isPlaying = false;
        this.audio?.pause?.();

        if (Number.isFinite(this._localVolume)) {
          this.volume = Math.max(0, Math.min(1, this._localVolume));
          if (this.audio) this.audio.volume = this.volume;
          try { localStorage.setItem('podwaffle_volume', String(this.volume)); } catch (_) {}
        }

        if (episode) this.currentEpisode = episode;
        if (wasCast && episode?.audioUrl && typeof this._setAudioSource === 'function') {
          this._setAudioSource(episode.audioUrl, resumeAt);
          this.audio?.pause?.();
          this.isPlaying = false;
          if (autoplay) this.play();
        }

        this._persistQueueStateLocal?.({
          mode: 'local',
          currentEpisodeGuid: this.currentEpisode?.guid || '',
          updatedAt: new Date().toISOString(),
        });
        this._scheduleQueueSync?.({ immediate: true });
        this._notifyStateChange?.();

        console.log(`[castRecovery] Switched to local playback (${autoplay ? 'playing' : 'paused'}):`, reason);
        return { status: 'idle', mode: 'local', autoplay };
      })().finally(() => {
        player._castStopInProgress = false;
        recoveryState.transitionPromise = null;
      });

      return recoveryState.transitionPromise;
    };
    player.__castRecoveryWrapped = true;
  }

  if (window.castClient && typeof window.castClient.on === 'function') {
    window.castClient.on('cast:status', (status = {}) => {
      const now = Date.now();
      const nextStatus = String(status.status || '').toLowerCase();
      const reason = String(status.reason || '').toLowerCase();
      const activeDeviceId = status.activeDeviceId || status.deviceId || null;
      const previousStatus = recoveryState.lastStatus;

      if (nextStatus === 'paused') {
        if (previousStatus !== 'paused' || !recoveryState.pausedSince) {
          recoveryState.pausedSince = now;
        }
      } else if (nextStatus === 'playing' || nextStatus === 'connecting') {
        recoveryState.pausedSince = 0;
      }

      const pausedLongEnough = nextStatus === 'idle'
        && previousStatus === 'paused'
        && recoveryState.pausedSince > 0
        && (now - recoveryState.pausedSince) >= PAUSED_IDLE_GRACE_MS;
      const terminalIdle = nextStatus === 'idle' && (
        TERMINAL_REASONS.has(reason)
        || !activeDeviceId
        || pausedLongEnough
      );

      recoveryState.lastStatus = nextStatus || previousStatus;
      if (nextStatus === 'idle') recoveryState.pausedSince = 0;

      if (!terminalIdle) return;

      clearClientCastState(reason || 'cast-idle');
      if (window.player?.mode === 'cast' && !window.player._castStopInProgress) {
        window.player.switchToLocal({
          stopCast: false,
          autoplay: false,
          reason: reason || (pausedLongEnough ? 'paused-idle' : 'cast-idle'),
        }).catch((err) => {
          console.warn('[castRecovery] Failed to finish cast recovery:', err?.message || err);
        });
      }
    });
  }

  window.__podwaffleCastRecovery = {
    clearClientCastState,
    getState: () => ({ ...recoveryState }),
  };
})();
