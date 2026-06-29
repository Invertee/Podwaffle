let searchTimeout = null;

async function renderDiscover(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Discover</h1>
    </div>
    <div class="discover-search">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="discover-search-input" placeholder="Search for podcasts...">
      </div>
    </div>
    <div id="discover-results" class="podcast-grid search-results-grid">
      <!-- Results or empty state go here -->
    </div>
    <div class="discover-footer">
      <p class="text-muted text-small text-center mt-6">
        Search powered by iTunes API (fallback). Add your PodcastIndex API key in <a href="#/profile">Profile</a> for better results.
      </p>
    </div>
  `;

  const inputEl = document.getElementById('discover-search-input');
  const resultsEl = document.getElementById('discover-results');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');

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
      performSearch(query, guid, resultsEl);
    }, 500);
  });
  
  // Focus input on load (if on desktop)
  if (window.innerWidth > 768) {
    inputEl.focus();
  }
}

async function performSearch(query, guid, resultsEl) {
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
      html += `
        <div class="podcast-tile search-result-tile">
          <img src="${res.imageUrl || '/icons/icon-192.png'}" onerror="this.src='/icons/icon-192.png'">
          <div class="tile-overlay always-visible-overlay">
            <span class="tile-title">${res.title}</span>
            <span class="tile-author">${res.author || ''}</span>
            <button class="btn btn-small btn-block mt-2 btn-discover-sub" 
                    data-url="${res.feedUrl}" 
                    data-subbed="${isSubbed}">
              ${isSubbed ? 'Subscribed <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>' : 'Subscribe'}
            </button>
          </div>
        </div>
      `;
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
