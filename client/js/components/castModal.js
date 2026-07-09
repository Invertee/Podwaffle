const castModal = {
  container: null,
  _stateHandler: null,
  _castStateHandler: null,
  _deviceFoundHandler: null,
  _deviceLostHandler: null,
  _actionInProgress: false,

  _getSessionContext() {
    const sender = window.googleCastSender;
    const castSession = sender?._currentSession || null;
    const userGuid = sender?._userGuid || localStorage.getItem('podwaffle_guid') || 'unknown';
    const activeDeviceId = castSession?.activeDeviceId || castSession?.deviceId || null;
    const hasActiveSession = !!activeDeviceId;
    const isOwner = !!(hasActiveSession && castSession?.ownerGuid && castSession.ownerGuid === userGuid);
    return { sender, castSession, userGuid, hasActiveSession, isOwner, activeDeviceId };
  },

  _formatLastUpdated(value) {
    if (!value) return 'Unknown';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'Unknown';
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  _renderHeaderState() {
    const infoEl = document.getElementById('cast-modal-info');
    if (!infoEl) return;

    if (!window.player && !window.googleCastSender) {
      infoEl.style.display = 'none';
      return;
    }

    const { castSession, hasActiveSession } = this._getSessionContext();
    const castState = hasActiveSession ? 'casting' : 'local';
    const deviceInfo = hasActiveSession ? (castSession.deviceName || castSession.activeDeviceId || castSession.deviceId || 'Unknown device') : 'Local playback';
    const episodeInfo = hasActiveSession ? (castSession.title || '(none)') : 'Local playback';
    const queueLen = Array.isArray(window.player?.queue) ? window.player.queue.length : 0;

    infoEl.innerHTML = `
      <div class="cast-state-grid">
        <div class="cast-state-row"><span class="cast-state-key">State</span><span class="cast-state-val">${castState}</span></div>
        <div class="cast-state-row"><span class="cast-state-key">Device</span><span class="cast-state-val">${deviceInfo}</span></div>
        <div class="cast-state-row"><span class="cast-state-key">Playing</span><span class="cast-state-val">${episodeInfo}</span></div>
        <div class="cast-state-row"><span class="cast-state-key">Queue</span><span class="cast-state-val">${queueLen} items</span></div>
      </div>
    `;
    infoEl.style.display = 'block';
    this._updateStopButtonVisibility();
  },

  _updateStopButtonVisibility() {
    const stopBtn = document.getElementById('cast-active-stop');
    if (!stopBtn) return;

    const { hasActiveSession } = this._getSessionContext();
    stopBtn.style.display = hasActiveSession ? 'inline-flex' : 'none';
    stopBtn.disabled = this._actionInProgress;
  },

  _bindHeaderStateUpdates() {
    this._unbindHeaderStateUpdates();

    if (window.player) {
      this._stateHandler = () => this._renderHeaderState();
      window.player.onStateChange(this._stateHandler);
    }

    if (window.castClient) {
      this._castStateHandler = () => {
        this._renderHeaderState();
        this.renderDeviceList(window.googleCastSender?.getAvailability() || { devices: [] });
        this._updateStopButtonVisibility();
      };
      window.castClient.on('cast:status', this._castStateHandler);
      window.castClient.on('user:queue', this._castStateHandler);
    }
  },

  _unbindHeaderStateUpdates() {
    if (window.player && this._stateHandler) {
      window.player.offStateChange(this._stateHandler);
    }
    if (window.castClient && this._castStateHandler) {
      window.castClient.off('cast:status', this._castStateHandler);
      window.castClient.off('user:queue', this._castStateHandler);
    }
    this._stateHandler = null;
    this._castStateHandler = null;
  },

  _bindDeviceUpdates() {
    this._unbindDeviceUpdates();

    if (!window.castClient) return;

    this._deviceFoundHandler = (device) => {
      console.log('[castModal] Device found via WebSocket:', device.name);
      this.renderDeviceList(window.googleCastSender?.getAvailability() || { devices: [] });
    };

    this._deviceLostHandler = (data) => {
      console.log('[castModal] Device lost via WebSocket:', data.deviceId);
      this.renderDeviceList(window.googleCastSender?.getAvailability() || { devices: [] });
    };

    window.castClient.on('cast:device_found', this._deviceFoundHandler);
    window.castClient.on('cast:device_lost', this._deviceLostHandler);
  },

  _unbindDeviceUpdates() {
    if (window.castClient) {
      if (this._deviceFoundHandler) {
        window.castClient.off('cast:device_found', this._deviceFoundHandler);
      }
      if (this._deviceLostHandler) {
        window.castClient.off('cast:device_lost', this._deviceLostHandler);
      }
    }
    this._deviceFoundHandler = null;
    this._deviceLostHandler = null;
  },

  render(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.container.innerHTML = `
      <div class="cast-modal-overlay">
        <div class="cast-modal">
          <div class="cast-modal-header">
            <div id="cast-modal-info" class="cast-modal-info">
              <!-- Populated dynamically -->
            </div>
            <button id="cast-modal-close" class="btn-icon cast-modal-close" aria-label="Close cast modal"><svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <h3 class="cast-modal-title">Cast to a device</h3>
          <div id="cast-device-list" class="cast-device-list">
            <div class="cast-loading">
              <div class="spinner spin"></div>
              Searching for devices...
            </div>
          </div>
        </div>
      </div>
    `;
    
    this.container.querySelector('.cast-modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hide();
    });
    document.getElementById('cast-modal-close').addEventListener('click', () => this.hide());
  },
  
  async show() {
    if (!this.container) return;
    this.container.style.display = 'block';
    this._actionInProgress = false;
    
    this._renderHeaderState();
    this._bindHeaderStateUpdates();
    this._bindDeviceUpdates();
    
    // Sync current session state only (devices come via WebSocket)
    if (window.googleCastSender && typeof window.googleCastSender.syncFromServerState === 'function') {
      await window.googleCastSender.syncFromServerState();
    }

    if (window.castClient && typeof window.castClient.send === 'function' && window.castClient.isConnected()) {
      window.castClient.send('cast:get_devices');
    }
    
    // Render with currently cached device list from WebSocket
    this.renderDeviceList(window.googleCastSender?.getAvailability() || { devices: [] });
    this._updateStopButtonVisibility();
  },
  
  hide() {
    this._actionInProgress = false;
    this._unbindHeaderStateUpdates();
    this._unbindDeviceUpdates();
    if (this.container) this.container.style.display = 'none';
  },

  
  renderDeviceList(availability) {
    const listEl = document.getElementById('cast-device-list');
    const supported = !!availability?.supported;
    const connected = !!availability?.connected;
    const device = availability?.device || null;
    const session = availability?.session || window.googleCastSender?._currentSession || null;
    const devices = Array.isArray(availability?.devices) ? availability.devices : [];
    const hasActiveSession = !!(session && (session.activeDeviceId || session.deviceId));
    const currentName = session?.deviceName || device?.name || (window.player && window.player._activeCastDeviceId) || 'Google Cast device';

    if (listEl) {
      listEl.style.pointerEvents = '';
    }
    
    if (!supported) {
      const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
      const reason = isNative
        ? 'Google Cast is not yet available inside this Android app runtime without a native Cast bridge plugin.'
        : 'Google Cast is unavailable in this browser context.';

      listEl.innerHTML = `
        <div class="cast-error">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="var(--accent-red)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>${reason}<br>Desktop Edge/Chrome casting remains available.</p>
        </div>
      `;
      return;
    }

    if (hasActiveSession) {
      listEl.innerHTML = `
        <div class="cast-device-item active cast-device-item-active" aria-disabled="true">
          <div class="cast-device-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path><line x1="2" y1="20" x2="2.01" y2="20"></line></svg>
          </div>
          <div class="cast-device-name">Casting to ${currentName}</div>
          <button id="cast-active-stop" class="btn btn-danger cast-active-stop">Stop casting</button>
          <div class="cast-active-dot"></div>
        </div>
      `;
      const stopBtn = document.getElementById('cast-active-stop');
      if (stopBtn) {
        stopBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (this._actionInProgress) return;
          this._actionInProgress = true;
          this._updateStopButtonVisibility();
          try {
            if (window.player && typeof window.player.switchToLocal === 'function') {
              await window.player.switchToLocal();
            }
            this.hide();
          } catch (err) {
            console.error('[castModal] Failed to stop casting:', err);
            alert('Failed to stop casting. See console.');
            this._actionInProgress = false;
            this._updateStopButtonVisibility();
          }
        });
      }
      return;
    }

    const deviceRows = devices.length > 0
      ? devices.map((item) => {
        const isCurrent = connected && device && item.id === device.id;
        return `
          <div class="cast-device-item ${isCurrent ? 'active' : ''}" data-action="choose" data-device-id="${item.id}">
            <div class="cast-device-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path><line x1="2" y1="20" x2="2.01" y2="20"></line></svg>
            </div>
            <div class="cast-device-name">${isCurrent ? `Connected: ${item.name}` : item.name}</div>
            ${isCurrent ? '<div class="cast-active-dot"></div>' : ''}
          </div>
        `;
      }).join('')
      : `
        <div class="cast-error">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="var(--accent-red)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>No cast devices found right now.<br>Ensure the backend can discover devices on the same network.</p>
        </div>
      `;

    listEl.innerHTML = `
      ${deviceRows}
    `;

    listEl.querySelectorAll('[data-action="choose"]').forEach((item) => {
      item.addEventListener('click', async () => {
        if (this._actionInProgress) return;
        this._actionInProgress = true;
        this._updateStopButtonVisibility();
        listEl.style.pointerEvents = 'none';
        try {
          const selectedDeviceId = item.getAttribute('data-device-id') || null;
          if (window.player) await window.player.switchToCast(selectedDeviceId);
          this.hide();
        } catch (err) {
          console.error('Failed to start Google Cast session:', err);
          alert('Failed to start Google Cast. See console.');
          this._actionInProgress = false;
          listEl.style.pointerEvents = '';
          this._updateStopButtonVisibility();
        }
      });
    });
  }
};

window.castModal = castModal;
