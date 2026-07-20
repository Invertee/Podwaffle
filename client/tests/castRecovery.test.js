'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'castRecovery.js'), 'utf8');

function createContext() {
  const values = new Map();
  const listeners = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };

  const castClient = {
    _castState: {
      status: 'paused',
      activeDeviceId: 'speaker-1',
      volume: 0.7,
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload);
    },
    isConnected() { return false; },
    send() { return false; },
    _clearIdleTimer() {},
  };

  const audio = {
    src: '',
    currentTime: 0,
    volume: 1,
    playCalls: 0,
    pauseCalls: 0,
    pause() { this.pauseCalls += 1; },
    load() {},
    play() { this.playCalls += 1; return Promise.resolve(); },
  };

  const player = {
    mode: 'cast',
    isPlaying: false,
    position: 321,
    duration: 1800,
    volume: 0.7,
    _localVolume: 0.5,
    _activeCastDeviceId: 'speaker-1',
    _lastCastStatus: 'paused',
    _castStopInProgress: false,
    currentEpisode: {
      guid: 'episode-1',
      title: 'Episode 1',
      podcastTitle: 'Podcast',
      audioUrl: 'https://media.example/episode.mp3',
    },
    audio,
    _setAudioSource(url, position) {
      this.audio.src = url;
      this.audio.currentTime = position;
    },
    _persistQueueStateLocal() {},
    _scheduleQueueSync() {},
    _notifyStateChange() {},
    play() {
      this.isPlaying = true;
      return this.audio.play();
    },
    async switchToLocal() {
      throw new Error('original switchToLocal should be replaced');
    },
  };

  const api = {
    async getCastSession() {
      return {
        session: {
          activeDeviceId: 'speaker-1',
          deviceId: 'speaker-1',
          status: 'idle',
        },
      };
    },
  };

  const googleCastSender = {
    _apiBaseUrl: '',
    _userGuid: 'user-1',
    _currentSession: { activeDeviceId: 'speaker-1', status: 'paused' },
    _resolveApiBaseUrl() {},
    async stop() { throw new Error('original stop should be replaced'); },
  };

  const window = {
    PODWAFFLE_CAST_RECOVERY_CONFIG: {
      stopTimeoutMs: 5,
      idleSessionGraceMs: 0,
      pausedIdleGraceMs: 0,
    },
    api,
    castClient,
    googleCastSender,
    player,
  };
  window.window = window;

  const context = {
    window,
    localStorage,
    console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'castRecovery.js' });
  return { window, player, audio, api, castClient, googleCastSender };
}

test('stale idle server sessions are treated as no active cast session', async () => {
  const { api } = createContext();
  const response = await api.getCastSession();
  assert.equal(response.session, null);
});

test('switching back to local restores position but remains paused', async () => {
  const { player, audio, googleCastSender } = createContext();
  await player.switchToLocal({ stopCast: false, autoplay: false, reason: 'timeout' });

  assert.equal(player.mode, 'local');
  assert.equal(player.isPlaying, false);
  assert.equal(player._activeCastDeviceId, null);
  assert.equal(audio.src, 'https://media.example/episode.mp3');
  assert.equal(audio.currentTime, 321);
  assert.equal(audio.playCalls, 0);
  assert.equal(googleCastSender._currentSession, null);
});

test('stopping an active cast continues playback on the local player', async () => {
  const { player, audio, googleCastSender } = createContext();
  player.isPlaying = true;
  await player.switchToLocal();

  assert.equal(player.mode, 'local');
  assert.equal(player.isPlaying, true);
  assert.equal(player._activeCastDeviceId, null);
  assert.equal(audio.src, 'https://media.example/episode.mp3');
  assert.equal(audio.currentTime, 321);
  assert.equal(audio.playCalls, 1);
  assert.equal(googleCastSender._currentSession, null);
});

test('terminal cast status clears the sender and returns player to local paused mode', async () => {
  const { player, audio, castClient, googleCastSender } = createContext();

  castClient.emit('cast:status', {
    activeDeviceId: 'speaker-1',
    status: 'idle',
    reason: 'timeout',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(player.mode, 'local');
  assert.equal(player.isPlaying, false);
  assert.equal(audio.playCalls, 0);
  assert.equal(googleCastSender._currentSession, null);
  assert.equal(castClient._castState.status, 'idle');
  assert.equal(castClient._castState.activeDeviceId, null);
});
