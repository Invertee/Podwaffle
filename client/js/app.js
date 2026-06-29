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

async function handleRoute() {
  const hash = window.location.hash || '#/podcasts';
  window.appState.currentRoute = hash;
  
  const mainContent = document.getElementById('main-content');
  
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
  }
}

// App Initialization
async function initApp() {
  try {
    // 1. Ensure user GUID
    if (!window.appState.guid) {
      console.log('No GUID found, creating new user profile...');
      const { guid } = await window.api.createUser();
      window.appState.guid = guid;
      localStorage.setItem('podwaffle_guid', guid);
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
    if (window.castClient) {
      window.castClient.connect();
      try {
        const castState = await window.api.getCastState();
        if (castState && castState.activeDeviceId && castState.mediaUrl) {
          if (window.player) {
            window.player.mode = 'cast';
            window.player._activeCastDeviceId = castState.activeDeviceId;
            window.player.position = castState.position || 0;
            window.player.duration = castState.duration || 0;
            window.player.isPlaying = castState.status === 'playing';
            window.player.currentEpisode = window.player.currentEpisode || {
              title: 'Casting session',
              podcastTitle: 'Casting',
              audioUrl: castState.mediaUrl,
              podcastImageUrl: null,
              guid: null,
              feedId: null
            };
            window.player._notifyStateChange();
          }
        }
      } catch (err) {
        console.warn('Failed to rejoin cast session:', err);
      }
    }

    // 5. Initial routing
    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // 6. Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('[SW] Registered scope:', reg.scope))
        .catch(err => console.error('[SW] Registration failed:', err));
    }

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
