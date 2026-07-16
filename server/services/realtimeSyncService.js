'use strict';

class RealtimeSyncService {
  constructor() {
    this.revision = 0;
    this.lastSyncAt = new Date().toISOString();
    this.users = new Map();
  }

  stamp(message, mutate = true) {
    const guid = message?.data?.guid ? String(message.data.guid) : '';
    const currentUserRevision = guid ? (this.users.get(guid) || 0) : 0;
    if (mutate) {
      this.revision += 1;
      this.lastSyncAt = new Date().toISOString();
      if (guid) this.users.set(guid, currentUserRevision + 1);
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
}

module.exports = new RealtimeSyncService();
