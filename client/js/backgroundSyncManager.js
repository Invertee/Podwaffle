/* ============================================================
   Podwaffle — backgroundSyncManager.js
   Automatically syncs progress updates to connected server.
   Queues updates when offline, persists queue to localStorage.
   ============================================================ */

const backgroundSyncManager = {
  _syncQueue: [], // Array of {type, guid, episodeGuid, data, retriedCount}
  _syncInFlight: false,
  _syncInterval: null,
  _QUEUE_KEY: 'podwaffle_sync_queue',
  _MAX_RETRIES: 3,
  _SYNC_INTERVAL_MS: 10000, // Every 10 seconds

  init() {
    console.log('[backgroundSyncManager] Initializing...');
    this._loadQueueFromStorage();
    this._startSyncLoop();

    // Hook into player progress changes so we push updates
    if (window.player) {
      const originalSync = window.player._syncProgress;
      window.player._syncProgress = async function() {
        // Call original sync first (to server if connected or local)
        await originalSync.call(this);

        // Then queue for bg sync to remote if configured
        if (window.api && window.api.getServerConnectionConfig().enabled) {
          backgroundSyncManager.queueProgressSync(
            localStorage.getItem('podwaffle_guid'),
            this.currentEpisode?.guid,
            {
              position: Math.floor(this.position || 0),
              duration: Math.floor(this.duration || 0),
              played: false,
              feedId: this.currentEpisode?.feedId,
              updatedAt: new Date().toISOString(),
            }
          );
        }
      };
    }

    console.log('[backgroundSyncManager] Ready');
  },

  _loadQueueFromStorage() {
    try {
      const raw = localStorage.getItem(this._QUEUE_KEY);
      this._syncQueue = raw ? JSON.parse(raw) : [];
      if (this._syncQueue.length > 0) {
        console.log(`[backgroundSyncManager] Loaded ${this._syncQueue.length} queued sync(es)`);
      }
    } catch (err) {
      console.warn('[backgroundSyncManager] Failed to load sync queue:', err);
      this._syncQueue = [];
    }
  },

  _saveQueueToStorage() {
    try {
      localStorage.setItem(this._QUEUE_KEY, JSON.stringify(this._syncQueue));
    } catch (err) {
      console.warn('[backgroundSyncManager] Failed to save sync queue:', err);
    }
  },

  queueProgressSync(guid, episodeGuid, progressData) {
    if (!guid || !episodeGuid) return;

    // Check if we already have a queued update for this episode
    const existing = this._syncQueue.findIndex(
      (item) => item.type === 'progress' && item.episodeGuid === episodeGuid
    );

    if (existing >= 0) {
      // Update existing entry
      this._syncQueue[existing] = {
        type: 'progress',
        guid,
        episodeGuid,
        data: progressData,
        retriedCount: 0,
      };
    } else {
      // Add new entry
      this._syncQueue.push({
        type: 'progress',
        guid,
        episodeGuid,
        data: progressData,
        retriedCount: 0,
      });
    }

    this._saveQueueToStorage();
  },

  _startSyncLoop() {
    if (this._syncInterval) clearInterval(this._syncInterval);

    this._syncInterval = setInterval(async () => {
      await this._processSyncQueue();
    }, this._SYNC_INTERVAL_MS);
  },

  async _processSyncQueue() {
    if (this._syncInFlight || this._syncQueue.length === 0) return;
    if (!window.api) return;

    const cfg = window.api.getServerConnectionConfig();
    if (!cfg.enabled) {
      // Server not configured; clear queue and wait
      if (this._syncQueue.length > 0) {
        console.log('[backgroundSyncManager] No server connected; sync queue cleared');
        this._syncQueue = [];
        this._saveQueueToStorage();
      }
      return;
    }

    this._syncInFlight = true;
    const batch = this._syncQueue.splice(0, 5); // Process 5 at a time

    for (const item of batch) {
      try {
        if (item.type === 'progress') {
          await window.api.updateProgress(item.guid, item.episodeGuid, item.data);
          console.log(
            `[backgroundSyncManager] Synced progress: ${item.episodeGuid} @ ${item.data.position}s`
          );
        }
      } catch (err) {
        item.retriedCount = (item.retriedCount || 0) + 1;

        if (item.retriedCount < this._MAX_RETRIES) {
          // Requeue for retry
          this._syncQueue.push(item);
          console.warn(
            `[backgroundSyncManager] Retry ${item.retriedCount}/${this._MAX_RETRIES} for ${item.episodeGuid}:`,
            err.message
          );
        } else {
          // Give up after max retries
          console.error(
            `[backgroundSyncManager] Max retries exceeded for ${item.episodeGuid}`,
            err.message
          );
        }
      }
    }

    this._saveQueueToStorage();
    this._syncInFlight = false;
  },

  getQueueStatus() {
    return {
      queuedCount: this._syncQueue.length,
      queue: [...this._syncQueue],
    };
  },

  clearQueue() {
    this._syncQueue = [];
    this._saveQueueToStorage();
  },

  destroy() {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
  },
};

window.backgroundSyncManager = backgroundSyncManager;
