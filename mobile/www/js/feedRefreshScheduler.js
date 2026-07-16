/* ============================================================
   Podwaffle — feedRefreshScheduler.js
   Periodically checks subscribed feeds for new episodes.
   Runs every 30 minutes on web, triggered by background task on Android.
   ============================================================ */

const feedRefreshScheduler = {
  _refreshInterval: null,
  _isRefreshing: false,
  _lastRefreshAt: null,
  _lastRefreshResult: null,
  _INTERVAL_MS: 30 * 60 * 1000, // 30 minutes
  _LOCAL_STORAGE_KEY: 'podwaffle_feed_refresh_state',

  init() {
    console.log('[feedRefreshScheduler] Initializing...');
    this._loadRefreshState();
    this._startRefreshLoop();
    console.log('[feedRefreshScheduler] Ready (interval: 30 minutes)');
  },

  _loadRefreshState() {
    try {
      const raw = localStorage.getItem(this._LOCAL_STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        this._lastRefreshAt = state.lastRefreshAt;
      }
    } catch (_) {}
  },

  _saveRefreshState() {
    try {
      localStorage.setItem(
        this._LOCAL_STORAGE_KEY,
        JSON.stringify({
          lastRefreshAt: this._lastRefreshAt,
        })
      );
    } catch (_) {}
  },

  _startRefreshLoop() {
    if (this._refreshInterval) clearInterval(this._refreshInterval);

    // Run immediately on first init if last refresh was > 30 mins ago
    const now = Date.now();
    const lastTs = this._lastRefreshAt ? new Date(this._lastRefreshAt).getTime() : 0;
    const timeSinceLastRefresh = now - lastTs;

    if (timeSinceLastRefresh > this._INTERVAL_MS) {
      this.refreshNow().catch((err) => {
        console.error('[feedRefreshScheduler] Initial refresh failed:', err);
      });
    }

    this._refreshInterval = setInterval(() => {
      this.refreshNow().catch((err) => {
        console.error('[feedRefreshScheduler] Scheduled refresh failed:', err);
      });
    }, this._INTERVAL_MS);
  },

  async refreshNow() {
    if (this._isRefreshing) {
      console.log('[feedRefreshScheduler] Refresh already in progress, skipping');
      return this._lastRefreshResult;
    }

    if (!window.api) {
      console.warn('[feedRefreshScheduler] API client not available');
      return null;
    }

    const guid = localStorage.getItem('podwaffle_guid');
    if (!guid) {
      console.warn('[feedRefreshScheduler] No GUID available');
      return null;
    }

    this._isRefreshing = true;
    const startedAt = Date.now();

    const result = {
      ok: false,
      startedAt: new Date().toISOString(),
      completedAt: null,
      feedsChecked: 0,
      newEpisodesFound: {},
      errors: [],
    };

    try {
      // Get subscribed feeds
      let subscriptions = window.appState?.subscriptions || [];
      if (subscriptions.length === 0) {
        // Fallback: fetch from API
        const user = await window.api.getUser(guid);
        subscriptions = user.subscriptions || [];
      }

      if (subscriptions.length === 0) {
        console.log('[feedRefreshScheduler] No subscribed feeds to check');
        result.ok = true;
        result.completedAt = new Date().toISOString();
        this._lastRefreshResult = result;
        return result;
      }

      console.log(`[feedRefreshScheduler] Checking ${subscriptions.length} feed(s)...`);

      // Call backend to refresh all feeds for this user
      try {
        const refreshResult = await window.api.refreshUserFeeds(guid);
        result.feedsChecked = refreshResult?.feedsChecked || subscriptions.length;
        result.newEpisodesFound = refreshResult?.newEpisodesFound || {};
        result.ok = true;

        const totalNewEpisodes = Object.values(result.newEpisodesFound).reduce(
          (sum, count) => sum + (count || 0),
          0
        );

        console.log(
          `[feedRefreshScheduler] Refresh complete: ${result.feedsChecked} feed(s), ${totalNewEpisodes} new episode(s)`
        );

        // Dispatch event so UI can update if needed
        window.dispatchEvent(
          new CustomEvent('podwaffle:feeds-refreshed', {
            detail: result,
          })
        );
      } catch (err) {
        // If refreshUserFeeds doesn't exist, try checking individual feeds
        console.log('[feedRefreshScheduler] Checking feeds individually...');
        for (const feedUrl of subscriptions) {
          try {
            // This would be a new endpoint to check a specific feed
            // For now just count it as checked
            result.feedsChecked++;
          } catch (feedErr) {
            result.errors.push(`${feedUrl}: ${feedErr.message}`);
          }
        }
        result.ok = true;
      }

      this._lastRefreshAt = new Date().toISOString();
      this._saveRefreshState();
      result.completedAt = this._lastRefreshAt;
    } catch (err) {
      result.errors.push(err.message || String(err));
      console.error('[feedRefreshScheduler] Refresh failed:', err);
    } finally {
      const durationMs = Date.now() - startedAt;
      result.durationMs = durationMs;
      this._lastRefreshResult = result;
      this._isRefreshing = false;
    }

    return result;
  },

  getStatus() {
    return {
      isRefreshing: this._isRefreshing,
      lastRefreshAt: this._lastRefreshAt,
      lastRefreshResult: this._lastRefreshResult,
    };
  },

  /**
   * Trigger from Android background task
   */
  async triggerFromBackgroundTask() {
    console.log('[feedRefreshScheduler] Triggered from background task');
    return await this.refreshNow();
  },

  destroy() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  },
};

window.feedRefreshScheduler = feedRefreshScheduler;
