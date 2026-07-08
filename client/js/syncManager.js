/* ============================================================
   Podwaffle — syncManager.js
   Bidirectional sync engine for subscriptions, progress, and stats.
   Handles merge conflicts with intelligent defaults.
   ============================================================ */

const syncManager = {
  _syncInProgress: false,
  _lastSyncResult: null,

  /**
   * Extract local state from window.appState and localStorage
   */
  async getLocalState(guid) {
    if (!guid) throw new Error('GUID required for local state');
    try {
      const user = window.appState.user || {};
      return {
        guid,
        subscriptions: window.appState.subscriptions || user.subscriptions || [],
        subscriptionsUpdatedAt: window.appState.subscriptionsUpdatedAt || user.subscriptionsUpdatedAt || user.updatedAt || null,
        progress: window.appState.progress || user.progress || {},
        stats: user.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 },
        settings: user.settings || {},
        queue: window.player && typeof window.player._serializeQueueForSync === 'function'
          ? window.player._serializeQueueForSync()
          : (Array.isArray(user.queue) ? user.queue : []),
        playbackSession: user.playbackSession || null,
      };
    } catch (err) {
      console.error('[syncManager] Failed to get local state:', err);
      throw err;
    }
  },

  /**
   * Fetch remote state from server via sync snapshot endpoint
   */
  async getRemoteState(guid) {
    if (!guid) throw new Error('GUID required for remote state');
    try {
      const payload = await window.api.getBootstrapSyncState(guid);
      const snapshot = payload && payload.snapshot ? payload.snapshot : {};
      return {
        guid,
        subscriptions: snapshot.subscriptions || [],
        subscriptionsUpdatedAt: snapshot.subscriptionsUpdatedAt || snapshot.updatedAt || null,
        progress: snapshot.progress || {},
        stats: snapshot.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 },
        settings: snapshot.settings || {},
        queue: snapshot.queue || payload.queue || [],
        playbackSession: snapshot.playbackSession || payload.playbackSession || null,
      };
    } catch (err) {
      console.error('[syncManager] Failed to get remote state:', err);
      throw err;
    }
  },

  /**
   * Merge progress: keep the entry with the most recent updatedAt timestamp
   */
  mergeProgress(local = {}, remote = {}) {
    const merged = {};
    const allEpisodeGuids = new Set([
      ...Object.keys(local || {}),
      ...Object.keys(remote || {}),
    ]);

    for (const episodeGuid of allEpisodeGuids) {
      const localProg = (local || {})[episodeGuid];
      const remoteProg = (remote || {})[episodeGuid];

      if (!localProg && remoteProg) {
        merged[episodeGuid] = remoteProg;
        continue;
      }

      if (localProg && !remoteProg) {
        merged[episodeGuid] = localProg;
        continue;
      }

      if (localProg && remoteProg) {
        const localTs = new Date(localProg.updatedAt || 0).getTime();
        const remoteTs = new Date(remoteProg.updatedAt || 0).getTime();
        merged[episodeGuid] = remoteTs >= localTs ? remoteProg : localProg;
      }
    }

    return merged;
  },

  mergeSubscriptions(local = [], remote = [], preferLocal = false) {
    const primary = preferLocal ? (local || []) : (remote || []);
    const secondary = preferLocal ? (remote || []) : (local || []);
    const merged = [];
    const seen = new Set();
    for (const feedUrl of primary) {
      if (!feedUrl || seen.has(feedUrl)) continue;
      seen.add(feedUrl);
      merged.push(feedUrl);
    }
    for (const feedUrl of secondary) {
      if (!feedUrl || seen.has(feedUrl)) continue;
      seen.add(feedUrl);
      merged.push(feedUrl);
    }
    return merged;
  },

  /**
   * Merge stats: take remote as source of truth (server is the authority)
   */
  mergeStats(local = {}, remote = {}) {
    return {
      totalListenedSeconds: remote.totalListenedSeconds || local.totalListenedSeconds || 0,
      totalSkippedSeconds: remote.totalSkippedSeconds || local.totalSkippedSeconds || 0,
      ...remote, // Remote wins on all fields
    };
  },

  /**
   * Perform a full bidirectional sync
   * @returns {Object} sync result with status and changes
   */
  async performSync(guid) {
    if (this._syncInProgress) {
      throw new Error('Sync already in progress');
    }

    this._syncInProgress = true;
    const startedAt = Date.now();
    const result = {
      ok: false,
      guid,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: 0,
      changes: {
        subscriptionsAdded: [],
        subscriptionsRemoved: [],
        progressMerged: 0,
        statsMerged: false,
      },
      errors: [],
      mode: 'local', // 'local' or 'sync'
    };

    try {
      if (!window.api) throw new Error('API client not available');

      // 1. Get local state
      console.log('[syncManager] Fetching local state...');
      const localState = await this.getLocalState(guid);

      // 2. Check if backend sync is enabled
      const cfg = window.api.getServerConnectionConfig();
      const isSyncEnabled = cfg && cfg.enabled;
      
      if (!isSyncEnabled) {
        // Local-only mode: no backend sync
        console.log('[syncManager] Backend sync disabled. Running in local-only mode.');
        result.mode = 'local';
        result.ok = true;
        result.endedAt = new Date().toISOString();
        result.durationMs = Date.now() - startedAt;
        this._lastSyncResult = result;
        this._syncInProgress = false;
        return result;
      }

      console.log('[syncManager] Fetching remote state...');
      const remoteState = await this.getRemoteState(guid);
      result.mode = 'sync';

      // 2. Push local state to backend sync endpoint (server performs merge)
      console.log('[syncManager] Pushing local state to sync endpoint...');
      const pushPayload = {
        subscriptions: localState.subscriptions || [],
        subscriptionsUpdatedAt: localState.subscriptionsUpdatedAt || new Date().toISOString(),
        progress: localState.progress || {},
        stats: localState.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 },
        settings: localState.settings || {},
        queue: localState.queue || [],
        playbackSession: localState.playbackSession || null,
      };

      const pushResult = await window.api.pushSyncState(guid, pushPayload);
      const mergedSnapshot = pushResult && pushResult.snapshot ? pushResult.snapshot : {};
      const mergedSummary = pushResult && pushResult.summary ? pushResult.summary : {};

      const preferLocalSubs = (mergedSnapshot.subscriptionsUpdatedAt || mergedSummary.subscriptionsUpdatedAt || localState.subscriptionsUpdatedAt || 0)
        >= (remoteState.subscriptionsUpdatedAt || remoteState.updatedAt || 0);
      const mergedSubs = mergedSnapshot.subscriptions || this.mergeSubscriptions(localState.subscriptions, remoteState.subscriptions, preferLocalSubs);
      const mergedProgress = mergedSnapshot.progress || this.mergeProgress(localState.progress, remoteState.progress);
      const mergedStats = mergedSnapshot.stats || this.mergeStats(localState.stats, remoteState.stats);

      result.changes.subscriptionsAdded = [];
      result.changes.subscriptionsRemoved = [];
      result.changes.progressMerged = mergedSummary.mergedProgressEntries || Object.keys(mergedProgress || {}).length;
      result.changes.statsMerged = true;

      // 5. Update local appState with merged results
      if (window.appState) {
        window.appState.subscriptions = mergedSubs;
        window.appState.subscriptionsUpdatedAt = mergedSnapshot.subscriptionsUpdatedAt || mergedSummary.subscriptionsUpdatedAt || localState.subscriptionsUpdatedAt || remoteState.subscriptionsUpdatedAt || remoteState.updatedAt || null;
        window.appState.progress = mergedProgress;
        if (window.appState.user) {
          window.appState.user.subscriptions = mergedSubs;
          window.appState.user.subscriptionsUpdatedAt = window.appState.subscriptionsUpdatedAt;
          window.appState.user.progress = mergedProgress;
          window.appState.user.stats = mergedStats;
        }
      }

      result.ok = !!(pushResult && pushResult.ok !== false);
      result.endedAt = new Date().toISOString();
      result.durationMs = Date.now() - startedAt;

      console.log('[syncManager] Sync completed successfully:', result);
      this._lastSyncResult = result;
      return result;
    } catch (err) {
      result.endedAt = new Date().toISOString();
      result.durationMs = Date.now() - startedAt;
      result.errors.push(err.message || String(err));
      console.error('[syncManager] Sync failed:', err);
      this._lastSyncResult = result;
      return result;
    } finally {
      this._syncInProgress = false;
    }
  },

  getLastSyncResult() {
    return this._lastSyncResult;
  },

  isSyncInProgress() {
    return this._syncInProgress;
  },
};

window.syncManager = syncManager;
