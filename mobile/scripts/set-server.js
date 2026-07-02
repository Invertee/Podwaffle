#!/usr/bin/env node
/**
 * scripts/set-server.js
 *
 * Convenience script to update server.config.json from the command line:
 *   node scripts/set-server.js http://192.168.1.50:3000
 *
 * After running, do `npx cap sync` to push the updated config to the native projects.
 */

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const newUrl = process.argv[2];
if (!newUrl) {
  console.error('Usage: node scripts/set-server.js <serverUrl>');
  console.error('Example: node scripts/set-server.js http://192.168.1.50:3000');
  process.exit(1);
}

try { new URL(newUrl); } catch {
  console.error('Invalid URL:', newUrl);
  process.exit(1);
}

const configPath = resolve(__dirname, '..', 'server.config.json');
const existing = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf-8'))
  : {};

const updated = { ...existing, serverUrl: newUrl };
writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');

console.log(`✓ server.config.json updated → ${newUrl}`);
console.log('  Run "npx cap sync" then rebuild the app to apply the change.');
