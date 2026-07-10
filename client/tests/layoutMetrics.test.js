'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(clientRoot, 'css', 'layout-fixes.css'), 'utf8');
const metrics = fs.readFileSync(path.join(clientRoot, 'js', 'layoutMetricsV2.js'), 'utf8');

test('layout assets are loaded by the client shell', () => {
  assert.match(index, /css\/layout-fixes\.css/);
  assert.match(index, /js\/layoutMetricsV2\.js/);
});

test('queue and view toggle use measured player stack height', () => {
  assert.match(css, /\.queue-panel\s*\{[\s\S]*bottom:\s*var\(--player-stack-height\)/);
  assert.match(css, /\.view-mode-toggle\s*\{[\s\S]*var\(--player-stack-height\)[\s\S]*var\(--player-floating-control-gap\)/);
  assert.match(metrics, /getBoundingClientRect\(\)\.height/);
  assert.match(metrics, /--player-rendered-height/);
  assert.match(metrics, /--bottom-nav-rendered-height/);
});

test('connection health cards are promoted to a full-width grid', () => {
  assert.match(metrics, /closest\('\.stats-grid'\)/);
  assert.match(metrics, /connection-health-grid/);
  assert.match(css, /\.connection-health-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});
