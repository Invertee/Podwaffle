// Global app state
window.appState = {
  guid: localStorage.getItem('podwaffle_guid') || null,
  user: null,
  subscriptions: [],
  progress: {},
  currentRoute: null,
};

window.getPodwaffleClientId = function() {
  const key = 'podwaffle_client_id';
  let existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(key, next);
  return next;
};

window.replaceProgressState = function(progressMap) {
  window.appState.progress = progressMap && typeof progressMap === 'object' ? { ...progressMap } : {};
  if (window.appState.user) {
    window.appState.user.progress = window.appState.progress;
  }
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
  if (window.appState.user) {
    window.appState.user.progress = window.appState.progress;
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

    const localClientId = window.getPodwaffleClientId ? window.getPodwaffleClientId() : localStorage.getItem('podwaffle_client_id');
    if (serverSession?.clientId && serverSession.clientId !== localClientId && window.player?.applyRemotePlaybackSession) {
      window.player.applyRemotePlaybackSession(serverSession);
      return;
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

let profileStateRefreshPromise = null;
let lastProfileStateRefreshAt = 0;

async function refreshProfileStateFromServer(reason = 'manual', options = {}) {
  const guid = window.appState?.guid || localStorage.getItem('podwaffle_guid');
  if (!guid || !window.api) return null;

  const now = Date.now();
  const minIntervalMs = options.force ? 0 : 30000;
  if (profileStateRefreshPromise) return profileStateRefreshPromise;
  if (now - lastProfileStateRefreshAt < minIntervalMs) return null;

  profileStateRefreshPromise = (async () => {
    try {
      lastProfileStateRefreshAt = Date.now();
      const result = await window.offlineStore?.refreshProfile?.(guid);
      const profile = window.offlineStore?.cachedProfile?.(guid);
      if (profile) {
        window.appState.user = profile;
        window.appState.subscriptions = profile.subscriptions || [];
        window.replaceProgressState(profile.progress || {});
      }
      return result ? { ok: true, mode: 'server', reason } : null;
    } catch (err) {
      console.warn(`[app] Profile state refresh failed (${reason}):`, err);
      return null;
    } finally {
      profileStateRefreshPromise = null;
    }
  })();

  return profileStateRefreshPromise;
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

async function showConnectionSetup(message = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'guid-entry-modal-overlay';
    overlay.innerHTML = `
      <div class="guid-entry-modal">
        <h2>Connect to Podwaffle</h2>
        <p id="server-setup-message"></p>
        <div class="field">
          <label class="label has-text-light">Server URL</label>
          <input id="server-setup-url" class="input" type="url" placeholder="Leave blank when opened from the add-on">
        </div>
        <div class="field">
          <label class="label has-text-light">Access key</label>
          <input id="server-setup-key" class="input" type="password" autocomplete="current-password" placeholder="Configured in the add-on">
        </div>
        <div class="modal-actions"><button id="server-setup-submit" class="button is-success">Continue</button></div>
        <div id="server-setup-error" class="error-banner" style="display: none; margin-top: 1rem;"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#server-setup-message').textContent = message || 'Connect this client to your Home Assistant Podwaffle add-on.';
    const urlInput = overlay.querySelector('#server-setup-url');
    const keyInput = overlay.querySelector('#server-setup-key');
    const submit = overlay.querySelector('#server-setup-submit');
    const error = overlay.querySelector('#server-setup-error');
    const current = window.api.getServerConnectionConfig();
    urlInput.value = current.baseUrl || '';
    keyInput.value = current.accessKey || '';

    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.textContent = 'Connecting...';
      try {
        window.api.saveServerConnectionConfig({ baseUrl: urlInput.value.trim(), accessKey: keyInput.value });
        const response = await window.api.getProfiles();
        overlay.remove();
        resolve(response.profiles || []);
      } catch (err) {
        error.textContent = err.status === 401 ? 'The access key is incorrect.' : (err.message || 'The server could not be reached.');
        error.style.display = 'block';
        submit.disabled = false;
        submit.textContent = 'Continue';
      }
    });
    keyInput.addEventListener('keypress', (event) => { if (event.key === 'Enter') submit.click(); });
    (current.baseUrl ? keyInput : urlInput).focus();
  });
}

async function showProfilePicker(profiles, selectedId = '') {
  if (profiles.length === 1) return profiles[0].id;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'guid-entry-modal-overlay';
    overlay.innerHTML = `
      <div class="guid-entry-modal">
        <h2>Choose a profile</h2>
        <p>Profiles are managed in the Home Assistant add-on configuration.</p>
        <div class="field"><select id="profile-picker" class="input"></select></div>
        <div class="modal-actions"><button id="profile-picker-submit" class="button is-success">Continue</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const select = overlay.querySelector('#profile-picker');
    profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      option.selected = profile.id === selectedId;
      select.appendChild(option);
    });
    overlay.querySelector('#profile-picker-submit').addEventListener('click', () => {
      const value = select.value;
      overlay.remove();
      resolve(value);
    });
  });
}

async function selectConfiguredProfile() {
  const savedId = localStorage.getItem('podwaffle_guid') || '';
  try {
    const response = await window.api.getProfiles();
    const profiles = response?.profiles || [];
    if (!profiles.length) throw new Error('No profiles are configured on the server.');
    const selected = profiles.some((profile) => profile.id === savedId) ? savedId : await showProfilePicker(profiles, savedId);
    localStorage.setItem('podwaffle_guid', selected);
    return selected;
  } catch (err) {
    const cached = savedId && window.offlineStore?.cachedProfile?.(savedId);
    if (cached && (!navigator.onLine || !err.status)) return savedId;
    const profiles = await showConnectionSetup(
      err.status === 401
        ? 'Enter the access key configured in the add-on.'
        : 'Enter the URL of your Home Assistant Podwaffle add-on.'
    );
    const selected = await showProfilePicker(profiles, savedId);
    localStorage.setItem('podwaffle_guid', selected);
    return selected;
  }
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

    // Profiles are server-configured. A previously cached profile is sufficient
    // to start while offline after the first successful connection.
    window.appState.guid = await selectConfiguredProfile();
    const user = await window.api.getUser(window.appState.guid);

    window.appState.user = user;
    window.appState.subscriptions = user.subscriptions || [];
    window.appState.progress = user.progress || {};
    // Start decoding cached cover art while the rest of app startup runs. This
    // avoids a delayed first paint when the Podcasts view is opened.
    window.prewarmPodcastArtwork?.(window.appState.subscriptions);

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
      try {
        const castSessionResponse = (window.api && typeof window.api.getCastSession === 'function')
          ? await window.api.getCastSession()
          : null;
        const castState = castSessionResponse?.session || castSessionResponse || null;

        if (castState && (castState.activeDeviceId || castState.deviceId)) {
          const activeDeviceId = castState.activeDeviceId || castState.deviceId;
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
            window.player._activeCastDeviceId = activeDeviceId;
            window.player.position = castState.position || 0;
            window.player.duration = castState.duration || 0;
            window.player.isPlaying = castState.status === 'playing';
            if (Number.isFinite(Number(castState.volume))) {
              window.player.volume = Math.max(0, Math.min(1, Number(castState.volume)));
            }
            
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
      window.castClient.on('sync:state', (payload) => {
        const incomingGuid = payload?.guid;
        if (incomingGuid && incomingGuid !== window.appState.guid) return;
        const snapshot = payload?.snapshot || {};
        window.offlineStore?.hydrateSyncState?.(payload);
        if (snapshot.progress && window.replaceProgressState) {
          window.replaceProgressState(snapshot.progress);
        }
        const cachedProfile = window.offlineStore?.cachedProfile?.(window.appState.guid);
        if (window.appState?.user && Array.isArray(cachedProfile?.subscriptions)) {
          // hydrateSyncState enriches server feed URLs with cached feed data.
          // Keep that shape in appState so an incoming event cannot temporarily
          // replace usable podcast cards with bare strings.
          window.appState.user.subscriptions = cachedProfile.subscriptions;
        }
        if (window.player && typeof window.player.applyRemotePlaybackSession === 'function') {
          window.player.applyRemotePlaybackSession(payload?.playbackSession || snapshot.playbackSession || null);
        }
        window.dispatchEvent(new CustomEvent('podwaffle:sync-state', { detail: payload }));
        const h = window.location.hash;
        if (!h || h === '#/' || h === '#/podcasts' || h === '#/in-progress' || h === '#/history') {
          handleRoute();
        }
      });
      window.castClient.on('feeds:updated', (payload) => {
        const incomingGuid = payload?.guid;
        if (incomingGuid && incomingGuid !== window.appState.guid) return;
        const feeds = Array.isArray(payload?.feeds) ? payload.feeds : [];
        feeds.forEach((feed) => window.offlineStore?.rememberPodcast?.(feed));
        if (feeds.length) {
          const cached = window.offlineStore?.cachedProfile?.(window.appState.guid);
          const replacements = new Map();
          feeds.forEach((feed) => {
            if (feed.feedId) replacements.set(feed.feedId, feed);
            if (feed.feedUrl) replacements.set(feed.feedUrl, feed);
          });
          const subscriptions = (cached?.subscriptions || []).map((feed) => {
            const key = typeof feed === 'string' ? feed : (feed.feedId || feed.feedUrl);
            return replacements.get(key) || feed;
          });
          window.offlineStore?.rememberProfile?.(window.appState.guid, { subscriptions });
          if (window.appState?.user) window.appState.user.subscriptions = subscriptions;
        }
        window.dispatchEvent(new CustomEvent('podwaffle:feeds-updated', { detail: payload }));
        const h = window.location.hash;
        if (!h || h === '#/' || h === '#/podcasts' || h.startsWith('#/podcast/')) handleRoute();
      });
      window.castClient.on('connected', () => {
        window.dispatchEvent(new CustomEvent('podwaffle:websocket-connected'));
        refreshProfileStateFromServer('websocket-connected');
        if (window.googleCastSender && typeof window.googleCastSender.syncFromServerState === 'function') {
          window.googleCastSender.syncFromServerState().catch(() => null);
        }
      });
      window.castClient.on('user:progress', async (payload) => {
        const incomingGuid = payload?.guid;
        if (incomingGuid && incomingGuid !== window.appState.guid) return;
        if (payload?.episodeGuid && payload?.progress && window.setEpisodeProgressState) {
          window.setEpisodeProgressState(payload.episodeGuid, payload.progress);
        } else if (window.api && window.appState.guid) {
          try {
            const progress = await window.api.getProgress(window.appState.guid);
            window.replaceProgressState(progress || {});
            if (payload?.episodeGuid && window.setEpisodeProgressState) {
              window.setEpisodeProgressState(payload.episodeGuid, progress?.[payload.episodeGuid] || null);
            }
          } catch (err) {
            console.warn('[app] Failed to refresh progress after websocket update:', err);
          }
        }
        const h = window.location.hash;
        if (h === '#/in-progress') {
          const row = payload?.episodeGuid
            ? Array.from(document.querySelectorAll('[data-guid]')).find((item) => item.dataset.guid === payload.episodeGuid)
            : null;
          const progress = payload?.progress || null;
          const shouldBeVisible = !!(progress && !progress.played && Number(progress.position || 0) > 0);
          if (!row || !shouldBeVisible) handleRoute();
        } else if (h === '#/history' && payload?.progress?.played) {
          handleRoute();
        }
      });
      window.castClient.on('user:playback-session', (payload) => {
        const incomingGuid = payload?.guid;
        if (incomingGuid && incomingGuid !== window.appState.guid) return;
        if (window.player && typeof window.player.applyRemotePlaybackSession === 'function') {
          window.player.applyRemotePlaybackSession(payload?.session || null);
        }
      });
      window.castClient.on('session:revoked', (payload) => {
        const clientId = window.getPodwaffleClientId?.() || '';
        if (payload?.targetClientId !== clientId) return;
        window.player?.applyRemotePlaybackSession?.(payload.session || null);
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
      window.castClient.connect();
    }
    refreshProfileStateFromServer('startup');

    // 5. Initial routing
    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('online', () => {
      refreshProfileStateFromServer('browser-online');
      if (window.castClient && !window.castClient.isConnected()) {
        window.castClient.connect();
      }
    });
    await handleRoute();

    // 6. Register Service Worker
    if ('serviceWorker' in navigator) {
      const swPath = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/sw.js' : './sw.js');
      const swScope = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/' : '/');
      navigator.serviceWorker.register(swPath, { scope: swScope })
        .then(reg => console.log('[SW] Registered at:', swPath, 'scope:', reg.scope))
        .catch(err => console.error('[SW] Registration failed:', err));
    }

    // 7. Capacitor native bridge (no-op in browser, active in native app)
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
      refreshProfileStateFromServer('capacitor-foreground', { force: true });
      if (window.castClient && !window.castClient.isConnected()) {
        window.castClient.connect();
      }
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
