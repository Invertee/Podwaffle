const playerBar = {
  container: null,
  isMobileControlsOpen: false,
  isFullscreenOpen: false,
  
  render(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="player-now-playing" id="pb-now-playing">
        <img id="pb-art" class="player-art" src="icons/icon-192.png" alt="Podcast artwork">
        <div class="pb-info">
          <div id="pb-title" class="pb-title">Nothing playing</div>
          <div id="pb-podcast" class="pb-podcast">Select a podcast to start</div>
        </div>
      </div>
      <div class="player-expanded-controls">
        <div class="player-controls">
          <div class="player-transport">
            <button id="pb-skip-back" class="button is-warning is-active is-rounded" title="Skip Back">
              <img src="icons/skip-backwards.svg" alt="Skip Back" width="24" height="24">
            </button>
            <button id="pb-play-pause" class="button is-danger is-active is-rounded" title="Play/Pause">
              <img id="pb-play-icon" src="icons/play.svg" alt="Play" width="24" height="24">
              <img id="pb-pause-icon" src="icons/pause.svg" alt="Pause" width="24" height="24" style="display:none;">
            </button>
            <button id="pb-skip-forward" class="button is-warning is-active is-rounded" title="Skip Forward">
              <img src="icons/skip-forward.svg" alt="Skip Forward" width="24" height="24">
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
      </div>
      <div id="pb-mobile-overlay" class="player-mobile-overlay" aria-hidden="true">
        <div id="pb-mobile-sheet" class="player-mobile-sheet">
          <div class="player-mobile-handle-wrap">
            <div class="player-mobile-handle"></div>
          </div>
          <div class="player-mobile-topbar">
            <button id="pb-mobile-close" class="btn-icon" title="Back to podcast menu" aria-label="Back to podcast menu">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="player-mobile-topbar-title">Now Playing</div>
            <button id="pb-mobile-queue" class="btn-icon pb-queue-btn" title="Up Next">
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              <span id="pb-mobile-queue-badge" class="queue-badge" style="display:none;">0</span>
            </button>
          </div>
          <div class="player-mobile-body">
            <img id="pb-mobile-art" class="player-mobile-art" src="icons/icon-192.png" alt="Podcast artwork">
            <div class="player-mobile-info">
              <div id="pb-mobile-title" class="player-mobile-title">Nothing playing</div>
              <div id="pb-mobile-podcast" class="player-mobile-podcast">Select a podcast to start</div>
            </div>
            <div class="player-mobile-progress">
              <span id="pb-mobile-time-current" class="pb-time">0:00</span>
              <input type="range" id="pb-mobile-scrubber" class="progress-slider" min="0" max="100" value="0" step="1">
              <span id="pb-mobile-time-total" class="pb-time">-0:00</span>
            </div>
            <div class="player-mobile-transport">
              <button id="pb-mobile-skip-back" class="btn-play-pause button is-danger is-active" title="Skip Back">
                <img src="/icons/skip-backwards.svg" alt="Skip Back" width="35" height="35">
              </button>
              <button id="pb-mobile-play-pause" class="btn-play-pause button is-danger is-active" title="Play/Pause">
                <img id="pb-mobile-play-icon" src="/icons/play.svg" alt="Play" width="40" height="40">
                <img id="pb-mobile-pause-icon" src="/icons/pause.svg" alt="Pause" width="40" height="40" style="display:none;">
              </button>
              <button id="pb-mobile-skip-forward" class="btn-play-pause button is-danger is-active" title="Skip Forward">
                <img src="/icons/skip-forward.svg" alt="Skip Forward" width="35" height="35">
              </button>
            </div>
            <div class="player-mobile-tools">
              <button id="pb-mobile-cast" class="btn-icon player-mobile-tool" title="Cast to device">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path><line x1="2" y1="20" x2="2.01" y2="20"></line></svg>
              </button>
              <div class="player-mobile-volume-wrap">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="var(--text-secondary)" stroke-width="2" fill="none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                <input type="range" id="pb-mobile-volume" class="volume-slider" min="0" max="100" value="100">
              </div>
              <button id="pb-mobile-queue-secondary" class="btn-icon player-mobile-tool" title="Up Next">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                <span id="pb-mobile-queue-badge-2" class="queue-badge" style="display:none;">0</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    
    // Register with player
    if (window.player) {
      window.player.onStateChange((state) => this.update(state));
    }
  },
  
  bindEvents() {
    const nowPlaying = document.getElementById('pb-now-playing');
    nowPlaying.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 768px)').matches) {
        this.toggleFullscreenControls();
      } else if (window.queue) {
        window.queue.toggle();
      }
    });

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
      this._setScrubberPct(pos, total);
    });
    scrubber.addEventListener('change', (e) => {
      // On mouse up, perform the seek
      if (window.player) window.player.seek(parseFloat(e.target.value));
    });
    
    document.getElementById('pb-volume').addEventListener('input', (e) => {
      if (window.player) window.player.setVolume(parseInt(e.target.value) / 100);
    });
    
    document.getElementById('pb-queue').addEventListener('click', () => {
      this.toggleQueuePanel();
    });
    
    document.getElementById('pb-cast').addEventListener('click', () => {
      if (window.castModal) window.castModal.show();
    });

    const miniPlayPause = document.getElementById('pb-mini-play-pause');
    const miniSkipBack = document.getElementById('pb-mini-skip-back');
    const miniSkipForward = document.getElementById('pb-mini-skip-forward');

    if (miniPlayPause) {
      miniPlayPause.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.player) window.player.togglePlay();
      });
    }

    if (miniSkipBack) {
      miniSkipBack.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.player) window.player.skipBack();
      });
    }

    if (miniSkipForward) {
      miniSkipForward.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.player) window.player.skipForward();
      });
    }

    this.bindMobileOverlayEvents();
  },

  bindMobileOverlayEvents() {
    const overlay = document.getElementById('pb-mobile-overlay');
    const sheet = document.getElementById('pb-mobile-sheet');
    const closeBtn = document.getElementById('pb-mobile-close');
    const playPause = document.getElementById('pb-mobile-play-pause');
    const skipBack = document.getElementById('pb-mobile-skip-back');
    const skipForward = document.getElementById('pb-mobile-skip-forward');
    const scrubber = document.getElementById('pb-mobile-scrubber');
    const volume = document.getElementById('pb-mobile-volume');
    const cast = document.getElementById('pb-mobile-cast');
    const queue = document.getElementById('pb-mobile-queue');
    const queue2 = document.getElementById('pb-mobile-queue-secondary');

    if (closeBtn) closeBtn.addEventListener('click', () => this.closeFullscreenControls());
    if (playPause) playPause.addEventListener('click', () => window.player && window.player.togglePlay());
    if (skipBack) skipBack.addEventListener('click', () => window.player && window.player.skipBack());
    if (skipForward) skipForward.addEventListener('click', () => window.player && window.player.skipForward());
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        const pos = parseFloat(e.target.value);
        const total = window.player ? window.player.duration : 0;
        this._updateTimeDisplays(pos, total, 'mobile');
        this._setScrubberPct(pos, total, scrubber);
      });
      scrubber.addEventListener('change', (e) => {
        if (window.player) window.player.seek(parseFloat(e.target.value));
      });
    }
    if (volume) volume.addEventListener('input', (e) => {
      if (window.player) window.player.setVolume(parseInt(e.target.value) / 100);
    });
    if (cast) cast.addEventListener('click', () => window.castModal && window.castModal.show());
    if (queue) queue.addEventListener('click', () => this.toggleQueuePanel());
    if (queue2) queue2.addEventListener('click', () => this.toggleQueuePanel());

    if (!overlay || !sheet) return;

    let startY = null;
    let startX = null;
    let tracking = false;

    const onTouchStart = (e) => {
      if (!this.isFullscreenOpen) return;
      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      tracking = true;
    };

    const onTouchMove = (e) => {
      if (!tracking || startY === null || startX === null) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startY;
      const dx = Math.abs(touch.clientX - startX);
      if (dy > 12 && dy > dx * 1.2) {
        sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
      }
    };

    const onTouchEnd = (e) => {
      if (!tracking || startY === null || startX === null) return;
      const touch = e.changedTouches[0];
      const dy = touch.clientY - startY;
      const dx = Math.abs(touch.clientX - startX);
      sheet.style.transform = '';
      if (dy > 80 && dy > dx) {
        this.closeFullscreenControls();
      }
      tracking = false;
      startY = null;
      startX = null;
    };

    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: true });
    sheet.addEventListener('touchend', onTouchEnd);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeFullscreenControls();
    });
  },

  toggleFullscreenControls() {
    this.setFullscreenControlsOpen(!this.isFullscreenOpen);
  },

  toggleQueuePanel() {
    if (!window.queue) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile && this.isFullscreenOpen) {
      this.closeFullscreenControls();
      window.setTimeout(() => {
        if (window.queue) window.queue.toggle();
      }, 180);
      return;
    }

    window.queue.toggle();
  },

  closeFullscreenControls() {
    this.setFullscreenControlsOpen(false);
  },

  setFullscreenControlsOpen(open) {
    this.isFullscreenOpen = open;
    if (!this.container) return;
    this.container.classList.toggle('mobile-controls-open', open);
    this.container.classList.toggle('mobile-fullscreen-open', open);

    const overlay = document.getElementById('pb-mobile-overlay');
    if (overlay) {
      overlay.classList.toggle('visible', open);
      overlay.setAttribute('aria-hidden', String(!open));
    }

    document.body.classList.toggle('player-overlay-open', open);
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
  
  _updateTimeDisplays(position, duration, target = 'desktop') {
    const currentId = target === 'mobile' ? 'pb-mobile-time-current' : 'pb-time-current';
    const totalId = target === 'mobile' ? 'pb-mobile-time-total' : 'pb-time-total';
    const currentEl = document.getElementById(currentId);
    const totalEl = document.getElementById(totalId);
    if (currentEl) currentEl.textContent = this._formatTime(position);
    const remaining = Math.max(0, duration - position);
    if (totalEl) totalEl.textContent = '-' + this._formatTime(remaining);
  },

  _setScrubberPct(position, duration, scrubberEl = null) {
    const scrubber = scrubberEl || document.getElementById('pb-scrubber');
    if (!scrubber) return;
    const total = duration > 0 ? duration : 100;
    const pct = Math.max(0, Math.min(100, (position / total) * 100));
    scrubber.style.setProperty('--progress-pct', `${pct}%`);
  },
  
  update(state) {
    if (!this.container) return;
    const titleEl = document.getElementById('pb-title');
    const podcastEl = document.getElementById('pb-podcast');
    const artEl = document.getElementById('pb-art');
    const playIcon = document.getElementById('pb-play-icon');
    const pauseIcon = document.getElementById('pb-pause-icon');
    const miniPlayIcon = document.getElementById('pb-mini-play-icon');
    const miniPauseIcon = document.getElementById('pb-mini-pause-icon');
    const scrubber = document.getElementById('pb-scrubber');
    const volSlider = document.getElementById('pb-volume');
    const castBtn = document.getElementById('pb-cast');
    const badge = document.getElementById('pb-queue-badge');
    
    // Slide up animation if we have an episode
    if (state.currentEpisode && !this.container.classList.contains('active')) {
      this.container.classList.add('active');
    } else if (!state.currentEpisode) {
      this.container.classList.remove('active');
    }
    
    // Update episode info
    if (state.currentEpisode) {
      if (titleEl) titleEl.textContent = state.currentEpisode.title || 'Unknown Episode';
      if (podcastEl) podcastEl.textContent = state.currentEpisode.podcastTitle || 'Unknown Podcast';
      if (artEl) artEl.src = state.currentEpisode.podcastImageUrl || state.currentEpisode.imageUrl || 'icons/icon-192.png';
      const mobileArt = document.getElementById('pb-mobile-art');
      const mobileTitle = document.getElementById('pb-mobile-title');
      const mobilePodcast = document.getElementById('pb-mobile-podcast');
      if (mobileArt) mobileArt.src = state.currentEpisode.podcastImageUrl || state.currentEpisode.imageUrl || 'icons/icon-192.png';
      if (mobileTitle) mobileTitle.textContent = state.currentEpisode.title || 'Unknown Episode';
      if (mobilePodcast) mobilePodcast.textContent = state.currentEpisode.podcastTitle || 'Unknown Podcast';
    } else {
      if (titleEl) titleEl.textContent = 'Nothing playing';
      if (podcastEl) podcastEl.textContent = 'Select a podcast to start';
      if (artEl) artEl.src = 'icons/icon-192.png';
      const mobileArt = document.getElementById('pb-mobile-art');
      const mobileTitle = document.getElementById('pb-mobile-title');
      const mobilePodcast = document.getElementById('pb-mobile-podcast');
      if (mobileArt) mobileArt.src = 'icons/icon-192.png';
      if (mobileTitle) mobileTitle.textContent = 'Nothing playing';
      if (mobilePodcast) mobilePodcast.textContent = 'Select a podcast to start';
    }
    
    // Update play/pause icon
    if (state.isPlaying) {
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
      if (miniPlayIcon) miniPlayIcon.style.display = 'none';
      if (miniPauseIcon) miniPauseIcon.style.display = 'block';
      const mobilePlay = document.getElementById('pb-mobile-play-icon');
      const mobilePause = document.getElementById('pb-mobile-pause-icon');
      if (mobilePlay) mobilePlay.style.display = 'none';
      if (mobilePause) mobilePause.style.display = 'block';
    } else {
      if (playIcon) playIcon.style.display = 'block';
      if (pauseIcon) pauseIcon.style.display = 'none';
      if (miniPlayIcon) miniPlayIcon.style.display = 'block';
      if (miniPauseIcon) miniPauseIcon.style.display = 'none';
      const mobilePlay = document.getElementById('pb-mobile-play-icon');
      const mobilePause = document.getElementById('pb-mobile-pause-icon');
      if (mobilePlay) mobilePlay.style.display = 'block';
      if (mobilePause) mobilePause.style.display = 'none';
    }
    
    // Update scrubber if not currently being dragged
    if (scrubber && document.activeElement !== scrubber) {
      scrubber.max = state.duration || 100;
      scrubber.value = state.position || 0;
      this._updateTimeDisplays(state.position, state.duration);
      this._setScrubberPct(state.position, state.duration);

      const mobileScrubber = document.getElementById('pb-mobile-scrubber');
      if (mobileScrubber && document.activeElement !== mobileScrubber) {
        mobileScrubber.max = state.duration || 100;
        mobileScrubber.value = state.position || 0;
        this._updateTimeDisplays(state.position, state.duration, 'mobile');
        this._setScrubberPct(state.position, state.duration, mobileScrubber);
      }
    }

    // Update volume
    if (volSlider && document.activeElement !== volSlider) {
      volSlider.value = Math.round(state.volume * 100);
    }

    const mobileVolSlider = document.getElementById('pb-mobile-volume');
    if (mobileVolSlider && document.activeElement !== mobileVolSlider) {
      mobileVolSlider.value = Math.round(state.volume * 100);
    }
    
    // Update cast icon color if casting
    if (castBtn && state.mode === 'cast') {
      castBtn.style.color = 'var(--accent-blue)';
    } else if (castBtn) {
      castBtn.style.color = '';
    }
    
    // Update queue badge
    const mobileBadge = document.getElementById('pb-mobile-queue-badge');
    const mobileBadge2 = document.getElementById('pb-mobile-queue-badge-2');
    if (state.queue && state.queue.length > 0) {
      if (badge) {
        badge.textContent = state.queue.length;
        badge.style.display = 'flex';
      }
      if (mobileBadge) {
        mobileBadge.textContent = state.queue.length;
        mobileBadge.style.display = 'flex';
      }
      if (mobileBadge2) {
        mobileBadge2.textContent = state.queue.length;
        mobileBadge2.style.display = 'flex';
      }
    } else {
      if (badge) badge.style.display = 'none';
      if (mobileBadge) mobileBadge.style.display = 'none';
      if (mobileBadge2) mobileBadge2.style.display = 'none';
    }
  }
};

window.playerBar = playerBar;
