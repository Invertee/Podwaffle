'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRuntime() {
  const storage = new Map();
  let online = true;
  const remoteProgress = [];
  const noop = async () => ({ ok: true });
  const api = {
    getBootstrapSyncState: async () => ({ guid: 'sam', snapshot: { guid: 'sam', progress: {}, subscriptions: [] } }),
    getUser: async () => ({ guid: 'sam', name: 'Sam', subscriptions: [], progress: {}, settings: {}, stats: {} }),
    getSubscriptions: async () => [], getProgress: async () => ({}), getPlaybackSession: async () => null,
    getQueue: async () => ({ queue: [] }), getHistory: async () => [], getStats: async () => ({}),
    getPodcast: async () => ({ feedId: 'show', title: 'Show', episodes: [{ guid: 'one', audioUrl: 'https://media/one.mp3' }] }),
    updateProgress: async (...args) => {
      if (!online) throw new TypeError('offline');
      remoteProgress.push(args);
      return args[2];
    },
    updateSettings: noop, subscribe: noop, unsubscribe: noop, reorderSubscriptions: noop,
    updatePlaybackSession: noop, clearPlaybackSession: noop, updateQueue: noop, addHistory: noop,
    updateStats: noop, markEpisodesSeen: noop,
  };
  const listeners = {};
  const root = {
    api,
    cacheManager: {
      _resolveUrl: (episode) => episode.audioUrl,
      downloadEpisode: async () => 'cached',
      deleteEpisode: async () => true,
      _isExpired: () => true,
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    dispatchEvent() {},
  };
  const context = {
    window: root,
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    navigator: { onLine: true },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    console,
    URL,
    setTimeout,
    clearTimeout,
  };
  root.window = root;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'offlineStore.js'), 'utf8'), context);
  return { root, remoteProgress, setOnline(value) { online = value; context.navigator.onLine = value; } };
}

test('caches server state and replays offline mutations through one outbox', async () => {
  const runtime = createRuntime();
  const user = await runtime.root.api.getUser('sam');
  assert.equal(user.name, 'Sam');

  runtime.setOnline(false);
  await runtime.root.api.updateProgress('sam', 'episode-1', { position: 42, updatedAt: '2026-01-01T00:00:00Z' });
  assert.equal(runtime.root.offlineStore.getStatus().queuedMutations, 1);
  assert.equal(runtime.root.offlineStore.cachedProfile('sam').progress['episode-1'].position, 42);

  runtime.setOnline(true);
  await runtime.root.offlineStore.flushOutbox();
  assert.equal(runtime.remoteProgress.length, 1);
  assert.equal(runtime.root.offlineStore.getStatus().queuedMutations, 0);
});

test('explicit episode downloads remain pinned', async () => {
  const { root } = createRuntime();
  const episode = { guid: 'one', feedId: 'show', audioUrl: 'https://media/one.mp3' };
  await root.cacheManager.downloadEpisode(episode);
  assert.equal(root.offlineStore.isAudioPinned(episode.audioUrl), true);
  assert.equal(root.cacheManager._isExpired(episode.audioUrl), false);
  await root.cacheManager.deleteEpisode(episode);
  assert.equal(root.offlineStore.isAudioPinned(episode.audioUrl), false);
});
