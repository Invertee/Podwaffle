'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storage = new Map();
global.localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

let online = true;
const feedUrl = 'https://example.com/feed.xml';
const feedId = 'server-feed-id';

global.window = {
  api: {
    async getSubscriptions() {
      return online
        ? [{ feedId, feedUrl, title: 'Example Show', imageUrl: 'https://example.com/art.jpg' }]
        : [feedUrl];
    },
    async getPodcast(_feedId, limit, offset) {
      if (!online) throw new Error('offline');
      const episodes = offset === 0
        ? [{ guid: 'ep-1', title: 'One', audioUrl: 'https://example.com/1.mp3' }]
        : [{ guid: 'ep-2', title: 'Two', audioUrl: 'https://example.com/2.mp3' }];
      return {
        feedId,
        feedUrl,
        title: 'Example Show',
        imageUrl: 'https://example.com/art.jpg',
        episodes: episodes.slice(0, limit),
        totalEpisodes: 2,
      };
    },
    async subscribe() { return { ok: true }; },
    async unsubscribe() { return { ok: true }; },
  },
  cacheManager: {
    _cacheIndex: {},
    TTL_MS: 1,
    _resolveUrl: (episode) => episode.audioUrl,
    async downloadEpisode() { return 'cached'; },
    async deleteEpisode() { return true; },
    _isExpired: () => true,
    isSupported: () => true,
    async _getCache() {
      return { keys: async () => [], delete: async () => true };
    },
    _setStatus() {},
    _saveIndex() {},
  },
};

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'offlineStore.js'), 'utf8');
vm.runInThisContext(source, { filename: 'offlineStore.js' });

(async () => {
  let subscriptions = await window.api.getSubscriptions('user-1');
  assert.equal(subscriptions[0].title, 'Example Show');
  assert.equal(subscriptions[0].feedId, feedId);

  await window.api.getPodcast(feedId, 1, 0);
  await window.api.getPodcast(feedId, 1, 1);

  online = false;
  subscriptions = await window.api.getSubscriptions('user-1');
  assert.equal(subscriptions[0].title, 'Example Show');
  assert.equal(subscriptions[0].feedId, feedId);

  const firstPage = await window.api.getPodcast(feedId, 1, 0);
  const secondPage = await window.api.getPodcast(feedId, 1, 1);
  assert.equal(firstPage.episodes[0].guid, 'ep-1');
  assert.equal(secondPage.episodes[0].guid, 'ep-2');

  const episode = {
    guid: 'ep-1',
    feedId,
    podcastTitle: 'Example Show',
    audioUrl: 'https://example.com/1.mp3',
  };
  await window.cacheManager.downloadEpisode(episode);
  assert.equal(window.offlineStore.isAudioPinned(episode.audioUrl), true);
  assert.equal(window.cacheManager._isExpired(episode.audioUrl), false);

  await window.cacheManager.deleteEpisode(episode);
  assert.equal(window.offlineStore.isAudioPinned(episode.audioUrl), false);

  console.log('offlineStore tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
