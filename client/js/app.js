// Global app state
window.appState = {
  guid: localStorage.getItem('podwaffle_guid') || null,
  user: null,
  subscriptions: [],
  progress: {},
  currentRoute: null,
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

  try {
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

    // 1. Ensure user GUID
    if (!window.appState.guid) {
      console.log('No GUID found, creating new user profile...');
      try {
        const { guid } = await window.api.createUser();
        window.appState.guid = guid;
        localStorage.setItem('podwaffle_guid', guid);
      } catch (err) {
        // Check if signup is disabled (403 error)
        if (err.message && err.message.includes('403')) {
          console.log('New user signups are disabled, prompting for existing GUID...');
          const guid = await showGuidEntryModal();
          if (!guid) {
            throw new Error('No profile GUID provided. Cannot continue.');
          }
        } else {
          throw err;
        }
      }
    }

    // 2. Load user settings to configure player
    const user = await window.api.getUser(window.appState.guid);
    window.appState.user = user;
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
        if (castState && castState.activeDeviceId && castState.mediaUrl) {
          hasActiveCastSession = true;
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
              audioUrl: castState.mediaUrl,
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
      await restoreLastInProgressEpisode(window.appState.guid);
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
    }

    // 5. Initial routing
    window.addEventListener('hashchange', handleRoute);
    await handleRoute();

    // 6. Register Service Worker
    if ('serviceWorker' in navigator) {
      const swPath = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/sw.js' : '/sw.js');
      const swScope = (window.APP_BASE_PATH || '/');
      navigator.serviceWorker.register(swPath, { scope: swScope })
        .then(reg => console.log('[SW] Registered at:', swPath, 'scope:', reg.scope))
        .catch(err => console.error('[SW] Registration failed:', err));
    }

    // 7. Init pull-to-refresh gesture (DISABLED)
    // initPullToRefresh();

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
