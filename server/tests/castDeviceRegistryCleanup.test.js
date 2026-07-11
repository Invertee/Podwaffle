'use strict';

process.env.PODWAFFLE_DISABLE_CAST_DEVICE_CLEANUP_AUTO = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dedupeDevices,
  samePhysicalDevice,
} = require('../services/castDeviceRegistryCleanup');

test('matches rediscovered speakers by friendly name when their mDNS id changes', () => {
  const oldEntry = {
    id: 'old-id',
    name: 'Kitchen speaker',
    host: '192.168.1.20',
    port: 8009,
  };
  const rediscoveredEntry = {
    id: 'new-id',
    name: 'Kitchen Speaker',
    host: '192.168.1.21',
    port: 8009,
  };

  assert.equal(samePhysicalDevice(oldEntry, rediscoveredEntry), true);
  assert.deepEqual(dedupeDevices([oldEntry, rediscoveredEntry]), [rediscoveredEntry]);
});

test('matches the same speaker by endpoint when its display name changes', () => {
  const oldEntry = {
    id: 'old-id',
    name: 'Living room',
    host: 'speaker.local.',
    port: 8009,
  };
  const renamedEntry = {
    id: 'new-id',
    name: 'Lounge',
    host: 'speaker.local',
    port: 8009,
  };

  assert.equal(samePhysicalDevice(oldEntry, renamedEntry), true);
  assert.deepEqual(dedupeDevices([oldEntry, renamedEntry]), [renamedEntry]);
});

test('preserves the active cast entry while deduplicating', () => {
  const activeEntry = {
    id: 'active-id',
    name: 'Office',
    host: '192.168.1.30',
    port: 8009,
  };
  const duplicateEntry = {
    id: 'duplicate-id',
    name: 'Office',
    host: '192.168.1.31',
    port: 8009,
  };

  assert.deepEqual(
    dedupeDevices([activeEntry, duplicateEntry], 'active-id'),
    [activeEntry]
  );
});

test('does not collapse unrelated generic device names', () => {
  const first = { id: 'one', name: 'Cast Device', host: '192.168.1.40', port: 8009 };
  const second = { id: 'two', name: 'Cast Device', host: '192.168.1.41', port: 8009 };

  assert.equal(samePhysicalDevice(first, second), false);
  assert.deepEqual(dedupeDevices([first, second]), [first, second]);
});
