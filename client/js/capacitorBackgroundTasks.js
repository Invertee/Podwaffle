/* ============================================================
   Podwaffle — capacitorBackgroundTasks.js
   Setup Capacitor background tasks for Android feed refresh.
   Registers periodic background task that runs feed refresh.
   ============================================================ */

const capacitorBackgroundTasks = {
  _tasksRegistered: false,

  /**
   * Initialize background task support
   * Called from Capacitor bridge when running on native platform
   */
  async init() {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform()) {
      console.log('[bgTasks] Not a native platform, skipping background task setup');
      return;
    }

    const Plugins = cap.Plugins || {};
    if (!Plugins.BackgroundTasks) {
      console.warn('[bgTasks] BackgroundTasks plugin not available');
      return;
    }

    try {
      console.log('[bgTasks] Setting up background tasks...');

      // Register a background task that runs every 30 minutes
      // Task ID: 'feed_refresh'
      // Interval: 30 minutes (1800000ms)
      await Plugins.BackgroundTasks.registerTask?.({
        id: 'feed_refresh',
        label: 'Podcast Feed Refresh',
        description: 'Check for new podcast episodes',
        interval: 30, // 30 minutes
        requiresNetwork: true,
        requiresDeviceIdle: false,
        requiresCharging: false,
      });

      console.log('[bgTasks] Registered periodic feed refresh task (30 min interval)');
      this._tasksRegistered = true;

      // Listen for task execution events
      Plugins.BackgroundTasks?.addListener?.('taskFinished', (data) => {
        if (data.taskId === 'feed_refresh') {
          console.log('[bgTasks] Feed refresh task executed', data);
          if (window.feedRefreshScheduler) {
            window.feedRefreshScheduler.triggerFromBackgroundTask().catch((err) => {
              console.error('[bgTasks] Feed refresh failed:', err);
            });
          }
        }
      });

      Plugins.BackgroundTasks?.addListener?.('taskError', (data) => {
        console.error('[bgTasks] Task error:', data);
      });
    } catch (err) {
      console.warn('[bgTasks] Failed to register background tasks:', err);
    }
  },

  /**
   * Clean up background tasks
   */
  async destroy() {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform()) return;

    const Plugins = cap.Plugins || {};
    if (!Plugins.BackgroundTasks) return;

    try {
      await Plugins.BackgroundTasks?.removeAllListeners?.();
      console.log('[bgTasks] Cleaned up background task listeners');
    } catch (err) {
      console.warn('[bgTasks] Failed to cleanup background tasks:', err);
    }
  },

  isSupported() {
    const cap = window.Capacitor;
    return cap && cap.isNativePlatform() && !!(cap.Plugins?.BackgroundTasks);
  },
};

window.capacitorBackgroundTasks = capacitorBackgroundTasks;
