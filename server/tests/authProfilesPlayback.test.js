'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('profile configuration produces stable unique IDs', () => {
  const registry = require('../services/profileRegistry');
  assert.deepEqual(registry.parseProfiles('Sam Smith, Alex, Sam Smith'), [
    { id: 'sam-smith', name: 'Sam Smith' },
    { id: 'alex', name: 'Alex' },
    { id: 'sam-smith-2', name: 'Sam Smith' },
  ]);
});

test('access key comparison protects HTTP and websocket credentials', () => {
  const previous = process.env.PODWAFFLE_ACCESS_KEY;
  process.env.PODWAFFLE_ACCESS_KEY = 'correct horse battery staple';
  const auth = require('../services/authService');
  assert.equal(auth.isRequired(), true);
  assert.equal(auth.matches('correct horse battery staple'), true);
  assert.equal(auth.matches('wrong'), false);
  if (previous === undefined) delete process.env.PODWAFFLE_ACCESS_KEY;
  else process.env.PODWAFFLE_ACCESS_KEY = previous;
});

test('only one client owns a profile playback lease', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podwaffle-session-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const modulePath = require.resolve('../services/userService');
  delete require.cache[modulePath];
  const users = require(modulePath);
  t.after(() => {
    delete require.cache[modulePath];
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await users.ensureUser('sam');
  const first = await users.updatePlaybackSession('sam', {
    episodeGuid: 'episode-1', audioUrl: 'https://media/one.mp3', clientId: 'client-a', isPlaying: true,
  });
  assert.equal(first.ownerClientId, 'client-a');

  const takeover = await users.updatePlaybackSession('sam', {
    episodeGuid: 'episode-2', audioUrl: 'https://media/two.mp3', clientId: 'client-b', isPlaying: true,
    leaseToken: first.leaseToken,
  });
  assert.equal(takeover.ownerClientId, 'client-b');
  assert.equal(takeover.previousOwnerClientId, 'client-a');

  const stalePause = await users.updatePlaybackSession('sam', {
    episodeGuid: 'episode-1', audioUrl: 'https://media/one.mp3', clientId: 'client-a', isPlaying: false,
  });
  assert.equal(stalePause.ownerClientId, 'client-b');
  assert.equal(stalePause.ignoredNonOwner, true);

  const stalePlay = await users.updatePlaybackSession('sam', {
    episodeGuid: 'episode-1', audioUrl: 'https://media/one.mp3', clientId: 'client-a', isPlaying: true,
    leaseToken: first.leaseToken,
  });
  assert.equal(stalePlay.ownerClientId, 'client-b');
  assert.equal(stalePlay.ignoredStaleLease, true);

  await Promise.all([
    users.addSubscription('sam', 'https://feeds.example/show.xml'),
    users.updateSettings('sam', { skipForward: 60 }),
    users.updateQueue('sam', [{ guid: 'episode-3', audioUrl: 'https://media/three.mp3' }]),
  ]);
  const afterConcurrentWrites = await users.getUser('sam');
  assert.deepEqual(afterConcurrentWrites.subscriptions, ['https://feeds.example/show.xml']);
  assert.equal(afterConcurrentWrites.settings.skipForward, 60);
  assert.equal(afterConcurrentWrites.queue[0].guid, 'episode-3');
  assert.equal(afterConcurrentWrites.playbackSession.ownerClientId, 'client-b');

  const historyEntry = { episodeGuid: 'episode-3', title: 'Episode 3', mutationId: 'client-b:episode-3:complete-1' };
  const historyFirst = await users.addHistoryEntry('sam', historyEntry);
  const historyRetry = await users.addHistoryEntry('sam', historyEntry);
  assert.equal(historyFirst.duplicate, false);
  assert.equal(historyRetry.duplicate, true);
  assert.equal((await users.getHistory('sam')).length, 1);

  const statFirst = await users.updateStats('sam', 0, 30, 'client-b:skip-1');
  const statRetry = await users.updateStats('sam', 0, 30, 'client-b:skip-1');
  assert.equal(statFirst.duplicate, false);
  assert.equal(statRetry.duplicate, true);
  assert.equal(statRetry.stats.totalSkippedSeconds, 30);
});

test('concurrent Firebase registrations are not lost', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podwaffle-push-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const modulePath = require.resolve('../services/pushService');
  delete require.cache[modulePath];
  const push = require(modulePath);
  t.after(() => {
    delete require.cache[modulePath];
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await Promise.all([
    push.registerDevice('sam', 'token-a', 'client-a'),
    push.registerDevice('sam', 'token-b', 'client-b'),
  ]);
  const diagnostics = await push.getDiagnostics();
  assert.equal(diagnostics.profiles.sam.registeredDevices, 2);
});
