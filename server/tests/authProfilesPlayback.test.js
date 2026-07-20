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

test('Firebase startup access check explains incomplete configuration without making a request', async (t) => {
  const envNames = [
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'FIREBASE_API_KEY', 'FIREBASE_APP_ID', 'FIREBASE_SENDER_ID',
    'FIREBASE_SERVICE_ACCOUNT_FILE', 'FIREBASE_GOOGLE_SERVICES_FILE',
    'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_GOOGLE_SERVICES_JSON',
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  const modulePath = require.resolve('../services/pushService');
  delete require.cache[modulePath];
  const push = require(modulePath);
  t.after(() => {
    delete require.cache[modulePath];
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });

  const status = await push.checkServiceAccess();
  assert.equal(status.configured, false);
  assert.equal(status.accessible, false);
  assert.deepEqual(status.errors, []);
  assert.deepEqual(status.missing, envNames.slice(0, 6));
});

test('Firebase private key normalization', () => {
  const modulePath = require.resolve('../services/pushService');
  delete require.cache[modulePath];
  const push = require(modulePath);

  // Standard valid PEM format with actual newlines
  const validPem = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ
-----END PRIVATE KEY-----`;
  assert.equal(push._normalizePrivateKey(validPem), validPem + '\n');

  // Key flattened to spaces (e.g. from single-line UI inputs)
  const flattenedKey = `-----BEGIN PRIVATE KEY----- MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ -----END PRIVATE KEY-----`;
  assert.equal(push._normalizePrivateKey(flattenedKey), validPem + '\n');

  // Key with escaped \\n sequences
  const escapedKey = `-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ\\n-----END PRIVATE KEY-----`;
  assert.equal(push._normalizePrivateKey(escapedKey), validPem + '\n');

  // Key with outer double quotes
  const quotedKey = `"-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ\\n-----END PRIVATE KEY-----\\n"`;
  assert.equal(push._normalizePrivateKey(quotedKey), validPem + '\n');
});

test('Firebase configuration is discovered from add-on JSON files', async (t) => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podwaffle-firebase-config-'));
  const envNames = [
    'ADDON_CONFIG_DIR', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'FIREBASE_API_KEY', 'FIREBASE_APP_ID', 'FIREBASE_SENDER_ID',
    'FIREBASE_SERVICE_ACCOUNT_FILE', 'FIREBASE_GOOGLE_SERVICES_FILE',
    'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_GOOGLE_SERVICES_JSON',
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.env.ADDON_CONFIG_DIR = configDir;

  fs.writeFileSync(path.join(configDir, 'podwaffle-test-key.json'), JSON.stringify({
    type: 'service_account',
    project_id: 'podwaffle-test',
    client_email: 'firebase-admin@podwaffle-test.iam.gserviceaccount.com',
    private_key: 'test-private-key',
  }));
  fs.writeFileSync(path.join(configDir, 'google-services.json'), JSON.stringify({
    project_info: { project_number: '123456789', project_id: 'podwaffle-test' },
    client: [{
      client_info: {
        mobilesdk_app_id: '1:123456789:android:abcdef',
        android_client_info: { package_name: 'com.podwaffle.app' },
      },
      api_key: [{ current_key: 'test-api-key' }],
    }],
  }));

  const modulePath = require.resolve('../services/pushService');
  delete require.cache[modulePath];
  const push = require(modulePath);
  t.after(() => {
    delete require.cache[modulePath];
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  assert.deepEqual(push.getPublicConfig(), {
    enabled: true,
    projectId: 'podwaffle-test',
    apiKey: 'test-api-key',
    applicationId: '1:123456789:android:abcdef',
    gcmSenderId: '123456789',
  });
  const diagnostics = await push.getDiagnostics();
  assert.deepEqual(diagnostics.configurationErrors, []);
  assert.deepEqual(diagnostics.configurationSources, {
    serviceAccount: 'podwaffle-test-key.json',
    googleServices: 'google-services.json',
  });

  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: 'service_account',
    project_id: 'pasted-project',
    client_email: 'firebase-admin@pasted-project.iam.gserviceaccount.com',
    private_key: 'pasted-private-key',
  });
  process.env.FIREBASE_GOOGLE_SERVICES_JSON = JSON.stringify({
    project_info: { project_number: '987654321', project_id: 'pasted-project' },
    client: [{
      client_info: {
        mobilesdk_app_id: '1:987654321:android:fedcba',
        android_client_info: { package_name: 'com.podwaffle.app' },
      },
      api_key: [{ current_key: 'pasted-api-key' }],
    }],
  });
  const pasted = push._loadFirebaseConfiguration();
  assert.equal(pasted.values.FIREBASE_PROJECT_ID, 'pasted-project');
  assert.equal(pasted.values.FIREBASE_API_KEY, 'pasted-api-key');
  assert.deepEqual(pasted.sources, {
    serviceAccount: 'Home Assistant option',
    googleServices: 'Home Assistant option',
  });
});
