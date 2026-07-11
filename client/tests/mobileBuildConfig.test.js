'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mobile', 'server.config.json'), 'utf8'));
const buildScript = fs.readFileSync(path.join(repoRoot, 'mobile', 'scripts', 'sync-web-assets.js'), 'utf8');

test('mobile build has a working default backend', () => {
  assert.equal(config.backendUrl, 'https://podwaffle.pecker.party');
  assert.match(buildScript, /PODWAFFLE_BACKEND_URL/);
  assert.match(buildScript, /defaultBackendUrl\s*=\s*'https:\/\/podwaffle\.pecker\.party'/);
});

test('mobile bootstrap migrates missing and build-managed server settings', () => {
  assert.match(buildScript, /podwaffle_mobile_managed_backend_url/);
  assert.match(buildScript, /legacyOrMissing/);
  assert.match(buildScript, /managedByPreviousBuild/);
  assert.match(buildScript, /source:\s*'mobile-build'/);
});
