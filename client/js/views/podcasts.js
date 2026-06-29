async function renderPodcasts(container) {
  container.innerHTML = `
    <div class="view-header">
    </div>
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
      // Override grid layout for empty state
      gridEl.style.display = 'flex';
      gridEl.style.justifyContent = 'center';
      return;
    }

    let html = '';
    subscriptions.forEach(sub => {
      html += `
        <div class="podcast-tile" data-feed-id="${sub.feedId}">
          <img src="${sub.imageUrl}" alt="${sub.title}" onerror="this.src='/icons/icon-192.png'">
          ${sub.newEpisodesAvailable ? '<div class="new-dot"></div>' : ''}
          <div class="tile-overlay">
            <span class="tile-title">${sub.title}</span>
          </div>
        </div>
      `;
    });
    
    gridEl.innerHTML = html;
    
    // Bind clicks
    gridEl.querySelectorAll('.podcast-tile').forEach(tile => {
      tile.addEventListener('click', async () => {
        const feedId = tile.dataset.feedId;
        window.navigate(`#/podcast/${feedId}`);
      });
    });
    
  } catch (err) {
    console.error('Failed to load podcasts view:', err);
    gridEl.innerHTML = `<div class="error-state">Failed to load podcasts.</div>`;
  }
}

// Hook up event listener for feeds update
if (window.castClient) {
  window.castClient.on('feeds:updated', () => {
    // Only re-render if we are currently on the podcasts view
    if (window.location.hash === '#/podcasts' || window.location.hash === '') {
      const container = document.getElementById('main-content');
      if (container) renderPodcasts(container);
    }
  });
}

window.renderPodcasts = renderPodcasts;
