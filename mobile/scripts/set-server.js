#!/usr/bin/env node
/**
 * Update the add-on URL and, optionally, the configured profile ID:
 *   node scripts/set-server.js http://192.168.1.50:3000 <profile-id>
 *
 * Run npm run sync afterwards to rebuild the packaged web assets.
 */

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const backendUrl = process.argv[2];
const profileId = process.argv[3];
if (!backendUrl) {
  console.error('Usage: node scripts/set-server.js <backendUrl> [profileId]');
  console.error('Example: node scripts/set-server.js https://podcasts.example.com sam');
  process.exit(1);
}

try { new URL(backendUrl); } catch {
  console.error('Invalid URL:', backendUrl);
  process.exit(1);
}

if (profileId && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profileId)) {
  console.error('Invalid profile ID:', profileId);
  process.exit(1);
}

const configPath = resolve(__dirname, '..', 'server.config.json');
const existing = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf-8'))
  : {};

const updated = {
  ...existing,
  backendUrl,
  ...(profileId ? { profileId } : {}),
};
delete updated.serverUrl;
delete updated.profileGuid;
writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');

console.log(`server.config.json backendUrl updated -> ${backendUrl}`);
if (profileId) console.log(`server.config.json profileId updated -> ${profileId}`);
console.log('Run "npm run sync" and rebuild the app to apply the change.');
