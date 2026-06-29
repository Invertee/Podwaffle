function createEpisodeRow(episode, progress, options = {}) {
  const {
    showCheckbox = false,
    onPlay = () => {},
    onPlayNext = () => {},
    onPlayLast = () => {},
    onMarkPlayed = () => {}
  } = options;

  const row = document.createElement('div');
  row.className = 'episode-row' + (progress?.played ? ' played' : '');
  row.dataset.guid = episode.guid;

  let checkboxHtml = '';
  if (showCheckbox) {
    checkboxHtml = `
      <label class="checkbox episode-checkbox">
        <input type="checkbox" value="${episode.guid}">
      </label>
    `;
  }

  // Format date
  let dateStr = 'Unknown date';
  if (episode.pubDate) {
    const pubDate = new Date(episode.pubDate);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (pubDate.toDateString() === today.toDateString()) {
      dateStr = 'Today';
    } else if (pubDate.toDateString() === yesterday.toDateString()) {
      dateStr = 'Yesterday';
    } else {
      dateStr = pubDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: pubDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    }
  }

  // Format duration
  let durationStr = '';
  if (episode.duration) {
    durationStr = window.formatDuration ? window.formatDuration(episode.duration) : episode.duration + 's';
  }

  // Progress bar HTML if in progress
  let progressHtml = '';
  if (progress && progress.position > 0 && !progress.played) {
    const percent = Math.min(100, Math.max(0, (progress.position / progress.duration) * 100));
    progressHtml = `
      <div class="episode-progress-bar">
        <div class="episode-progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="episode-progress-text">
        ${window.formatDuration ? window.formatDuration(progress.duration - progress.position) : Math.round(progress.duration - progress.position) + 's'} left
      </div>
    `;
  }

  row.innerHTML = `
    ${checkboxHtml}
    <div class="episode-info">
      <div class="episode-title">${episode.title}</div>
      <div class="episode-meta">
        <span class="episode-date">${dateStr}</span>
        ${durationStr ? `<span class="episode-duration">${durationStr}</span>` : ''}
        ${progress?.played ? `<span class="episode-played-tick"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}
      </div>
      ${progressHtml}
    </div>
    <div class="episode-actions">
      <button class="btn-icon btn-action play-btn" title="Play">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
      </button>
      <button class="btn-icon btn-action play-next-btn" title="Play Next">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>
      </button>
      <button class="btn-icon btn-action play-last-btn" title="Play Last">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
      <button class="btn-icon btn-action mark-played-btn" title="Mark Played">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
      </button>
    </div>
  `;

  // Attach event listeners
  const playBtn = row.querySelector('.play-btn');
  const playNextBtn = row.querySelector('.play-next-btn');
  const playLastBtn = row.querySelector('.play-last-btn');
  const markPlayedBtn = row.querySelector('.mark-played-btn');

  if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); onPlay(episode); });
  if (playNextBtn) playNextBtn.addEventListener('click', (e) => { e.stopPropagation(); onPlayNext(episode); });
  if (playLastBtn) playLastBtn.addEventListener('click', (e) => { e.stopPropagation(); onPlayLast(episode); });
  if (markPlayedBtn) markPlayedBtn.addEventListener('click', (e) => { e.stopPropagation(); onMarkPlayed(episode); });

  // Make the whole row clickable to play (unless clicking a button or checkbox)
  row.addEventListener('click', (e) => {
    if (!e.target.closest('.episode-actions') && !e.target.closest('.checkbox')) {
      onPlay(episode);
    }
  });

  return row;
}

window.createEpisodeRow = createEpisodeRow;
