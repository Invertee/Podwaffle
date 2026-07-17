'use strict';

const fs = require('fs');
const path = require('path');

const dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const statePath = path.join(dataRoot, 'sync-state.json');

class RealtimeSyncService {
  constructor() {
    const persisted = this._load();
    this.revision = Number(persisted.revision || 0);
    this.lastSyncAt = persisted.lastSyncAt || new Date().toISOString();
    this.users = new Map();
    this.userChangedAt = new Map();
    for (const [guid, state] of Object.entries(persisted.users || {})) {
      this.users.set(guid, Number(state.revision || 0));
      this.userChangedAt.set(guid, state.lastChangedAt || this.lastSyncAt);
    }
    this._persistTimer = null;
    this._persistPromise = Promise.resolve();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8')) || {};
    } catch (_) {
      return {};
    }
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      const users = {};
      for (const [guid, revision] of this.users.entries()) {
        users[guid] = { revision, lastChangedAt: this.userChangedAt.get(guid) || this.lastSyncAt };
      }
      const content = JSON.stringify({ revision: this.revision, lastSyncAt: this.lastSyncAt, users }, null, 2);
      this._persistPromise = this._persistPromise.catch(() => {}).then(async () => {
        await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
        const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.promises.writeFile(temporaryPath, content, 'utf8');
        try {
          await fs.promises.rename(temporaryPath, statePath);
        } catch (err) {
          if (err?.code !== 'EEXIST' && err?.code !== 'EPERM') throw err;
          await fs.promises.unlink(statePath).catch(() => {});
          await fs.promises.rename(temporaryPath, statePath);
        }
      }).catch((err) => console.warn('[sync] Failed to persist revision state:', err.message));
    }, 100);
    this._persistTimer.unref?.();
  }

  stamp(message, mutate = true) {
    const guid = message?.data?.guid ? String(message.data.guid) : '';
    const currentUserRevision = guid ? (this.users.get(guid) || 0) : 0;
    if (mutate) {
      this.revision += 1;
      this.lastSyncAt = new Date().toISOString();
      if (guid) {
        this.users.set(guid, currentUserRevision + 1);
        this.userChangedAt.set(guid, this.lastSyncAt);
      }
      this._schedulePersist();
    }
    return {
      ...(message || {}),
      sync: {
        revision: this.revision,
        userRevision: guid ? (this.users.get(guid) || 0) : null,
        lastSyncAt: this.lastSyncAt,
        serverTime: new Date().toISOString(),
      },
    };
  }

  clock(guid = '') {
    const message = { type: 'sync:clock' };
    if (guid) message.data = { guid };
    return this.stamp(message, false);
  }

  status(guid = '') {
    return {
      revision: this.revision,
      userRevision: guid ? (this.users.get(guid) || 0) : null,
      lastChangedAt: guid ? (this.userChangedAt.get(guid) || this.lastSyncAt) : this.lastSyncAt,
      serverTime: new Date().toISOString(),
    };
  }
}

module.exports = new RealtimeSyncService();
