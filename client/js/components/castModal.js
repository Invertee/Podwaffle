const castModal = {
  container: null,
  _stateHandler: null,
  _castStateHandler: null,

  _formatLastUpdated(value) {
    if (!value) return 'Unknown';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'Unknown';
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  _renderHeaderState() {
    const infoEl = document.getElementById('cast-modal-info');
    if (!infoEl) return;

    if (!window.player) {
      infoEl.style.display = 'none';
      return;
    }

    const queueLen = Array.isArray(window.player.queue) ? window.player.queue.length : 0;
    const ownerMode = window.player._queueStateMode === 'cast' ? 'Cast owns state' : 'Local owns state';
    const source = window.player._queueStateSource === 'server' ? 'Server sync' : 'Local mirror';
    const updatedAt = this._formatLastUpdated(window.player._queueStateUpdatedAt);
    const currentEpisodeGuid = window.player.currentEpisode?.guid || '(none)';

    infoEl.innerHTML = `
      <div class="cast-state-grid">
        <div class="cast-state-row"><span class="cast-state-key">Owner</span><span class="cast-state-val">${ownerMode}</span></div>
        <div class="cast-state-row"><span class="cast-state-key">Queue</span><span class="cast-state-val">${queueLen} items</span></div>
        <div class="cast-state-row"><span class="cast-state-key">Current</span><span class="cast-state-val">${currentEpisodeGuid}</span></div>
        <div class="cast-state-row"><span class="cast-state-key">Updated</span><span class="cast-state-val">${updatedAt} (${source})</span></div>
      </div>
    `;
    infoEl.style.display = 'block';
  },

  _bindHeaderStateUpdates() {
    this._unbindHeaderStateUpdates();

    if (window.player) {
      this._stateHandler = () => this._renderHeaderState();
      window.player.onStateChange(this._stateHandler);
    }

    if (window.castClient) {
      this._castStateHandler = () => this._renderHeaderState();
      window.castClient.on('cast:state', this._castStateHandler);
      window.castClient.on('user:queue', this._castStateHandler);
    }
  },

  _unbindHeaderStateUpdates() {
    if (window.player && this._stateHandler) {
      window.player.offStateChange(this._stateHandler);
    }
    if (window.castClient && this._castStateHandler) {
      window.castClient.off('cast:state', this._castStateHandler);
      window.castClient.off('user:queue', this._castStateHandler);
    }
    this._stateHandler = null;
    this._castStateHandler = null;
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
            <button id="cast-modal-close" class="btn-icon"><svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
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
    
    this._renderHeaderState();
    this._bindHeaderStateUpdates();
    
    await this.fetchDevices();
  },
  
  hide() {
    this._unbindHeaderStateUpdates();
    if (this.container) this.container.style.display = 'none';
  },
  
  async fetchDevices() {
    const listEl = document.getElementById('cast-device-list');
    listEl.innerHTML = `
      <div class="cast-loading">
        <div class="spinner spin"></div>
        Preparing Google Cast...
      </div>
    `;
    
    try {
      const availability = window.googleCastSender && typeof window.googleCastSender.getAvailability === 'function'
        ? window.googleCastSender.getAvailability()
        : { supported: false, connected: false, device: null };
      this.renderDeviceList(availability);
    } catch (err) {
      console.error('Failed to fetch cast devices:', err);
      listEl.innerHTML = `
        <div class="cast-error">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="var(--accent-red)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>Google Cast is not available here.<br>Use Edge or Chrome on desktop with Cast support enabled.</p>
        </div>
      `;
    }
  },
  
  renderDeviceList(availability) {
    const listEl = document.getElementById('cast-device-list');
    const supported = !!availability?.supported;
    const connected = !!availability?.connected;
    const device = availability?.device || null;
    const currentName = device?.name || (window.player && window.player._activeCastDeviceId) || 'Google Cast device';
    
    if (!supported) {
      listEl.innerHTML = `
        <div class="cast-error">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="var(--accent-red)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>Google Cast is unavailable in this browser context.<br>Desktop Edge/Chrome works; the Android app will still need a native Cast bridge.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="cast-device-item ${connected ? 'active' : ''}" data-action="choose">
        <div class="cast-device-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path><line x1="2" y1="20" x2="2.01" y2="20"></line></svg>
        </div>
        <div class="cast-device-name">${connected ? `Connected: ${currentName}` : 'Choose a Google Cast device'}</div>
        ${connected ? '<div class="cast-active-dot"></div>' : ''}
      </div>
      ${connected ? `
        <div class="cast-device-item" data-action="stop">
          <div class="cast-device-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>
          </div>
          <div class="cast-device-name">Stop casting and return to local playback</div>
        </div>
      ` : ''}
    `;

    listEl.querySelector('[data-action="choose"]')?.addEventListener('click', async () => {
      try {
        if (window.player) await window.player.switchToCast();
        this.hide();
      } catch (err) {
        console.error('Failed to start Google Cast session:', err);
        alert('Failed to start Google Cast. See console.');
      }
    });

    listEl.querySelector('[data-action="stop"]')?.addEventListener('click', async () => {
      try {
        if (window.player) await window.player.switchToLocal();
        this.hide();
      } catch (err) {
        console.error('Failed to stop casting:', err);
        alert('Failed to stop casting. See console.');
      }
    });
  }
};

window.castModal = castModal;
