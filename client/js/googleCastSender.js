/* ============================================================
   Podwaffle — googleCastSender.js
   Server-driven Google Cast control via Podwaffle backend.
   Only works when connected to a Podwaffle server.
   Exposes window.googleCastSender for casting control.
   ============================================================ */

const googleCastSender = {
  _initialized: false,
  _available: false,
  _listeners: {},
  _availableDevices: [],
  _currentSession: null,
  _userGuid: null,
  _apiBaseUrl: null,

  init() {
    console.log('[googleCastSender] init()');
    this._userGuid = localStorage.getItem('podwaffle_guid') || null;
    this._detectApiBaseUrl();
    this._setupWsListener();
    this._initialized = true;
    this._available = !!this._apiBaseUrl;
  },

  _detectApiBaseUrl() {
    try {
      const url = new URL(window.location.href);
      this._apiBaseUrl = `${url.protocol}//${url.host}`;
    } catch (_) {
      this._apiBaseUrl = '';
    }
  },

  _setupWsListener() {
    // Listen for cast state updates pushed from the server via WebSocket
    if (window.castClient && typeof window.castClient.on === 'function') {
      window.castClient.on('cast:device_found', (device) => {
        console.log('[googleCastSender] Device found:', device.name);
        if (!this._availableDevices.find(d => d.id === device.id)) {
          this._availableDevices.push(device);
        }
        this._dispatch('device_found', device);
      });

      window.castClient.on('cast:device_lost', (data) => {
        console.log('[googleCastSender] Device lost:', data.deviceId);
        this._availableDevices = this._availableDevices.filter(d => d.id !== data.deviceId);
        this._dispatch('device_lost', data);
      });

      window.castClient.on('cast:status', (status) => {
        console.log('[googleCastSender] Status update:', status);
        this._currentSession = status.activeDeviceId ? status : null;
        this._dispatch('statechange', status);

        // Notify player of state changes
        if (window.player && window.player.mode === 'cast' && typeof window.player.applyCastState === 'function') {
          window.player.applyCastState({
            deviceId: status.activeDeviceId,
            deviceName: status.deviceName,
            episodeGuid: status.episodeGuid,
            title: status.title,
            podcastTitle: status.podcastTitle,
            imageUrl: status.imageUrl,
            position: status.position,
            duration: status.duration,
            status: status.status,
            volume: status.volume,
          });
        }
      });
    }
  },

  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  },

  off(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter((item) => item !== handler);
  },

  _dispatch(event, data) {
    (this._listeners[event] || []).forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error('[googleCastSender] listener error:', err);
      }
    });
  },

  isSupported() {
    return this._initialized && this._available && !!this._apiBaseUrl;
  },

  isConnected() {
    return !!(
      this._currentSession &&
      this._currentSession.activeDeviceId &&
      this._currentSession.ownerGuid === this._userGuid
    );
  },

  getAvailability() {
    return {
      supported: this.isSupported(),
      connected: this.isConnected(),
      devices: this._availableDevices,
      session: this._currentSession,
    };
  },

  getCurrentDevice() {
    if (!this._currentSession || !this._currentSession.activeDeviceId) {
      return null;
    }
    const device = this._availableDevices.find(d => d.id === this._currentSession.activeDeviceId);
    return device || {
      id: this._currentSession.activeDeviceId,
      name: this._currentSession.deviceName || 'Cast Device',
      modelName: '',
    };
  },

  getCurrentSession() {
    // For compatibility — returns null in server mode
    return null;
  },

  async requestSession() {
    // In server mode, show a device picker modal or just use the first available device
    if (this._availableDevices.length === 0) {
      throw new Error('No cast devices available. Ensure at least one cast device is on the network.');
    }
    // Return first device for now; in future could show UI to choose
    return {
      id: this._availableDevices[0].id,
      name: this._availableDevices[0].name,
      modelName: '',
    };
  },

  async ensureSession() {
    if (this.isConnected()) {
      return this.getCurrentDevice();
    }
    return this.requestSession();
  },

  async loadEpisode(episode, startPosition = 0) {
    if (!episode || !episode.audioUrl) {
      throw new Error('Cannot cast episode without audioUrl');
    }

    if (!this.isSupported()) {
      throw new Error('Cast service unavailable. Check that the server is running.');
    }

    // Use current device or find the first available
    let targetDeviceId = this._currentSession?.activeDeviceId;
    if (!targetDeviceId && this._availableDevices.length > 0) {
      targetDeviceId = this._availableDevices[0].id;
    }

    if (!targetDeviceId) {
      throw new Error('No cast devices available.');
    }

    const payload = {
      userGuid: this._userGuid,
      deviceId: targetDeviceId,
      mediaUrl: episode.audioUrl,
      episodeGuid: episode.guid || '',
      title: episode.title || 'Unknown',
      podcastTitle: episode.podcastTitle || '',
      imageUrl: episode.podcastImageUrl || episode.imageUrl || '',
      duration: episode.duration || 0,
      startPosition: Math.max(0, Number(startPosition) || 0),
    };

    console.log('[googleCastSender] loadEpisode → posting to server');

    const response = await fetch(`${this._apiBaseUrl}/api/cast/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return this.getCurrentDevice();
  },

  async play() {
    if (!this.isConnected()) {
      throw new Error('Not connected to a cast session');
    }

    const response = await fetch(`${this._apiBaseUrl}/api/cast/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userGuid: this._userGuid }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  },

  async pause() {
    if (!this.isConnected()) {
      throw new Error('Not connected to a cast session');
    }

    const response = await fetch(`${this._apiBaseUrl}/api/cast/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userGuid: this._userGuid }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  },

  async seek(position) {
    if (!this.isConnected()) {
      throw new Error('Not connected to a cast session');
    }

    const targetPosition = Math.max(0, Number(position) || 0);

    const response = await fetch(`${this._apiBaseUrl}/api/cast/seek`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userGuid: this._userGuid, position: targetPosition }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  },

  async setVolume(level) {
    if (!this.isConnected()) {
      throw new Error('Not connected to a cast session');
    }

    const targetLevel = Math.max(0, Math.min(1, Number(level) || 0));

    const response = await fetch(`${this._apiBaseUrl}/api/cast/setVolume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userGuid: this._userGuid, level: targetLevel }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  },

  async stop() {
    if (!this._currentSession) {
      return { status: 'idle' };
    }

    try {
      const response = await fetch(`${this._apiBaseUrl}/api/cast/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userGuid: this._userGuid }),
      });
    } catch (_) {
      // Ignore errors on stop
    }

    this._currentSession = null;
    return { status: 'idle' };
  },

  showDevicePicker() {
    // For future implementation — show modal with available devices
    console.warn('[googleCastSender] Device picker not yet implemented');
  },
};

window.googleCastSender = googleCastSender;
window.__castActive = false;
window.__adjustCastVolume = function(delta) {
  if (window.player && typeof window.player.setVolume === 'function') {
    const nextVol = Math.max(0, Math.min(1, (window.player.volume || 0) + delta));
    window.player.setVolume(nextVol);
  }
};
googleCastSender.init();
