'use strict';

/**
 * Keeps the public Cast device registry stable when mDNS rediscovers the same
 * speaker under a different service identifier. The underlying discovery
 * service can retain an old entry when its raw mDNS name differs from the
 * cleaned friendly name stored in the registry.
 */

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

function isGenericName(value) {
  const name = normalizeName(value);
  return !name || name === 'cast device' || name === 'unknown cast device' || name === 'unknown device';
}

function samePhysicalDevice(left, right) {
  if (!left || !right) return false;

  const leftHost = normalizeHost(left.host);
  const rightHost = normalizeHost(right.host);
  const leftPort = Number(left.port || 8009);
  const rightPort = Number(right.port || 8009);
  if (leftHost && rightHost && leftHost === rightHost && leftPort === rightPort) {
    return true;
  }

  const leftName = normalizeName(left.name);
  const rightName = normalizeName(right.name);
  return !isGenericName(leftName) && leftName === rightName;
}

function dedupeDevices(deviceList, activeDeviceId = null) {
  const result = [];

  for (const device of Array.isArray(deviceList) ? deviceList : []) {
    if (!device || !device.id) continue;

    const duplicateIndex = result.findIndex((existing) => samePhysicalDevice(existing, device));
    if (duplicateIndex === -1) {
      result.push(device);
      continue;
    }

    const existing = result[duplicateIndex];
    const existingIsActive = existing.id === activeDeviceId;
    const nextIsActive = device.id === activeDeviceId;

    // Preserve the active session entry. Otherwise prefer the most recently
    // discovered record, which appears later in the registry iteration order.
    if (!existingIsActive || nextIsActive) {
      result[duplicateIndex] = device;
    }
  }

  return result;
}

function installCastDeviceRegistryCleanup(castService) {
  if (!castService || castService.__castDeviceRegistryCleanupInstalled) return castService;

  const originalGetDevices = typeof castService.getDevices === 'function'
    ? castService.getDevices.bind(castService)
    : null;
  const originalGetSession = typeof castService.getSession === 'function'
    ? castService.getSession.bind(castService)
    : null;
  const originalInit = typeof castService.init === 'function'
    ? castService.init.bind(castService)
    : null;

  const announcedDevices = new Map();

  function activeDeviceId() {
    try {
      const session = originalGetSession ? originalGetSession() : null;
      return session?.deviceId || session?.activeDeviceId || null;
    } catch (_) {
      return null;
    }
  }

  if (originalGetDevices) {
    castService.getDevices = function getDeduplicatedDevices() {
      const rawDevices = originalGetDevices();
      const cleanDevices = dedupeDevices(rawDevices, activeDeviceId());
      if (cleanDevices.length !== rawDevices.length) {
        console.log(`[castDeviceRegistryCleanup] Removed ${rawDevices.length - cleanDevices.length} duplicate speaker entr${rawDevices.length - cleanDevices.length === 1 ? 'y' : 'ies'} from the public list.`);
      }
      return cleanDevices;
    };
  }

  if (originalInit) {
    castService.init = function initWithDeviceCleanup(broadcastFn) {
      const filteredBroadcast = typeof broadcastFn === 'function'
        ? (message) => {
            if (!message || !message.type) {
              broadcastFn(message);
              return;
            }

            if (message.type === 'cast:device_found' && message.data?.id) {
              const nextDevice = message.data;
              const staleEntries = Array.from(announcedDevices.values())
                .filter((existing) => existing.id !== nextDevice.id && samePhysicalDevice(existing, nextDevice));

              for (const stale of staleEntries) {
                announcedDevices.delete(stale.id);
                broadcastFn({
                  type: 'cast:device_lost',
                  data: { deviceId: stale.id, reason: 'deduplicated' },
                });
                console.log(`[castDeviceRegistryCleanup] Replaced stale speaker entry ${stale.id} with ${nextDevice.id} (${nextDevice.name || 'Cast Device'}).`);
              }

              announcedDevices.set(nextDevice.id, nextDevice);
              broadcastFn(message);
              return;
            }

            if (message.type === 'cast:device_lost' && message.data?.deviceId) {
              announcedDevices.delete(message.data.deviceId);
              broadcastFn(message);
              return;
            }

            if (message.type === 'cast:devices' && Array.isArray(message.data)) {
              const cleanDevices = dedupeDevices(message.data, activeDeviceId());
              announcedDevices.clear();
              cleanDevices.forEach((device) => announcedDevices.set(device.id, device));
              broadcastFn({ ...message, data: cleanDevices });
              return;
            }

            broadcastFn(message);
          }
        : broadcastFn;

      return originalInit(filteredBroadcast);
    };
  }

  castService.__castDeviceRegistryCleanupInstalled = true;
  castService.__castDeviceRegistryCleanup = {
    dedupeDevices,
    samePhysicalDevice,
  };

  return castService;
}

module.exports = {
  installCastDeviceRegistryCleanup,
  dedupeDevices,
  samePhysicalDevice,
};

if (process.env.PODWAFFLE_DISABLE_CAST_DEVICE_CLEANUP_AUTO !== '1') {
  try {
    installCastDeviceRegistryCleanup(require('./castService'));
  } catch (err) {
    console.error('[castDeviceRegistryCleanup] Failed to install:', err);
  }
}
