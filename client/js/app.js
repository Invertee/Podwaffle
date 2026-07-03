// Global app state
window.appState = {
  guid: localStorage.getItem('podwaffle_guid') || null,
  user: null,
  subscriptions: [],
  progress: {},
  currentRoute: null,
};

window.replaceProgressState = function(progressMap) {
  window.appState.progress = progressMap && typeof progressMap === 'object' ? { ...progressMap } : {};
  return window.appState.progress;
};

window.setEpisodeProgressState = function(episodeGuid, progress) {
  if (!episodeGuid) return null;
  if (!window.appState.progress || typeof window.appState.progress !== 'object') {
    window.appState.progress = {};
  }

  const nextProgress = progress ? {
    ...(window.appState.progress[episodeGuid] || {}),
    ...progress,
  } : null;

  if (nextProgress) {
    window.appState.progress[episodeGuid] = nextProgress;
  } else {
    delete window.appState.progress[episodeGuid];
  }

  window.dispatchEvent(new CustomEvent('podwaffle:progress-updated', {
    detail: {
      episodeGuid,
      progress: nextProgress,
    },
  }));

  return nextProgress;
};

// Global format utils
window.formatDuration = function(seconds) {
  if (!seconds || isNaN(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} mins`;
};

// Router
window.navigate = function(hash) {
  window.location.hash = hash;
};

function resetRouteScroll(mainContent) {
  window.scrollTo(0, 0);
  if (mainContent) {
    mainContent.scrollTop = 0;
  }
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    if (mainContent) {
      mainContent.scrollTop = 0;
    }
  });
}

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// DISABLED: Pull-to-refresh feature (commented out to re-enable later if needed)
/*
function initPullToRefresh() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;

  let startY = 0;
  let isDragging = false;
  let pullDelta = 0;
  const THRESHOLD = 72;

  const indicator = document.createElement('div');
  indicator.className = 'pull-refresh-indicator';
  indicator.innerHTML = `
    <div class="pull-refresh-icon">
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
    </div>
    <span class="pull-refresh-label">Pull down to refresh</span>
  `;
  document.body.insertAdjacentElement('afterbegin', indicator);

  mainContent.addEventListener('touchstart', (e) => {
    if (mainContent.scrollTop > 5) return;
    startY = e.touches[0].clientY;
    isDragging = true;
    pullDelta = 0;
  }, { passive: true });

  mainContent.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    pullDelta = e.touches[0].clientY - startY;
    if (pullDelta <= 0) { pullDelta = 0; return; }
    const progress = Math.min(pullDelta / THRESHOLD, 1);
    const translateY = Math.min(pullDelta * 0.45, 56);
    indicator.style.opacity = progress;
    indicator.style.transform = `translateY(${translateY}px)`;
    indicator.querySelector('.pull-refresh-label').textContent =
      pullDelta >= THRESHOLD ? 'Release to refresh' : 'Pull down to refresh';
  }, { passive: true });

  mainContent.addEventListener('touchend', async () => {
    if (!isDragging) return;
    isDragging = false;
    const shouldRefresh = pullDelta >= THRESHOLD;
    pullDelta = 0;

    if (shouldRefresh) {
      indicator.querySelector('.pull-refresh-label').textContent = 'Refreshing\u2026';
      indicator.querySelector('.pull-refresh-icon').classList.add('spinning');
      indicator.style.opacity = '1';
      indicator.style.transform = 'translateY(56px)';
      await handleRoute();
    }

    indicator.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateY(-100%)';
    setTimeout(() => {
      indicator.style.transition = '';
      indicator.querySelector('.pull-refresh-icon').classList.remove('spinning');
    }, 300);
  }, { passive: true });
}
*/

async function restoreLastInProgressEpisode(guid) {
  if (!window.player || !window.api || !guid) return;
  if (window.player.mode === 'cast' && window.player._activeCastDeviceId) return;
  if (window.player.currentEpisode) return;

  const getStoredSession = () => {
    try {
      const raw = localStorage.getItem('podwaffle_playback_session');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.guid !== guid) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  };

  const restoreFromSession = async (session) => {
    if (!session || !session.episodeGuid) return false;

    let episode = null;
    if (session.audioUrl) {
      episode = {
        guid: session.episodeGuid,
        title: session.title || 'Unknown episode',
        podcastTitle: session.podcastTitle || 'Unknown podcast',
        audioUrl: session.audioUrl,
        podcastImageUrl: session.podcastImageUrl || session.imageUrl || null,
        imageUrl: session.imageUrl || session.podcastImageUrl || null,
        feedId: session.feedId || null,
        duration: session.duration || 0,
      };
    } else if (session.feedId) {
      try {
        const podcast = await window.api.getPodcast(session.feedId, 500, 0);
        const found = (podcast.episodes || []).find((ep) => ep.guid === session.episodeGuid);
        if (found) {
          episode = {
            ...found,
            podcastTitle: podcast.title,
            podcastImageUrl: podcast.imageUrl,
            feedId: session.feedId,
          };
        }
      } catch (err) {
        console.warn('[app] Failed to hydrate playback session episode:', session.episodeGuid, err);
      }
    }

    if (!episode || !episode.audioUrl) return false;

    window.player.loadEpisode(episode, Math.max(0, session.position || 0), { autoplay: false });
    return true;
  };

  try {
    const localSession = getStoredSession();
    let serverSession = null;

    try {
      serverSession = await window.api.getPlaybackSession(guid);
    } catch (sessionErr) {
      console.warn('[app] Failed to load playback session:', sessionErr);
    }

    const sessionCandidates = [localSession, serverSession]
      .filter((item) => item && item.episodeGuid)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

    for (const session of sessionCandidates) {
      if (await restoreFromSession(session)) {
        return;
      }
    }

    const progress = await window.api.getProgress(guid);
    const candidates = Object.entries(progress || {})
      .map(([episodeGuid, data]) => ({ episodeGuid, ...(data || {}) }))
      .filter((item) => !item.played && (item.position || 0) > 0 && item.feedId)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

    for (const item of candidates) {
      try {
        const podcast = await window.api.getPodcast(item.feedId, 500, 0);
        const episode = (podcast.episodes || []).find((ep) => ep.guid === item.episodeGuid);
        if (!episode) continue;

        episode.podcastTitle = podcast.title;
        episode.podcastImageUrl = podcast.imageUrl;
        episode.feedId = item.feedId;
        window.player.loadEpisode(episode, item.position || 0, { autoplay: false });
        return;
      } catch (feedErr) {
        console.warn('[app] Failed to restore candidate episode:', item.episodeGuid, feedErr);
      }
    }
  } catch (err) {
    console.warn('[app] Failed to restore last in-progress episode:', err);
  }
}

async function handleRoute() {
  const hash = window.location.hash || '#/podcasts';
  window.appState.currentRoute = hash;
  
  const mainContent = document.getElementById('main-content');
  resetRouteScroll(mainContent);
  
  // Update Nav
  let routeName = hash.replace('#/', '');
  if (!routeName) routeName = 'podcasts';
  if (window.nav) window.nav.setActive(routeName);

  try {
    if (hash === '#/podcasts' || hash === '#/') {
      await window.renderPodcasts(mainContent);
    } else if (hash.startsWith('#/podcast/')) {
      const feedId = hash.replace('#/podcast/', '');
      await window.renderPodcastDetail(mainContent, feedId);
    } else if (hash === '#/in-progress') {
      await window.renderInProgress(mainContent);
    } else if (hash === '#/discover') {
      await window.renderDiscover(mainContent);
    } else if (hash === '#/history') {
      await window.renderHistory(mainContent);
    } else if (hash === '#/profile') {
      await window.renderProfile(mainContent);
    } else {
      mainContent.innerHTML = `<div class="error-state">Page not found</div>`;
    }
  } catch(err) {
    console.error('Route error:', err);
    mainContent.innerHTML = `<div class="error-state">An error occurred loading this page.</div>`;
  } finally {
    resetRouteScroll(mainContent);
  }
}

// Show modal to enter existing GUID when signups are disabled
async function showGuidEntryModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'guid-entry-modal-overlay';
    overlay.innerHTML = `
      <div class="guid-entry-modal">
        <h2>Enter Profile GUID</h2>
        <p>New user signups are currently disabled. Please enter an existing profile GUID to continue.</p>
        <div class="field">
          <input id="guid-entry-input" class="input" type="text" placeholder="Paste your profile GUID here">
          <small class="text-secondary">You can get your GUID from another device in Settings > Your GUID</small>
        </div>
        <div class="modal-actions">
          <button id="guid-entry-cancel" class="button">Cancel</button>
          <button id="guid-entry-submit" class="button is-success">Continue</button>
        </div>
        <div id="guid-entry-error" class="error-banner" style="display: none; margin-top: 1rem;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('guid-entry-input');
    const submitBtn = document.getElementById('guid-entry-submit');
    const cancelBtn = document.getElementById('guid-entry-cancel');
    const errorDiv = document.getElementById('guid-entry-error');

    const cleanup = () => {
      overlay.remove();
    };

    submitBtn.addEventListener('click', async () => {
      const guid = input.value.trim();
      if (!guid) {
        errorDiv.textContent = 'Please enter a GUID';
        errorDiv.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Validating...';

      try {
        // Validate GUID exists
        await window.api.getUser(guid);
        localStorage.setItem('podwaffle_guid', guid);
        window.appState.guid = guid;
        cleanup();
        resolve(guid);
      } catch (err) {
        errorDiv.textContent = 'Invalid GUID or profile not found.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    });

    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });

    input.focus();
  });
}

// App Initialization
async function initApp() {
  try {
    if (window.cacheManager) {
      window.cacheManager.init();
      window.setInterval(() => {
        window.cacheManager.cleanupExpired().catch(() => {});
      }, 6 * 60 * 60 * 1000);
    }

    // 1. Ensure user GUID (no backend needed - all local)
    // GUID is created below in step 2 if it doesn't already exist

    // 2. Initialize local user profile (no API calls needed)
    // All data is stored in localStorage for offline-first operation
    const generateUUID = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };

    const loadLocalUserProfile = () => {
      const guid = window.appState.guid;
      if (!guid) return null;

      // Load subscriptions from localStorage
      const subsKey = `podwaffle_subscriptions_${guid}`;
      const subscriptions = (() => {
        try {
          const raw = localStorage.getItem(subsKey);
          return raw ? JSON.parse(raw) : [];
        } catch (_) {
          return [];
        }
      })();

      // Load progress from localStorage
      const progressKey = `podwaffle_progress_${guid}`;
      const progress = (() => {
        try {
          const raw = localStorage.getItem(progressKey);
          return raw ? JSON.parse(raw) : {};
        } catch (_) {
          return {};
        }
      })();

      // Load playback session
      const playbackSessionKey = 'podwaffle_playback_session';
      const playbackSession = (() => {
        try {
          const raw = localStorage.getItem(playbackSessionKey);
          return raw ? JSON.parse(raw) : null;
        } catch (_) {
          return null;
        }
      })();

      // Load queue
      const queueKey = `podwaffle_queue_state_${guid}`;
      const queue = (() => {
        try {
          const raw = localStorage.getItem(queueKey);
          return raw ? JSON.parse(raw) : [];
        } catch (_) {
          return [];
        }
      })();

      // Load settings
      const settingsKey = `podwaffle_settings_${guid}`;
      const settings = (() => {
        try {
          const raw = localStorage.getItem(settingsKey);
          return raw ? JSON.parse(raw) : {};
        } catch (_) {
          return {};
        }
      })();

      return {
        guid,
        subscriptions,
        progress,
        playbackSession,
        queue,
        settings,
        stats: { totalListenedSeconds: 0, totalSkippedSeconds: 0 },
      };
    };

    let user = loadLocalUserProfile();

    // If no GUID exists, create one locally
    if (!window.appState.guid) {
      window.appState.guid = generateUUID();
      localStorage.setItem('podwaffle_guid', window.appState.guid);
      user = loadLocalUserProfile();
      console.log('[app] Created new local profile:', window.appState.guid);
    }

    // Register this client's GUID with the backend (idempotent — creates profile if missing).
    // Non-fatal: if the backend is unreachable the app continues in local mode.
    if (window.api && window.appState.guid) {
      await window.api.ensureUserOnBackend(window.appState.guid).catch(() => {});
    }

    window.appState.user = user;
    window.appState.subscriptions = user.subscriptions || [];
    window.appState.progress = user.progress || {};

    if (user.settings && window.player) {
      window.player.skipBackSecs = user.settings.skipBack || 15;
      window.player.skipForwardSecs = user.settings.skipForward || 45;
    }

    // 3. Render static UI components
    window.nav.render('sidebar');
    window.nav.render('bottom-nav');
    window.playerBar.render('player-bar');
    window.queue.render('queue-panel');
    window.castModal.render('cast-modal');

    // 4. Connect WebSocket and rejoin cast session if active
    let hasActiveCastSession = false;
    if (window.castClient) {
      window.castClient.connect();
      try {
        const castState = await window.api.getCastState();
        if (castState && castState.activeDeviceId) {
          hasActiveCastSession = true;

          if (window.googleCastSender && typeof window.googleCastSender.syncFromServerState === 'function') {
            await window.googleCastSender.syncFromServerState().catch((err) => {
              console.warn('[app] Failed to sync sender state from server:', err);
            });
          }

          if (window.player) {
            window.player.audio.pause();
            window.player.audio.removeAttribute('src');
            window.player.audio.load();
            window.player.mode = 'cast';
            window.player._activeCastDeviceId = castState.activeDeviceId;
            window.player.position = castState.position || 0;
            window.player.duration = castState.duration || 0;
            window.player.isPlaying = castState.status === 'playing';
            
            // Restore episode metadata from cast state if available
            window.player.currentEpisode = {
              ...(window.player.currentEpisode || {}),
              title: castState.title || 'Casting session',
              podcastTitle: castState.podcastTitle || 'Casting',
              guid: castState.episodeGuid || null,
              audioUrl: castState.mediaUrl || window.player.currentEpisode?.audioUrl || '',
              podcastImageUrl: castState.imageUrl || null,
              feedId: null
            };
            window.player._notifyStateChange();
          }
        }
      } catch (err) {
        console.warn('Failed to rejoin cast session:', err);
      }
    }

    if (!hasActiveCastSession) {
      try {
        await restoreLastInProgressEpisode(window.appState.guid);
      } catch (err) {
        console.warn('[app] Failed to restore last episode:', err);
      }
    }

    if (window.player && typeof window.player.hydrateQueueFromServer === 'function') {
      try {
        await window.player.hydrateQueueFromServer();
      } catch (err) {
        console.warn('[app] Failed to hydrate queue:', err);
      }
    }

    // Set up cross-client sync listeners
    if (window.castClient) {
      window.castClient.on('user:progress', () => {
        const h = window.location.hash;
        if (h === '#/in-progress' || h === '#/history') handleRoute();
      });
      window.castClient.on('user:subscriptions', () => {
        const h = window.location.hash;
        if (!h || h === '#/' || h === '#/podcasts') handleRoute();
      });
      window.castClient.on('user:queue', (payload) => {
        const incomingGuid = payload?.guid;
        if (!incomingGuid || incomingGuid !== window.appState.guid) return;
        const incomingMode = payload?.mode === 'cast' ? 'cast' : (payload?.mode === 'local' ? 'local' : null);
        if (incomingMode && window.player && window.player.mode && incomingMode !== window.player.mode) {
          return;
        }
        if (window.player && payload?.updatedAt && window.player._toTimestamp) {
          const incomingTs = window.player._toTimestamp(payload.updatedAt);
          const localTs = window.player._toTimestamp(window.player._queueStateUpdatedAt);
          if (incomingTs && localTs && incomingTs < localTs) {
            return;
          }
        }
        if (window.player && typeof window.player.hydrateQueueFromServer === 'function') {
          window.player.hydrateQueueFromServer();
        }
      });
    }

    // 5. Initial routing
    window.addEventListener('hashchange', handleRoute);
    await handleRoute();

    // 6. Register Service Worker
    if ('serviceWorker' in navigator) {
      const swPath = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/sw.js' : './sw.js');
      const swScope = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/' : '/');
      navigator.serviceWorker.register(swPath, { scope: swScope })
        .then(reg => console.log('[SW] Registered at:', swPath, 'scope:', reg.scope))
        .catch(err => console.error('[SW] Registration failed:', err));
    }

    // 7. Init pull-to-refresh gesture (DISABLED)
    // initPullToRefresh();

    // 8. Initialize background sync managers
    if (window.backgroundSyncManager && typeof window.backgroundSyncManager.init === 'function') {
      window.backgroundSyncManager.init();
    }
    if (window.feedRefreshScheduler && typeof window.feedRefreshScheduler.init === 'function') {
      window.feedRefreshScheduler.init();
    }

    // 9. Capacitor native bridge (no-op in browser, active in native app)
    _initCapacitorBridge();

  } catch (err) {
    console.error('Failed to initialize app:', err);
    document.body.innerHTML = `
      <div style="color:white; padding: 2rem; text-align: center;">
        <h2>Failed to start Podwaffle</h2>
        <p>Could not connect to the backend server. Please ensure it is running.</p>
        <pre style="color:red; margin-top:1rem;">${err.message}</pre>
        <button onclick="window.location.reload()" style="margin-top:1rem; padding: 0.5rem 1rem;">Retry</button>
      </div>
    `;
  }
}

// Start
document.addEventListener('DOMContentLoaded', initApp);

// ---------------------------------------------------------------------------
// Capacitor native bridge
// Integrates with Capacitor plugins when running inside the native Android/iOS
// app. Safe to call in a browser — all Capacitor checks are guarded.
// ---------------------------------------------------------------------------
function _initCapacitorBridge() {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform()) return;

  const Plugins = cap.Plugins || {};
  console.log('[capacitor] Native platform detected — initialising bridge.');

  // Hide the splash screen now that the app shell is ready
  Plugins.SplashScreen?.hide({ fadeOutDuration: 300 });

  // Setup background tasks for feed refresh on Android
  if (Plugins.BackgroundTasks && window.capacitorBackgroundTasks) {
    window.capacitorBackgroundTasks.init().catch((err) => {
      console.warn('[capacitor] Background task setup failed:', err);
    });
  }

  // Keep system bars visually aligned with app theme
  try {
    Plugins.StatusBar?.setStyle?.({ style: 'DARK' });
    Plugins.StatusBar?.setBackgroundColor?.({ color: '#1a1a2e' });
    Plugins.StatusBar?.setOverlaysWebView?.({ overlay: false });
  } catch (err) {
    console.warn('[capacitor] StatusBar configuration failed:', err);
  }

  // App lifecycle — flush progress to server when going to background
  Plugins.App?.addListener('appStateChange', (state) => {
    if (!state.isActive) {
      // Went to background: flush playback position so it's safe if the OS kills us
      if (window.player?.mode === 'local' && typeof window.player._syncProgress === 'function') {
        window.player._syncProgress({ force: true });
      }
      console.log('[capacitor] App backgrounded — progress flushed.');
    } else {
      // Came to foreground: refresh queue/subscriptions in case another device updated them
      console.log('[capacitor] App foregrounded.');
      if (window.player && typeof window.player.hydrateQueueFromServer === 'function') {
        window.player.hydrateQueueFromServer();
      }
    }
  });

  // Back button — navigate back in hash history; exit app on root
  Plugins.App?.addListener('backButton', ({ canGoBack }) => {
    const hash = window.location.hash;
    const isRoot = !hash || hash === '#/' || hash === '#/podcasts';
    if (isRoot) {
      Plugins.App.exitApp();
    } else {
      window.history.back();
    }
  });

  // Deep-link / URL open
  Plugins.App?.addListener('appUrlOpen', (data) => {
    try {
      const url = new URL(data.url);
      if (url.hash) window.navigate(url.hash);
    } catch (_) {}
  });
}
