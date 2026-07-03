/* ============================================================
   Podwaffle — googleCastSender.js
   Browser Google Cast sender integration for Edge/Chrome.
   Mirrors cast state back to the backend for synced control.
   ============================================================ */

const googleCastSender = {
  _initialized: false,
  _available: false,
  _castContext: null,
  _remotePlayer: null,
  _remotePlayerController: null,
  _listeners: {},
  _mediaMeta: null,
  _lastMirroredState: null,
  _lastMirrorAt: 0,
  _lastPersistAt: 0,
  _lastPersistedPosition: 0,
  _lastPersistedStatus: 'idle',
  _lastKnownStatus: 'idle',
  _lastStateKey: '',

  init() {
    const previousHandler = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable) => {
      if (typeof previousHandler === 'function') {
        try { previousHandler(isAvailable); } catch (_) {}
      }
      this._available = !!isAvailable;
      if (isAvailable) {
        this._initializeFramework();
      } else {
        this._dispatch('availability', { available: false });
      }
    };

    if (window.cast && window.cast.framework && window.chrome && window.chrome.cast) {
      this._available = true;
      this._initializeFramework();
    }
  },

  _initializeFramework() {
    if (this._initialized || !(window.cast && window.cast.framework && window.chrome && window.chrome.cast)) {
      return;
    }

    this._castContext = cast.framework.CastContext.getInstance();
    this._castContext.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      resumeSavedSession: true,
    });

    this._remotePlayer = new cast.framework.RemotePlayer();
    this._remotePlayerController = new cast.framework.RemotePlayerController(this._remotePlayer);

    const playerEvents = [
      cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
      cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
      cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
      cast.framework.RemotePlayerEventType.DURATION_CHANGED,
      cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
      cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
      cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED,
    ];

    playerEvents.forEach((eventType) => {
      this._remotePlayerController.addEventListener(eventType, () => {
        this._handleRemoteStateChange();
      });
    });

    this._castContext.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (event) => this._handleSessionStateChanged(event)
    );

    this._initialized = true;
    this._dispatch('availability', { available: true });
    this._handleRemoteStateChange({ forceMirror: true });
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
    return !!(this._available && this._initialized && this._castContext);
  },

  isConnected() {
    return !!(this._remotePlayer && this._remotePlayer.isConnected);
  },

  getAvailability() {
    const device = this.getCurrentDevice();
    return {
      supported: this.isSupported(),
      connected: this.isConnected(),
      device,
      state: this._buildStatePayload(),
    };
  },

  getCurrentSession() {
    return this._castContext ? this._castContext.getCurrentSession() : null;
  },

  getCurrentDevice() {
    const session = this.getCurrentSession();
    const device = session && typeof session.getCastDevice === 'function' ? session.getCastDevice() : null;
    if (!device) return null;
    return {
      id: device.deviceId || device.friendlyName || 'google-cast',
      name: device.friendlyName || device.modelName || 'Google Cast device',
      modelName: device.modelName || '',
    };
  },

  async requestSession() {
    if (!this.isSupported()) {
      throw new Error('Google Cast is not available in this browser context');
    }

    await this._castContext.requestSession();
    this._handleRemoteStateChange({ forceMirror: true });
    return this.getCurrentDevice();
  },

  async ensureSession() {
    if (this.isConnected()) {
      return this.getCurrentDevice();
    }
    return this.requestSession();
  },

  _restoreMirroredState() {
    if (!window.api || typeof window.api.getCastState !== 'function') return null;
    return window.api.getCastState().catch(() => null);
  },

  async syncFromServerState() {
    const mirrored = await this._restoreMirroredState();
    if (!mirrored || !mirrored.activeDeviceId) return null;

    this._lastMirroredState = mirrored;
    this._mediaMeta = {
      guid: mirrored.episodeGuid || '',
      feedId: mirrored.feedId || '',
      title: mirrored.title || 'Podwaffle',
      podcastTitle: mirrored.podcastTitle || '',
      imageUrl: mirrored.imageUrl || '',
      audioUrl: mirrored.mediaUrl || '',
      duration: Number.isFinite(Number(mirrored.duration)) ? Number(mirrored.duration) : 0,
    };
    this._lastKnownStatus = mirrored.status || this._lastKnownStatus;

    this._dispatch('statechange', {
      deviceId: mirrored.activeDeviceId,
      ...mirrored,
    });

    return mirrored;
  },

  async loadEpisode(episode, startPosition = 0) {
    if (!episode || !episode.audioUrl) {
      throw new Error('Cannot cast episode without audioUrl');
    }

    await this.ensureSession();
    const session = this.getCurrentSession();
    if (!session) {
      throw new Error('Cast session is not available');
    }

    this._mediaMeta = {
      guid: episode.guid || '',
      feedId: episode.feedId || '',
      title: episode.title || 'Podwaffle',
      podcastTitle: episode.podcastTitle || '',
      imageUrl: episode.podcastImageUrl || episode.imageUrl || '',
      audioUrl: episode.audioUrl,
      duration: Number.isFinite(Number(episode.duration)) ? Number(episode.duration) : 0,
    };

    const mediaInfo = new chrome.cast.media.MediaInfo(episode.audioUrl, 'audio/mpeg');
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
    if (this._mediaMeta.duration > 0) {
      mediaInfo.duration = this._mediaMeta.duration;
    }

    const metadata = new chrome.cast.media.GenericMediaMetadata();
    metadata.title = this._mediaMeta.title;
    metadata.subtitle = this._mediaMeta.podcastTitle;
    metadata.images = this._mediaMeta.imageUrl ? [new chrome.cast.Image(this._mediaMeta.imageUrl)] : [];
    mediaInfo.metadata = metadata;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    request.currentTime = Math.max(0, Number(startPosition) || 0);

    await session.loadMedia(request);
    this._lastKnownStatus = 'playing';
    await this._mirrorNow({ force: true });
    return this.getCurrentDevice();
  },

  async play() {
    if (!this.isConnected()) return { status: 'idle' };
    if (this._remotePlayer && this._remotePlayer.isPaused) {
      this._remotePlayerController.playOrPause();
    }
    this._lastKnownStatus = 'playing';
    await this._mirrorSoon(true);
    return { status: 'playing' };
  },

  async pause() {
    if (!this.isConnected()) return { status: 'idle' };
    if (this._remotePlayer && !this._remotePlayer.isPaused) {
      this._remotePlayerController.playOrPause();
    }
    this._lastKnownStatus = 'paused';
    await this._mirrorSoon(true);
    return { status: 'paused' };
  },

  async seek(position) {
    if (!this.isConnected()) throw new Error('No active cast session');
    const nextPosition = Math.max(0, Number(position) || 0);
    this._remotePlayer.currentTime = nextPosition;
    this._remotePlayerController.seek();
    await this._mirrorSoon(true);
    return { position: nextPosition };
  },

  async setVolume(level) {
    if (!this.isConnected()) throw new Error('No active cast session');
    const nextLevel = Math.max(0, Math.min(1, Number(level) || 0));
    this._remotePlayer.volumeLevel = nextLevel;
    this._remotePlayerController.setVolumeLevel();
    await this._mirrorSoon(true);
    return { volume: nextLevel };
  },

  async stop() {
    const session = this.getCurrentSession();
    const hadConnection = this.isConnected() || !!session;

    try {
      if (hadConnection && this._castContext && typeof this._castContext.endCurrentSession === 'function') {
        this._castContext.endCurrentSession(true);
      } else if (hadConnection && session && typeof session.endSession === 'function') {
        session.endSession(true);
      }
    } catch (err) {
      console.warn('[googleCastSender] Failed to end cast session cleanly:', err);
    }

    this._lastKnownStatus = 'idle';
    await this._clearMirroredState();
    return { status: 'idle' };
  },

  _handleSessionStateChanged(event) {
    const state = event && event.sessionState;
    if (state === cast.framework.SessionState.NO_SESSION || state === cast.framework.SessionState.SESSION_ENDED) {
      this._clearMirroredState().catch((err) => {
        console.warn('[googleCastSender] Failed to clear mirrored state:', err?.message || err);
      });
    }
    this._handleRemoteStateChange({ forceMirror: true });
    this._dispatch('sessionchange', { sessionState: state, device: this.getCurrentDevice() });
  },

  _deriveStatus() {
    if (!this.isConnected()) return 'idle';
    const playerState = String(this._remotePlayer?.playerState || '').toUpperCase();
    if (playerState === 'PAUSED') return 'paused';
    if (playerState === 'PLAYING' || playerState === 'BUFFERING') return 'playing';
    if (playerState === 'IDLE') return 'idle';
    if (this._remotePlayer?.isPaused) return 'paused';
    return this._lastKnownStatus === 'playing' ? 'playing' : 'paused';
  },

  _buildStatePayload() {
    const device = this.getCurrentDevice();
    const guid = localStorage.getItem('podwaffle_guid') || null;
    const status = this._deriveStatus();
    const fallback = this._lastMirroredState || {};

    if (!device) {
      return {
        activeDeviceId: null,
        deviceName: null,
        ownerGuid: guid,
        mediaUrl: fallback.mediaUrl || this._mediaMeta?.audioUrl || null,
        episodeGuid: fallback.episodeGuid || this._mediaMeta?.guid || null,
        title: fallback.title || this._mediaMeta?.title || null,
        podcastTitle: fallback.podcastTitle || this._mediaMeta?.podcastTitle || null,
        imageUrl: fallback.imageUrl || this._mediaMeta?.imageUrl || null,
        position: 0,
        duration: 0,
        volume: this._remotePlayer?.volumeLevel ?? 1,
        status: 'idle',
        transport: 'google_cast_sender',
        source: 'browser',
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      activeDeviceId: device.id,
      deviceName: device.name,
      ownerGuid: guid,
      mediaUrl: this._mediaMeta?.audioUrl || fallback.mediaUrl || null,
      episodeGuid: this._mediaMeta?.guid || fallback.episodeGuid || null,
      feedId: this._mediaMeta?.feedId || fallback.feedId || '',
      title: this._mediaMeta?.title || fallback.title || null,
      podcastTitle: this._mediaMeta?.podcastTitle || fallback.podcastTitle || null,
      imageUrl: this._mediaMeta?.imageUrl || fallback.imageUrl || null,
      position: Number.isFinite(Number(this._remotePlayer?.currentTime)) ? Number(this._remotePlayer.currentTime) : 0,
      duration: Number.isFinite(Number(this._remotePlayer?.duration)) ? Number(this._remotePlayer.duration) : (this._mediaMeta?.duration || 0),
      volume: Number.isFinite(Number(this._remotePlayer?.volumeLevel)) ? Number(this._remotePlayer.volumeLevel) : 1,
      status,
      transport: 'google_cast_sender',
      source: 'browser',
      updatedAt: new Date().toISOString(),
    };
  },

  _handleRemoteStateChange(options = {}) {
    const payload = this._buildStatePayload();
    this._lastKnownStatus = payload.status || this._lastKnownStatus;

    if (window.player && window.player.mode === 'cast' && typeof window.player.applyCastState === 'function' && payload.activeDeviceId) {
      window.player.applyCastState({
        deviceId: payload.activeDeviceId,
        deviceName: payload.deviceName,
        episodeGuid: payload.episodeGuid,
        title: payload.title,
        podcastTitle: payload.podcastTitle,
        imageUrl: payload.imageUrl,
        position: payload.position,
        duration: payload.duration,
        status: payload.status,
        volume: payload.volume,
      });
    }

    this._dispatch('statechange', payload);
    this._mirrorSoon(!!options.forceMirror);
  },

  async _mirrorSoon(force = false) {
    const delayMs = force ? 0 : 250;
    clearTimeout(this._mirrorTimer);
    this._mirrorTimer = setTimeout(() => {
      this._mirrorNow({ force }).catch((err) => {
        console.warn('[googleCastSender] Failed to mirror state:', err?.message || err);
      });
    }, delayMs);
  },

  async _mirrorNow(options = {}) {
    const payload = this._buildStatePayload();
    this._lastMirroredState = payload;
    const nowMs = Date.now();
    const key = JSON.stringify([
      payload.activeDeviceId,
      payload.episodeGuid,
      Math.floor(payload.position || 0),
      Math.floor(payload.duration || 0),
      payload.status,
      Math.round((payload.volume || 0) * 100),
    ]);

    if (!options.force && key === this._lastStateKey && (nowMs - this._lastMirrorAt) < 1000) {
      return payload;
    }

    this._lastMirrorAt = nowMs;
    this._lastStateKey = key;

    if (window.api && typeof window.api.updateCastState === 'function') {
      await window.api.updateCastState(payload).catch((err) => {
        console.warn('[googleCastSender] updateCastState failed:', err?.message || err);
      });
    }

    await this._persistUserState(payload, options.force);
    return payload;
  },

  async _persistUserState(payload, force = false) {
    const guid = payload.ownerGuid;
    if (!guid || !window.api || !payload.episodeGuid) return;

    const nowMs = Date.now();
    const moved = Math.abs((payload.position || 0) - (this._lastPersistedPosition || 0));
    const statusChanged = payload.status !== this._lastPersistedStatus;
    const shouldPersist = force || statusChanged || moved >= 15 || (nowMs - this._lastPersistAt) >= 5000;
    if (!shouldPersist) return;

    this._lastPersistAt = nowMs;
    this._lastPersistedPosition = payload.position || 0;
    this._lastPersistedStatus = payload.status || 'idle';

    const updatedAt = payload.updatedAt || new Date().toISOString();
    const session = {
      episodeGuid: payload.episodeGuid,
      feedId: payload.feedId || this._mediaMeta?.feedId || '',
      title: payload.title || '',
      podcastTitle: payload.podcastTitle || '',
      audioUrl: payload.mediaUrl || '',
      podcastImageUrl: payload.imageUrl || '',
      imageUrl: payload.imageUrl || '',
      position: payload.position || 0,
      duration: payload.duration || 0,
      isPlaying: payload.status === 'playing',
      mode: 'cast',
      transport: 'google_cast_sender',
      castDeviceId: payload.activeDeviceId || '',
      castDeviceName: payload.deviceName || '',
      updatedAt,
    };

    await window.api.updatePlaybackSession(guid, session).catch((err) => {
      console.warn('[googleCastSender] updatePlaybackSession failed:', err?.message || err);
    });

    const progressPayload = {
      position: payload.position || 0,
      duration: payload.duration || 0,
      played: payload.status === 'idle' && payload.duration > 0 && (payload.position >= Math.max(payload.duration - 10, payload.duration * 0.95)),
      feedId: payload.feedId || this._mediaMeta?.feedId || '',
      updatedAt,
    };
    await window.api.updateProgress(guid, payload.episodeGuid, progressPayload).catch((err) => {
      console.warn('[googleCastSender] updateProgress failed:', err?.message || err);
    });
  },

  async _clearMirroredState() {
    clearTimeout(this._mirrorTimer);
    this._mirrorTimer = null;

    const ownerGuid = localStorage.getItem('podwaffle_guid') || null;
    this._lastStateKey = '';
    this._lastKnownStatus = 'idle';
    this._mediaMeta = null;
    this._lastMirroredState = null;

    if (window.api && typeof window.api.clearCastState === 'function') {
      await window.api.clearCastState(ownerGuid).catch((err) => {
        console.warn('[googleCastSender] clearCastState failed:', err?.message || err);
      });
    }

    this._dispatch('statechange', {
      activeDeviceId: null,
      deviceName: null,
      ownerGuid,
      status: 'idle',
      position: 0,
      duration: 0,
      volume: this._remotePlayer?.volumeLevel ?? 1,
    });
  },
};

window.googleCastSender = googleCastSender;
googleCastSender.init();