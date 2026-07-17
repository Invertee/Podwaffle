'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'js', 'api.js'), 'utf8');
const socket = fs.readFileSync(path.join(root, 'js', 'castClient.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js', 'player.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('client shell uses the single server API and offline store', () => {
  assert.ok(index.indexOf('js/api.js') < index.indexOf('js/offlineStore.js'));
  assert.ok(index.indexOf('js/offlineStore.js') < index.indexOf('js/app.js'));
  for (const removed of ['syncManager', 'localFirstRuntime', 'subscriptionSyncRepair', 'podcastDataRuntimeV2', 'podcastDataRuntimeV3', 'feedRefreshScheduler']) {
    assert.doesNotMatch(index, new RegExp(removed));
    assert.doesNotMatch(worker, new RegExp(removed));
  }
  assert.match(worker, /podwaffle-shell-v8/);
});

test('server API defaults to same-origin and authenticates requests', () => {
  assert.match(api, /X-Podwaffle-Key/);
  assert.match(api, /_sameOriginBasePath/);
  assert.doesNotMatch(api, /_handleLocalRequest/);
  assert.doesNotMatch(api, /corsproxy\.io/);
});

test('websocket is primary and HTTP Cast polling is fallback-only', () => {
  assert.match(socket, /this\._stopStatePolling\(\);[\s\S]*this\._startHealthMonitoring\(\)/);
  assert.match(socket, /if \(!this\._intentionalClose\) this\._startStatePolling\(\)/);
  assert.match(socket, /accessKey/);
  assert.match(socket, /60000/);
});

test('local playback starts a durable device download', () => {
  assert.match(player, /cacheManager\?\.downloadEpisode\?\.\(episode\)/);
});
