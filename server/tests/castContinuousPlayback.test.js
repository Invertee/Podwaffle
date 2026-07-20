'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const service = fs.readFileSync(path.join(__dirname, '..', 'services', 'castService.js'), 'utf8');
const player = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'player.js'), 'utf8');

test('same-device episode replacement reuses the active Cast receiver', () => {
  assert.match(service, /state\.activeDeviceId === deviceId[\s\S]*state\.player\.load\(mediaInfo/);
  assert.match(service, /reusedSession: true/);
  assert.match(service, /mediaLoadInProgress && mappedStatus === 'idle'/);
});

test('the client ignores transient idle while a Cast media load is pending', () => {
  assert.match(player, /this\._castStartInFlight && nextStatus === 'idle'/);
});
