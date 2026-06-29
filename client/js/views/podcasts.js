async function renderPodcasts(container) {
  container.innerHTML = `
    <div class="view-header"></div>
    <br>
    <div id="podcasts-grid" class="podcast-grid">
      <div class="loading-state">
        <div class="spinner spin"></div>
        <p>Loading podcasts...</p>
      </div>
    </div>
  `;

  const gridEl = document.getElementById('podcasts-grid');

  try {
    const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
    if (!guid) {
      gridEl.innerHTML = `<div class="empty-state">No profile found. Please refresh.</div>`;
      return;
    }

    const subscriptions = await window.api.getSubscriptions(guid);

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
      html += `
        <div class="podcast-tile" data-feed-id="${sub.feedId}" draggable="true">
          <img src="${sub.imageUrl}" alt="${sub.title}" onerror="this.src='/icons/icon-192.png'" draggable="false">
          ${sub.newEpisodesAvailable ? '<div class="new-dot"></div>' : ''}
          <div class="tile-overlay">
            <span class="tile-title">${sub.title}</span>
          </div>
        </div>
      `;
    });

    gridEl.innerHTML = html;

    // Bind tile click (navigate only when not dragging)
    gridEl.querySelectorAll('.podcast-tile').forEach(tile => {
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

async function _saveTileOrder(gridEl, guid) {
  const feedIds = [...gridEl.querySelectorAll('.podcast-tile')].map(t => t.dataset.feedId);
  try {
    await window.api.reorderSubscriptions(guid, feedIds);
    console.log('[podcasts] Saved tile order:', feedIds);
  } catch (err) {
    console.error('[podcasts] Failed to save tile order:', err);
  }
}

function _initTileDrag(gridEl, guid) {
  // ── HTML5 Drag (desktop mouse) ────────────────────────
  let dragSrcEl = null;
  let didDrag = false;

  gridEl.addEventListener('dragstart', (e) => {
    dragSrcEl = e.target.closest('.podcast-tile');
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
    const target = e.target.closest('.podcast-tile');
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
    const tile = e.target.closest('.podcast-tile');
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
      touchGhost.className = 'podcast-tile touch-drag-ghost';
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

    const target = below && below.closest('.podcast-tile');
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
