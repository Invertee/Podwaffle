async function renderInProgress(container) {
  container.innerHTML = `
    <div class="view-header">
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
    window.replaceProgressState(progressData);
    
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

    const visibleEpisodes = [];

    // Render each in-progress episode
    inProgressItems.forEach(item => {
      const feed = feedMap[item.feedId];
      if (!feed) return; // Feed might have been deleted or failed to load

      // Find episode in feed
      const ep = feed.episodes.find(e => e.guid === item.epGuid);
      if (!ep) return; // Episode might have dropped off the feed
      
      ep.podcastTitle = feed.title;
      ep.feedId = feed.feedId;
      ep.podcastImageUrl = feed.imageUrl;
      visibleEpisodes.push(ep);
    });

    const cacheStatuses = window.cacheManager
      ? await window.cacheManager.getStatuses(visibleEpisodes)
      : {};

    const listEl = document.createElement('div');
    listEl.className = 'ip-list';

    inProgressItems.forEach(item => {
      const feed = feedMap[item.feedId];
      if (!feed) return;

      const ep = feed.episodes.find(e => e.guid === item.epGuid);
      if (!ep) return;

      ep.podcastTitle = feed.title;
      ep.feedId = feed.feedId;
      ep.podcastImageUrl = feed.imageUrl;

      const row = window.createEpisodeRow(ep, item, {
        showCheckbox: false,
        cacheStatus: cacheStatuses[ep.guid] || 'uncached',
        onPlay: (episode) => {
          if (window.player) {
            const latestProgress = window.appState.progress?.[episode.guid] || item;
            window.player.loadEpisode(episode, latestProgress.position || 0, { autoplay: true });
          }
        },
        onPlayNext: (episode) => {
          if (window.player) window.player.playNext(episode);
        },
        onPlayLast: (episode) => {
          if (window.player) window.player.addToQueue(episode);
        },
        onDownload: (episode) => window.cacheManager ? window.cacheManager.downloadEpisode(episode) : Promise.reject(new Error('Caching unavailable')),
        onMarkPlayed: async (episode) => {
          try {
            const nextProgress = {
              position: episode.duration || item.position || 0,
              duration: episode.duration || item.duration || 0,
              played: true,
              feedId: episode.feedId,
              updatedAt: new Date().toISOString(),
            };
            await window.api.updateProgress(guid, episode.guid, nextProgress);
            window.setEpisodeProgressState(episode.guid, nextProgress);
            if (window.cacheManager) {
              await window.cacheManager.deleteEpisode(episode);
            }
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

    if (window.cacheManager) {
      window.cacheManager.prefetchEpisodes(visibleEpisodes, 2).catch(() => {});
    }

  } catch (err) {
    console.error('Failed to load in-progress:', err);
    contentEl.innerHTML = `<div class="error-state">Failed to load in-progress episodes.</div>`;
  }
}

window.renderInProgress = renderInProgress;
