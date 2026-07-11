'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(clientRoot, 'sw.js'), 'utf8');

test('subscription repair loads after local-first runtime and before app startup', () => {
  const runtimeIndex = indexHtml.indexOf('js/localFirstRuntime.js');
  const repairIndex = indexHtml.indexOf('js/subscriptionSyncRepair.js');
  const appIndex = indexHtml.indexOf('js/app.js');

  assert.ok(runtimeIndex >= 0);
  assert.ok(repairIndex > runtimeIndex);
  assert.ok(appIndex > repairIndex);
});

test('service worker precaches the subscription repair and uses a fresh shell version', () => {
  assert.match(serviceWorker, /podwaffle-shell-v7/);
  assert.match(serviceWorker, /\.\/js\/subscriptionSyncRepair\.js/);
  assert.match(serviceWorker, /\.\/js\/localFirstRuntime\.js/);
});
