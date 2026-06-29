async function renderPodcastDetail(container, feedId) {
  container.innerHTML = `
    <div class="view-header with-back">
      <button class="btn-icon back-btn" onclick="window.history.back()">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      </button>
    </div>
    <div id="pd-content">
      <div class="loading-state">
        <div class="spinner spin"></div>
        <p>Loading podcast details...</p>
      </div>
    </div>
  `;

  const contentEl = document.getElementById('pd-content');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
  
  try {
    const [podcast, progressData] = await Promise.all([
      window.api.getPodcast(feedId, 100, 0),
      window.api.getProgress(guid)
    ]);
    
    // Clear new flag for this user
    await window.api.markEpisodesSeen(feedId, guid, []);
    
    let isSubscribed = false;
    try {
      const subs = await window.api.getSubscriptions(guid);
      isSubscribed = subs.some(s => s.feedId === feedId);
    } catch(e){}

    const headerHtml = `
      <div class="podcast-detail-header">
        <img src="${podcast.imageUrl}" class="podcast-artwork-large" onerror="this.src='/icons/icon-192.png'">
        <div class="podcast-detail-info">
          <h2>${podcast.title}</h2>
          <div class="pd-author">${podcast.author || ''}</div>
          <br>
          <button id="pd-sub-btn" class="btn button ${isSubscribed ? 'btn-outline is-danger' : 'btn-primary is-info'} pd-sub-btn">
            ${isSubscribed ? 'Unsubscribe' : 'Subscribe'}
          </button>
        </div>
      </div>
      <div class="podcast-description" id="pd-desc">
        ${podcast.description || 'No description available.'}
      </div>
      
      <div class="pd-bulk-actions">
        <label class="checkbox">
          <input type="checkbox" id="pd-select-all"> Select All
        </label>
        <button id="pd-mark-selected" class="btn btn-outline btn-small" disabled>Mark Played</button>
      </div>
      
      <div id="pd-episodes" class="pd-episode-list"></div>
      
      ${podcast.episodes.length === 100 ? `<div class="pd-load-more"><button id="pd-load-more-btn" class="btn btn-outline">Load more episodes</button></div>` : ''}
    `;
    
    contentEl.innerHTML = headerHtml;
    
    // Desc expand
    document.getElementById('pd-desc').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('description-expanded');
    });
    
    // Sub toggle
    document.getElementById('pd-sub-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (isSubscribed) {
          await window.api.unsubscribe(guid, feedId);
          isSubscribed = false;
          btn.textContent = 'Subscribe';
          btn.className = 'button btn btn-primary is-info pd-sub-btn';
        } else {
          await window.api.subscribe(guid, podcast.feedUrl);
          isSubscribed = true;
          btn.textContent = 'Unsubscribe';
          btn.className = 'button btn btn-outline is-danger pd-sub-btn';
        }
      } catch (err) {
        console.error(err);
        alert('Failed to change subscription status');
      }
      btn.disabled = false;
    });

    const epsContainer = document.getElementById('pd-episodes');
    
    // Render episodes
    const renderEps = (eps) => {
      eps.forEach(ep => {
        // Find progress if any
        let prog = progressData[ep.guid];
        if (!prog) {
          // Check if it's already marked as played somehow else, but usually it's in progressData
          prog = { played: false, position: 0 };
        }
        
        // Add podcast metadata to ep object for player and artwork
        ep.podcastTitle = podcast.title;
        ep.podcastImageUrl = podcast.imageUrl;
        ep.feedId = feedId;
        
        const row = window.createEpisodeRow(ep, prog, {
          showCheckbox: true,
          onPlay: (episode) => {
            if (window.player) {
              window.player.loadEpisode(episode, prog.position || 0);
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
                position: episode.duration || 0,
                duration: episode.duration || 0,
                played: true,
                feedId: feedId
              });
              // Refresh view to show tick
              renderPodcastDetail(container, feedId);
            } catch(e) { console.error(e); }
          }
        });
        epsContainer.appendChild(row);
      });
    };
    
    renderEps(podcast.episodes);
    
    // Bulk actions
    const selectAll = document.getElementById('pd-select-all');
    const markSelectedBtn = document.getElementById('pd-mark-selected');
    
    const updateBulkBtn = () => {
      const checked = epsContainer.querySelectorAll('.episode-checkbox input:checked');
      markSelectedBtn.disabled = checked.length === 0;
      markSelectedBtn.textContent = checked.length > 0 ? `Mark Played (${checked.length})` : 'Mark Played';
    };
    
    selectAll.addEventListener('change', (e) => {
      const isChecked = e.currentTarget.checked;
      epsContainer.querySelectorAll('.episode-checkbox input').forEach(cb => {
        cb.checked = isChecked;
      });
      updateBulkBtn();
    });
    
    epsContainer.addEventListener('change', (e) => {
      if (e.target.matches('.episode-checkbox input')) {
        updateBulkBtn();
        // Update select all indeterminate state if needed
      }
    });
    
    markSelectedBtn.addEventListener('click', async () => {
      const checked = epsContainer.querySelectorAll('.episode-checkbox input:checked');
      if (checked.length === 0) return;
      
      markSelectedBtn.disabled = true;
      markSelectedBtn.textContent = 'Marking...';
      
      try {
        const promises = Array.from(checked).map(cb => {
          const epGuid = cb.value;
          const row = cb.closest('.episode-row');
          return window.api.updateProgress(guid, epGuid, {
            position: 1, // dummy value, played is true
            duration: 1,
            played: true,
            feedId: feedId
          });
        });
        
        await Promise.all(promises);
        renderPodcastDetail(container, feedId);
      } catch (err) {
        console.error(err);
        alert('Failed to mark episodes as played');
        updateBulkBtn();
      }
    });
    
    // Pagination (Load More)
    let currentOffset = 100;
    const loadMoreBtn = document.getElementById('pd-load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Loading...';
        try {
          const nextData = await window.api.getPodcast(feedId, 100, currentOffset);
          renderEps(nextData.episodes);
          currentOffset += 100;
          if (nextData.episodes.length < 100) {
            loadMoreBtn.parentElement.style.display = 'none';
          } else {
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = 'Load more episodes';
          }
        } catch (err) {
          console.error(err);
          loadMoreBtn.disabled = false;
          loadMoreBtn.textContent = 'Error loading. Try again.';
        }
      });
    }

  } catch (err) {
    console.error('Failed to load podcast detail:', err);
    contentEl.innerHTML = `
      <div class="error-state">
        Failed to load podcast details.<br>
        <button class="btn btn-outline mt-4" onclick="window.renderPodcastDetail(document.getElementById('main-content'), '${feedId}')">Retry</button>
      </div>
    `;
  }
}

window.renderPodcastDetail = renderPodcastDetail;
