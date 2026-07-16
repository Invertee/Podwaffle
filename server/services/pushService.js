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

function saveDevices(devices) {
  writeQueue = writeQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(devicesPath), { recursive: true });
    const tempPath = `${devicesPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(devices, null, 2), 'utf8');
    await fs.promises.rename(tempPath, devicesPath);
  });
  return writeQueue;
}

async function registerDevice(guid, token, clientId = '') {
  if (!guid || !token) throw new Error('guid and token are required');
  const devices = await loadDevices();
  const current = Array.isArray(devices[guid]) ? devices[guid] : [];
  const withoutToken = current.filter((item) => item && item.token !== token);
  withoutToken.push({ token, clientId, platform: 'android', updatedAt: new Date().toISOString() });
  devices[guid] = withoutToken.slice(-20);
  await saveDevices(devices);
  return { registered: true, devices: devices[guid].length };
}

async function unregisterDevice(guid, token) {
  const devices = await loadDevices();
  devices[guid] = (Array.isArray(devices[guid]) ? devices[guid] : []).filter((item) => item && item.token !== token);
  await saveDevices(devices);
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
  const devices = await loadDevices();
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
    devices[guid] = targets.filter((device) => !invalid.has(device.token));
    await saveDevices(devices);
  }
  return { sent, registered: targets.length };
}

module.exports = { getPublicConfig, isConfigured, registerDevice, unregisterDevice, sendToGuid };
