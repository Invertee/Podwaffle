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
  _stateSyncPromise: null,
  _deviceRefreshPromise: null,

  init() {
    console.log('[googleCastSender] init()');
    this._userGuid = localStorage.getItem('podwaffle_guid') || null;
    console.log('[googleCastSender] User GUID:', this._userGuid || '(none)');
    this._resolveApiBaseUrl();
    console.log('[googleCastSender] API base URL:', this._apiBaseUrl || '(empty)');
    this._setupWsListener();
    this._initialized = true;
    this._available = !!this._apiBaseUrl;
    console.log('[googleCastSender] initialization complete. Available:', this._available);
  },

  _resolveApiBaseUrl() {
    if (window.api && typeof window.api._getRemoteBaseOrigin === 'function') {
      const remoteOrigin = window.api._getRemoteBaseOrigin();
      this._apiBaseUrl = remoteOrigin || '';
      return;
    }

    if (window.api && typeof window.api.getServerConnectionConfig === 'function') {
      const cfg = window.api.getServerConnectionConfig();
      if (cfg && cfg.enabled && cfg.host) {
        const protocol = cfg.secure ? 'https' : 'http';
        const hostPort = cfg.port ? `${cfg.host}:${cfg.port}` : cfg.host;
        this._apiBaseUrl = `${protocol}://${hostPort}`;
        return;
      }
    }

    this._apiBaseUrl = '';
  },

  _setupWsListener() {
    // Listen for cast state updates pushed from the server via WebSocket
    if (!window.castClient) {
      console.warn('[googleCastSender] castClient not available yet, skipping WS listener setup');
      return;
    }
    
    if (typeof window.castClient.on !== 'function') {
      console.warn('[googleCastSender] castClient.on is not a function');
      return;
    }

    console.log('[googleCastSender] Setting up WS listener for cast events');
    
    window.castClient.on('cast:device_found', (device) => {
      console.log('[googleCastSender] Device found:', device.name || device.id);
      if (!this._availableDevices.find(d => d.id === device.id)) {
        this._availableDevices.push(device);
        console.log('[googleCastSender] Added device. Total devices:', this._availableDevices.length);
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
      // Preserve ownerGuid from previous session if new message doesn't have it
      if (status?.activeDeviceId) {
        this._currentSession = {
          ...this._currentSession,  // preserve old values like ownerGuid
          ...status,                // overlay new values from server
          ownerGuid: status.ownerGuid || this._currentSession?.ownerGuid || null,
        };
      } else {
        this._currentSession = null;
      }
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

    console.log('[googleCastSender] WS listeners registered');
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
    this._resolveApiBaseUrl();
    this._available = !!this._apiBaseUrl;
    const supported = this._initialized && this._available && !!this._apiBaseUrl;
    if (!supported) {
      console.warn('[googleCastSender] isSupported() = false. initialized:', this._initialized, 'available:', this._available, 'apiBaseUrl:', this._apiBaseUrl);
    }
    return supported;
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
    const activeDeviceId = this._currentSession?.activeDeviceId || this._currentSession?.deviceId || null;
    if (!this._currentSession || !activeDeviceId) {
      return null;
    }
    const device = this._availableDevices.find(d => d.id === activeDeviceId);
    return device || {
      id: activeDeviceId,
      name: this._currentSession.deviceName || 'Cast Device',
      modelName: '',
    };
  },

  getCurrentSession() {
    // For compatibility — returns null in server mode
    return null;
  },

  async _refreshDevicesFromServer() {
    if (this._deviceRefreshPromise) {
      return this._deviceRefreshPromise;
    }

    this._resolveApiBaseUrl();
    if (!this._apiBaseUrl) return [];

    this._deviceRefreshPromise = (async () => {
      try {
        let devices = [];
        if (window.api && typeof window.api.getCastDevices === 'function') {
          devices = await window.api.getCastDevices();
        } else {
          const response = await fetch(`${this._apiBaseUrl}/api/cast/devices`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          devices = await response.json();
        }

        const normalized = Array.isArray(devices)
          ? devices
          : (Array.isArray(devices?.devices) ? devices.devices : []);
        this._availableDevices = normalized;
        console.log('[googleCastSender] Refreshed cast devices from API:', normalized.length);
        return normalized;
      } catch (err) {
        console.warn('[googleCastSender] Failed to refresh cast devices from API:', err);
        return this._availableDevices;
      } finally {
        this._deviceRefreshPromise = null;
      }
    })();

    return this._deviceRefreshPromise;
  },

  async syncFromServerState() {
    if (this._stateSyncPromise) {
      return this._stateSyncPromise;
    }

    this._resolveApiBaseUrl();
    if (!this._apiBaseUrl) {
      return null;
    }

    this._stateSyncPromise = (async () => {
      try {
        const session = (window.api && typeof window.api.getCastSession === 'function')
          ? await window.api.getCastSession()
          : await fetch(`${this._apiBaseUrl}/api/cast/session`).then((res) => (res.ok ? res.json() : null));

        const status = session?.session || session || null;
        const activeDeviceId = status?.activeDeviceId || status?.deviceId || null;

        if (status && activeDeviceId) {
          this._currentSession = {
            ...status,
            activeDeviceId,
            deviceId: status.deviceId || activeDeviceId,
            ownerGuid: status.ownerGuid || this._currentSession?.ownerGuid || null,
          };
        } else {
          this._currentSession = null;
        }

        return this._currentSession;
      } catch (err) {
        console.warn('[googleCastSender] Failed to sync cast state from API:', err);
        return null;
      } finally {
        this._stateSyncPromise = null;
      }
    })();

    return this._stateSyncPromise;
  },

  async refreshAvailability() {
    await Promise.all([
      this.syncFromServerState(),
      this._refreshDevicesFromServer(),
    ]);

    return this.getAvailability();
  },

  async requestSession(options = {}) {
    const skipRefresh = !!options.skipRefresh;
    const preferredDeviceId = options.preferredDeviceId || null;
    // In server mode, show a device picker modal or just use the first available device
    if (!skipRefresh && this._availableDevices.length === 0) {
      await this._refreshDevicesFromServer();
    }
    console.log('[googleCastSender] requestSession() - available devices:', this._availableDevices.length);
    console.log('[googleCastSender] Device list:', this._availableDevices);
    
    if (this._availableDevices.length === 0) {
      throw new Error('No cast devices available. Ensure at least one cast device is on the network.');
    }

    const chosenDevice = preferredDeviceId
      ? (this._availableDevices.find((item) => item.id === preferredDeviceId) || this._availableDevices[0])
      : this._availableDevices[0];

    // Return first device for now; in future could show UI to choose
    return {
      id: chosenDevice.id,
      name: chosenDevice.name,
      modelName: '',
    };
  },

  async ensureSession(options = {}) {
    const preferredDeviceId = options.preferredDeviceId || null;
    await this.refreshAvailability();
    if (this.isConnected()) {
      return this.getCurrentDevice();
    }
    return this.requestSession({ skipRefresh: true, preferredDeviceId });
  },

  async loadEpisode(episode, startPosition = 0) {
    this._resolveApiBaseUrl();
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
    this._resolveApiBaseUrl();
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
    this._resolveApiBaseUrl();
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
    this._resolveApiBaseUrl();
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
    this._resolveApiBaseUrl();
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
    this._resolveApiBaseUrl();
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
    this._dispatch('statechange', { status: 'idle', activeDeviceId: null, ownerGuid: null });
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
