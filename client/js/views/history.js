async function renderHistory(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">History</h1>
    </div>
    <div id="history-content">
      <div class="loading-state">
        <div class="spinner spin"></div>
        <p>Loading history...</p>
      </div>
    </div>
  `;

  const contentEl = document.getElementById('history-content');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
  
  try {
    const history = await window.api.getHistory(guid, 100, 0); // Get last 100 items
    
    if (!history || history.length === 0) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="64" height="64" stroke="var(--text-muted)" stroke-width="1" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <h2>No listening history</h2>
          <p>Episodes you finish will appear here.</p>
        </div>
      `;
      return;
    }

    let html = '<div class="history-list">';
    
    // Simple grouping by date (just string formatting for now)
    let lastDateStr = null;

    history.forEach(entry => {
      const date = new Date(entry.listenedAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dateStr;
      if (date.toDateString() === today.toDateString()) {
        dateStr = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateStr = 'Yesterday';
      } else {
        dateStr = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      }
      
      if (dateStr !== lastDateStr) {
        html += `<h3 class="history-date-header">${dateStr}</h3>`;
        lastDateStr = dateStr;
      }
      
      const durationStr = window.formatDuration ? window.formatDuration(entry.duration) : '';
      
      // We don't use full createEpisodeRow here because history entries don't have all data (like audioUrl) easily available without another fetch.
      // We'll render a simplified read-only row. 
      // Pocketcasts allows playing from history, but requires fetching the feed.
      // We'll keep it simple for now: display only.
      
      html += `
        <div class="history-item">
          <img src="${entry.imageUrl}" class="history-item-thumb" onerror="this.src='/icons/icon-192.png'">
          <div class="history-item-info">
            <div class="history-item-title">${entry.title}</div>
            <div class="history-item-podcast">${entry.podcastTitle}</div>
          </div>
          ${durationStr ? `<div class="history-item-duration">${durationStr}</div>` : ''}
        </div>
      `;
    });
    
    html += `</div>`;
    contentEl.innerHTML = html;

  } catch (err) {
    console.error('Failed to load history:', err);
    contentEl.innerHTML = `<div class="error-state">Failed to load history.</div>`;
  }
}

window.renderHistory = renderHistory;
