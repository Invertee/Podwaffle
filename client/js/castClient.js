/* ============================================================
   Podwaffle — castClient.js
   WebSocket client bridging the frontend to the backend cast service.
   Auto-reconnects on disconnect. Exposes window.castClient.
   ============================================================ */

const castClient = {
  ws: null,
  listeners: {},
  _reconnectTimer: null,
  _reconnectDelay: 5000,
  _intentionalClose: false,
  _statePollTimer: null,
  _healthTimer: null,
  _healthCheckTimer: null,
  _pendingHealthPing: null,
  _lastPongAt: 0,
  _lastMessageAt: 0,
  _lastUserRevision: 0,
  _resyncRequested: false,
  _idleTimer: null,
  _IDLE_TIMEOUT_MS: 20 * 60 * 1000, // 20 minutes
  _HEALTH_CHECK_INTERVAL_MS: 15000,
  _HEALTH_PONG_TIMEOUT_MS: 10000,
  _castState: {
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
    volume: 1,
  },

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[castClient] Already connected or connecting.');
      return;
    }

    this._intentionalClose = false;
    const wsUrl = (window.api && typeof window.api.getWebSocketUrl === 'function')
      ? window.api.getWebSocketUrl()
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${window.APP_BASE_PATH ? window.APP_BASE_PATH + '/ws' : '/ws'}`;

    if (!wsUrl) {
      console.log('[castClient] Backend not configured; skipping WebSocket connection.');
      return;
    }

    console.log(`[castClient] Connecting to ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[castClient] Failed to create WebSocket:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      console.log('[castClient] WebSocket connected.');
      clearTimeout(this._reconnectTimer);
      this._lastPongAt = Date.now();
      this._lastMessageAt = Date.now();
      this._startStatePolling();
      this._startHealthMonitoring();
      const guid = localStorage.getItem('podwaffle_guid') || '';
      const clientId = window.getPodwaffleClientId ? window.getPodwaffleClientId() : (localStorage.getItem('podwaffle_client_id') || '');
      if (guid) {
        this.send('sync:hello', { guid, clientId, lastUserRevision: this._lastUserRevision });
      }
      this._dispatch('connected', {});
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this._lastMessageAt = Date.now();
        this._handleMessage(data);
      } catch (err) {
        console.error('[castClient] Failed to parse WS message:', err, event.data);
      }
    });

    this.ws.addEventListener('close', (event) => {
      console.warn(`[castClient] WebSocket closed (code=${event.code}). Intentional=${this._intentionalClose}`);
      this.ws = null;
      this._stopStatePolling();
      this._stopHealthMonitoring();
      this._dispatch('disconnected', { code: event.code });
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    });

    this.ws.addEventListener('error', (err) => {
      console.error('[castClient] WebSocket error:', err);
      this._dispatch('error', { error: err });
    });
  },

  disconnect() {
    this._intentionalClose = true;
    clearTimeout(this._reconnectTimer);
    this._stopStatePolling();
    this._stopHealthMonitoring();
    this._clearIdleTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    console.log('[castClient] Disconnected intentionally.');
  },

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    console.log(`[castClient] Reconnecting in ${this._reconnectDelay}ms...`);
    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, this._reconnectDelay);
  },

  _startStatePolling() {
    this._stopStatePolling();
    if (!window.api || typeof window.api.getCastSession !== 'function') return;

    const pollState = async () => {
      try {
        const response = await window.api.getCastSession();
        const session = response?.session || response || null;
        const activeDeviceId = session?.activeDeviceId || session?.deviceId || null;

        if (session && activeDeviceId) {
          this._handleMessage({
            type: 'cast:status',
            data: {
              ...session,
              activeDeviceId,
            },
          });
          return;
        }

        if (this._castState.activeDeviceId || this._castState.status !== 'idle') {
          this._handleMessage({
            type: 'cast:status',
            data: {
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
              volume: this._castState.volume || 1,
              status: 'idle',
              reason: 'poll',
            },
          });
        }
      } catch (err) {
        console.warn('[castClient] Cast state poll failed:', err?.message || err);
      }
    };

    this._statePollTimer = setInterval(pollState, 15000);
    setTimeout(pollState, 1000);
  },

  _startHealthMonitoring() {
    this._stopHealthMonitoring();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const sendPing = () => {
      if (!this.isConnected()) return;

      const now = Date.now();
      const lastPongAge = now - (this._lastPongAt || 0);
      const pendingAge = this._pendingHealthPing ? now - this._pendingHealthPing : 0;

      if (this._pendingHealthPing && pendingAge > this._HEALTH_PONG_TIMEOUT_MS) {
        console.warn('[castClient] Health ping timed out; reconnecting websocket.');
        this._forceReconnect();
        return;
      }

      if (lastPongAge > this._HEALTH_CHECK_INTERVAL_MS * 2) {
        console.warn('[castClient] No recent pong received; reconnecting websocket.');
        this._forceReconnect();
        return;
      }

      try {
        this._pendingHealthPing = now;
        this.ws.send(JSON.stringify({ type: 'ping', data: { client: 'castClient', ts: now } }));
      } catch (err) {
        console.warn('[castClient] Failed to send health ping; reconnecting websocket.', err);
        this._forceReconnect();
      }
    };

    this._healthTimer = setInterval(sendPing, this._HEALTH_CHECK_INTERVAL_MS);
    this._healthCheckTimer = setTimeout(sendPing, this._HEALTH_CHECK_INTERVAL_MS);
  },

  _stopHealthMonitoring() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    if (this._healthCheckTimer) {
      clearTimeout(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
    this._pendingHealthPing = null;
  },

  _forceReconnect() {
    if (this._intentionalClose) return;
    try {
      if (this.ws) {
        this.ws.close(4000, 'Health check failed');
      }
    } catch (_) {}
    this.ws = null;
    this._stopHealthMonitoring();
    this._stopStatePolling();
    this._scheduleReconnect();
  },

  _stopStatePolling() {
    if (this._statePollTimer) {
      clearInterval(this._statePollTimer);
      this._statePollTimer = null;
    }
  },

  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  },

  _startIdleTimer() {
    this._clearIdleTimer();
    console.log(`[castClient] Cast idle — switching to local playback in ${this._IDLE_TIMEOUT_MS / 60000} min if no activity.`);
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (window.player && window.player.mode === 'cast') {
        console.log('[castClient] Cast idle timeout reached — switching to local playback.');
        window.player.switchToLocal();
        this._dispatch('cast:idle_timeout', {});
      }
    }, this._IDLE_TIMEOUT_MS);
  },

  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },

  off(event, handler) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(h => h !== handler);
  },

  isConnected() {
    return !!(this.ws && this.ws.readyState === WebSocket.OPEN);
  },

  send(type, payload = {}) {
    if (!type) return false;
    if (!this.isConnected()) {
      console.warn('[castClient] Cannot send message while disconnected:', type);
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ type, ...(payload || {}) }));
      return true;
    } catch (err) {
      console.error('[castClient] Failed to send message:', type, err);
      return false;
    }
  },

  _dispatch(event, data) {
    const handlers = this.listeners[event] || [];
    handlers.forEach(h => {
      try {
        h(data);
      } catch (err) {
        console.error(`[castClient] Error in handler for "${event}":`, err);
      }
    });
  },

  _handleHaCommand(commandData) {
    if (!commandData || !commandData.guid) return;

    const localGuid = localStorage.getItem('podwaffle_guid');
    if (!localGuid || localGuid !== commandData.guid) return;
    const localClientId = window.getPodwaffleClientId ? window.getPodwaffleClientId() : localStorage.getItem('podwaffle_client_id');
    if (commandData.targetClientId && localClientId && commandData.targetClientId !== localClientId) return;

    const player = window.player;
    if (!player) return;

    const command = String(commandData.command || '').toLowerCase();
    const numericValue = Number.parseFloat(commandData.value);
    const seekPosition = Number.isFinite(commandData.position)
      ? commandData.position
      : (Number.isFinite(numericValue) ? numericValue : null);
    const volumeValue = Number.isFinite(commandData.volume)
      ? commandData.volume
      : (Number.isFinite(numericValue) ? numericValue : null);

    try {
      switch (command) {
        case 'play':
          player.play();
          break;
        case 'pause':
          player.pause();
          break;
        case 'play_pause':
          player.togglePlay();
          break;
        case 'stop':
          player.pause();
          player.seek(0);
          break;
        case 'seek':
          if (seekPosition != null) {
            player.seek(seekPosition);
          }
          break;
        case 'set_volume':
          if (volumeValue != null) {
            player.setVolume(volumeValue);
          }
          break;
        case 'next':
          player.skipForward();
          break;
        case 'previous':
          player.skipBack();
          break;
        default:
          console.log('[castClient] Ignoring unsupported HA command:', command);
          return;
      }
      console.log('[castClient] Applied HA command:', command, commandData);
    } catch (err) {
      console.error('[castClient] Failed to apply HA command:', commandData, err);
    }
  },

  _observeSync(sync) {
    if (!sync || !Number.isFinite(Number(sync.userRevision))) return;
    const revision = Number(sync.userRevision);
    if (this._lastUserRevision > 0 && revision > this._lastUserRevision + 1 && !this._resyncRequested) {
      this._resyncRequested = true;
      this.send('sync:request', {
        guid: localStorage.getItem('podwaffle_guid') || '',
        lastUserRevision: this._lastUserRevision,
      });
    }
    this._lastUserRevision = Math.max(this._lastUserRevision, revision);
    try {
      localStorage.setItem('podwaffle_last_sync', JSON.stringify({
        revision: this._lastUserRevision,
        lastSyncAt: sync.lastSyncAt || null,
        serverTime: sync.serverTime || null,
      }));
    } catch (_) {}
    this._dispatch('sync:clock', { ...sync, revision: this._lastUserRevision });
  },

  _applyCastStatus(status = {}) {
    const explicitStatus = String(status.status || '').toLowerCase();
    const activeDeviceId = status.activeDeviceId !== undefined
      ? status.activeDeviceId
      : (status.deviceId !== undefined ? status.deviceId : this._castState.activeDeviceId);
    const nextStatus = explicitStatus || (activeDeviceId ? this._castState.status : 'idle');
    const isIdle = !activeDeviceId || nextStatus === 'idle';

    this._castState = {
      status: isIdle ? 'idle' : nextStatus,
      position: isIdle ? 0 : (status.position != null ? status.position : this._castState.position),
      duration: isIdle ? 0 : (status.duration != null ? status.duration : this._castState.duration),
      activeDeviceId: isIdle ? null : activeDeviceId,
      deviceName: isIdle ? null : (status.deviceName != null ? status.deviceName : this._castState.deviceName),
      ownerGuid: isIdle ? null : (status.ownerGuid != null ? status.ownerGuid : this._castState.ownerGuid),
      episodeGuid: isIdle ? null : (status.episodeGuid != null ? status.episodeGuid : this._castState.episodeGuid),
      title: isIdle ? null : (status.title != null ? status.title : this._castState.title),
      podcastTitle: isIdle ? null : (status.podcastTitle != null ? status.podcastTitle : this._castState.podcastTitle),
      imageUrl: isIdle ? null : (status.imageUrl != null ? status.imageUrl : this._castState.imageUrl),
      mediaUrl: isIdle ? null : (status.mediaUrl != null ? status.mediaUrl : this._castState.mediaUrl),
      volume: status.volume != null ? status.volume : this._castState.volume,
    };

    if (isIdle) {
      this._clearIdleTimer();
    } else if (this._castState.status === 'playing') {
      this._clearIdleTimer();
    } else if (this._castState.status === 'paused' || this._castState.status === 'error') {
      if (!this._idleTimer) this._startIdleTimer();
    }

    const localGuid = localStorage.getItem('podwaffle_guid') || '';
    const belongsToUser = !!(this._castState.ownerGuid && this._castState.ownerGuid === localGuid);
    if (window.player && (window.player.mode === 'cast' || belongsToUser) && typeof window.player.applyCastState === 'function') {
      window.player.applyCastState({
        deviceId: this._castState.activeDeviceId,
        deviceName: this._castState.deviceName,
        mediaUrl: this._castState.mediaUrl,
        episodeGuid: this._castState.episodeGuid,
        title: this._castState.title,
        podcastTitle: this._castState.podcastTitle,
        imageUrl: this._castState.imageUrl,
        position: this._castState.position,
        duration: this._castState.duration,
        status: this._castState.status,
        reason: status.reason,
        volume: this._castState.volume,
        ownerGuid: this._castState.ownerGuid,
      });
    }
  },

  resetCastState(reason = 'client-reset') {
    this._applyCastStatus({
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
      volume: this._castState.volume || 1,
      status: 'idle',
      reason,
    });
    this._dispatch('cast:status', this.getCastState());
  },

  _handleMessage(data) {
    this._observeSync(data?.sync);
    if (data.type !== 'cast:state') {
      console.log('[castClient] Message received:', data.type, data);
    }
    switch (data.type) {
      case 'pong':
        this._lastPongAt = Date.now();
        this._pendingHealthPing = null;
        break;

      case 'cast:state':
        if (data.data) {
          this._applyCastStatus({
            ...data.data,
            activeDeviceId: data.data.deviceId !== undefined ? data.data.deviceId : data.data.activeDeviceId,
          });
        }

        this._dispatch('cast:state', data.data);
        break;

      case 'ping':
        this._lastPongAt = Date.now();
        if (this.isConnected()) {
          try {
            this.ws.send(JSON.stringify({ type: 'pong' }));
          } catch (_) {}
        }
        this._dispatch('ping', data.data);
        break;

      case 'cast:device_found':
        this._dispatch('cast:device_found', data.data);
        break;

      case 'cast:device_lost':
        this._dispatch('cast:device_lost', data.data);
        break;

      case 'cast:devices': {
        const devices = Array.isArray(data.data) ? data.data : [];
        this._dispatch('cast:devices', devices);
        devices.forEach((device) => {
          this._dispatch('cast:device_found', device);
        });
        break;
      }

      case 'cast:status':
        if (data.data) {
          this._applyCastStatus(data.data);
        }
        this._dispatch('cast:status', data.data);
        break;

      case 'feeds:updated':
        this._dispatch('feeds:updated', data.data);
        break;

      case 'sync:state':
        this._resyncRequested = false;
        this._dispatch('sync:state', data.data);
        break;

      case 'sync:clock':
        break;

      case 'user:progress':
        this._dispatch('user:progress', data.data);
        break;

      case 'user:playback-session':
        this._dispatch('user:playback-session', data.data);
        break;

      case 'user:subscriptions':
        this._dispatch('user:subscriptions', data.data);
        break;

      case 'ha:command':
        this._handleHaCommand(data.data);
        this._dispatch('ha:command', data.data);
        break;

      default:
        console.log('[castClient] Unknown message type:', data.type);
        this._dispatch(data.type, data.data);
        break;
    }
  },

  getCastState() {
    return { ...this._castState };
  },
};

window.castClient = castClient;
