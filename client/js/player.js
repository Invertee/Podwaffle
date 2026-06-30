/* ============================================================
   Podwaffle — player.js
   Core audio player. Manages local playback + cast integration.
   Exposes window.player.
   ============================================================ */

const player = {
  audio: new Audio(),
  currentEpisode: null, // {guid, title, podcastTitle, audioUrl, imageUrl, feedId, duration}
  queue: [],
  mode: 'local',        // 'local' | 'cast'
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 1.0,
  skipBackSecs: 15,
  skipForwardSecs: 45,
  progressSyncInterval: null,
  lastSyncPosition: 0,
  lastSyncTime: 0,
  skippedSeconds: 0,
  _stateHandlers: [],
  _activeCastDeviceId: null,
  _castStartInFlight: false,
  _lastMediaSessionKey: null,

  // ─── Initialization ──────────────────────────────────────
  init() {
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this._notifyStateChange();
    });
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._notifyStateChange();
    });
    this.audio.addEventListener('durationchange', () => {
      this.duration = this.audio.duration || 0;
      this._notifyStateChange();
    });
    this.audio.addEventListener('error', (e) => {
      console.error('[player] Audio error:', e);
    });

    // Load saved volume
    const savedVolume = parseFloat(localStorage.getItem('podwaffle_volume') || '1');
    this.volume = isNaN(savedVolume) ? 1.0 : savedVolume;
    this.audio.volume = this.volume;

    // Load saved skip settings
    const savedSkipBack = parseInt(localStorage.getItem('podwaffle_skip_back') || '15');
    const savedSkipFwd = parseInt(localStorage.getItem('podwaffle_skip_forward') || '45');
    if (!isNaN(savedSkipBack)) this.skipBackSecs = savedSkipBack;
    if (!isNaN(savedSkipFwd)) this.skipForwardSecs = savedSkipFwd;

    console.log('[player] Initialized.');
  },

  // ─── Load & Play ─────────────────────────────────────────
  loadEpisode(episode, startPosition = 0, options = {}) {
    const autoplay = options.autoplay !== false;
    if (!episode || !episode.audioUrl) {
      console.error('[player] loadEpisode: missing audioUrl', episode);
      return;
    }

    if (this.mode === 'cast' && this._activeCastDeviceId) {
      console.log('[player] Loading episode on cast device:', episode.title, 'at', startPosition);
      this.currentEpisode = episode;
      this.position = startPosition;
      this.duration = episode.duration || this.duration || 0;
      this.lastSyncPosition = startPosition;
      this.lastSyncTime = Date.now();
      this.skippedSeconds = 0;
      this.currentEpisode._markedPlayed = false;
      this.currentEpisode._markingPlayed = false;
      this._castStartInFlight = true;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this._notifyStateChange();
      this._setupProgressSync();

      api.castPlay(
        this._activeCastDeviceId,
        episode.audioUrl,
        startPosition,
        episode.guid,
        localStorage.getItem('podwaffle_guid'),
        episode.title,
        episode.podcastTitle,
        episode.podcastImageUrl || episode.imageUrl,
        episode.duration || 0
      ).then(() => {
        this.isPlaying = true;
        this._notifyStateChange();
      }).catch((err) => {
        console.error('[player] castPlay from loadEpisode error:', err);
        this.isPlaying = false;
        this._notifyStateChange();
      }).finally(() => {
        this._castStartInFlight = false;
      });
      return;
    }

    console.log('[player] Loading episode:', episode.title, 'at', startPosition);

    this.currentEpisode = episode;
    this.mode = 'local';
    this.isPlaying = false;
    this.position = startPosition;
    this.lastSyncPosition = startPosition;
    this.lastSyncTime = Date.now();
    this.skippedSeconds = 0;
    this.currentEpisode._markedPlayed = false;
    this.currentEpisode._markingPlayed = false;

    this.audio.src = episode.audioUrl;
    this.audio.load();
    this.audio.volume = this.volume;
    if (startPosition > 0) {
      this.audio.currentTime = startPosition;
    }

    this._updateMediaSession();
    this._notifyStateChange();
    this._setupProgressSync();
    if (autoplay) {
      this.play();
    }
  },

  play() {
    if (this.mode === 'cast') {
      if (this._castStartInFlight) {
        return;
      }
      if (!this.currentEpisode || !this.currentEpisode.audioUrl) {
        console.warn('[player] play ignored in cast mode: no episode loaded yet');
        return;
      }
      this.audio.pause();
      api.castResume().catch(err => console.error('[player] castResume error:', err));
      this.isPlaying = true;
      this._notifyStateChange();
      return;
    }
    if (!this.audio.src) {
      console.warn('[player] play: no audio source loaded');
      return;
    }
    this.audio.play().then(() => {
      console.log('[player] Playing:', this.currentEpisode?.title);
    }).catch(err => {
      console.error('[player] play() error:', err);
    });
  },

  pause() {
    if (this.mode === 'cast') {
      api.castPause().catch(err => console.error('[player] castPause error:', err));
      this.isPlaying = false;
      this._notifyStateChange();
      return;
    }
    this.audio.pause();
    console.log('[player] Paused.');
  },

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  },

  skipBack() {
    const newPos = Math.max(0, this.position - this.skipBackSecs);
    console.log(`[player] Skip back ${this.skipBackSecs}s: ${this.position} → ${newPos}`);
    this.seek(newPos);
  },

  skipForward() {
    const newPos = Math.min(this.duration || Infinity, this.position + this.skipForwardSecs);
    console.log(`[player] Skip forward ${this.skipForwardSecs}s: ${this.position} → ${newPos}`);
    this.skippedSeconds += this.skipForwardSecs;
    this.seek(newPos);
  },

  seek(position) {
    position = Math.max(0, Math.floor(position));
    console.log('[player] Seek to:', position);
    if (this.mode === 'cast') {
      api.castSeek(position).catch(err => console.error('[player] castSeek error:', err));
      this.position = position;
      this._notifyStateChange();
      return;
    }
    this.audio.currentTime = position;
    this.position = position;
    this._notifyStateChange();
  },

  setVolume(level) {
    this.volume = Math.max(0, Math.min(1, level));
    this.audio.volume = this.volume;
    localStorage.setItem('podwaffle_volume', String(this.volume));
    if (this.mode === 'cast') {
      api.setCastVolume(this.volume).catch(err => console.error('[player] setCastVolume error:', err));
    }
    this._notifyStateChange();
  },

  // ─── Queue Management ─────────────────────────────────────
  addToQueue(episode) {
    if (!episode) return;
    console.log('[player] Add to queue:', episode.title);
    this.queue.push(episode);
    this._notifyStateChange();
  },

  playNext(episode) {
    if (!episode) return;
    console.log('[player] Play next:', episode.title);
    this.queue.unshift(episode);
    this._notifyStateChange();
  },

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    console.log('[player] Remove from queue index:', index);
    this.queue.splice(index, 1);
    this._notifyStateChange();
  },

  reorderQueue(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex >= this.queue.length) return;
    console.log(`[player] Reorder queue: ${fromIndex} → ${toIndex}`);
    const [item] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, item);
    this._notifyStateChange();
  },

  // ─── Internal Event Handlers ──────────────────────────────
  _onTimeUpdate() {
    this.position = this.audio.currentTime || 0;
    this.duration = this.audio.duration || this.duration;

    // Check 95% threshold or within 3 seconds of end to mark as played
    const playedRatio = this.duration > 0 ? this.position / this.duration : 0;
    const nearEnd = this.duration > 0 && (this.position >= this.duration - 3);
    
    if (this.duration > 0 && (playedRatio >= 0.95 || nearEnd)) {
      if (this.currentEpisode && !this.currentEpisode._markedPlayed && !this.currentEpisode._markingPlayed) {
        console.log(`[player] Episode 95%+ complete or within 3s of end: ${this.currentEpisode.title} (${Math.round(playedRatio * 100)}%, ${this.position.toFixed(1)}s / ${this.duration.toFixed(1)}s)`);
        this.currentEpisode._markedPlayed = true;
        this._markPlayed(this.currentEpisode, { force: true });
      }
    }

    this._notifyStateChange();
  },

  _onEnded() {
    console.log('[player] Episode ended:', this.currentEpisode?.title);
    this.duration = this.audio.duration || this.duration || 0;
    this.position = this.duration > 0 ? this.duration : (this.audio.currentTime || this.position || 0);

    if (this.currentEpisode && !this.currentEpisode._markedPlayed && !this.currentEpisode._markingPlayed) {
      this.currentEpisode._markedPlayed = true;
      this._markPlayed(this.currentEpisode, { force: true, position: this.position, duration: this.duration });
    }
    this.isPlaying = false;
    this._notifyStateChange();

    // Advance queue
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this._notifyStateChange();
      this.loadEpisode(next, 0);
    } else {
      this._notifyStateChange();
    }
  },

  _setupProgressSync() {
    if (this.progressSyncInterval) {
      clearInterval(this.progressSyncInterval);
    }
    this.progressSyncInterval = setInterval(() => {
      this._syncProgress();
    }, 15000);
  },

  async _syncProgress() {
    if (!this.currentEpisode) return;
    const guid = localStorage.getItem('podwaffle_guid');
    if (!guid) return;

    const episode = this.currentEpisode;
    const pos = Math.max(0, Math.floor(this.position || this.audio.currentTime || 0));
    const dur = Math.max(0, Math.floor(this.duration || this.audio.duration || 0));

    // Don't sync if episode has already been marked as played (avoid race condition)
    if (episode._markedPlayed) {
      console.log('[player] Skipping sync for already-played episode:', episode.title);
      return;
    }

    try {
      await api.updateProgress(guid, episode.guid, {
        position: pos,
        duration: dur,
        played: false,
        feedId: episode.feedId,
      });

      // Calculate listened delta
      const listenedDelta = Math.max(0, pos - this.lastSyncPosition);
      if (listenedDelta > 0 || this.skippedSeconds > 0) {
        await api.updateStats(guid, Math.floor(listenedDelta), Math.floor(this.skippedSeconds));
      }
      this.lastSyncPosition = pos;
      this.skippedSeconds = 0;
      console.log(`[player] Progress synced: ${formatTime(pos)} / ${formatTime(dur)}`);
    } catch (err) {
      console.error('[player] _syncProgress error:', err);
    }
  },

  async _markPlayed(episode, options = {}) {
    const guid = localStorage.getItem('podwaffle_guid');
    if (!guid || !episode || episode._markingPlayed) return;
    episode._markingPlayed = true;
    try {
      const finalPosition = Math.max(0, Math.floor(options.position ?? this.position ?? this.audio.currentTime ?? this.duration ?? 0));
      const finalDuration = Math.max(0, Math.floor(options.duration ?? this.duration ?? this.audio.duration ?? 0));
      await api.updateProgress(guid, episode.guid, {
        position: finalPosition,
        duration: finalDuration,
        played: true,
        feedId: episode.feedId,
      });

      await api.addHistory(guid, {
        episodeGuid: episode.guid,
        feedId: episode.feedId,
        title: episode.title,
        podcastTitle: episode.podcastTitle,
        imageUrl: episode.imageUrl,
        listenedAt: new Date().toISOString(),
        duration: finalDuration,
      });

      // Final stats update
      const listenedDelta = Math.max(0, finalPosition - this.lastSyncPosition);
      if (listenedDelta > 0) {
        await api.updateStats(guid, Math.floor(listenedDelta), 0);
      }
      this.lastSyncPosition = finalPosition;
      console.log('[player] Episode marked as played:', episode.title);
    } catch (err) {
      console.error('[player] _markPlayed error:', err);
    } finally {
      episode._markingPlayed = false;
    }
  },

  _resolveMediaAssetUrl(src) {
    if (!src) return null;
    try {
      return new URL(src, window.location.href).href;
    } catch (_) {
      return src;
    }
  },

  _getMediaSessionArtwork(episode) {
    const artworkUrl = this._resolveMediaAssetUrl(
      episode?.podcastImageUrl || episode?.imageUrl || 'icons/icon-512.png'
    );
    if (!artworkUrl) return [];

    return [
      { src: artworkUrl, sizes: '96x96' },
      { src: artworkUrl, sizes: '128x128' },
      { src: artworkUrl, sizes: '192x192' },
      { src: artworkUrl, sizes: '256x256' },
      { src: artworkUrl, sizes: '384x384' },
      { src: artworkUrl, sizes: '512x512' },
    ];
  },

  _getMediaSessionKey(episode) {
    if (!episode) return '';
    return [
      episode.guid || '',
      episode.title || '',
      episode.podcastTitle || '',
      episode.podcastImageUrl || episode.imageUrl || ''
    ].join('|');
  },

  _updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const episode = this.currentEpisode;
    if (!episode) return;

    this._lastMediaSessionKey = this._getMediaSessionKey(episode);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title || 'Unknown',
      artist: episode.podcastTitle || 'Podwaffle',
      album: 'Podwaffle',
      artwork: this._getMediaSessionArtwork(episode),
    });

    navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';

    navigator.mediaSession.setActionHandler('play', () => player.play());
    navigator.mediaSession.setActionHandler('pause', () => player.pause());
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const amt = details.seekOffset || player.skipBackSecs;
      player.seek(player.position - amt);
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const amt = details.seekOffset || player.skipForwardSecs;
      player.seek(player.position + amt);
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => player.skipBack());
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (player.queue.length > 0) {
        const next = player.queue.shift();
        player.loadEpisode(next, 0);
      } else {
        player.skipForward();
      }
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) player.seek(details.seekTime);
    });

    console.log('[player] MediaSession updated for:', episode.title);
  },

  _notifyStateChange() {
    const state = {
      currentEpisode: this.currentEpisode,
      queue: this.queue,
      mode: this.mode,
      isPlaying: this.isPlaying,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      skipBackSecs: this.skipBackSecs,
      skipForwardSecs: this.skipForwardSecs,
      activeCastDeviceId: this._activeCastDeviceId,
    };
    this._stateHandlers.forEach(handler => {
      try {
        handler(state);
      } catch (err) {
        console.error('[player] Error in state handler:', err);
      }
    });

    if ('mediaSession' in navigator) {
      const mediaSessionKey = this._getMediaSessionKey(this.currentEpisode);
      if (mediaSessionKey && mediaSessionKey !== this._lastMediaSessionKey) {
        this._updateMediaSession();
      }
      try {
        navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
      } catch (_) {}
    }

    // Update MediaSession position state
    if ('mediaSession' in navigator && this.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.duration,
          playbackRate: this.audio.playbackRate,
          position: Math.min(this.position, this.duration),
        });
      } catch (_) {}
    }
  },

  onStateChange(handler) {
    this._stateHandlers.push(handler);
  },

  offStateChange(handler) {
    this._stateHandlers = this._stateHandlers.filter(h => h !== handler);
  },

  // ─── Cast switching ──────────────────────────────────────
  async switchToCast(deviceId) {
    console.log('[player] Switching to cast device:', deviceId);
    const wasPlaying = this.isPlaying;
    const pos = this.position;

    // Pause local playback
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.mode = 'cast';
    this._activeCastDeviceId = deviceId;

    if (!this.currentEpisode) {
      this.isPlaying = false;
      this.position = 0;
      this.duration = 0;
      this._notifyStateChange();
      console.log('[player] Cast mode active with no episode loaded yet');
      return;
    }

    try {
      await api.castPlay(
        deviceId,
        this.currentEpisode.audioUrl,
        pos,
        this.currentEpisode.guid,
        localStorage.getItem('podwaffle_guid'),
        this.currentEpisode.title,
        this.currentEpisode.podcastTitle,
        this.currentEpisode.podcastImageUrl || this.currentEpisode.imageUrl,
        this.currentEpisode.duration || this.duration || 0
      );
      this.isPlaying = true;
      this._notifyStateChange();
      console.log('[player] Cast started on device:', deviceId);
    } catch (err) {
      console.error('[player] switchToCast error:', err);
      this.mode = 'local';
      this._activeCastDeviceId = null;
      if (wasPlaying) this.audio.play().catch(() => {});
      this._notifyStateChange();
    }
  },

  async switchToLocal() {
    console.log('[player] Switching to local playback.');
    const pos = this.position;

    try {
      await api.castStop();
    } catch (err) {
      console.warn('[player] castStop error (continuing anyway):', err);
    }

    this.mode = 'local';
    this._activeCastDeviceId = null;
    if (this.currentEpisode && this.currentEpisode.audioUrl) {
      const resumePos = Math.max(0, Math.floor(pos || 0));
      this.audio.pause();
      this.audio.src = this.currentEpisode.audioUrl;
      this.audio.load();
      this.audio.volume = this.volume;

      const applyResumePosition = () => {
        if (resumePos > 0) {
          try {
            this.audio.currentTime = resumePos;
          } catch (err) {
            console.warn('[player] Failed to restore local resume position:', err);
          }
        }
      };

      if (this.audio.readyState >= 1) {
        applyResumePosition();
      } else {
        this.audio.addEventListener('loadedmetadata', applyResumePosition, { once: true });
      }
    }
    this.play();
  },
};

window.player = player;
player.init();
