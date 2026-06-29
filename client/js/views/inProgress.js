async function renderInProgress(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">In Progress</h1>
    </div>
    <div id="ip-content">
      <div class="loading-state">
        <div class="spinner spin"></div>
        <p>Loading in-progress episodes...</p>
      </div>
    </div>
  `;

  const contentEl = document.getElementById('ip-content');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
  
  try {
    const progressData = await window.api.getProgress(guid);
    
    // Filter to only items with position > 0 and played == false
    const inProgressItems = Object.entries(progressData)
      .filter(([epGuid, data]) => data.position > 0 && !data.played)
      .map(([epGuid, data]) => ({ epGuid, ...data }));
      
    if (inProgressItems.length === 0) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="64" height="64" stroke="var(--text-muted)" stroke-width="1" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <h2>No episodes in progress</h2>
          <p>Start listening to a podcast to see it here.</p>
        </div>
      `;
      return;
    }

    // Sort by updatedAt descending
    inProgressItems.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    // We need episode details (title, image, etc.) which aren't in progress data.
    // We have feedId in progress data, so we need to fetch those feeds.
    // Optimization: collect unique feedIds
    const feedIds = [...new Set(inProgressItems.map(i => i.feedId).filter(Boolean))];
    
    // Fetch all needed feeds in parallel
    const feedPromises = feedIds.map(id => window.api.getPodcast(id, 100, 0).catch(() => null));
    const feeds = await Promise.all(feedPromises);
    
    // Map feedId to feed object
    const feedMap = {};
    feeds.forEach(f => {
      if (f) feedMap[f.feedId] = f;
    });

    const listEl = document.createElement('div');
    listEl.className = 'ip-list';

    // Render each in-progress episode
    inProgressItems.forEach(item => {
      const feed = feedMap[item.feedId];
      if (!feed) return; // Feed might have been deleted or failed to load

      // Find episode in feed
      const ep = feed.episodes.find(e => e.guid === item.epGuid);
      if (!ep) return; // Episode might have dropped off the feed
      
      ep.podcastTitle = feed.title;
      ep.feedId = feed.feedId;

      const row = window.createEpisodeRow(ep, item, {
        showCheckbox: false,
        onPlay: (episode) => {
          if (window.player) {
            window.player.loadEpisode(episode);
            window.player.play();
          }
        },
        onPlayNext: (episode) => {
          if (window.player) window.player.playNext(episode);
        },
        onPlayLast: (episode) => {
          if (window.player) window.player.addToQueue(episode);
        },
        onMarkPlayed: async (episode) => {
          try {
            await window.api.updateProgress(guid, episode.guid, {
              position: episode.duration || item.position || 0,
              duration: episode.duration || item.duration || 0,
              played: true,
              feedId: episode.feedId
            });
            // Re-render to remove it from list
            renderInProgress(container);
          } catch(e) { console.error(e); }
        }
      });
      listEl.appendChild(row);
    });

    contentEl.innerHTML = '';
    
    if (listEl.children.length === 0) {
      contentEl.innerHTML = `<div class="empty-state">No episodes in progress.</div>`;
    } else {
      contentEl.appendChild(listEl);
    }

  } catch (err) {
    console.error('Failed to load in-progress:', err);
    contentEl.innerHTML = `<div class="error-state">Failed to load in-progress episodes.</div>`;
  }
}

window.renderInProgress = renderInProgress;
