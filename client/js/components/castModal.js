const castModal = {
  container: null,
  
  render(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    
    this.container.innerHTML = `
      <div class="cast-modal-overlay"></div>
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
    `;
    
    this.container.querySelector('.cast-modal-overlay').addEventListener('click', () => this.hide());
    document.getElementById('cast-modal-close').addEventListener('click', () => this.hide());
  },
  
  async show() {
    if (!this.container) return;
    this.container.style.display = 'block';
    
    // Update header info
    const infoEl = document.getElementById('cast-modal-info');
    if (window.player && window.player.currentEpisode) {
      const ep = window.player.currentEpisode;
      infoEl.innerHTML = `
        <img src="${ep.imageUrl}" onerror="this.src='/icons/icon-192.png'">
        <div>
          <div class="cmi-podcast">${ep.podcastTitle}</div>
          <div class="cmi-title">${ep.title}</div>
        </div>
      `;
      infoEl.style.display = 'flex';
    } else {
      infoEl.style.display = 'none';
    }
    
    await this.fetchDevices();
  },
  
  hide() {
    if (this.container) this.container.style.display = 'none';
  },
  
  async fetchDevices() {
    const listEl = document.getElementById('cast-device-list');
    listEl.innerHTML = `
      <div class="cast-loading">
        <div class="spinner spin"></div>
        Searching for devices...
      </div>
    `;
    
    try {
      const devices = await window.api.getCastDevices();
      this.renderDeviceList(devices);
    } catch (err) {
      console.error('Failed to fetch cast devices:', err);
      listEl.innerHTML = `
        <div class="cast-error">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="var(--accent-red)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>Failed to find devices on network.<br>Ensure backend is running on same network as speakers.</p>
        </div>
      `;
    }
  },
  
  renderDeviceList(devices) {
    const listEl = document.getElementById('cast-device-list');
    let html = '';
    
    const isCastMode = window.player && window.player.mode === 'cast';
    const activeDeviceId = window.player ? window.player.activeCastDeviceId : null;
    
    // Always show Local Playback option first
    html += `
      <div class="cast-device-item ${!isCastMode ? 'active' : ''}" data-id="local">
        <div class="cast-device-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
        </div>
        <div class="cast-device-name">Local Playback (This device)</div>
        ${!isCastMode ? '<div class="cast-active-dot"></div>' : ''}
      </div>
    `;
    
    if (devices && devices.length > 0) {
      devices.forEach(d => {
        const isActive = isCastMode && activeDeviceId === d.id;
        html += `
          <div class="cast-device-item ${isActive ? 'active' : ''}" data-id="${d.id}">
            <div class="cast-device-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path><line x1="2" y1="20" x2="2.01" y2="20"></line></svg>
            </div>
            <div class="cast-device-name">${d.name}</div>
            ${isActive ? '<div class="cast-active-dot"></div>' : ''}
          </div>
        `;
      });
    }
    
    listEl.innerHTML = html;
    
    // Bind clicks
    listEl.querySelectorAll('.cast-device-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        try {
          if (id === 'local') {
            if (window.player) await window.player.switchToLocal();
          } else {
            if (window.player) await window.player.switchToCast(id);
          }
          this.hide();
        } catch (err) {
          console.error('Failed to switch playback mode:', err);
          alert('Failed to connect to device. See console.');
        }
      });
    });
  }
};

window.castModal = castModal;
