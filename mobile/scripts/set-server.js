#!/usr/bin/env node
/**
 * Update the backend URL and, optionally, the existing profile GUID:
 *   node scripts/set-server.js http://192.168.1.50:3000 <profile-guid>
 *
 * Run npm run sync afterwards to rebuild the packaged web assets.
 */

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const backendUrl = process.argv[2];
const profileGuid = process.argv[3];
if (!backendUrl) {
  console.error('Usage: node scripts/set-server.js <backendUrl> [profileGuid]');
  console.error('Example: node scripts/set-server.js http://192.168.1.50:3000 01234567-89ab-4cde-8f01-23456789abcd');
  process.exit(1);
}

try { new URL(backendUrl); } catch {
  console.error('Invalid URL:', backendUrl);
  process.exit(1);
}

if (profileGuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileGuid)) {
  console.error('Invalid profile GUID:', profileGuid);
  process.exit(1);
}

const configPath = resolve(__dirname, '..', 'server.config.json');
const existing = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf-8'))
  : {};

const updated = {
  ...existing,
  backendUrl,
  ...(profileGuid ? { profileGuid } : {}),
};
delete updated.serverUrl;
writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');

console.log(`server.config.json backendUrl updated -> ${backendUrl}`);
if (profileGuid) console.log(`server.config.json profileGuid updated -> ${profileGuid}`);
console.log('Run "npm run sync" and rebuild the app to apply the change.');
