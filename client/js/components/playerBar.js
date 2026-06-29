const playerBar = {
  container: null,
  
  render(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="player-now-playing" id="pb-now-playing">
        <img id="pb-art" src="/icons/icon-192.png" alt="Artwork">
        <div class="pb-info">
          <div id="pb-title" class="pb-title">Nothing playing</div>
          <div id="pb-podcast" class="pb-podcast">Select a podcast to start</div>
        </div>
      </div>
      
      <div class="player-controls">
        <div class="player-transport">
          <button id="pb-skip-back" class="btn-icon" title="Skip Back">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><path d="M3 11l19-9v18z"></path><path d="M3 11v8"></path></svg>
            <span class="skip-text">15</span>
          </button>
          <button id="pb-play-pause" class="btn-icon btn-play-pause" title="Play/Pause">
            <svg id="pb-play-icon" viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
            <svg id="pb-pause-icon" viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line></svg>
          </button>
          <button id="pb-skip-forward" class="btn-icon" title="Skip Forward">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 11L2 2v18z"></path><path d="M21 11v8"></path></svg>
            <span class="skip-text">45</span>
          </button>
        </div>
        
        <div class="player-scrubber-container">
          <span id="pb-time-current" class="pb-time">0:00</span>
          <input type="range" id="pb-scrubber" class="progress-slider" min="0" max="100" value="0" step="1">
          <span id="pb-time-total" class="pb-time">-0:00</span>
        </div>
      </div>
      
      <div class="player-right">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--text-secondary)" stroke-width="2" fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
        <input type="range" id="pb-volume" class="volume-slider" min="0" max="100" value="100">
        
        <button id="pb-cast" class="btn-icon" title="Cast to device">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path><line x1="2" y1="20" x2="2.01" y2="20"></line></svg>
        </button>
        
        <button id="pb-queue" class="btn-icon pb-queue-btn" title="Up Next">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          <span id="pb-queue-badge" class="queue-badge" style="display:none;">0</span>
        </button>
      </div>
    `;

    this.bindEvents();
    
    // Register with player
    if (window.player) {
      window.player.onStateChange((state) => this.update(state));
    }
  },
  
  bindEvents() {
    document.getElementById('pb-play-pause').addEventListener('click', () => {
      if (window.player) window.player.togglePlay();
    });
    
    document.getElementById('pb-skip-back').addEventListener('click', () => {
      if (window.player) window.player.skipBack();
    });
    
    document.getElementById('pb-skip-forward').addEventListener('click', () => {
      if (window.player) window.player.skipForward();
    });
    
    const scrubber = document.getElementById('pb-scrubber');
    scrubber.addEventListener('input', (e) => {
      // While dragging, just update the visual times, don't seek yet
      const pos = parseFloat(e.target.value);
      const total = window.player ? window.player.duration : 0;
      this._updateTimeDisplays(pos, total);
    });
    scrubber.addEventListener('change', (e) => {
      // On mouse up, perform the seek
      if (window.player) window.player.seek(parseFloat(e.target.value));
    });
    
    document.getElementById('pb-volume').addEventListener('input', (e) => {
      if (window.player) window.player.setVolume(parseInt(e.target.value) / 100);
    });
    
    document.getElementById('pb-now-playing').addEventListener('click', () => {
      if (window.queue) window.queue.toggle();
    });
    
    document.getElementById('pb-queue').addEventListener('click', () => {
      if (window.queue) window.queue.toggle();
    });
    
    document.getElementById('pb-cast').addEventListener('click', () => {
      if (window.castModal) window.castModal.show();
    });
  },
  
  _formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  },
  
  _updateTimeDisplays(position, duration) {
    document.getElementById('pb-time-current').textContent = this._formatTime(position);
    const remaining = Math.max(0, duration - position);
    document.getElementById('pb-time-total').textContent = '-' + this._formatTime(remaining);
  },
  
  update(state) {
    if (!this.container) return;
    
    // Slide up animation if we have an episode
    if (state.currentEpisode && !this.container.classList.contains('active')) {
      this.container.classList.add('active');
    } else if (!state.currentEpisode) {
      this.container.classList.remove('active');
    }
    
    // Update episode info
    if (state.currentEpisode) {
      document.getElementById('pb-title').textContent = state.currentEpisode.title || 'Unknown Episode';
      document.getElementById('pb-podcast').textContent = state.currentEpisode.podcastTitle || 'Unknown Podcast';
      document.getElementById('pb-art').src = state.currentEpisode.imageUrl || '/icons/icon-192.png';
    } else {
      document.getElementById('pb-title').textContent = 'Nothing playing';
      document.getElementById('pb-podcast').textContent = 'Select a podcast to start';
      document.getElementById('pb-art').src = '/icons/icon-192.png';
    }
    
    // Update play/pause icon
    if (state.isPlaying) {
      document.getElementById('pb-play-icon').style.display = 'none';
      document.getElementById('pb-pause-icon').style.display = 'block';
    } else {
      document.getElementById('pb-play-icon').style.display = 'block';
      document.getElementById('pb-pause-icon').style.display = 'none';
    }
    
    // Update scrubber if not currently being dragged
    const scrubber = document.getElementById('pb-scrubber');
    if (document.activeElement !== scrubber) {
      scrubber.max = state.duration || 100;
      scrubber.value = state.position || 0;
      this._updateTimeDisplays(state.position, state.duration);
    }
    
    // Update skip texts
    document.querySelector('#pb-skip-back .skip-text').textContent = state.skipBack;
    document.querySelector('#pb-skip-forward .skip-text').textContent = state.skipForward;
    
    // Update volume
    const volSlider = document.getElementById('pb-volume');
    if (document.activeElement !== volSlider) {
      volSlider.value = Math.round(state.volume * 100);
    }
    
    // Update cast icon color if casting
    const castBtn = document.getElementById('pb-cast');
    if (state.mode === 'cast') {
      castBtn.style.color = 'var(--accent-blue)';
    } else {
      castBtn.style.color = '';
    }
    
    // Update queue badge
    const badge = document.getElementById('pb-queue-badge');
    if (state.queue && state.queue.length > 0) {
      badge.textContent = state.queue.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
};

window.playerBar = playerBar;
