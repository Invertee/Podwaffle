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
  _idleTimer: null,
  _IDLE_TIMEOUT_MS: 20 * 60 * 1000, // 20 minutes
  _castState: {
    status: 'idle',
    position: 0,
    duration: 0,
    activeDeviceId: null,
    episodeGuid: null,
    title: null,
    podcastTitle: null,
    imageUrl: null,
  },

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[castClient] Already connected or connecting.');
      return;
    }
    this._intentionalClose = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/ws' : '/ws');
    const wsUrl = `${protocol}//${location.host}${wsPath}`;
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
      this._startStatePolling();
      this._dispatch('connected', {});
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch (err) {
        console.error('[castClient] Failed to parse WS message:', err, event.data);
      }
    });

    this.ws.addEventListener('close', (event) => {
      console.warn(`[castClient] WebSocket closed (code=${event.code}). Intentional=${this._intentionalClose}`);
      this.ws = null;
      this._stopStatePolling();
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
    this._statePollTimer = setInterval(async () => {
      try {
        if (!window.api) return;
        const castState = await window.api.getCastState();
        if (!castState || !castState.activeDeviceId) return;
        this._handleMessage({
          type: 'cast:state',
          data: {
            deviceId: castState.activeDeviceId,
            mediaUrl: castState.mediaUrl,
            episodeGuid: castState.episodeGuid,
            title: castState.title,
            podcastTitle: castState.podcastTitle,
            imageUrl: castState.imageUrl,
            position: castState.position,
            duration: castState.duration,
            status: castState.status,
            volume: castState.volume
          }
        });
      } catch (err) {
        console.warn('[castClient] cast state poll failed:', err.message || err);
      }
    }, 1000);
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

  _handleMessage(data) {
    console.log('[castClient] Message received:', data.type, data);
    switch (data.type) {
      case 'cast:state':
        // Update internal cast state
        if (data.data) {
          this._castState = {
            status: data.data.status || this._castState.status,
            position: data.data.position != null ? data.data.position : this._castState.position,
            duration: data.data.duration != null ? data.data.duration : this._castState.duration,
            activeDeviceId: data.data.deviceId || this._castState.activeDeviceId,
            episodeGuid: data.data.episodeGuid != null ? data.data.episodeGuid : this._castState.episodeGuid,
            title: data.data.title != null ? data.data.title : this._castState.title,
            podcastTitle: data.data.podcastTitle != null ? data.data.podcastTitle : this._castState.podcastTitle,
            imageUrl: data.data.imageUrl != null ? data.data.imageUrl : this._castState.imageUrl,
          };
          // Manage idle timeout: clear on playing, start on non-playing
          if (this._castState.status === 'playing') {
            this._clearIdleTimer();
          } else if (this._castState.status === 'idle' || this._castState.status === 'paused' || this._castState.status === 'error') {
            if (!this._idleTimer) this._startIdleTimer();
          }
          // Notify player only when cast mode is currently authoritative
          if (window.player && window.player.mode === 'cast') {
            if (!this._castState.activeDeviceId) {
              return;
            }

            window.player._activeCastDeviceId = this._castState.activeDeviceId || window.player._activeCastDeviceId;
            window.player.position = this._castState.position;
            window.player.duration = this._castState.duration;
            window.player.isPlaying = this._castState.status === 'playing';
            
            // Update episode metadata if available
            if (this._castState.episodeGuid && this._castState.title) {
              window.player.currentEpisode = {
                ...window.player.currentEpisode,
                guid: this._castState.episodeGuid,
                title: this._castState.title,
                podcastTitle: this._castState.podcastTitle,
                podcastImageUrl: this._castState.imageUrl,
              };
            }

            if (typeof window.player.handleCastStatusUpdate === 'function') {
              window.player.handleCastStatusUpdate(this._castState);
            }
            
            window.player._notifyStateChange();
          }
        }
        this._dispatch('cast:state', data.data);
        break;

      case 'feeds:updated':
        // Notify any registered feed-update listeners
        this._dispatch('feeds:updated', data.data);
        break;

      case 'user:progress':
        this._dispatch('user:progress', data.data);
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
