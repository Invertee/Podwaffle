'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const configRoot = process.env.ADDON_CONFIG_DIR || dataRoot;
const devicesPath = path.join(dataRoot, 'push-devices.json');
let accessToken = null;
let accessTokenExpiresAt = 0;
let writeQueue = Promise.resolve();
const pendingSyncNotifications = new Map();

function rawEnv(name) {
  const val = String(process.env[name] || '').trim();
  return val === 'null' ? '' : val;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    return null;
  }
}

function resolveConfigFile(configuredName, defaultName) {
  const name = String(configuredName || defaultName || '').trim();
  if (!name) return null;
  return path.isAbsolute(name) ? name : path.join(configRoot, name);
}

function selectAndroidClient(googleServices) {
  const clients = Array.isArray(googleServices?.client) ? googleServices.client : [];
  return clients.find((client) => client?.client_info?.android_client_info?.package_name === 'com.podwaffle.app')
    || clients[0]
    || null;
}

function discoverServiceAccount(projectId) {
  const explicitPath = resolveConfigFile(rawEnv('FIREBASE_SERVICE_ACCOUNT_FILE'));
  if (explicitPath) return { filePath: explicitPath, json: readJson(explicitPath), explicit: true };

  let names = [];
  try {
    names = fs.readdirSync(configRoot).filter((name) => name.toLowerCase().endsWith('.json'));
  } catch (_) {
    return { filePath: null, json: null, explicit: false };
  }
  const candidates = names
    .filter((name) => name.toLowerCase() !== 'google-services.json')
    .map((name) => {
      const filePath = path.join(configRoot, name);
      return { filePath, json: readJson(filePath), explicit: false };
    })
    .filter((candidate) => candidate.json?.type === 'service_account');
  return candidates.find((candidate) => projectId && candidate.json?.project_id === projectId)
    || candidates.find((candidate) => /^podwaffle.*\.json$/i.test(path.basename(candidate.filePath)))
    || candidates[0]
    || { filePath: null, json: null, explicit: false };
}

function loadFirebaseConfiguration() {
  const googleJsonOption = rawEnv('FIREBASE_GOOGLE_SERVICES_JSON');
  const serviceJsonOption = rawEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  const googlePath = resolveConfigFile(rawEnv('FIREBASE_GOOGLE_SERVICES_FILE'), 'google-services.json');
  const googleServices = googleJsonOption ? parseJson(googleJsonOption) : readJson(googlePath);
  const googleProject = String(googleServices?.project_info?.project_id || '').trim();
  const serviceAccount = serviceJsonOption
    ? { filePath: null, json: parseJson(serviceJsonOption), explicit: true, option: true }
    : discoverServiceAccount(googleProject);
  const androidClient = selectAndroidClient(googleServices);
  const serviceProject = String(serviceAccount.json?.project_id || '').trim();
  const configuredProject = rawEnv('FIREBASE_PROJECT_ID');
  const effectiveProject = configuredProject || serviceProject || googleProject;
  const errors = [];

  if (googleJsonOption && !googleServices) {
    errors.push('Unable to parse firebase_google_services_json');
  } else if (rawEnv('FIREBASE_GOOGLE_SERVICES_FILE') && !googleServices) {
    errors.push(`Unable to read Firebase Android config: ${path.basename(googlePath)}`);
  }
  if (serviceAccount.explicit && !serviceAccount.json) {
    errors.push(serviceAccount.option
      ? 'Unable to parse firebase_service_account_json'
      : `Unable to read Firebase service account: ${path.basename(serviceAccount.filePath)}`);
  }
  if (googleProject && serviceProject && googleProject !== serviceProject) {
    errors.push(`Firebase project mismatch: google-services.json uses ${googleProject}, service account uses ${serviceProject}`);
  }
  if (configuredProject && googleProject && configuredProject !== googleProject) {
    errors.push(`Firebase project mismatch: firebase_project_id uses ${configuredProject}, google-services.json uses ${googleProject}`);
  } else if (configuredProject && serviceProject && configuredProject !== serviceProject) {
    errors.push(`Firebase project mismatch: firebase_project_id uses ${configuredProject}, service account uses ${serviceProject}`);
  }
  if (effectiveProject && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(effectiveProject)) {
    errors.push(`Invalid Firebase project ID: ${effectiveProject}`);
  }

  return {
    values: {
      FIREBASE_PROJECT_ID: serviceProject || googleProject,
      FIREBASE_CLIENT_EMAIL: String(serviceAccount.json?.client_email || '').trim(),
      FIREBASE_PRIVATE_KEY: String(serviceAccount.json?.private_key || '').trim(),
      FIREBASE_API_KEY: String(androidClient?.api_key?.[0]?.current_key || '').trim(),
      FIREBASE_APP_ID: String(androidClient?.client_info?.mobilesdk_app_id || '').trim(),
      FIREBASE_SENDER_ID: String(googleServices?.project_info?.project_number || '').trim(),
    },
    errors,
    sources: {
      serviceAccount: serviceAccount.option
        ? 'Home Assistant option'
        : (serviceAccount.filePath ? path.basename(serviceAccount.filePath) : null),
      googleServices: googleJsonOption && googleServices
        ? 'Home Assistant option'
        : (googleServices ? path.basename(googlePath) : null),
    },
  };
}

const firebaseConfiguration = loadFirebaseConfiguration();
if (firebaseConfiguration.errors.length) {
  firebaseConfiguration.errors.forEach((error) => console.warn(`[push] Firebase configuration error: ${error}`));
} else if (firebaseConfiguration.sources.serviceAccount || firebaseConfiguration.sources.googleServices) {
  console.log(
    `[push] Firebase configuration loaded (service_account=${firebaseConfiguration.sources.serviceAccount || 'not found'}, google_services=${firebaseConfiguration.sources.googleServices || 'not found'})`
  );
}

function env(name) {
  return rawEnv(name) || firebaseConfiguration.values[name] || '';
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
  return firebaseConfiguration.errors.length === 0 && !!(
    env('FIREBASE_PROJECT_ID')
    && env('FIREBASE_CLIENT_EMAIL')
    && env('FIREBASE_PRIVATE_KEY')
    && env('FIREBASE_API_KEY')
    && env('FIREBASE_APP_ID')
    && env('FIREBASE_SENDER_ID')
  );
}

function missingConfigurationFields() {
  return [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_API_KEY',
    'FIREBASE_APP_ID',
    'FIREBASE_SENDER_ID',
  ].filter((name) => !env(name));
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

function normalizePrivateKey(rawKey) {
  if (!rawKey) return '';
  // Replace literal '\n' characters with actual newlines
  let cleaned = rawKey.replace(/\\n/g, '\n').trim();

  // Strip outer quotes if present (e.g. copied from service account JSON)
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).replace(/\\n/g, '\n').trim();
  }

  // Reconstruct standard 64-char wrapped PEM format if it lacks proper lines
  // (e.g. if the UI flattened the key into spaces instead of newlines)
  const headerMatch = cleaned.match(/-----BEGIN[^-]+-----/);
  const footerMatch = cleaned.match(/-----END[^-]+-----/);

  if (headerMatch && footerMatch) {
    const header = headerMatch[0];
    const footer = footerMatch[0];
    const startIndex = cleaned.indexOf(header) + header.length;
    const endIndex = cleaned.indexOf(footer);
    if (endIndex > startIndex) {
      const base64Content = cleaned.substring(startIndex, endIndex).replace(/\s+/g, '');
      const lines = [];
      for (let i = 0; i < base64Content.length; i += 64) {
        lines.push(base64Content.substring(i, i + 64));
      }
      return `${header}\n${lines.join('\n')}\n${footer}\n`;
    }
  }

  return cleaned;
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
  const privateKey = normalizePrivateKey(env('FIREBASE_PRIVATE_KEY'));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${signingInput}.${signature}`,
      }).toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `OAuth HTTP ${response.status}`);
  accessToken = body.access_token;
  accessTokenExpiresAt = Date.now() + (Number(body.expires_in || 3600) * 1000);
  return accessToken;
}

async function checkServiceAccess() {
  const missing = missingConfigurationFields();
  if (firebaseConfiguration.errors.length || missing.length) {
    return {
      configured: false,
      accessible: false,
      projectId: env('FIREBASE_PROJECT_ID') || null,
      missing,
      errors: [...firebaseConfiguration.errors],
    };
  }

  try {
    await getAccessToken();
    return {
      configured: true,
      accessible: true,
      projectId: env('FIREBASE_PROJECT_ID'),
      missing: [],
      errors: [],
    };
  } catch (error) {
    return {
      configured: true,
      accessible: false,
      projectId: env('FIREBASE_PROJECT_ID'),
      missing: [],
      errors: [error?.message || String(error)],
    };
  }
}

async function logStartupStatus() {
  const status = await checkServiceAccess();
  const diagnostics = await getDiagnostics();
  const registeredDevices = Object.values(diagnostics.profiles)
    .reduce((total, profile) => total + profile.registeredDevices, 0);

  if (!status.configured) {
    const details = status.errors.length
      ? status.errors.join('; ')
      : `missing ${status.missing.join(', ')}`;
    console.warn(`[push] Firebase startup check: DISABLED (${details})`);
  } else if (!status.accessible) {
    console.error(`[push] Firebase startup check: FAILED (project=${status.projectId}, OAuth access denied: ${status.errors.join('; ')})`);
  } else {
    console.log(`[push] Firebase startup check: OK (project=${status.projectId}, OAuth access verified, registered_devices=${registeredDevices})`);
  }
  return { ...status, registeredDevices };
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
  return {
    configured: isConfigured(),
    configurationErrors: [...firebaseConfiguration.errors],
    configurationSources: { ...firebaseConfiguration.sources },
    profiles,
  };
}

module.exports = {
  getPublicConfig,
  isConfigured,
  registerDevice,
  unregisterDevice,
  sendToGuid,
  notifySyncChanged,
  getDiagnostics,
  checkServiceAccess,
  logStartupStatus,
  _normalizePrivateKey: normalizePrivateKey,
  _loadFirebaseConfiguration: loadFirebaseConfiguration,
};
