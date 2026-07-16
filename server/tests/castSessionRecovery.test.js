'use strict';

process.env.PODWAFFLE_DISABLE_CAST_RECOVERY_AUTO = '1';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installCastSessionRecovery } = require('../services/castSessionRecovery');

function createFakeService() {
  const state = {
    activeDeviceId: 'speaker-1',
    deviceId: 'speaker-1',
    episodeGuid: 'episode-1',
    mediaUrl: 'https://media.example/episode.mp3',
    status: 'paused',
  };

  return {
    state,
    service: {
      init() {},
      getState() { return { ...state }; },
      getSession() { return state.activeDeviceId ? { ...state } : null; },
      stop() { return new Promise(() => {}); },
      castTo(deviceId, _userGuid, mediaUrl, _position, _callback, metadata = {}) {
        state.activeDeviceId = deviceId;
        state.deviceId = deviceId;
        state.mediaUrl = mediaUrl;
        state.episodeGuid = metadata.episodeGuid || null;
        state.status = 'connecting';
        return Promise.resolve({ status: 'playing' });
      },
    },
  };
}

test('a hanging stop resolves to forced idle and hides the stale session', async (t) => {
  const { service } = createFakeService();
  const broadcasts = [];
  installCastSessionRecovery(service, {
    stopTimeoutMs: 5,
    pausedTimeoutMs: 1000,
    idleGraceMs: 5,
    watchdogIntervalMs: 2,
  });
  t.after(() => service.__castSessionRecovery.destroy());
  service.init((message) => broadcasts.push(message));

  const result = await service.stop({ reason: 'stopped' });

  assert.equal(result.status, 'idle');
  assert.equal(result.forced, true);
  assert.equal(service.getSession(), null);
  assert.ok(broadcasts.some((message) => (
    message.type === 'cast:status'
    && message.data.status === 'idle'
    && message.data.activeDeviceId === null
  )));
});

test('watchdog recovers a cast session that remains paused past the timeout', async (t) => {
  const { service } = createFakeService();
  const broadcasts = [];
  installCastSessionRecovery(service, {
    stopTimeoutMs: 5,
    pausedTimeoutMs: 4,
    idleGraceMs: 5,
    watchdogIntervalMs: 2,
  });
  t.after(() => service.__castSessionRecovery.destroy());
  service.init((message) => broadcasts.push(message));

  // Leave headroom for timer coalescing when Node runs test files in parallel.
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(service.getSession(), null);
  assert.ok(broadcasts.some((message) => message.data?.reason === 'timeout'));
});

test('starting a replacement cast clears the forced-idle guard', async (t) => {
  const { service } = createFakeService();
  installCastSessionRecovery(service, {
    stopTimeoutMs: 3,
    pausedTimeoutMs: 1000,
    idleGraceMs: 5,
    watchdogIntervalMs: 2,
  });
  t.after(() => service.__castSessionRecovery.destroy());
  service.init(() => {});

  await service.stop({ reason: 'stopped' });
  assert.equal(service.getSession(), null);

  await service.castTo('speaker-2', 'user-1', 'https://media.example/new.mp3', 0, null, {
    episodeGuid: 'episode-2',
  });

  const session = service.getSession();
  assert.equal(session.activeDeviceId, 'speaker-2');
  assert.equal(session.status, 'connecting');
});
