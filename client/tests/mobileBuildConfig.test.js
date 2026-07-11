'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mobile', 'server.config.json'), 'utf8'));
const buildScript = fs.readFileSync(path.join(repoRoot, 'mobile', 'scripts', 'sync-web-assets.js'), 'utf8');

test('mobile build records the GitHub Pages site separately from the API backend', () => {
  assert.equal(config.siteUrl, 'https://invertee.github.io/Podwaffle');
  assert.equal(config.backendUrl, '');
  assert.match(buildScript, /PODWAFFLE_SITE_URL/);
  assert.match(buildScript, /defaultSiteUrl\s*=\s*'https:\/\/invertee\.github\.io\/Podwaffle'/);
  assert.doesNotMatch(buildScript, /defaultBackendUrl/);
});

test('mobile backend remains optional and preserves manually configured servers', () => {
  assert.match(buildScript, /PODWAFFLE_BACKEND_URL/);
  assert.match(buildScript, /podwaffle_mobile_managed_backend_url/);
  assert.match(buildScript, /localStorage\.removeItem\('podwaffle_server_connection'\)/);
  assert.match(buildScript, /managedByPreviousBuild/);
  assert.match(buildScript, /source:\s*'mobile-build'/);
});
