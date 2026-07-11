/* Podcast chapters: discovery, transport controls, indicator, and queue-panel tab. */
(function installChapterSupport(root) {
  'use strict';

  const player = root.player;
  const api = root.api;
  if (!player || !api || player.__chapterSupportInstalled) return;

  const CACHE_KEY = 'podwaffle_chapter_cache_v1';
  const inflight = new Map();
  let activeEpisodeKey = '';

  function readJson(key, fallback) {
    try {
      const raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    return value;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function parseTime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    const raw = String(value || '').trim();
    if (!raw) return 0;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Number(raw));
    const parts = raw.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
  }

  function normalizeChapters(input) {
    const source = Array.isArray(input) ? input : (Array.isArray(input?.chapters) ? input.chapters : []);
    const chapters = source.map((chapter, index) => ({
      startTime: parseTime(chapter?.startTime ?? chapter?.start ?? chapter?.time),
      title: String(chapter?.title || chapter?.name || `Chapter ${index + 1}`).trim(),
      imageUrl: String(chapter?.img || chapter?.image || chapter?.imageUrl || '').trim(),
      url: String(chapter?.url || chapter?.href || '').trim(),
    })).filter((chapter) => Number.isFinite(chapter.startTime));

    chapters.sort((a, b) => a.startTime - b.startTime);
    return chapters.filter((chapter, index) => index === 0 || chapter.startTime > chapters[index - 1].startTime);
  }

  function episodeKey(episode) {
    return String(episode?.guid || episode?.audioUrl || episode?.title || '');
  }

  function findFeedUrl(episode) {
    if (episode?.feedUrl) return episode.feedUrl;
    const catalog = readJson('podwaffle_podcast_catalog', {});
    const direct = catalog[episode?.feedId];
    if (direct?.feedUrl) return direct.feedUrl;
    for (const item of Object.values(catalog)) {
      if (item?.feedId === episode?.feedId && item.feedUrl) return item.feedUrl;
    }
    for (let index = 0; index < root.localStorage.length; index += 1) {
      const key = root.localStorage.key(index);
      if (!key?.startsWith('podwaffle_subscriptions_') && !key?.startsWith('podwaffle_offline_subscriptions_')) continue;
      const items = readJson(key, []);
      const match = Array.isArray(items) && items.find((item) => item && typeof item === 'object' && item.feedId === episode?.feedId);
      if (match?.feedUrl) return match.feedUrl;
    }
    return '';
  }

  function localName(node) {
    return String(node?.localName || node?.tagName || '').toLowerCase().replace(/^.*:/, '');
  }

  function findEpisodeNode(xml, episode) {
    const entries = Array.from(xml.getElementsByTagName('*')).filter((node) => ['item', 'entry'].includes(localName(node)));
    const wantedGuid = String(episode?.guid || '').trim();
    const wantedAudio = String(episode?.audioUrl || '').trim();
    const wantedTitle = String(episode?.title || '').trim();

    return entries.find((entry) => {
      const descendants = Array.from(entry.getElementsByTagName('*'));
      const textFor = (name) => String(descendants.find((node) => localName(node) === name)?.textContent || '').trim();
      const guid = textFor('guid') || textFor('id');
      const title = textFor('title');
      const enclosure = descendants.find((node) => localName(node) === 'enclosure');
      const audio = enclosure?.getAttribute?.('url') || '';
      return (wantedGuid && guid === wantedGuid) || (wantedAudio && audio === wantedAudio) || (wantedTitle && title === wantedTitle);
    }) || null;
  }

  function chapterSourceFromEntry(entry) {
    if (!entry) return { url: '', chapters: [] };
    const nodes = Array.from(entry.getElementsByTagName('*'));
    const container = nodes.find((node) => localName(node) === 'chapters');
    if (!container) return { url: '', chapters: [] };

    const url = String(container.getAttribute?.('url') || container.getAttribute?.('href') || '').trim();
    const inline = Array.from(container.getElementsByTagName('*'))
      .filter((node) => localName(node) === 'chapter')
      .map((node, index) => ({
        startTime: node.getAttribute?.('start') || node.getAttribute?.('startTime') || 0,
        title: node.getAttribute?.('title') || `Chapter ${index + 1}`,
        url: node.getAttribute?.('href') || node.getAttribute?.('url') || '',
        imageUrl: node.getAttribute?.('image') || node.getAttribute?.('img') || '',
      }));
    return { url, chapters: normalizeChapters(inline) };
  }

  async function fetchJson(url) {
    const attempts = [url, `https://corsproxy.io/?url=${encodeURIComponent(url)}`];
    let lastError = null;
    for (const candidate of attempts) {
      try {
        const response = await fetch(candidate, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        lastError = err;
      }
    }

    const nativeHttp = root.Capacitor?.Plugins?.CapacitorHttp;
    if (nativeHttp?.get) {
      const response = await nativeHttp.get({ url, headers: { Accept: 'application/json' } });
      return typeof response?.data === 'string' ? JSON.parse(response.data) : response?.data;
    }
    throw lastError || new Error('Unable to load chapter file');
  }

  async function discoverChapters(episode) {
    const key = episodeKey(episode);
    if (!key) return [];

    const stored = readJson(CACHE_KEY, {});
    if (Array.isArray(stored[key])) return stored[key];

    let chapters = normalizeChapters(episode?.chapters);
    let chapterUrl = String(episode?.chaptersUrl || episode?.chapterUrl || '').trim();

    if (!chapters.length && !chapterUrl) {
      const feedUrl = findFeedUrl(episode);
      if (feedUrl && typeof api._fetchFeedXml === 'function') {
        const xmlText = await api._fetchFeedXml(feedUrl);
        const xml = new DOMParser().parseFromString(String(xmlText || ''), 'text/xml');
        if (!xml.querySelector('parsererror')) {
          const source = chapterSourceFromEntry(findEpisodeNode(xml, episode));
          chapters = source.chapters;
          chapterUrl = source.url;
        }
      }
    }

    if (!chapters.length && chapterUrl) {
      chapters = normalizeChapters(await fetchJson(chapterUrl));
    }

    stored[key] = chapters;
    writeJson(CACHE_KEY, stored);
    return chapters;
  }

  function currentIndex() {
    const chapters = player.getChapters();
    const position = Number(player.position || 0);
    let index = -1;
    chapters.forEach((chapter, candidate) => {
      if (chapter.startTime <= position + 0.25) index = candidate;
    });
    return index;
  }

  player.getChapters = function getChapters() {
    return normalizeChapters(this.currentEpisode?.chapters);
  };

  player.getCurrentChapterIndex = currentIndex;
  player.getCurrentChapter = function getCurrentChapter() {
    const index = currentIndex();
    return index >= 0 ? this.getChapters()[index] : null;
  };

  player.skipToPreviousChapter = function skipToPreviousChapter() {
    const chapters = this.getChapters();
    const index = currentIndex();
    if (!chapters.length || index < 0) return;
    const current = chapters[index];
    const target = this.position - current.startTime > 3 ? current : chapters[Math.max(0, index - 1)];
    this.seek(target.startTime);
  };

  player.skipToNextChapter = function skipToNextChapter() {
    const chapters = this.getChapters();
    const index = currentIndex();
    if (!chapters.length || index >= chapters.length - 1) return;
    this.seek(chapters[index + 1].startTime);
  };

  function button(id, label, icon) {
    const element = document.createElement('button');
    element.id = id;
    element.className = 'button chapter-skip-button is-rounded';
    element.type = 'button';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.innerHTML = icon;
    return element;
  }

  function installPlayerControls() {
    const desktop = document.querySelector('.player-transport');
    if (desktop && !document.getElementById('pb-chapter-back')) {
      const previous = button('pb-chapter-back', 'Previous chapter', '<span aria-hidden="true">|◀</span>');
      const next = button('pb-chapter-forward', 'Next chapter', '<span aria-hidden="true">▶|</span>');
      previous.addEventListener('click', () => player.skipToPreviousChapter());
      next.addEventListener('click', () => player.skipToNextChapter());
      desktop.insertBefore(previous, desktop.firstElementChild);
      desktop.appendChild(next);
    }

    const mobile = document.querySelector('.player-mobile-transport');
    if (mobile && !document.getElementById('pb-mobile-chapter-back')) {
      const previous = button('pb-mobile-chapter-back', 'Previous chapter', '<span aria-hidden="true">|◀</span>');
      const next = button('pb-mobile-chapter-forward', 'Next chapter', '<span aria-hidden="true">▶|</span>');
      previous.addEventListener('click', () => player.skipToPreviousChapter());
      next.addEventListener('click', () => player.skipToNextChapter());
      mobile.insertBefore(previous, mobile.firstElementChild);
      mobile.appendChild(next);
    }

    for (const targetId of ['pb-podcast', 'pb-mobile-podcast']) {
      const target = document.getElementById(targetId);
      if (target && !document.getElementById(`${targetId}-chapter`)) {
        const indicator = document.createElement('div');
        indicator.id = `${targetId}-chapter`;
        indicator.className = 'player-chapter-indicator';
        indicator.hidden = true;
        target.insertAdjacentElement('afterend', indicator);
      }
    }
  }

  function installQueueTabs() {
    const panel = document.getElementById('queue-panel');
    const header = panel?.querySelector('.queue-header');
    const list = document.getElementById('queue-list');
    if (!panel || !header || !list || document.getElementById('queue-tab-bar')) return;

    const title = header.querySelector('.queue-title');
    if (title) title.style.display = 'none';
    const tabs = document.createElement('div');
    tabs.id = 'queue-tab-bar';
    tabs.className = 'queue-tab-bar';
    tabs.innerHTML = '<button class="queue-tab is-active" data-tab="queue">Up Next</button><button class="queue-tab" data-tab="chapters">Chapters</button>';
    header.insertBefore(tabs, header.firstChild);

    const chapterList = document.createElement('div');
    chapterList.id = 'chapter-list';
    chapterList.className = 'queue-list chapter-list';
    chapterList.hidden = true;
    list.insertAdjacentElement('afterend', chapterList);

    tabs.querySelectorAll('.queue-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const chapterMode = tab.dataset.tab === 'chapters';
        tabs.querySelectorAll('.queue-tab').forEach((item) => item.classList.toggle('is-active', item === tab));
        list.hidden = chapterMode;
        chapterList.hidden = !chapterMode;
        if (chapterMode) renderChapterList();
      });
    });
  }

  function renderChapterList() {
    const list = document.getElementById('chapter-list');
    if (!list) return;
    const chapters = player.getChapters();
    const selected = currentIndex();
    if (!chapters.length) {
      list.innerHTML = '<div class="queue-empty"><p>No chapters are available for this episode.</p></div>';
      return;
    }

    list.innerHTML = chapters.map((chapter, index) => `
      <button class="chapter-list-item ${index === selected ? 'is-current' : ''}" data-index="${index}">
        <span class="chapter-number">${index + 1}</span>
        <span class="chapter-list-copy"><strong>${escapeHtml(chapter.title)}</strong><small>${root.formatTime?.(chapter.startTime) || chapter.startTime}</small></span>
      </button>
    `).join('');
    list.querySelectorAll('.chapter-list-item').forEach((item) => {
      item.addEventListener('click', () => {
        const chapter = chapters[Number(item.dataset.index)];
        if (chapter) player.seek(chapter.startTime);
      });
    });
  }

  function updateUi() {
    installPlayerControls();
    installQueueTabs();
    const chapters = player.getChapters();
    const index = currentIndex();
    const current = index >= 0 ? chapters[index] : null;

    for (const id of ['pb-chapter-back', 'pb-mobile-chapter-back']) {
      const element = document.getElementById(id);
      if (element) element.disabled = !chapters.length || index < 0;
    }
    for (const id of ['pb-chapter-forward', 'pb-mobile-chapter-forward']) {
      const element = document.getElementById(id);
      if (element) element.disabled = !chapters.length || index < 0 || index >= chapters.length - 1;
    }
    for (const id of ['pb-podcast-chapter', 'pb-mobile-podcast-chapter']) {
      const element = document.getElementById(id);
      if (!element) continue;
      element.hidden = !current;
      element.textContent = current ? `Chapter ${index + 1} of ${chapters.length} · ${current.title}` : '';
    }
    if (document.getElementById('chapter-list') && !document.getElementById('chapter-list').hidden) renderChapterList();
  }

  async function hydrateCurrentEpisode() {
    const episode = player.currentEpisode;
    const key = episodeKey(episode);
    if (!episode || !key || key === activeEpisodeKey) return;
    activeEpisodeKey = key;

    if (!inflight.has(key)) {
      inflight.set(key, discoverChapters(episode).finally(() => inflight.delete(key)));
    }
    const chapters = await inflight.get(key).catch((err) => {
      console.warn('[chapterSupport] Chapter discovery failed:', err?.message || err);
      return [];
    });
    if (episodeKey(player.currentEpisode) !== key) return;
    player.currentEpisode.chapters = chapters;
    player._notifyStateChange?.();
    updateUi();
  }

  const originalQueueRender = root.queue?.render?.bind(root.queue);
  if (originalQueueRender) {
    root.queue.render = function renderQueueWithChapters(containerId) {
      const result = originalQueueRender(containerId);
      installQueueTabs();
      updateUi();
      return result;
    };
  }

  const style = document.createElement('style');
  style.textContent = `
    .chapter-skip-button{min-width:38px;padding:0 .65rem;background:transparent;border-color:var(--border-color);color:var(--text-secondary)}
    .chapter-skip-button:disabled{opacity:.3;cursor:not-allowed}
    .player-chapter-indicator{font-size:.72rem;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
    .queue-tab-bar{display:flex;gap:.35rem;align-items:center}
    .queue-tab{border:0;background:transparent;color:var(--text-secondary);padding:.5rem .75rem;border-bottom:2px solid transparent;font-weight:600;cursor:pointer}
    .queue-tab.is-active{color:var(--text-primary);border-bottom-color:var(--accent)}
    .chapter-list-item{display:flex;width:100%;align-items:center;gap:.75rem;padding:.85rem 1rem;border:0;border-bottom:1px solid var(--border-color);background:transparent;color:var(--text-primary);text-align:left;cursor:pointer}
    .chapter-list-item:hover,.chapter-list-item.is-current{background:rgba(244,63,94,.12)}
    .chapter-number{display:grid;place-items:center;min-width:2rem;height:2rem;border-radius:50%;background:var(--surface-elevated);color:var(--text-secondary)}
    .chapter-list-copy{display:flex;min-width:0;flex:1;flex-direction:column}.chapter-list-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chapter-list-copy small{color:var(--text-muted)}
    @media(max-width:768px){.player-mobile-transport{gap:.45rem}.chapter-skip-button{min-width:34px;padding:0 .45rem}.player-chapter-indicator{font-size:.68rem}}
  `;
  document.head.appendChild(style);

  player.onStateChange(() => {
    updateUi();
    hydrateCurrentEpisode();
  });

  player.__chapterSupportInstalled = true;
  installPlayerControls();
  updateUi();
  hydrateCurrentEpisode();
})(window);
