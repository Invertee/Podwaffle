async function renderPodcasts(container) {
  const VIEW_KEY = 'podwaffle_view_mode_podcasts';
  const getViewMode = () => localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  const setViewMode = (mode) => localStorage.setItem(VIEW_KEY, mode === 'list' ? 'list' : 'grid');
  // These images are the primary content of this view.  Decoding them
  // asynchronously lets a cache hit still be painted a frame (or more) after
  // its tile, which is visible as artwork popping in.
  const imageAttrs = 'loading="eager" decoding="sync" fetchpriority="high" draggable="false"';

  container.innerHTML = `
    <div class="view-header"></div>
    <button id="podcasts-view-toggle" class="view-mode-toggle" title="Toggle view mode" aria-label="Toggle view mode">
      <svg class="view-mode-icon-grid" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      <svg class="view-mode-icon-list" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
    </button>
    <br>
    <div id="podcasts-grid" class="podcast-grid">
      <div class="loading-state">
        <div class="spinner spin"></div>
        <p>Loading podcasts...</p>
      </div>
    </div>
  `;

  const gridEl = document.getElementById('podcasts-grid');
  const toggleEl = document.getElementById('podcasts-view-toggle');
  let currentMode = getViewMode();

  const applyViewMode = (mode) => {
    currentMode = mode === 'list' ? 'list' : 'grid';
    setViewMode(currentMode);
    gridEl.classList.toggle('podcast-grid-list', currentMode === 'list');
    toggleEl.classList.toggle('is-list', currentMode === 'list');
    toggleEl.title = currentMode === 'list' ? 'Switch to grid view' : 'Switch to list view';
    toggleEl.setAttribute('aria-label', toggleEl.title);
  };

  toggleEl.addEventListener('click', () => {
    applyViewMode(currentMode === 'list' ? 'grid' : 'list');
    renderPodcasts(container);
  });

  applyViewMode(currentMode);

  try {
    const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
    if (!guid) {
      gridEl.innerHTML = `<div class="empty-state">No profile found. Please refresh.</div>`;
      return;
    }

    const subscriptions = await window.api.getSubscriptions(guid);
    _prewarmPodcastArtwork(subscriptions);

    if (!subscriptions || subscriptions.length === 0) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="64" height="64" stroke="var(--text-muted)" stroke-width="1" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          <h2>No podcasts yet</h2>
          <p>Head over to Discover to find something to listen to.</p>
          <a href="#/discover" class="btn btn-primary" style="margin-top: 16px;">Discover Podcasts</a>
        </div>
      `;
      gridEl.style.display = 'flex';
      gridEl.style.justifyContent = 'center';
      return;
    }

    let html = '';
    subscriptions.forEach(sub => {
      if (currentMode === 'list') {
        const updatedText = sub.lastRefreshed
          ? new Date(sub.lastRefreshed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : 'Unknown date';
        const description = sub.description || sub.author || 'No description available.';
        html += `
          <div class="podcast-list-item" data-feed-id="${_escapePodcastAttr(sub.feedId)}" data-feed-url="${_escapePodcastAttr(sub.feedUrl || '')}" draggable="true">
            <img src="${sub.imageUrl || 'icons/icon-192.png'}" alt="${sub.title || 'Podcast'}" onerror="this.src='icons/icon-192.png'" ${imageAttrs}>
            <div class="podcast-list-body">
              <div class="podcast-list-title">${sub.title || 'Untitled podcast'}</div>
              <div class="podcast-list-date">Last update: ${updatedText}</div>
              <div class="podcast-list-description">${description}</div>
            </div>
            ${sub.hasRecentEpisode ? '<div class="new-dot"></div>' : ''}
          </div>
        `;
      } else {
        html += `
          <div class="podcast-tile" data-feed-id="${_escapePodcastAttr(sub.feedId)}" data-feed-url="${_escapePodcastAttr(sub.feedUrl || '')}" draggable="true">
            <img src="${sub.imageUrl || 'icons/icon-192.png'}" alt="${sub.title || 'Podcast'}" onerror="this.src='icons/icon-192.png'" ${imageAttrs}>
            ${sub.hasRecentEpisode ? '<div class="new-dot"></div>' : ''}
          </div>
        `;
      }
    });

    gridEl.innerHTML = html;

    // Bind tile click (navigate only when not dragging)
    gridEl.querySelectorAll('[data-feed-id]').forEach(tile => {
      tile.addEventListener('click', () => {
        if (tile.classList.contains('dragging')) return;
        window.navigate(`#/podcast/${tile.dataset.feedId}`);
      });
    });

    _initTileDrag(gridEl, guid);

  } catch (err) {
    console.error('Failed to load podcasts view:', err);
    gridEl.innerHTML = `<div class="error-state">Failed to load podcasts.</div>`;
  }
}

const PODCAST_ARTWORK_PRELOAD_LIMIT = 80;
const podcastArtworkPreloads = new Map();

function _prewarmPodcastArtwork(subscriptions = []) {
  const urls = Array.from(new Set((subscriptions || [])
    .map((sub) => sub && sub.imageUrl)
    .filter(Boolean))).slice(0, PODCAST_ARTWORK_PRELOAD_LIMIT);
  if (!urls.length) return;

  urls.forEach((url) => _decodePodcastArtwork(url));

  if (typeof caches === 'undefined') return;
  caches.open('podwaffle-images-v1').then((cache) => {
    urls.forEach((url) => {
      cache.match(url).then((cached) => {
        if (!cached) {
          fetch(url, { mode: 'no-cors' })
            .then((response) => {
              if (response && (response.ok || response.type === 'opaque')) {
                cache.put(url, response.clone()).catch(() => {});
              }
            })
            .catch(() => {});
        }
      }).catch(() => {});
    });
  }).catch(() => {});
}

function _decodePodcastArtwork(url) {
  if (!url || podcastArtworkPreloads.has(url)) return podcastArtworkPreloads.get(url);

  const image = new Image();
  image.decoding = 'async';
  image.fetchPriority = 'high';
  const decoded = new Promise((resolve) => {
    image.onload = () => {
      // decode() makes the prewarm useful for the next DOM image, rather than
      // only ensuring that its bytes are present in Cache Storage.
      Promise.resolve(image.decode ? image.decode() : null).catch(() => null).then(resolve);
    };
    image.onerror = resolve;
  });

  // Keep the Image alive for the session so browsers do not immediately evict
  // its decoded bitmap before the menu or detail view uses it.
  podcastArtworkPreloads.set(url, { image, decoded });
  image.src = url;
  return podcastArtworkPreloads.get(url);
}

function _escapePodcastAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function _saveTileOrder(gridEl, guid) {
  const tiles = [...gridEl.querySelectorAll('[data-feed-id]')];
  const feedIds = tiles.map(t => t.dataset.feedId).filter(Boolean);
  const feedUrls = tiles.map(t => t.dataset.feedUrl).filter(Boolean);
  try {
    const result = await window.api.reorderSubscriptions(guid, feedIds);
    const updatedAt = result?.subscriptionsUpdatedAt || new Date().toISOString();
    const updatedSubscriptions = Array.isArray(result?.subscriptions)
      ? result.subscriptions
      : feedUrls;

    if (window.appState) {
      window.appState.subscriptions = updatedSubscriptions;
      window.appState.subscriptionsUpdatedAt = updatedAt;
      if (window.appState.user) {
        window.appState.user.subscriptions = updatedSubscriptions;
        window.appState.user.subscriptionsUpdatedAt = updatedAt;
      }
    }

    try {
      localStorage.setItem(`podwaffle_subscriptions_updated_at_${guid}`, JSON.stringify(updatedAt));
      if (updatedSubscriptions.length > 0) {
        localStorage.setItem(`podwaffle_subscriptions_${guid}`, JSON.stringify(updatedSubscriptions));
      }
    } catch (_) {}

    console.log('[podcasts] Saved tile order:', feedIds);
  } catch (err) {
    console.error('[podcasts] Failed to save tile order:', err);
  }
}

function _initTileDrag(gridEl, guid) {
  const tileSelector = '[data-feed-id]';
  // ── HTML5 Drag (desktop mouse) ────────────────────────
  let dragSrcEl = null;
  let didDrag = false;

  gridEl.addEventListener('dragstart', (e) => {
    dragSrcEl = e.target.closest(tileSelector);
    if (!dragSrcEl) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcEl.dataset.feedId);
    didDrag = false;
    // Use rAF so the dragging class doesn't affect the drag ghost
    requestAnimationFrame(() => dragSrcEl && dragSrcEl.classList.add('dragging'));
  });

  gridEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest(tileSelector);
    if (!target || target === dragSrcEl) return;
    const rect = target.getBoundingClientRect();
    const isAfter = e.clientX > rect.left + rect.width / 2;
    target.parentNode.insertBefore(dragSrcEl, isAfter ? target.nextSibling : target);
    didDrag = true;
  });

  gridEl.addEventListener('dragend', async () => {
    if (dragSrcEl) dragSrcEl.classList.remove('dragging');
    dragSrcEl = null;
    if (didDrag) await _saveTileOrder(gridEl, guid);
    didDrag = false;
  });

  // ── Touch Drag (mobile — long-press to start) ─────────
  let touchDragEl = null;
  let touchGhost = null;
  let touchOffX = 0, touchOffY = 0;
  let touchHoldTimer = null;
  let touchDidDrag = false;
  let touchStartX = 0, touchStartY = 0;

  gridEl.addEventListener('touchstart', (e) => {
    const tile = e.target.closest(tileSelector);
    if (!tile) return;
    const touch = e.touches[0];
    const rect = tile.getBoundingClientRect();
    touchOffX = touch.clientX - rect.left;
    touchOffY = touch.clientY - rect.top;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchDidDrag = false;

    touchHoldTimer = setTimeout(() => {
      touchDragEl = tile;
      tile.classList.add('dragging');

      touchGhost = tile.cloneNode(true);
      touchGhost.classList.add('touch-drag-ghost');
      Object.assign(touchGhost.style, {
        position: 'fixed',
        width: rect.width + 'px',
        height: rect.height + 'px',
        left: (touch.clientX - touchOffX) + 'px',
        top: (touch.clientY - touchOffY) + 'px',
        opacity: '0.85',
        pointerEvents: 'none',
        zIndex: '9999',
        transform: 'scale(1.06)',
      });
      document.body.appendChild(touchGhost);
    }, 350);
  }, { passive: true });

  gridEl.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    // Cancel hold if user swiped (scroll intent)
    if (!touchDragEl) {
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);
      if (dx > 8 || dy > 8) clearTimeout(touchHoldTimer);
      return;
    }
    e.preventDefault();
    touchGhost.style.left = (touch.clientX - touchOffX) + 'px';
    touchGhost.style.top = (touch.clientY - touchOffY) + 'px';

    touchGhost.style.visibility = 'hidden';
    const below = document.elementFromPoint(touch.clientX, touch.clientY);
    touchGhost.style.visibility = '';

    const target = below && below.closest(tileSelector);
    if (target && target !== touchDragEl) {
      const rect = target.getBoundingClientRect();
      const isAfter = touch.clientX > rect.left + rect.width / 2;
      target.parentNode.insertBefore(touchDragEl, isAfter ? target.nextSibling : target);
      touchDidDrag = true;
    }
  }, { passive: false });

  const endTouchDrag = async () => {
    clearTimeout(touchHoldTimer);
    if (!touchDragEl) return;
    touchDragEl.classList.remove('dragging');
    if (touchGhost) { touchGhost.remove(); touchGhost = null; }
    const el = touchDragEl;
    touchDragEl = null;
    if (touchDidDrag) await _saveTileOrder(gridEl, guid);
    touchDidDrag = false;
    // Prevent the following click from navigating (ghost click after drag)
    el.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { once: true, capture: true });
  };

  gridEl.addEventListener('touchend', endTouchDrag, { passive: true });
  gridEl.addEventListener('touchcancel', endTouchDrag, { passive: true });
}

// Re-render on feed or subscription changes
function _maybeRerender() {
  const h = window.location.hash;
  if (!h || h === '#/' || h === '#/podcasts') {
    const container = document.getElementById('main-content');
    if (container) renderPodcasts(container);
  }
}

if (window.castClient) {
  window.castClient.on('feeds:updated', _maybeRerender);
  window.castClient.on('user:subscriptions', _maybeRerender);
}

window.renderPodcasts = renderPodcasts;
window.prewarmPodcastArtwork = _prewarmPodcastArtwork;
