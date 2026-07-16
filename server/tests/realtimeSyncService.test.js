'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshService() {
  const modulePath = require.resolve('../services/realtimeSyncService');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('tracks independent revisions for each user GUID', () => {
  const service = freshService();
  const firstA = service.stamp({ type: 'user:progress', data: { guid: 'a' } });
  const firstB = service.stamp({ type: 'user:progress', data: { guid: 'b' } });
  const secondA = service.stamp({ type: 'user:playback-session', data: { guid: 'a' } });

  assert.equal(firstA.sync.userRevision, 1);
  assert.equal(firstB.sync.userRevision, 1);
  assert.equal(secondA.sync.userRevision, 2);
  assert.equal(service.clock('b').sync.userRevision, 1);
});

test('clock messages do not advance revisions', () => {
  const service = freshService();
  const mutation = service.stamp({ type: 'user:progress', data: { guid: 'a' } });
  const clock = service.clock('a');
  assert.equal(clock.sync.revision, mutation.sync.revision);
  assert.equal(clock.sync.userRevision, mutation.sync.userRevision);
});
