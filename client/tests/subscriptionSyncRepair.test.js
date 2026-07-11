'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function createRuntime() {
  const storage = new Map();
  const listeners = new Map();
  const api = {
    getServerConnectionConfig: () => ({ enabled: false, host: '' }),
    getSubscriptions: async () => [],
    subscribe: async (_guid, feedUrl) => ({
      feedId: '0123456789abcdef0123456789abcdef',
      feedUrl,
      title: 'Server title',
      imageUrl: 'https://img.example/show.jpg',
    }),
    _makeFeedId: (url) => `slug-${url.length}`,
    _searchAppleCatalog: async () => [],
    search: async () => [],
    _saveCachedPodcasts: (items) => items,
    _mapApplePodcastResult: (item) => item,
  };
  const context = {
    console,
    URL,
    AbortController,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => [] }),
    window: {
      api,
      syncManager: {
        getLocalState: async () => ({ subscriptions: [] }),
        performSync: async () => ({ ok: true }),
      },
      offlineStore: { rememberPodcast() {} },
      appState: { guid: 'g', user: {}, subscriptions: [] },
      localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
      addEventListener: (type, fn) => listeners.set(type, fn),
      dispatchEvent: () => {},
      location: { hash: '#/podcasts' },
      document: { getElementById: () => null },
    },
  };
  context.window.window = context.window;
  vm.createContext(context);
  const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'subscriptionSyncRepair.js'), 'utf8');
  vm.runInContext(script, context);
  return { context, api, storage };
}

test('deduplicates string and metadata versions of the same feed URL', () => {
  const { api } = createRuntime();
  const result = api.__subscriptionSyncRepair.dedupeSubscriptions([
    'https://example.com/feed.xml',
    { feedId: 'client-slug', feedUrl: 'https://example.com/feed.xml', title: 'Example', imageUrl: 'https://img.example/a.jpg' },
    { feedId: '0123456789abcdef0123456789abcdef', feedUrl: 'https://example.com/feed.xml', title: null, imageUrl: null },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].feedId, '0123456789abcdef0123456789abcdef');
  assert.equal(result[0].title, 'Example');
  assert.equal(result[0].imageUrl, 'https://img.example/a.jpg');
});

test('sync payload contains canonical feed URL strings only', () => {
  const { context } = createRuntime();
  assert.deepEqual(
    Array.from(context.window.api.__subscriptionSyncRepair.subscriptionUrls([
      { feedUrl: 'https://example.com/feed.xml' },
      'https://example.com/feed.xml',
      { feedUrl: 'https://another.example/rss' },
    ])),
    ['https://example.com/feed.xml', 'https://another.example/rss']
  );
});

test('subscribe reconciliation prefers the server feed id and metadata', async () => {
  const { api, storage } = createRuntime();
  await api.subscribe('g', 'https://example.com/feed.xml', {
    feedId: 'client-slug',
    feedUrl: 'https://example.com/feed.xml',
    title: 'Search title',
  });
  const saved = JSON.parse(storage.get('podwaffle_subscriptions_g'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].feedId, '0123456789abcdef0123456789abcdef');
  assert.equal(saved[0].title, 'Server title');
});
