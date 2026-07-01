let searchTimeout = null;
const DISCOVER_VIEW_KEY = 'podwaffle_view_mode_discover';

function getDiscoverViewMode() {
  return localStorage.getItem(DISCOVER_VIEW_KEY) === 'list' ? 'list' : 'grid';
}

function setDiscoverViewMode(mode) {
  localStorage.setItem(DISCOVER_VIEW_KEY, mode === 'list' ? 'list' : 'grid');
}

async function renderDiscover(container) {
  let viewMode = getDiscoverViewMode();
  container.innerHTML = `
    <div class="view-header">
    </div>
    <br>
    <div class="discover-search">
      <div class="search-input-wrapper">
        <input type="text" class="input" id="discover-search-input" placeholder="Search for podcasts...">
      </div>
    </div>
    <div id="discover-results" class="podcast-grid search-results-grid">
      <!-- Results or empty state go here -->
    </div>
    <div class="discover-footer">
    </div>
    <button id="discover-view-toggle" class="view-mode-toggle" title="Toggle view mode" aria-label="Toggle view mode">
      <svg class="view-mode-icon-grid" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      <svg class="view-mode-icon-list" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
    </button>
  `;

  const inputEl = document.getElementById('discover-search-input');
  const resultsEl = document.getElementById('discover-results');
  const toggleEl = document.getElementById('discover-view-toggle');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');

  const applyViewMode = (mode) => {
    viewMode = mode === 'list' ? 'list' : 'grid';
    setDiscoverViewMode(viewMode);
    resultsEl.classList.toggle('podcast-grid-list', viewMode === 'list');
    toggleEl.classList.toggle('is-list', viewMode === 'list');
    toggleEl.title = viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view';
    toggleEl.setAttribute('aria-label', toggleEl.title);
  };

  toggleEl.addEventListener('click', () => {
    applyViewMode(viewMode === 'list' ? 'grid' : 'list');
    const q = inputEl.value.trim();
    if (q) {
      performSearch(q, guid, resultsEl, viewMode);
    }
  });

  applyViewMode(viewMode);

  inputEl.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (!query) {
      resultsEl.innerHTML = '';
      return;
    }

    resultsEl.innerHTML = `
      <div class="loading-state">
        <div class="spinner spin"></div>
      </div>
    `;

    searchTimeout = setTimeout(() => {
      performSearch(query, guid, resultsEl, viewMode);
    }, 500);
  });
  
  // Focus input on load (if on desktop)
  if (window.innerWidth > 768) {
    inputEl.focus();
  }
}

async function performSearch(query, guid, resultsEl, viewMode = 'grid') {
  try {
    const results = await window.api.search(query, guid);
    
    // Also fetch user subscriptions so we can show subscribed state
    let subs = [];
    try {
      subs = await window.api.getSubscriptions(guid);
    } catch(e) {}
    
    const subUrls = new Set(subs.map(s => s.feedUrl));

    if (results.length === 0) {
      resultsEl.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1">No podcasts found for "${query}".</div>`;
      return;
    }

    let html = '';
    results.forEach(res => {
      const isSubbed = subUrls.has(res.feedUrl);
      if (viewMode === 'list') {
        const dateLabel = res.lastReleaseDate
          ? new Date(res.lastReleaseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : 'Unknown date';
        const description = res.description || res.author || 'No description available.';
        html += `
          <div class="podcast-list-item search-result-list-item">
            <img src="${res.imageUrl || 'icons/icon-192.png'}" onerror="this.src='icons/icon-192.png'">
            <div class="podcast-list-body">
              <div class="podcast-list-title">${res.title || 'Untitled podcast'}</div>
              <div class="podcast-list-date">Last episode: ${dateLabel}</div>
              <div class="podcast-list-description">${description}</div>
              <button class="button btn btn-small btn-discover-sub" data-url="${res.feedUrl}" data-subbed="${isSubbed}">
                ${isSubbed ? 'Subscribed <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>' : 'Subscribe'}
              </button>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="podcast-tile search-result-tile">
            <img src="${res.imageUrl || 'icons/icon-192.png'}" onerror="this.src='icons/icon-192.png'">
            <div class="tile-overlay always-visible-overlay">
              <button class="button btn btn-small btn-block mt-2  btn-discover-sub" 
                      data-url="${res.feedUrl}" 
                      data-subbed="${isSubbed}">
                ${isSubbed ? 'Subscribed <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>' : 'Subscribe'}
              </button>
            </div>
          </div>
        `;
      }
    });
    
    resultsEl.innerHTML = html;
    
    // Bind subscribe buttons
    resultsEl.querySelectorAll('.btn-discover-sub').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // prevent tile click if any
        if (btn.dataset.subbed === "true") return; // already subbed
        
        btn.disabled = true;
        btn.textContent = 'Adding...';
        const feedUrl = btn.dataset.url;
        
        try {
          await window.api.subscribe(guid, feedUrl);
          btn.dataset.subbed = "true";
          btn.innerHTML = 'Subscribed <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-outline');
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          btn.textContent = 'Subscribe';
          alert('Failed to subscribe.');
        }
      });
    });

  } catch (err) {
    console.error('Search failed:', err);
    resultsEl.innerHTML = `<div class="error-state" style="grid-column: 1 / -1">Search failed. Try again later.</div>`;
  }
}

window.renderDiscover = renderDiscover;
