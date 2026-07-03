function createEpisodeRow(episode, progress, options = {}) {
  const {
    showCheckbox = false,
    onPlay = () => {},
    onPlayNext = () => {},
    onPlayLast = () => {},
    onMarkPlayed = () => {},
    cacheStatus = 'unknown',
    onDownload = async () => {}
  } = options;

  let currentProgress = progress && typeof progress === 'object'
    ? { ...progress }
    : { played: false, position: 0, duration: episode.duration || 0 };
  let currentCacheStatus = cacheStatus;

  const row = document.createElement('div');
  row.className = 'episode-row';
  row.dataset.guid = episode.guid;

  let checkboxHtml = '';
  if (showCheckbox) {
    checkboxHtml = `
      <label class="checkbox episode-checkbox">
        <input type="checkbox" value="${episode.guid}">
        <span class="episode-checkbox-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </span>
      </label>
    `;
  }

  let dateStr = 'Unknown date';
  const dateSource = episode.pubDate || episode.publishedAt || null;
  if (dateSource) {
    const pubDate = new Date(dateSource);
    if (!Number.isNaN(pubDate.getTime())) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (pubDate.toDateString() === today.toDateString()) {
      dateStr = 'Today';
    } else if (pubDate.toDateString() === yesterday.toDateString()) {
      dateStr = 'Yesterday';
    } else {
      dateStr = pubDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: pubDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
      });
    }
    }
  }

  let durationStr = '';
  if (episode.duration) {
    durationStr = window.formatDuration ? window.formatDuration(episode.duration) : episode.duration + 's';
  }

  function getCacheBadgeHtml(status) {
    if (status === 'cached') {
      return `<span class="episode-cache-badge cached">Cached</span>`;
    }
    if (status === 'downloading') {
      return `<span class="episode-cache-badge downloading">Caching…</span>`;
    }
    if (status === 'error') {
      return `<span class="episode-cache-badge error">Cache failed</span>`;
    }
    return '';
  }

  function getDownloadButtonHtml(status) {
    if (status === 'cached') {
      return `
        <button class="btn-icon btn-action download-btn is-cached" title="Cached" aria-label="Cached">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
        </button>
      `;
    }
    if (status === 'downloading') {
      return `
        <button class="btn-icon btn-action download-btn is-downloading" title="Caching" aria-label="Caching" disabled>
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
        </button>
      `;
    }
    return `
      <button class="btn-icon btn-action download-btn" title="Download for offline playback" aria-label="Download for offline playback">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
      </button>
    `;
  }

  function isPlayingEpisode() {
    return !!(window.player && window.player.currentEpisode && window.player.currentEpisode.guid === episode.guid && window.player.isPlaying);
  }

  function renderProgressHtml() {
    const position = Math.max(0, Number(currentProgress?.position || 0));
    const duration = Math.max(position, Number(currentProgress?.duration || episode.duration || 0));
    if (!position || currentProgress?.played || !duration) {
      return '';
    }

    const percent = Math.min(100, Math.max(0, (position / duration) * 100));
    const remaining = Math.max(0, duration - position);
    return `
      <div class="episode-progress-bar">
        <div class="episode-progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="episode-progress-text">
        ${window.formatDuration ? window.formatDuration(remaining) : Math.round(remaining) + 's'} left
      </div>
    `;
  }

  function renderMetaHtml() {
    return `
      <span class="episode-date">${dateStr}</span>
      ${durationStr ? `<span class="episode-duration">${durationStr}</span>` : ''}
      ${getCacheBadgeHtml(currentCacheStatus)}
      ${isPlayingEpisode() ? `<span class="episode-playing-badge"><span class="episode-playing-dot"></span>Playing</span>` : ''}
      ${currentProgress?.played ? `<span class="episode-played-tick"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}
    `;
  }

  row.innerHTML = `
    ${checkboxHtml}
    <div class="episode-info">
      <div class="episode-title"></div>
      <div class="episode-meta"></div>
      <div class="episode-progress-slot"></div>
    </div>
    <div class="episode-actions">
      ${getDownloadButtonHtml(currentCacheStatus)}
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

  const titleEl = row.querySelector('.episode-title');
  const metaEl = row.querySelector('.episode-meta');
  const progressSlotEl = row.querySelector('.episode-progress-slot');
  const playBtn = row.querySelector('.play-btn');
  const playNextBtn = row.querySelector('.play-next-btn');
  const playLastBtn = row.querySelector('.play-last-btn');
  const markPlayedBtn = row.querySelector('.mark-played-btn');
  let downloadBtn = row.querySelector('.download-btn');

  titleEl.textContent = episode.title || 'Untitled episode';

  const syncUi = () => {
    row.classList.toggle('played', !!currentProgress?.played);
    row.classList.toggle('playing', isPlayingEpisode());
    metaEl.innerHTML = renderMetaHtml();
    progressSlotEl.innerHTML = renderProgressHtml();
    if (markPlayedBtn) {
      markPlayedBtn.disabled = !!currentProgress?.played;
      markPlayedBtn.title = currentProgress?.played ? 'Already played' : 'Mark Played';
      markPlayedBtn.setAttribute('aria-label', markPlayedBtn.title);
    }
  };

  const updateCacheUi = (status) => {
    currentCacheStatus = status;
    if (downloadBtn) {
      downloadBtn.outerHTML = getDownloadButtonHtml(status);
      downloadBtn = row.querySelector('.download-btn');
      bindDownload();
    }
    syncUi();
  };

  async function handleDownloadClick(e) {
    e.stopPropagation();
    if (!downloadBtn || downloadBtn.disabled) return;
    updateCacheUi('downloading');
    try {
      await onDownload(episode);
      updateCacheUi('cached');
    } catch (err) {
      console.error('[episodeRow] Download failed:', err);
      updateCacheUi('error');
    }
  }

  function bindDownload() {
    if (downloadBtn) {
      downloadBtn.addEventListener('click', handleDownloadClick);
    }
  }

  if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); onPlay(episode); });
  if (playNextBtn) playNextBtn.addEventListener('click', (e) => { e.stopPropagation(); onPlayNext(episode); });
  if (playLastBtn) playLastBtn.addEventListener('click', (e) => { e.stopPropagation(); onPlayLast(episode); });
  if (markPlayedBtn) markPlayedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentProgress?.played) return;
    onMarkPlayed(episode);
  });
  bindDownload();

  if (window.cacheManager && episode.audioUrl) {
    const cacheListener = (ev) => {
      const rowUrl = window.cacheManager._resolveUrl(episode);
      if (ev.detail?.url === rowUrl) {
        updateCacheUi(ev.detail.status);
      }
    };
    window.addEventListener('podwaffle:cache-status', cacheListener);
  }

  const progressListener = (ev) => {
    if (ev.detail?.episodeGuid !== episode.guid) return;
    currentProgress = ev.detail.progress
      ? { ...currentProgress, ...ev.detail.progress }
      : { played: false, position: 0, duration: episode.duration || 0 };
    syncUi();
  };
  window.addEventListener('podwaffle:progress-updated', progressListener);

  if (window.player) {
    window.player.onStateChange((state) => {
      if (state?.currentEpisode?.guid === episode.guid && !currentProgress?.played) {
        currentProgress = {
          ...currentProgress,
          position: Math.max(Number(currentProgress?.position || 0), Math.floor(state.position || 0)),
          duration: Math.max(Number(currentProgress?.duration || 0), Math.floor(state.duration || 0))
        };
      }
      syncUi();
    });
  }

  row.updateCacheStatus = updateCacheUi;
  row.updateProgressState = (nextProgress) => {
    currentProgress = { ...currentProgress, ...(nextProgress || {}) };
    syncUi();
  };

  syncUi();
  return row;
}

window.createEpisodeRow = createEpisodeRow;
