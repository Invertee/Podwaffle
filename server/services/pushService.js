'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const devicesPath = path.join(dataRoot, 'push-devices.json');
let accessToken = null;
let accessTokenExpiresAt = 0;
let writeQueue = Promise.resolve();
const pendingSyncNotifications = new Map();

function env(name) {
  return String(process.env[name] || '').trim();
}

function getPublicConfig() {
  return {
    enabled: isConfigured(),
    projectId: env('FIREBASE_PROJECT_ID'),
    apiKey: env('FIREBASE_API_KEY'),
    applicationId: env('FIREBASE_APP_ID'),
    gcmSenderId: env('FIREBASE_SENDER_ID'),
  };
}

function isConfigured() {
  return !!(
    env('FIREBASE_PROJECT_ID')
    && env('FIREBASE_CLIENT_EMAIL')
    && env('FIREBASE_PRIVATE_KEY')
    && env('FIREBASE_API_KEY')
    && env('FIREBASE_APP_ID')
    && env('FIREBASE_SENDER_ID')
  );
}

async function loadDevices() {
  try {
    return JSON.parse(await fs.promises.readFile(devicesPath, 'utf8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[push] Failed to read device registry:', err.message);
    return {};
  }
}

async function persistDevices(devices) {
  await fs.promises.mkdir(path.dirname(devicesPath), { recursive: true });
  const tempPath = `${devicesPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(devices, null, 2), 'utf8');
  await fs.promises.rename(tempPath, devicesPath);
}

function mutateDevices(operation) {
  const task = writeQueue.catch(() => {}).then(async () => {
    const devices = await loadDevices();
    const result = await operation(devices);
    await persistDevices(devices);
    return result;
  });
  writeQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function readDevices() {
  await writeQueue.catch(() => {});
  return loadDevices();
}

async function registerDevice(guid, token, clientId = '') {
  if (!guid || !token) throw new Error('guid and token are required');
  return mutateDevices(async (devices) => {
    const current = Array.isArray(devices[guid]) ? devices[guid] : [];
    const withoutToken = current.filter((item) => item && item.token !== token);
    withoutToken.push({ token, clientId, platform: 'android', updatedAt: new Date().toISOString() });
    devices[guid] = withoutToken.slice(-20);
    return { registered: true, devices: devices[guid].length };
  });
}

async function unregisterDevice(guid, token) {
  return mutateDevices(async (devices) => {
    devices[guid] = (Array.isArray(devices[guid]) ? devices[guid] : []).filter((item) => item && item.token !== token);
  });
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt - 60000) return accessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: env('FIREBASE_CLIENT_EMAIL'),
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const privateKey = env('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }).toString(),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `OAuth HTTP ${response.status}`);
  accessToken = body.access_token;
  accessTokenExpiresAt = Date.now() + (Number(body.expires_in || 3600) * 1000);
  return accessToken;
}

function stringifyData(data) {
  const result = {};
  for (const [key, value] of Object.entries(data || {})) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}

async function sendToGuid(guid, data) {
  if (!isConfigured() || !guid) return { sent: 0, disabled: !isConfigured() };
  const devices = await readDevices();
  const targets = Array.isArray(devices[guid]) ? devices[guid] : [];
  if (!targets.length) return { sent: 0 };
  const token = await getAccessToken();
  let sent = 0;
  const invalid = new Set();
  for (const device of targets) {
    try {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env('FIREBASE_PROJECT_ID'))}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: device.token, data: stringifyData(data), android: { priority: 'high' } } }),
      });
      if (response.ok) sent += 1;
      else {
        const error = await response.text();
        if (response.status === 404 || error.includes('UNREGISTERED')) invalid.add(device.token);
        console.warn('[push] FCM send failed:', response.status, error.slice(0, 300));
      }
    } catch (err) {
      console.warn('[push] FCM request failed:', err.message);
    }
  }
  if (invalid.size) {
    await mutateDevices(async (currentDevices) => {
      currentDevices[guid] = (Array.isArray(currentDevices[guid]) ? currentDevices[guid] : [])
        .filter((device) => !invalid.has(device.token));
    });
  }
  return { sent, registered: targets.length };
}

function notifySyncChanged(guid, sync = {}, reason = 'state-changed') {
  if (!guid || !isConfigured()) return;
  const existing = pendingSyncNotifications.get(guid);
  if (existing) {
    existing.sync = sync;
    existing.reason = reason;
    return;
  }

  const pending = { sync, reason, timer: null };
  pending.timer = setTimeout(() => {
    pendingSyncNotifications.delete(guid);
    sendToGuid(guid, {
      type: 'sync_changed',
      guid,
      reason: pending.reason,
      revision: pending.sync.userRevision ?? pending.sync.revision ?? 0,
      changedAt: pending.sync.lastSyncAt || pending.sync.lastChangedAt || new Date().toISOString(),
    }).catch((err) => console.warn('[push] Sync notification failed:', err.message));
  }, 1500);
  pending.timer.unref?.();
  pendingSyncNotifications.set(guid, pending);
}

async function getDiagnostics() {
  const devices = await readDevices();
  const profiles = {};
  for (const [guid, entries] of Object.entries(devices)) {
    profiles[guid] = {
      registeredDevices: Array.isArray(entries) ? entries.length : 0,
      devices: (Array.isArray(entries) ? entries : []).map((entry) => ({
        clientId: entry.clientId || '',
        platform: entry.platform || 'android',
        updatedAt: entry.updatedAt || null,
      })),
    };
  }
  return { configured: isConfigured(), profiles };
}

module.exports = {
  getPublicConfig,
  isConfigured,
  registerDevice,
  unregisterDevice,
  sendToGuid,
  notifySyncChanged,
  getDiagnostics,
};
