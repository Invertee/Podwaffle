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
  skippedSeconds: 0,
  _stateHandlers: [],
  _activeCastDeviceId: null,
  _castStartInFlight: false,
  _lastMediaSessionKey: null,
  _queueAutoplayTimer: null,
  _lastPlaybackSnapshotAt: 0,
  _audioRecoveryEpisodeGuid: null,
  _audioRecoveryAttempts: 0,
  _queueSyncTimer: null,
  _queueSyncInFlight: false,
  _lastQueueSyncAt: 0,
  _lastCastStatus: 'idle',
  _queueStateUpdatedAt: null,
  _queueStateMode: 'local',
  _queueStateSource: 'local',
  _keyHandlerBound: null,
  _nativeMediaSession: null,
  _nativeMediaInitialized: false,

  _toTimestamp(value) {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  },

  _getQueueLocalStorageKey() {
    const guid = localStorage.getItem('podwaffle_guid');
    if (!guid) return null;
    return `podwaffle_queue_state_${guid}`;
  },

  _sanitizeStartPosition(episode, startPosition = 0) {
    const parsed = Number.parseFloat(startPosition);
    const safeStart = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const episodeDuration = Number.parseFloat(episode?.duration);

    if (Number.isFinite(episodeDuration) && episodeDuration > 0) {
      return Math.max(0, Math.min(safeStart, Math.max(0, episodeDuration - 1)));
    }

    return Math.max(0, safeStart);
  },

  _normalizeQueueItem(item) {
    if (!item || typeof item !== 'object') return null;
    const audioUrl = item.audioUrl ? String(item.audioUrl) : '';
    if (!audioUrl) return null;

    const duration = typeof item.duration === 'number' ? item.duration : parseFloat(item.duration) || 0;
    return {
      guid: item.guid ? String(item.guid) : '',
      title: item.title ? String(item.title) : '',
      podcastTitle: item.podcastTitle ? String(item.podcastTitle) : '',
      audioUrl,
      imageUrl: item.imageUrl ? String(item.imageUrl) : '',
      podcastImageUrl: item.podcastImageUrl ? String(item.podcastImageUrl) : '',
      feedId: item.feedId ? String(item.feedId) : '',
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    };
  },

  _sanitizeQueue(items = []) {
    if (!Array.isArray(items)) return [];
    const sanitized = [];
    for (const item of items) {
      const normalized = this._normalizeQueueItem(item);
      if (normalized) sanitized.push(normalized);
    }
    return sanitized;
  },

  _canUseGlobalKeybindings(event) {
    if (!event) return false;
    const target = event.target;
    if (!target) return true;

    const tagName = String(target.tagName || '').toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return false;
    if (target.isContentEditable) return false;
    return true;
  },

  _handleGlobalKeydown(event) {
    if (!this._canUseGlobalKeybindings(event)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    switch (event.key) {
      case ' ': {
        event.preventDefault();
        this.togglePlay();
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        this.skipBack();
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        this.skipForward();
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        this.setVolume((this.volume || 0) + 0.05);
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        this.setVolume((this.volume || 0) - 0.05);
        break;
      }
      default:
        break;
    }
  },

  _serializeQueueForSync() {
    return this._sanitizeQueue(this.queue);
  },

  _persistQueueStateLocal(overrides = {}) {
    const key = this._getQueueLocalStorageKey();
    if (!key) return;

    const nextState = {
      queue: this._serializeQueueForSync(),
      mode: overrides.mode || (this.mode === 'cast' ? 'cast' : 'local'),
      currentEpisodeGuid: overrides.currentEpisodeGuid !== undefined
        ? String(overrides.currentEpisodeGuid || '')
        : String(this.currentEpisode?.guid || ''),
      updatedAt: overrides.updatedAt || new Date().toISOString(),
    };

    try {
      localStorage.setItem(key, JSON.stringify(nextState));
      this._queueStateMode = nextState.mode;
      this._queueStateUpdatedAt = nextState.updatedAt;
      this._queueStateSource = 'local';
    } catch (err) {
      console.warn('[player] Failed to persist local queue state:', err?.message || err);
    }
  },

  _loadQueueStateLocal() {
    const key = this._getQueueLocalStorageKey();
    if (!key) return null;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      return {
        queue: this._sanitizeQueue(parsed?.queue || []),
        mode: parsed?.mode === 'cast' ? 'cast' : 'local',
        currentEpisodeGuid: parsed?.currentEpisodeGuid ? String(parsed.currentEpisodeGuid) : '',
        updatedAt: parsed?.updatedAt || null,
      };
    } catch (_) {
      return null;
    }
  },

  _scheduleQueueSync(options = {}) {
    const delayMs = typeof options.delayMs === 'number' ? options.delayMs : 400;
    const immediate = !!options.immediate;
    const now = Date.now();
    const minIntervalMs = 1000;
    const effectiveDelay = immediate
      ? Math.max(0, minIntervalMs - (now - this._lastQueueSyncAt))
      : delayMs;

    clearTimeout(this._queueSyncTimer);
    this._queueSyncTimer = setTimeout(() => {
      this._syncQueueNow().catch((err) => {
        console.warn('[player] Queue sync failed:', err?.message || err);
      });
    }, effectiveDelay);
  },

  async _syncQueueNow() {
    const guid = localStorage.getItem('podwaffle_guid');
    if (!guid || !window.api || typeof window.api.updateQueue !== 'function') return;
    if (this._queueSyncInFlight) {
      this._scheduleQueueSync({ delayMs: 500 });
      return;
    }

    this._queueSyncInFlight = true;
    try {
      const payload = this._serializeQueueForSync();
      const updatedAt = new Date().toISOString();
      const mode = this.mode === 'cast' ? 'cast' : 'local';
      const currentEpisodeGuid = this.currentEpisode?.guid || '';
      this._persistQueueStateLocal({ mode, currentEpisodeGuid, updatedAt });
      await api.updateQueue(guid, payload, {
        mode,
        currentEpisodeGuid,
        updatedAt,
      });
      this._queueStateMode = mode;
      this._queueStateUpdatedAt = updatedAt;
      this._lastQueueSyncAt = Date.now();
    } finally {
      this._queueSyncInFlight = false;
    }
  },

  async hydrateQueueFromServer() {
    const guid = localStorage.getItem('podwaffle_guid');
    if (!guid || !window.api || typeof window.api.getQueue !== 'function') return;

    const localQueueState = this._loadQueueStateLocal();

    try {
      const queueState = await api.getQueue(guid);
      const remoteQueue = Array.isArray(queueState) ? queueState : (queueState?.queue || []);
      const remoteState = {
        queue: this._sanitizeQueue(remoteQueue || []),
        mode: queueState?.mode === 'cast' ? 'cast' : 'local',
        updatedAt: queueState?.updatedAt || null,
      };

      const localTs = this._toTimestamp(localQueueState?.updatedAt);
      const remoteTs = this._toTimestamp(remoteState.updatedAt);
      const useLocal = !!localQueueState && localTs > remoteTs;
      const chosen = useLocal ? localQueueState : remoteState;

      this.queue = this._sanitizeQueue(chosen.queue || []);
      if (queueState && typeof queueState === 'object') {
        this._queueStateMode = chosen.mode === 'cast' ? 'cast' : 'local';
        this._queueStateUpdatedAt = chosen.updatedAt || this._queueStateUpdatedAt;
      }

      if (useLocal) {
        this._queueStateSource = 'local';
        this._scheduleQueueSync({ immediate: true });
      } else {
        this._queueStateSource = 'server';
      }
      this._prefetchUpcomingQueue();
      this._notifyStateChange();
    } catch (err) {
      console.warn('[player] Failed to hydrate queue from server, using local copy if available:', err?.message || err);
      if (!localQueueState) return;

      this.queue = this._sanitizeQueue(localQueueState.queue || []);
      this._queueStateMode = localQueueState.mode === 'cast' ? 'cast' : 'local';
      this._queueStateUpdatedAt = localQueueState.updatedAt || this._queueStateUpdatedAt;
      this._queueStateSource = 'local';
      this._prefetchUpcomingQueue();
      this._notifyStateChange();
    }
  },

  _advanceQueueAfterCompletion() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this._persistQueueStateLocal({
        mode: this.mode,
        currentEpisodeGuid: next.guid || '',
        updatedAt: new Date().toISOString(),
      });
      this._notifyStateChange();
      this.loadEpisode(next, 0, { autoplay: false });
      this._scheduleQueueSync({ immediate: true });
      this._prefetchUpcomingQueue();
      if (this.mode === 'cast') {
        this.play();
      } else {
        this._attemptQueuedAutoplay();
      }
      return;
    }

    this._enterIdleState();
  },

  handleCastStatusUpdate(statusObj) {
    if (!statusObj || this.mode !== 'cast') return;
    const nextStatus = String(statusObj.status || '').toLowerCase();
    const wasPlaying = this._lastCastStatus === 'playing';
    const becameIdle = nextStatus === 'idle' && wasPlaying;
    this._lastCastStatus = nextStatus || this._lastCastStatus;

    if (becameIdle) {
      this._advanceQueueAfterCompletion();
    }
  },

  applyCastState(statusObj) {
    if (!statusObj || this.mode !== 'cast') return;
    if (!statusObj.deviceId && !this._activeCastDeviceId) return;

    this._activeCastDeviceId = statusObj.deviceId || this._activeCastDeviceId;
    if (statusObj.position != null) this.position = statusObj.position;
    if (statusObj.duration != null) this.duration = statusObj.duration;
    if (statusObj.status) this.isPlaying = statusObj.status === 'playing';

    if (statusObj.episodeGuid || statusObj.title) {
      this.currentEpisode = {
        ...(this.currentEpisode || {}),
        guid: statusObj.episodeGuid || this.currentEpisode?.guid || '',
        title: statusObj.title || this.currentEpisode?.title || '',
        podcastTitle: statusObj.podcastTitle || this.currentEpisode?.podcastTitle || '',
        podcastImageUrl: statusObj.imageUrl || this.currentEpisode?.podcastImageUrl || '',
        imageUrl: statusObj.imageUrl || this.currentEpisode?.imageUrl || '',
      };
    }

    this.handleCastStatusUpdate(statusObj);
    this._notifyStateChange();
  },

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
      this._recoverFromAudioError();
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

    window.addEventListener('pagehide', () => {
      this._flushPlaybackSnapshot({ keepalive: true });
      this._scheduleQueueSync({ immediate: true });
    });
    window.addEventListener('beforeunload', () => {
      this._flushPlaybackSnapshot({ keepalive: true });
      this._scheduleQueueSync({ immediate: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this._flushPlaybackSnapshot({ keepalive: true });
        this._scheduleQueueSync({ immediate: true });
      }
    });

    this._keyHandlerBound = (event) => this._handleGlobalKeydown(event);
    window.addEventListener('keydown', this._keyHandlerBound);

    console.log('[player] Initialized.');
  },

  // ─── Load & Play ─────────────────────────────────────────
  _buildPlaybackUrl(audioUrl, options = {}) {
    const { bustCache = false } = options;
    const resolved = this._resolveMediaAssetUrl(audioUrl);
    if (!resolved || !bustCache) return resolved;
    try {
      const url = new URL(resolved, window.location.href);
      url.searchParams.set('_pw_retry', String(Date.now()));
      return url.href;
    } catch (_) {
      return `${resolved}${resolved.includes('?') ? '&' : '?'}_pw_retry=${Date.now()}`;
    }
  },

  _setAudioSource(audioUrl, startPosition = 0, options = {}) {
    const sourceUrl = this._buildPlaybackUrl(audioUrl, options);
    const safeStart = Math.max(0, Math.floor(startPosition || 0));

    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.src = sourceUrl;
    this.audio.load();
    this.audio.volume = this.volume;

    if (safeStart > 0) {
      const applyStartPosition = () => {
        try {
          this.audio.currentTime = safeStart;
        } catch (err) {
          console.warn('[player] Failed to apply start position:', err);
        }
      };

      if (this.audio.readyState >= 1) {
        applyStartPosition();
      } else {
        this.audio.addEventListener('loadedmetadata', applyStartPosition, { once: true });
      }
    }

    return sourceUrl;
  },

  _recoverFromAudioError() {
    if (this.mode !== 'local' || !this.currentEpisode?.audioUrl) return;
    if (this.currentEpisode._markedPlayed) return;

    const episodeGuid = this.currentEpisode.guid || '';
    if (this._audioRecoveryEpisodeGuid !== episodeGuid) {
      this._audioRecoveryEpisodeGuid = episodeGuid;
      this._audioRecoveryAttempts = 0;
    }

    if (this._audioRecoveryAttempts >= 1) {
      console.warn('[player] Audio recovery exhausted for episode:', this.currentEpisode.title);
      return;
    }

    const resumeAt = Math.max(0, Math.floor(this.position || this.audio.currentTime || 0));
    const shouldAutoplay = this.isPlaying;
    this._audioRecoveryAttempts += 1;

    console.warn('[player] Retrying local playback with cache-busted URL:', this.currentEpisode.title);
    this._setAudioSource(this.currentEpisode.audioUrl, resumeAt, { bustCache: true });

    if (shouldAutoplay) {
      this.play();
    }
  },

  loadEpisode(episode, startPosition = 0, options = {}) {
    const autoplay = options.autoplay !== false;
    if (!episode || !episode.audioUrl) {
      console.error('[player] loadEpisode: missing audioUrl', episode);
      return;
    }

    const safeStartPosition = this._sanitizeStartPosition(episode, startPosition);
    if (safeStartPosition !== startPosition) {
      console.warn(`[player] Clamped invalid start position ${startPosition} → ${safeStartPosition} for episode:`, episode.title);
    }

    if (this.mode === 'cast' && this._activeCastDeviceId) {
      console.log('[player] Loading episode on cast device:', episode.title, 'at', safeStartPosition);
      this.currentEpisode = episode;
      this.position = safeStartPosition;
      this.duration = episode.duration || this.duration || 0;
      this.lastSyncPosition = safeStartPosition;
      this.skippedSeconds = 0;
      this.currentEpisode._markedPlayed = false;
      this.currentEpisode._markingPlayed = false;
      this._audioRecoveryEpisodeGuid = episode.guid || null;
      this._audioRecoveryAttempts = 0;
      this._castStartInFlight = true;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this._clearPersistedPlaybackSession({ episodeGuid: episode.guid, keepalive: true });
      this._notifyStateChange();
      this._setupProgressSync();

      const castLoader = (window.googleCastSender && window.googleCastSender.isConnected())
        ? window.googleCastSender.loadEpisode(episode, safeStartPosition)
        : api.castPlay(
          this._activeCastDeviceId,
          episode.audioUrl,
          safeStartPosition,
          episode.guid,
          localStorage.getItem('podwaffle_guid'),
          episode.title,
          episode.podcastTitle,
          episode.podcastImageUrl || episode.imageUrl,
          episode.duration || 0
        );

      Promise.resolve(castLoader).then(() => {
        this.isPlaying = true;
        this._notifyStateChange();
      }).catch((err) => {
        console.error('[player] castPlay from loadEpisode error:', err);
        this.isPlaying = false;
        this._notifyStateChange();
      }).finally(() => {
        this._castStartInFlight = false;
      });
      this._lastCastStatus = 'connecting';
      return;
    }

    console.log('[player] Loading episode:', episode.title, 'at', safeStartPosition);

    this.currentEpisode = episode;
    this.mode = 'local';
    this.isPlaying = false;
    this.position = safeStartPosition;
    this.lastSyncPosition = safeStartPosition;
    this.skippedSeconds = 0;
    this.currentEpisode._markedPlayed = false;
    this.currentEpisode._markingPlayed = false;
    this._audioRecoveryEpisodeGuid = episode.guid || null;
    this._audioRecoveryAttempts = 0;

    this._setAudioSource(episode.audioUrl, safeStartPosition);

    this._persistPlaybackSnapshot({ force: true });
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
      const resumePromise = (window.googleCastSender && window.googleCastSender.isConnected())
        ? window.googleCastSender.play()
        : api.castResume();
      Promise.resolve(resumePromise).catch(err => console.error('[player] castResume error:', err));
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
      const pausePromise = (window.googleCastSender && window.googleCastSender.isConnected())
        ? window.googleCastSender.pause()
        : api.castPause();
      Promise.resolve(pausePromise).catch(err => console.error('[player] castPause error:', err));
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
      const seekPromise = (window.googleCastSender && window.googleCastSender.isConnected())
        ? window.googleCastSender.seek(position)
        : api.castSeek(position);
      Promise.resolve(seekPromise).catch(err => console.error('[player] castSeek error:', err));
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
      const volumePromise = (window.googleCastSender && window.googleCastSender.isConnected())
        ? window.googleCastSender.setVolume(this.volume)
        : api.setCastVolume(this.volume);
      Promise.resolve(volumePromise).catch(err => console.error('[player] setCastVolume error:', err));
    }
    this._notifyStateChange();
  },

  // ─── Queue Management ─────────────────────────────────────
  addToQueue(episode) {
    if (!episode) return;
    console.log('[player] Add to queue:', episode.title);
    const normalized = this._normalizeQueueItem(episode);
    if (!normalized) return;
    this.queue.push(normalized);
    this._persistQueueStateLocal();
    this._prefetchUpcomingQueue();
    this._scheduleQueueSync();
    this._notifyStateChange();
  },

  playNext(episode) {
    if (!episode) return;
    console.log('[player] Play next:', episode.title);
    const normalized = this._normalizeQueueItem(episode);
    if (!normalized) return;
    this.queue.unshift(normalized);
    this._persistQueueStateLocal();
    this._prefetchUpcomingQueue();
    this._scheduleQueueSync();
    this._notifyStateChange();
  },

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    console.log('[player] Remove from queue index:', index);
    this.queue.splice(index, 1);
    this._persistQueueStateLocal();
    this._prefetchUpcomingQueue();
    this._scheduleQueueSync();
    this._notifyStateChange();
  },

  playFromQueue(index, expectedGuid = null) {
    if (!Array.isArray(this.queue) || this.queue.length === 0) return;

    let resolvedIndex = Number.isInteger(index) ? index : parseInt(index, 10);
    if (!Number.isFinite(resolvedIndex) || resolvedIndex < 0 || resolvedIndex >= this.queue.length) {
      resolvedIndex = -1;
    }

    if (expectedGuid) {
      if (resolvedIndex === -1 || this.queue[resolvedIndex]?.guid !== expectedGuid) {
        resolvedIndex = this.queue.findIndex((item) => item && item.guid === expectedGuid);
      }
    }

    if (resolvedIndex < 0 || resolvedIndex >= this.queue.length) return;

    const selected = this._normalizeQueueItem(this.queue[resolvedIndex]);
    if (!selected) return;

    const remaining = this.queue.filter((_, idx) => idx !== resolvedIndex);
    const currentAsQueueItem = this._normalizeQueueItem(this.currentEpisode);
    const isSameAsCurrent = !!(currentAsQueueItem && (
      (selected.guid && currentAsQueueItem.guid && selected.guid === currentAsQueueItem.guid) ||
      (selected.audioUrl && currentAsQueueItem.audioUrl && selected.audioUrl === currentAsQueueItem.audioUrl)
    ));

    this.queue = remaining;
    if (currentAsQueueItem && !isSameAsCurrent) {
      this.queue.unshift(currentAsQueueItem);
    }

    this.loadEpisode(selected, 0, { autoplay: true });

    this._persistQueueStateLocal({
      mode: this.mode,
      currentEpisodeGuid: selected.guid || '',
      updatedAt: new Date().toISOString(),
    });
    this._prefetchUpcomingQueue();
    this._scheduleQueueSync({ immediate: true });
    this._notifyStateChange();
  },

  moveQueueItemUp(index) {
    const idx = Number.isInteger(index) ? index : parseInt(index, 10);
    if (!Number.isFinite(idx) || idx <= 0 || idx >= this.queue.length) return;
    this.reorderQueue(idx, idx - 1);
  },

  moveQueueItemDown(index) {
    const idx = Number.isInteger(index) ? index : parseInt(index, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= this.queue.length - 1) return;
    this.reorderQueue(idx, idx + 1);
  },

  reorderQueue(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex > this.queue.length) return;
    console.log(`[player] Reorder queue: ${fromIndex} → ${toIndex}`);
    const [item] = this.queue.splice(fromIndex, 1);
    const normalizedTarget = Math.max(0, Math.min(toIndex, this.queue.length));
    this.queue.splice(normalizedTarget, 0, item);
    this._persistQueueStateLocal();
    this._prefetchUpcomingQueue();
    this._scheduleQueueSync();
    this._notifyStateChange();
  },

  _prefetchUpcomingQueue() {
    if (this.mode !== 'local' || !window.cacheManager) return;
    window.cacheManager.prefetchEpisodes(this.queue, 2).catch((err) => {
      console.warn('[player] Queue prefetch failed:', err?.message || err);
    });
  },

  _clearEpisodeCache(episode) {
    if (!window.cacheManager || !episode) return;
    window.cacheManager.deleteEpisode(episode).catch((err) => {
      console.warn('[player] Failed to clear episode cache:', err?.message || err);
    });
  },

  _enterIdleState() {
    this.isPlaying = false;
    this.position = 0;
    this.duration = 0;
    this.lastSyncPosition = 0;
    this.skippedSeconds = 0;
    this.currentEpisode = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this._persistQueueStateLocal({ currentEpisodeGuid: '', updatedAt: new Date().toISOString() });
    this._notifyStateChange();
  },

  _attemptQueuedAutoplay() {
    if (this.mode !== 'local') return;
    const tryPlay = () => {
      clearTimeout(this._queueAutoplayTimer);
      this._queueAutoplayTimer = null;
      if (this.mode !== 'local' || !this.audio.src) return;
      this.play();
    };

    if (this.audio.readyState >= 2) {
      tryPlay();
      return;
    }

    const onReady = () => {
      this.audio.removeEventListener('canplay', onReady);
      this.audio.removeEventListener('loadeddata', onReady);
      tryPlay();
    };

    this.audio.addEventListener('canplay', onReady, { once: true });
    this.audio.addEventListener('loadeddata', onReady, { once: true });
    this._queueAutoplayTimer = setTimeout(onReady, 1200);
  },

  // ─── Internal Event Handlers ──────────────────────────────
  _onTimeUpdate() {
    this.position = this.audio.currentTime || 0;
    this.duration = this.audio.duration || this.duration;

    // Check 95% threshold or within 15 seconds of end to mark as played
    const playedRatio = this.duration > 0 ? this.position / this.duration : 0;
    const nearEnd = this.duration > 0 && (this.position >= this.duration - 15);
    
    if (this.duration > 0 && (playedRatio >= 0.95 || nearEnd)) {
      if (this.currentEpisode && !this.currentEpisode._markedPlayed && !this.currentEpisode._markingPlayed) {
        console.log(`[player] Episode 95%+ complete or within 15s of end: ${this.currentEpisode.title} (${Math.round(playedRatio * 100)}%, ${this.position.toFixed(1)}s / ${this.duration.toFixed(1)}s)`);
        this._markPlayed(this.currentEpisode, { force: true });
      }
    }

    this._persistPlaybackSnapshot();
    this._notifyStateChange();
  },

  _onEnded() {
    console.log('[player] Episode ended:', this.currentEpisode?.title);
    this.duration = this.audio.duration || this.duration || 0;
    this.position = this.duration > 0 ? this.duration : (this.audio.currentTime || this.position || 0);

    if (this.currentEpisode && !this.currentEpisode._markedPlayed && !this.currentEpisode._markingPlayed) {
      this._markPlayed(this.currentEpisode, { force: true, position: this.position, duration: this.duration });
    }
    this.isPlaying = false;
    this._notifyStateChange();

    this._advanceQueueAfterCompletion();
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

    // Cast progress is persisted server-side via cast status callbacks.
    // Here we only flush skipped-time stats from local user actions.
    if (this.mode === 'cast') {
      if (this.skippedSeconds > 0) {
        try {
          await api.updateStats(guid, 0, Math.floor(this.skippedSeconds));
          this.skippedSeconds = 0;
        } catch (err) {
          console.error('[player] _syncProgress cast skipped-stats error:', err);
        }
      }
      this.lastSyncPosition = pos;
      return;
    }

    try {
      const nextProgress = {
        position: pos,
        duration: dur,
        played: false,
        feedId: episode.feedId,
        updatedAt: new Date().toISOString(),
      };
      await api.updateProgress(guid, episode.guid, nextProgress);
      if (window.setEpisodeProgressState) {
        window.setEpisodeProgressState(episode.guid, nextProgress);
      }

      await api.updatePlaybackSession(guid, this._buildPlaybackSnapshot({
        position: pos,
        duration: dur,
      }));

      // Listened stats are derived server-side from updateProgress deltas.
      // Only sync skipped time explicitly.
      if (this.skippedSeconds > 0) {
        await api.updateStats(guid, 0, Math.floor(this.skippedSeconds));
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
      const nextProgress = {
        position: finalPosition,
        duration: finalDuration,
        played: true,
        feedId: episode.feedId,
        updatedAt: new Date().toISOString(),
      };
      await api.updateProgress(guid, episode.guid, nextProgress);

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
      if (this.skippedSeconds > 0) {
        await api.updateStats(guid, 0, Math.floor(this.skippedSeconds));
        this.skippedSeconds = 0;
      }
      episode._markedPlayed = true;
      if (window.setEpisodeProgressState) {
        window.setEpisodeProgressState(episode.guid, nextProgress);
      }
      await api.clearPlaybackSession(guid, episode.guid).catch((err) => {
        console.warn('[player] Failed to clear playback session after completion:', err);
      });
      this._clearPersistedPlaybackSession({ episodeGuid: episode.guid });
      this.lastSyncPosition = finalPosition;
      console.log('[player] Episode marked as played:', episode.title);
      this._clearEpisodeCache(episode);
    } catch (err) {
      console.error('[player] _markPlayed error:', err);
    } finally {
      episode._markingPlayed = false;
    }
  },

  _buildPlaybackSnapshot(overrides = {}) {
    const guid = localStorage.getItem('podwaffle_guid');
    const episode = this.currentEpisode;
    if (!guid || !episode || this.mode !== 'local') return null;

    return {
      guid,
      episodeGuid: episode.guid,
      feedId: episode.feedId || '',
      title: episode.title || '',
      podcastTitle: episode.podcastTitle || '',
      audioUrl: episode.audioUrl || '',
      podcastImageUrl: episode.podcastImageUrl || episode.imageUrl || '',
      imageUrl: episode.imageUrl || episode.podcastImageUrl || '',
      position: Math.max(0, Math.floor(overrides.position ?? this.position ?? this.audio.currentTime ?? 0)),
      duration: Math.max(0, Math.floor(overrides.duration ?? this.duration ?? this.audio.duration ?? 0)),
      isPlaying: this.isPlaying,
      mode: this.mode,
      updatedAt: overrides.updatedAt || new Date().toISOString(),
    };
  },

  _persistPlaybackSnapshot(options = {}) {
    const force = !!options.force;
    const snapshot = this._buildPlaybackSnapshot(options);
    if (!snapshot) return;

    const now = Date.now();
    if (!force && now - this._lastPlaybackSnapshotAt < 5000) {
      return;
    }

    this._lastPlaybackSnapshotAt = now;
    try {
      localStorage.setItem('podwaffle_playback_session', JSON.stringify(snapshot));
    } catch (err) {
      console.warn('[player] Failed to persist local playback snapshot:', err);
    }
  },

  _clearPersistedPlaybackSession(options = {}) {
    const guid = localStorage.getItem('podwaffle_guid');
    const episodeGuid = options.episodeGuid;

    try {
      const raw = localStorage.getItem('podwaffle_playback_session');
      if (raw) {
        const existing = JSON.parse(raw);
        if (!episodeGuid || existing?.episodeGuid === episodeGuid) {
          localStorage.removeItem('podwaffle_playback_session');
        }
      }
    } catch (_) {
      localStorage.removeItem('podwaffle_playback_session');
    }

    if (options.keepalive && guid) {
      api.clearPlaybackSession(guid, episodeGuid, { keepalive: true }).catch(() => {});
    }
  },

  _flushPlaybackSnapshot(options = {}) {
    if (this.mode !== 'local' || !this.currentEpisode || this.currentEpisode._markedPlayed) {
      return;
    }

    const guid = localStorage.getItem('podwaffle_guid');
    const snapshot = this._buildPlaybackSnapshot();
    if (!guid || !snapshot) return;

    this._persistPlaybackSnapshot({ force: true });

    const requestOptions = options.keepalive ? { keepalive: true } : {};
    api.updateProgress(guid, this.currentEpisode.guid, {
      position: snapshot.position,
      duration: snapshot.duration,
      played: false,
      feedId: this.currentEpisode.feedId,
    }, requestOptions).catch((err) => {
      console.warn('[player] Failed to flush playback progress:', err);
    });

    api.updatePlaybackSession(guid, snapshot, requestOptions).catch((err) => {
      console.warn('[player] Failed to flush playback session:', err);
    });

    if (this.skippedSeconds > 0 && !options.keepalive) {
      api.updateStats(guid, 0, Math.floor(this.skippedSeconds)).then(() => {
        this.skippedSeconds = 0;
      }).catch((err) => {
        console.warn('[player] Failed to flush skipped stats:', err);
      });
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

  _normalizeNativeAction(value) {
    if (!value) return '';
    return String(value).toLowerCase();
  },

  _getNativeMediaSessionPlugin() {
    if (this._nativeMediaSession) return this._nativeMediaSession;

    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
      return null;
    }

    const plugin = cap.Plugins?.MediaSession || null;
    if (!plugin) {
      return null;
    }

    this._nativeMediaSession = plugin;
    return plugin;
  },

  async _initNativeMediaSession() {
    const plugin = this._getNativeMediaSessionPlugin();
    if (!plugin) return;
    if (this._nativeMediaInitialized) return;

    try {
      await plugin.setActionHandler({ action: 'play' }, () => {
        this.play();
      });
      await plugin.setActionHandler({ action: 'pause' }, () => {
        this.pause();
      });
      await plugin.setActionHandler({ action: 'seekbackward' }, (details) => {
        const offset = this.skipBackSecs;
        this.seek(this.position - offset);
      });
      await plugin.setActionHandler({ action: 'seekforward' }, (details) => {
        const offset = this.skipForwardSecs;
        this.seek(this.position + offset);
      });
      this._nativeMediaInitialized = true;

      console.log('[player] Native MediaSession bridge initialized.');
    } catch (err) {
      console.warn('[player] Failed to initialize native MediaSession bridge:', err);
    }
  },

  async _syncNativeMediaSession() {
    const plugin = this._getNativeMediaSessionPlugin();
    if (!plugin) return;

    await this._initNativeMediaSession();

    const episode = this.currentEpisode;
    if (!episode) {
      try {
        await plugin.setPlaybackState({ playbackState: 'none' });
      } catch (_) {}
      return;
    }

    // Playback state must be updated even if metadata/artwork fetch fails,
    // otherwise Android won't show notification controls.
    try {
      await plugin.setPlaybackState({
        playbackState: this.isPlaying ? 'playing' : 'paused',
      });
    } catch (err) {
      console.warn('[player] Native MediaSession playback state sync failed:', err);
    }

    try {
      await plugin.setMetadata({
        title: episode.title || 'Unknown',
        artist: episode.podcastTitle || 'Podwaffle',
        album: 'Podwaffle',
        artwork: this._getMediaSessionArtwork(episode),
      });
    } catch (err) {
      console.warn('[player] Native MediaSession metadata sync failed (retrying without artwork):', err);
      try {
        await plugin.setMetadata({
          title: episode.title || 'Unknown',
          artist: episode.podcastTitle || 'Podwaffle',
          album: 'Podwaffle',
          artwork: [],
        });
      } catch (metaErr) {
        console.warn('[player] Native MediaSession metadata fallback failed:', metaErr);
      }
    }

    try {
      if (this.duration > 0) {
        await plugin.setPositionState({
          duration: this.duration,
          playbackRate: this.audio.playbackRate || 1,
          position: Math.max(0, Math.min(this.position || 0, this.duration)),
        });
      }
    } catch (err) {
      console.warn('[player] Native MediaSession position sync failed:', err);
    }
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
    navigator.mediaSession.setActionHandler('previoustrack', null);
    navigator.mediaSession.setActionHandler('nexttrack', null);
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) player.seek(details.seekTime);
    });

    console.log('[player] MediaSession updated for:', episode.title);

    this._syncNativeMediaSession();
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

    this._syncNativeMediaSession();
  },

  onStateChange(handler) {
    this._stateHandlers.push(handler);
  },

  offStateChange(handler) {
    this._stateHandlers = this._stateHandlers.filter(h => h !== handler);
  },

  // ─── Cast switching ──────────────────────────────────────
  async switchToCast(deviceId) {
    console.log('[player] Switching to cast device:', deviceId || '(chooser)');
    const wasPlaying = this.isPlaying;
    const pos = this._sanitizeStartPosition(this.currentEpisode, this.position);

    this._flushPlaybackSnapshot();

    const useBrowserSender = !!(window.googleCastSender && window.googleCastSender.isSupported());
    let resolvedDeviceId = deviceId || null;
    if (useBrowserSender) {
      const sessionDevice = await window.googleCastSender.ensureSession();
      resolvedDeviceId = sessionDevice?.id || resolvedDeviceId || 'google-cast';
    }

    if (!useBrowserSender) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    } else {
      this.audio.pause();
    }

    this.mode = 'cast';
    this._activeCastDeviceId = resolvedDeviceId;
    this._clearPersistedPlaybackSession({
      episodeGuid: this.currentEpisode?.guid,
      keepalive: true,
    });

    if (!this.currentEpisode) {
      this.isPlaying = false;
      this.position = 0;
      this.duration = 0;
      this._notifyStateChange();
      console.log('[player] Cast mode active with no episode loaded yet');
      return;
    }

    try {
      if (useBrowserSender) {
        await window.googleCastSender.loadEpisode(this.currentEpisode, pos);
      } else {
        await api.castPlay(
          resolvedDeviceId,
          this.currentEpisode.audioUrl,
          pos,
          this.currentEpisode.guid,
          localStorage.getItem('podwaffle_guid'),
          this.currentEpisode.title,
          this.currentEpisode.podcastTitle,
          this.currentEpisode.podcastImageUrl || this.currentEpisode.imageUrl,
          this.currentEpisode.duration || this.duration || 0
        );
      }
      this.isPlaying = true;
      this._notifyStateChange();
      console.log('[player] Cast started on device:', resolvedDeviceId);
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
      if (window.googleCastSender && window.googleCastSender.isConnected()) {
        await window.googleCastSender.stop();
      }

      // Always force backend cast teardown and mirrored state cleanup as a safety net
      await Promise.allSettled([
        api.castStop(),
        (window.api && typeof window.api.clearCastState === 'function')
          ? window.api.clearCastState(localStorage.getItem('podwaffle_guid'))
          : Promise.resolve(),
      ]);
    } catch (err) {
      console.warn('[player] castStop error (continuing anyway):', err);
    }

    this.mode = 'local';
    this._activeCastDeviceId = null;
    if (this.currentEpisode && this.currentEpisode.audioUrl) {
      const resumePos = Math.max(0, Math.floor(pos || 0));
      this._setAudioSource(this.currentEpisode.audioUrl, resumePos);
    }
    this.play();
  },
};

window.player = player;
player.init();
