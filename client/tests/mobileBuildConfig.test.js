'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mobile', 'server.config.json'), 'utf8'));
const buildScript = fs.readFileSync(path.join(repoRoot, 'mobile', 'scripts', 'sync-web-assets.js'), 'utf8');

test('mobile build targets the Home Assistant add-on without a static-site dependency', () => {
  assert.equal(config.backendUrl, '');
  assert.equal(config.profileId, '');
  assert.equal(config.siteUrl, undefined);
  assert.match(buildScript, /PODWAFFLE_BACKEND_URL/);
  assert.doesNotMatch(buildScript, /github\.io/i);
  assert.doesNotMatch(buildScript, /PODWAFFLE_SITE_URL/);
});

test('mobile bundle can seed a profile and preserves a manually entered access key', () => {
  assert.match(buildScript, /config\.profileId/);
  assert.match(buildScript, /baseUrl:/);
  assert.match(buildScript, /\.\.\.\(existing \|\| \{\}\)/);
  assert.doesNotMatch(buildScript, /accessKey:/);
});
