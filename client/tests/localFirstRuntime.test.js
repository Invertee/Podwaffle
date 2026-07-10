'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(clientRoot, 'js', 'localFirstRuntime.js'), 'utf8');
const metrics = fs.readFileSync(path.join(clientRoot, 'js', 'layoutMetricsV2.js'), 'utf8');

test('client shell loads the stable layout and local-first runtime before app startup', () => {
  const metricsIndex = index.indexOf('js/layoutMetricsV2.js');
  const runtimeIndex = index.indexOf('js/localFirstRuntime.js');
  const appIndex = index.indexOf('js/app.js');
  assert.ok(metricsIndex >= 0);
  assert.ok(runtimeIndex > metricsIndex);
  assert.ok(appIndex > runtimeIndex);
  assert.doesNotMatch(index, /js\/layoutMetrics\.js/);
});

test('layout metrics observer does not watch style or class attributes', () => {
  assert.match(metrics, /childList:\s*true,\s*subtree:\s*true/);
  assert.doesNotMatch(metrics, /attributeFilter/);
  assert.doesNotMatch(metrics, /attributes:\s*true/);
  assert.match(metrics, /getPropertyValue\(name\) !== next/);
});

test('route reads are local-first and backend work is scheduled', () => {
  assert.match(runtime, /api\.getSubscriptions = function getSubscriptionsLocalFirst/);
  assert.match(runtime, /api\.getProgress = function getProgressLocalFirst/);
  assert.match(runtime, /api\.getPodcast = function getPodcastLocalFirst/);
  assert.match(runtime, /api\.ensureUserOnBackend = function ensureUserOnBackendInBackground/);
  assert.match(runtime, /scheduleSync\(guid, 'profile-route'\)/);
  assert.match(runtime, /return Promise\.resolve\(localSubscriptions\(guid\)\)/);
  assert.match(runtime, /return Promise\.resolve\(localProfile\(guid\)\?\.progress \|\| \{\}\)/);
});
