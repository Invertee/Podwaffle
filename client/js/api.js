/* ============================================================
   Podwaffle — api.js
   API client module. All methods are async, throw on non-OK
   ============================================================ */

// ── Utility: format seconds → "37 mins" or "1h 8m"
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '';
  const totalSec = Math.floor(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) return `${m} mins`;
  return `${s}s`;
}

// ── Utility: format date → "Today", "Yesterday", "Jun 26"
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Utility: format seconds to mm:ss or h:mm:ss
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Utility: sanitise text for safe textContent use
function sanitizeText(str) {
  return String(str || '');
}

// ── Utility: debounce
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Expose utilities globally
window.formatDuration = formatDuration;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.sanitizeText = sanitizeText;
window.debounce = debounce;

const LOCAL_PODCAST_CATALOG = [
  {
    feedId: 'guardian-daily',
    feedUrl: 'local://guardian-daily',
    title: 'Guardian Daily',
    author: 'The Guardian',
    description: 'A daily briefing on the biggest stories from around the world.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 24,
  },
  {
    feedId: 'science-friday',
    feedUrl: 'local://science-friday',
    title: 'Science Friday',
    author: 'WNYC Studios',
    description: 'Science, technology, and the ideas shaping our world.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 18,
  },
  {
    feedId: 'code-craft',
    feedUrl: 'local://code-craft',
    title: 'Code Craft',
    author: 'PodWaffle Labs',
    description: 'Practical conversations about shipping software and building products.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 15,
  },
  {
    feedId: 'space-signal',
    feedUrl: 'local://space-signal',
    title: 'Space Signal',
    author: 'Orbit Media',
    description: 'A weekly show about spaceflight, astronomy, and exploration.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 12,
  },
  {
    feedId: 'mindful-minute',
    feedUrl: 'local://mindful-minute',
    title: 'The Mindful Minute',
    author: 'Calm Studio',
    description: 'Short, practical episodes for focusing and winding down.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 20,
  },
  {
    feedId: 'history-unplugged',
    feedUrl: 'local://history-unplugged',
    title: 'History Unplugged',
    author: 'Evergreen Audio',
    description: 'Stories behind the moments and people that shaped history.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 30,
  },
  {
    feedId: 'indie-dev',
    feedUrl: 'local://indie-dev',
    title: 'Indie Dev Podcast',
    author: 'Small Team Media',
    description: 'Indie makers sharing lessons from products, launches, and failures.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 22,
  },
  {
    feedId: 'cozy-reads',
    feedUrl: 'local://cozy-reads',
    title: 'Cozy Reads',
    author: 'Night Owl Audio',
    description: 'A relaxed show about books, writing, and stories worth savouring.',
    imageUrl: 'icons/icon-192.png',
    episodeCount: 10,
  },
];

function _generateLocalEpisode(feedId, index, podcast) {
  const episodeNumber = index + 1;
  const audioUrls = [
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  ];
  return {
    guid: `${feedId}-episode-${episodeNumber}`,
    title: `${podcast.title} Episode ${episodeNumber}`,
    description: `A local sample episode for ${podcast.title}.`,
    audioUrl: audioUrls[index % audioUrls.length],
    imageUrl: podcast.imageUrl,
    podcastImageUrl: podcast.imageUrl,
    podcastTitle: podcast.title,
    feedId: podcast.feedId,
    publishedAt: new Date(Date.now() - index * 86400000).toISOString(),
    duration: 1800 + (index * 60),
  };
}

function _buildLocalPodcastEntry(podcast) {
  const episodes = Array.from({ length: podcast.episodeCount || 12 }, (_, index) => _generateLocalEpisode(podcast.feedId, index, podcast));
  return {
    ...podcast,
    feedType: 'local',
    episodes,
  };
}

const LOCAL_PODCAST_INDEX = LOCAL_PODCAST_CATALOG.map(_buildLocalPodcastEntry);

// ── API client
const api = {
  _SERVER_CONFIG_KEY: 'podwaffle_server_connection',
  _PODCAST_CACHE_KEY: 'podwaffle_podcast_catalog',

  _normalizeServerConfig(config = {}) {
    const rawHost = String(config.host || config.url || '').trim();
    const rawPort = config.port == null ? '' : String(config.port).trim();
    const enabled = !!config.enabled;

    if (!rawHost) {
      return {
        enabled: false,
        host: '',
        port: '',
        secure: false,
      };
    }

    let secure = !!config.secure;
    let host = rawHost;

    if (/^https?:\/\//i.test(rawHost)) {
      try {
        const parsed = new URL(rawHost);
        secure = parsed.protocol === 'https:';
        host = parsed.hostname;
      } catch (_) {
        host = rawHost.replace(/^https?:\/\//i, '').split('/')[0];
      }
    } else {
      host = rawHost.split('/')[0];
    }

    return {
      enabled,
      host,
      port: rawPort,
      secure,
      updatedAt: config.updatedAt || new Date().toISOString(),
    };
  },

  getServerConnectionConfig() {
    try {
      const raw = localStorage.getItem(this._SERVER_CONFIG_KEY);
      if (!raw) {
        return this._normalizeServerConfig({ enabled: false });
      }
      const parsed = JSON.parse(raw);
      return this._normalizeServerConfig(parsed || {});
    } catch (_) {
      return this._normalizeServerConfig({ enabled: false });
    }
  },

  saveServerConnectionConfig(config) {
    const normalized = this._normalizeServerConfig(config || {});
    localStorage.setItem(this._SERVER_CONFIG_KEY, JSON.stringify(normalized));
    return normalized;
  },

  clearServerConnectionConfig() {
    localStorage.removeItem(this._SERVER_CONFIG_KEY);
    return this._normalizeServerConfig({ enabled: false });
  },

  _getRemoteBaseOrigin() {
    const cfg = this.getServerConnectionConfig();
    if (!cfg.enabled || !cfg.host) return '';
    const protocol = cfg.secure ? 'https' : 'http';
    const hostPort = cfg.port ? `${cfg.host}:${cfg.port}` : cfg.host;
    return `${protocol}://${hostPort}`;
  },

  getWebSocketUrl() {
    const cfg = this.getServerConnectionConfig();
    if (!cfg.enabled || !cfg.host) return '';
    const remoteOrigin = this._getRemoteBaseOrigin();
    if (remoteOrigin) {
      const wsProtocol = remoteOrigin.startsWith('https://') ? 'wss://' : 'ws://';
      return `${wsProtocol}${remoteOrigin.replace(/^https?:\/\//i, '')}/ws`;
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = (window.APP_BASE_PATH ? window.APP_BASE_PATH + '/ws' : '/ws');
    return `${protocol}//${location.host}${wsPath}`;
  },

  _buildUrl(url) {
    const remoteOrigin = this._getRemoteBaseOrigin();
    if (url.startsWith('/api/') && remoteOrigin) {
      return remoteOrigin + url;
    }
    return (url.startsWith('/api/') && window.APP_BASE_PATH)
      ? window.APP_BASE_PATH + url
      : url;
  },

  _isLocalDevServer() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.');
  },

  async _fetchFeedXml(feedUrl) {
    // 1. Try direct fetch first — works for feeds that send CORS headers
    try {
      const res = await fetch(feedUrl, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
      });
      if (res.ok) return await res.text();
    } catch (_) {
      // CORS blocked — fall through to proxy
    }

    // 2. On local dev server, use the built-in Node proxy
    if (this._isLocalDevServer()) {
      const basePath = window.APP_BASE_PATH || '';
      const proxyUrl = `${basePath}/proxy/feed?url=${encodeURIComponent(feedUrl)}`;
      const res = await fetch(proxyUrl, {
        headers: { Accept: 'application/xml, text/xml, application/rss+xml' },
      });
      if (!res.ok) throw new Error(`Feed proxy failed with HTTP ${res.status}`);
      return await res.text();
    }

    // 3. Static hosting (GitHub Pages, etc.) — corsproxy.io is free for github.io origins
    try {
      const corsProxy = `https://corsproxy.io/?url=${encodeURIComponent(feedUrl)}`;
      const res = await fetch(corsProxy, {
        headers: { Accept: 'application/xml, text/xml, application/rss+xml' },
      });
      if (res.ok) return await res.text();
      throw new Error(`CORS proxy responded with HTTP ${res.status}`);
    } catch (proxyErr) {
      throw new Error(`Feed fetch blocked by CORS and proxy failed (${proxyErr.message}). Connect to a Podwaffle backend or run the local client proxy to refresh this feed.`);
    }
  },

  _getGuid() {
    return localStorage.getItem('podwaffle_guid');
  },

  async _fetch(url, options = {}) {
    const cfg = this.getServerConnectionConfig();
    const isApiCall = url.startsWith('/api/');
    const allowAutoEnsure = options.__allowAutoEnsure !== false;
    const fetchOptions = { ...options };
    delete fetchOptions.__allowAutoEnsure;

    // No backend configured — always use local
    if ((!cfg.enabled || !cfg.host) && isApiCall) {
      return this._handleLocalRequest(url, fetchOptions);
    }

    // Backend configured — try it, but fall back to local on any failure
    if (isApiCall) {
      try {
        const userRouteMatch = url.match(/^\/api\/users\/([^/]+)(?:\/|$)/i);
        const userGuid = userRouteMatch ? decodeURIComponent(userRouteMatch[1]) : null;
        const fullUrl = this._buildUrl(url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(fullUrl, {
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
          ...fetchOptions,
        }).finally(() => clearTimeout(timeout));
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          if (
            allowAutoEnsure
            && res.status === 404
            && userGuid
            && /user not found/i.test(errText)
          ) {
            await this.ensureUserOnBackend(userGuid);
            return this._fetch(url, { ...fetchOptions, __allowAutoEnsure: false });
          }
          throw new Error(`API error ${res.status}: ${errText}`);
        }
        const text = await res.text();
        try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
      } catch (err) {
        console.warn(`[API] Backend unavailable (${err.message}) — falling back to local mode for ${url}`);
        return this._handleLocalRequest(url, fetchOptions);
      }
    }

    const fullUrl = this._buildUrl(url);
    const res = await fetch(fullUrl, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.error(`[API] Error ${res.status} for ${url}:`, errText);
      throw new Error(`API error ${res.status}: ${errText}`);
    }
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch (_) {
      return text;
    }
  },

  _localKey(prefix, guid) {
    return `${prefix}_${guid}`;
  },

  _getJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  },

  _setJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  },

  _getLocalGuid() {
    return this._getGuid() || localStorage.getItem('podwaffle_guid') || null;
  },

  _slugify(value) {
    return String(value || 'podcast')
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'podcast';
  },

  _makeFeedId(feedUrl, fallback = '') {
    const source = String(feedUrl || '').trim();
    if (source) {
      try {
        const parsed = new URL(source);
        return this._slugify(`${parsed.hostname}${parsed.pathname}`);
      } catch (_) {
        return this._slugify(source);
      }
    }
    return this._slugify(fallback || 'podcast');
  },

  _getCachedPodcastCatalog() {
    return this._getJsonStorage(this._PODCAST_CACHE_KEY, {});
  },

  _saveCachedPodcasts(podcasts = []) {
    const catalog = this._getCachedPodcastCatalog();
    const normalized = [];

    podcasts.forEach((podcast) => {
      if (!podcast) return;
      const feedUrl = String(podcast.feedUrl || '').trim();
      const feedId = podcast.feedId || this._makeFeedId(feedUrl, podcast.title || podcast.collectionId || 'podcast');
      if (!feedId) return;
      const entry = {
        ...podcast,
        feedId,
        feedUrl,
        imageUrl: podcast.imageUrl || 'icons/icon-192.png',
      };
      catalog[feedId] = entry;
      normalized.push(entry);
    });

    this._setJsonStorage(this._PODCAST_CACHE_KEY, catalog);
    return normalized;
  },

  _getCachedPodcast(identifier) {
    if (!identifier) return null;
    const catalog = this._getCachedPodcastCatalog();
    if (catalog[identifier]) return catalog[identifier];

    const needle = String(identifier || '').trim().toLowerCase();
    return Object.values(catalog).find((podcast) => {
      return podcast
        && (
          String(podcast.feedId || '').toLowerCase() === needle
          || String(podcast.feedUrl || '').toLowerCase() === needle
          || String(podcast.title || '').toLowerCase() === needle
        );
    }) || null;
  },

  _mapApplePodcastResult(item = {}) {
    const feedUrl = String(item.feedUrl || '').trim();
    const collectionId = item.collectionId || item.trackId || null;
    return {
      feedId: this._makeFeedId(feedUrl, `itunes-${collectionId || item.collectionName || item.trackName || 'podcast'}`),
      feedUrl,
      title: item.trackName || item.collectionName || 'Untitled podcast',
      author: item.artistName || 'Unknown creator',
      imageUrl: item.artworkUrl600 || item.artworkUrl100 || 'icons/icon-192.png',
      description: item.description || item.collectionName || '',
      episodeCount: Number(item.trackCount) || 0,
      collectionId,
      source: 'apple-search',
      lastRefreshed: new Date().toISOString(),
    };
  },

  async _searchAppleCatalog(query) {
    const q = String(query || '').trim();
    if (!q) return [];

    const url = `https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(q)}&limit=20`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Apple Podcasts search failed with HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = (data.results || [])
      .map((item) => this._mapApplePodcastResult(item))
      .filter((item) => item.feedUrl);

    return this._saveCachedPodcasts(results);
  },

  _findXmlNode(root, names = []) {
    if (!root) return null;
    for (const name of names) {
      const direct = root.getElementsByTagName(name);
      if (direct && direct.length > 0) return direct[0];
    }

    const lowered = names.map((name) => String(name).toLowerCase().replace(/^.*:/, ''));
    const all = root.getElementsByTagName('*');
    for (const node of all) {
      const tag = String(node.tagName || '').toLowerCase();
      const local = String(node.localName || '').toLowerCase();
      if (lowered.includes(tag) || lowered.includes(local) || lowered.includes(tag.replace(/^.*:/, ''))) {
        return node;
      }
    }
    return null;
  },

  _getXmlText(root, names = []) {
    const node = this._findXmlNode(root, names);
    return node && node.textContent ? String(node.textContent).trim() : '';
  },

  _parseDurationSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value || '').trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw) || 0;
    const parts = raw.split(':').map((part) => Number(part) || 0);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return 0;
  },

  _parseExternalPodcastFeed(xmlText, seedPodcast) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'text/xml');
    const parserError = xml.querySelector('parsererror');
    if (parserError) {
      throw new Error('Podcast feed could not be parsed');
    }

    const channel = xml.querySelector('channel') || xml.documentElement;
    const itunesImage = this._findXmlNode(channel, ['itunes:image']);
    const imageNode = this._findXmlNode(channel, ['image']);
    const imageUrl = (itunesImage && itunesImage.getAttribute && itunesImage.getAttribute('href'))
      || this._getXmlText(imageNode || channel, ['url'])
      || seedPodcast.imageUrl
      || 'icons/icon-192.png';

    const items = Array.from(xml.getElementsByTagName('item'));
    const episodes = items.map((item, index) => {
      const enclosure = this._findXmlNode(item, ['enclosure']);
      const audioUrl = enclosure && enclosure.getAttribute ? enclosure.getAttribute('url') : '';
      const itemImage = this._findXmlNode(item, ['itunes:image']);
      const episodeGuid = this._getXmlText(item, ['guid']) || `${seedPodcast.feedId}-episode-${index + 1}`;
      const rawPublished = this._getXmlText(item, ['pubDate', 'published', 'dc:date', 'date']) || '';
      const parsedPublished = rawPublished ? new Date(rawPublished) : null;
      const normalizedPublished = parsedPublished && !Number.isNaN(parsedPublished.getTime())
        ? parsedPublished.toISOString()
        : new Date().toISOString();
      return {
        guid: episodeGuid,
        title: this._getXmlText(item, ['title']) || `Episode ${index + 1}`,
        description: this._getXmlText(item, ['description', 'summary']) || '',
        audioUrl,
        imageUrl: (itemImage && itemImage.getAttribute && itemImage.getAttribute('href')) || imageUrl,
        podcastImageUrl: imageUrl,
        podcastTitle: seedPodcast.title,
        feedId: seedPodcast.feedId,
        pubDate: normalizedPublished,
        publishedAt: normalizedPublished,
        duration: this._parseDurationSeconds(this._getXmlText(item, ['itunes:duration', 'duration'])),
      };
    }).filter((episode) => episode.audioUrl);

    return {
      ...seedPodcast,
      title: this._getXmlText(channel, ['title']) || seedPodcast.title,
      author: this._getXmlText(channel, ['itunes:author', 'author', 'managingEditor']) || seedPodcast.author,
      description: this._getXmlText(channel, ['description', 'itunes:summary']) || seedPodcast.description,
      imageUrl,
      episodes,
      totalEpisodes: episodes.length,
      hasRecentEpisode: episodes.length > 0,
      newEpisodesAvailable: false,
      lastRefreshed: new Date().toISOString(),
    };
  },

  async _getLocalPodcastDetails(feedId) {
    const localPodcast = this._findLocalPodcast(feedId);
    if (localPodcast) {
      return {
        ...localPodcast,
        totalEpisodes: (localPodcast.episodes || []).length,
      };
    }

    const cachedPodcast = this._getCachedPodcast(feedId);
    if (!cachedPodcast) return null;
    if (Array.isArray(cachedPodcast.episodes) && cachedPodcast.episodes.length > 0) {
      return {
        ...cachedPodcast,
        totalEpisodes: cachedPodcast.totalEpisodes || cachedPodcast.episodes.length,
      };
    }
    if (!cachedPodcast.feedUrl) {
      return {
        ...cachedPodcast,
        episodes: cachedPodcast.episodes || [],
        totalEpisodes: (cachedPodcast.episodes || []).length,
      };
    }

    try {
      const xmlText = await this._fetchFeedXml(cachedPodcast.feedUrl);
      const parsedPodcast = this._parseExternalPodcastFeed(xmlText, cachedPodcast);
      this._saveCachedPodcasts([parsedPodcast]);
      return parsedPodcast;
    } catch (error) {
      console.warn('[api] Falling back to cached podcast metadata:', error);
      return {
        ...cachedPodcast,
        episodes: cachedPodcast.episodes || [],
        totalEpisodes: (cachedPodcast.episodes || []).length,
        hasRecentEpisode: false,
        newEpisodesAvailable: false,
      };
    }
  },

  _getLocalProfile(guid) {
    const resolvedGuid = guid || this._getLocalGuid();
    if (!resolvedGuid) return null;
    const subscriptions = this._getJsonStorage(this._localKey('podwaffle_subscriptions', resolvedGuid), []);
    return {
      guid: resolvedGuid,
      subscriptions,
      subscriptionsUpdatedAt: this._getJsonStorage(this._localKey('podwaffle_subscriptions_updated_at', resolvedGuid), new Date().toISOString()),
      progress: this._getJsonStorage(this._localKey('podwaffle_progress', resolvedGuid), {}),
      settings: this._getJsonStorage(this._localKey('podwaffle_settings', resolvedGuid), {}),
      stats: this._getJsonStorage(this._localKey('podwaffle_stats', resolvedGuid), { totalListenedSeconds: 0, totalSkippedSeconds: 0 }),
      queue: this._getJsonStorage(this._localKey('podwaffle_queue_state', resolvedGuid), { queue: [], mode: 'local', currentEpisodeGuid: '', updatedAt: new Date().toISOString() }),
      playbackSession: this._getJsonStorage('podwaffle_playback_session', null),
    };
  },

  _saveLocalProfileField(guid, field, value) {
    const keyMap = {
      subscriptions: this._localKey('podwaffle_subscriptions', guid),
      subscriptionsUpdatedAt: this._localKey('podwaffle_subscriptions_updated_at', guid),
      progress: this._localKey('podwaffle_progress', guid),
      settings: this._localKey('podwaffle_settings', guid),
      stats: this._localKey('podwaffle_stats', guid),
      queue: this._localKey('podwaffle_queue_state', guid),
    };
    const key = keyMap[field];
    if (!key) return value;
    return this._setJsonStorage(key, value);
  },

  _findLocalPodcast(identifier) {
    if (!identifier) return null;
    const needle = String(identifier).toLowerCase();
    return LOCAL_PODCAST_INDEX.find((podcast) => {
      return podcast.feedId === needle || podcast.feedUrl === identifier || podcast.title.toLowerCase().includes(needle);
    }) || null;
  },

  _searchLocalCatalog(query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return LOCAL_PODCAST_INDEX.slice(0, 12);
    return LOCAL_PODCAST_INDEX.filter((podcast) => {
      return [podcast.title, podcast.author, podcast.description, podcast.feedUrl, podcast.feedId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  },

  _normalizeLocalSubscription(podcast) {
    if (!podcast) return null;
    return {
      feedId: podcast.feedId,
      feedUrl: podcast.feedUrl,
      title: podcast.title,
      author: podcast.author,
      description: podcast.description,
      imageUrl: podcast.imageUrl,
      lastRefreshed: new Date().toISOString(),
      hasRecentEpisode: true,
    };
  },

  _normalizeSubscriptionsForSync(subscriptions) {
    if (!Array.isArray(subscriptions)) return [];
    const seen = new Set();
    const normalized = [];
    for (const entry of subscriptions) {
      const value = typeof entry === 'string'
        ? entry.trim()
        : (entry && typeof entry === 'object'
          ? String(entry.feedUrl || entry.url || '').trim()
          : '');
      if (!value || value === '[object Object]' || seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
    return normalized;
  },

  async _handleLocalRequest(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    const path = url.replace(/^\/api/, '');

  // Split path from query string for matching
  const cleanPath = path.split('?')[0];
    if (cleanPath === '/health' && method === 'GET') {
      return { ok: true, mode: 'local', message: 'Using local-only mode' };
    }

    if (cleanPath === '/users' && method === 'POST') {
      const guid = this._getLocalGuid() || (() => {
        const next = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        localStorage.setItem('podwaffle_guid', next);
        return next;
      })();
      return { ok: true, guid, profile: this._getLocalProfile(guid) };
    }

    if (cleanPath === '/search' && method === 'GET') {
      const q = new URLSearchParams(url.split('?')[1] || '').get('q') || '';
      return this._searchAppleCatalog(q);
    }

    if (cleanPath.startsWith('/podcasts/') && method === 'GET') {
      const feedId = decodeURIComponent(path.replace('/podcasts/', '').split('?')[0]);
      const podcast = await this._getLocalPodcastDetails(feedId);
      if (!podcast) throw new Error(`Podcast not found: ${feedId}`);
      const query = new URLSearchParams(url.split('?')[1] || '');
      const limit = Number.parseInt(query.get('limit') || '100', 10);
      const offset = Number.parseInt(query.get('offset') || '0', 10);
      return {
        ...podcast,
        episodes: podcast.episodes.slice(offset, offset + limit),
      };
    }

    const seenMatch = cleanPath.match(/^\/podcasts\/([^/]+)\/seen$/);
    if (seenMatch && method === 'POST') {
      const feedId = decodeURIComponent(seenMatch[1]);
      return {
        ok: true,
        feedId,
        seenCount: Array.isArray(body?.episodeGuids) ? body.episodeGuids.length : 0,
      };
    }

    // ────── Cast endpoints (not user-scoped) ──────────────────────────
    if (cleanPath === '/cast/state' && method === 'GET') {
      return this._getJsonStorage('podwaffle_cast_state', null);
    }

    if (cleanPath === '/cast/devices' && method === 'GET') {
      return [];
    }

    if (cleanPath === '/cast/state' && method === 'PUT') {
      const nextState = {
        ...(body || {}),
        updatedAt: body?.updatedAt || new Date().toISOString(),
      };
      this._setJsonStorage('podwaffle_cast_state', nextState);
      return { ok: true, state: nextState };
    }

    if (cleanPath === '/cast/state' && method === 'DELETE') {
      localStorage.removeItem('podwaffle_cast_state');
      return { ok: true, state: null };
    }

    if (cleanPath === '/cast/play' && method === 'POST') {
      const { deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration, feedId } = body || {};
      // For local device, just store the playback session
      // The actual playback is handled by the web audio player
      const session = {
        deviceId,
        mediaUrl,
        episodeGuid,
        title,
        podcastTitle,
        imageUrl,
        feedId: feedId || '',
        position: startPosition || 0,
        duration,
        status: 'playing',
        volume: 1.0,
        updatedAt: new Date().toISOString(),
      };
      this._setJsonStorage(this._localKey('podwaffle_cast_session', userGuid || 'local'), session);
      return { ok: true, status: 'playing' };
    }

    if (cleanPath === '/cast/pause' && method === 'POST') {
      return { ok: true, status: 'paused' };
    }

    if (cleanPath === '/cast/resume' && method === 'POST') {
      return { ok: true, status: 'playing' };
    }

    if (cleanPath === '/cast/stop' && method === 'POST') {
      return { ok: true, status: 'stopped' };
    }

    if (cleanPath === '/cast/seek' && (method === 'PUT' || method === 'POST')) {
      const { position } = body || {};
      return { ok: true, position, status: 'paused' };
    }

    if ((cleanPath === '/cast/volume' || cleanPath === '/cast/setVolume') && (method === 'PUT' || method === 'POST')) {
      const { volume, level } = body || {};
      const nextVolume = volume != null ? volume : level;
      return { ok: true, volume: nextVolume, status: 'paused' };
    }

    // ────── User-scoped routes ──────────────────────────────────────────
    const userMatch = cleanPath.match(/^\/users\/([^/]+)(.*)$/);
    if (!userMatch) {
      throw new Error(`Local API route not implemented: ${method} ${path}`);
    }

    const guid = decodeURIComponent(userMatch[1]);
    const subPath = userMatch[2] || '';

    if (subPath === '' && method === 'GET') {
      return this._getLocalProfile(guid);
    }

    if (subPath === '/settings' && method === 'PUT') {
      const next = { ...this._getJsonStorage(this._localKey('podwaffle_settings', guid), {}), ...(body || {}) };
      this._saveLocalProfileField(guid, 'settings', next);
      return { ok: true, settings: next };
    }

    if (subPath === '/subscriptions' && method === 'GET') {
      return this._getJsonStorage(this._localKey('podwaffle_subscriptions', guid), []);
    }

    if (subPath === '/subscriptions' && method === 'POST') {
      const selected = this._getCachedPodcast(body?.feedId || body?.feedUrl)
        || this._findLocalPodcast(body?.feedId || body?.feedUrl)
        || {
        feedId: String(body?.feedId || this._makeFeedId(body?.feedUrl, 'custom-feed')),
        feedUrl: String(body?.feedUrl || ''),
        title: body?.title || String(body?.feedUrl || body?.feedId || 'Untitled podcast'),
        author: body?.author || 'Local podcast',
        description: body?.description || '',
        imageUrl: body?.imageUrl || 'icons/icon-192.png',
      };
      this._saveCachedPodcasts([selected]);
      const normalized = this._normalizeLocalSubscription(selected);
      const current = this._getJsonStorage(this._localKey('podwaffle_subscriptions', guid), []);
      const updated = [...current.filter((item) => item.feedId !== normalized.feedId && item.feedUrl !== normalized.feedUrl), normalized];
      this._saveLocalProfileField(guid, 'subscriptions', updated);
      this._saveLocalProfileField(guid, 'subscriptionsUpdatedAt', new Date().toISOString());
      if (window.appState) window.appState.subscriptions = updated;
      return normalized;
    }

    if (subPath.startsWith('/subscriptions/') && method === 'DELETE') {
      const feedId = decodeURIComponent(subPath.replace('/subscriptions/', ''));
      const current = this._getJsonStorage(this._localKey('podwaffle_subscriptions', guid), []);
      const updated = current.filter((item) => item.feedId !== feedId && item.feedUrl !== feedId);
      this._saveLocalProfileField(guid, 'subscriptions', updated);
      this._saveLocalProfileField(guid, 'subscriptionsUpdatedAt', new Date().toISOString());
      if (window.appState) window.appState.subscriptions = updated;
      return { ok: true };
    }

    if (subPath === '/subscriptions' && method === 'PATCH') {
      const order = Array.isArray(body?.order) ? body.order : [];
      const current = this._getJsonStorage(this._localKey('podwaffle_subscriptions', guid), []);
      const byId = new Map(current.map((item) => [item.feedId, item]));
      const reordered = order.map((feedId) => byId.get(feedId)).filter(Boolean);
      const remaining = current.filter((item) => !order.includes(item.feedId));
      const updated = [...reordered, ...remaining];
      this._saveLocalProfileField(guid, 'subscriptions', updated);
      this._saveLocalProfileField(guid, 'subscriptionsUpdatedAt', new Date().toISOString());
      return updated;
    }

    if (subPath === '/progress' && method === 'GET') {
      return this._getJsonStorage(this._localKey('podwaffle_progress', guid), {});
    }

    if (subPath.startsWith('/progress/') && method === 'PUT') {
      const episodeGuid = decodeURIComponent(subPath.replace('/progress/', ''));
      const current = this._getJsonStorage(this._localKey('podwaffle_progress', guid), {});
      current[episodeGuid] = { ...(current[episodeGuid] || {}), ...(body || {}) };
      this._saveLocalProfileField(guid, 'progress', current);
      return current[episodeGuid];
    }

    if (subPath === '/playback-session' && method === 'GET') {
      return this._getJsonStorage('podwaffle_playback_session', null);
    }

    if (subPath === '/playback-session' && method === 'PUT') {
      const next = { ...(body || {}), guid, updatedAt: new Date().toISOString() };
      this._setJsonStorage('podwaffle_playback_session', next);
      return next;
    }

    if (subPath === '/playback-session' && method === 'DELETE') {
      localStorage.removeItem('podwaffle_playback_session');
      return { ok: true };
    }

    if (subPath === '/queue' && method === 'GET') {
      return this._getJsonStorage(this._localKey('podwaffle_queue_state', guid), { queue: [], mode: 'local', currentEpisodeGuid: '', updatedAt: new Date().toISOString() });
    }

    if (subPath === '/queue' && method === 'PUT') {
      const next = {
        queue: Array.isArray(body?.queue) ? body.queue : [],
        mode: body?.mode || 'local',
        currentEpisodeGuid: body?.currentEpisodeGuid || '',
        updatedAt: body?.updatedAt || new Date().toISOString(),
      };
      this._saveLocalProfileField(guid, 'queue', next);
      return next;
    }

    if (subPath === '/stats' && method === 'GET') {
      return this._getJsonStorage(this._localKey('podwaffle_stats', guid), { totalListenedSeconds: 0, totalSkippedSeconds: 0 });
    }

    if (subPath === '/stats' && method === 'PUT') {
      const current = this._getJsonStorage(this._localKey('podwaffle_stats', guid), { totalListenedSeconds: 0, totalSkippedSeconds: 0 });
      const next = {
        totalListenedSeconds: Math.max(0, Number(current.totalListenedSeconds || 0) + Number(body?.listenedDelta || 0)),
        totalSkippedSeconds: Math.max(0, Number(current.totalSkippedSeconds || 0) + Number(body?.skippedDelta || 0)),
      };
      this._saveLocalProfileField(guid, 'stats', next);
      return next;
    }

    if (subPath === '/history' && method === 'GET') {
      return [];
    }

    if (subPath === '/history' && method === 'POST') {
      const historyKey = this._localKey('podwaffle_history', guid);
      const current = this._getJsonStorage(historyKey, []);
      const entry = {
        ...(body || {}),
        completedAt: body?.completedAt || new Date().toISOString(),
      };
      current.unshift(entry);
      this._setJsonStorage(historyKey, current);
      return entry;
    }

    if (subPath === '/history' && method === 'POST') {
      return { ok: true };
    }

    if (subPath.startsWith('/sync/')) {
      const profile = this._getLocalProfile(guid);
      return {
        ok: true,
        guid,
        snapshot: {
          guid,
          updatedAt: new Date().toISOString(),
          subscriptionsUpdatedAt: this._getJsonStorage(this._localKey('podwaffle_subscriptions_updated_at', guid), new Date().toISOString()),
          settings: profile.settings,
          subscriptions: this._normalizeSubscriptionsForSync(profile.subscriptions),
          progress: profile.progress,
          stats: profile.stats,
          queue: profile.queue,
          playbackSession: profile.playbackSession,
        },
        queue: profile.queue,
        playbackSession: profile.playbackSession,
        serverTime: new Date().toISOString(),
      };
    }

    if (subPath === '/feeds/refresh' && method === 'POST') {
      return { ok: true };
    }

    throw new Error(`Local API route not implemented: ${method} ${path}`);
  },

  async checkConnectionHealth(timeoutMs = 5000) {
    const cfg = this.getServerConnectionConfig();
    if (!cfg.enabled || !cfg.host) {
      return {
        ok: true,
        mode: 'local',
        message: 'Using local server mode',
        checkedAt: new Date().toISOString(),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    const startedAt = Date.now();

    try {
      const fullUrl = this._buildUrl('/api/health');
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          ok: false,
          mode: 'connected',
          message: `Server returned HTTP ${response.status}`,
          latencyMs: elapsedMs,
          checkedAt: new Date().toISOString(),
        };
      }

      const payload = await response.json().catch(() => ({}));
      return {
        ok: true,
        mode: 'connected',
        message: 'Connected',
        latencyMs: elapsedMs,
        checkedAt: new Date().toISOString(),
        payload,
      };
    } catch (err) {
      return {
        ok: false,
        mode: 'connected',
        message: err && err.name === 'AbortError' ? 'Connection timed out' : (err.message || 'Connection failed'),
        checkedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  },

  // ─── User ─────────────────────────────────────────────
  async createUser() {
    return this._fetch('/api/users', { method: 'POST' });
  },

  async getUser(guid) {
    return this._fetch(`/api/users/${guid}`);
  },

  /**
   * Ensure the backend has a profile for this client's GUID.
   * Called at startup when a backend is configured so the locally-generated
   * GUID gets a server-side profile created on first connection.
   * Idempotent — safe to call any time.
   */
  async ensureUserOnBackend(guid) {
    const cfg = this.getServerConnectionConfig();
    if (!cfg.enabled || !cfg.host) return; // no backend configured — nothing to do
    try {
      const url = this._buildUrl(`/api/users/${guid}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'PUT',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      }).finally(() => clearTimeout(timeout));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      console.log(`[API] ensureUserOnBackend(${guid}) → ok`, data?.guid);
    } catch (err) {
      // Non-fatal — app continues in local mode
      console.warn(`[API] ensureUserOnBackend(${guid}) failed (non-fatal):`, err.message);
    }
  },

  async updateSettings(guid, settings) {
    return this._fetch(`/api/users/${guid}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // ─── Subscriptions ────────────────────────────────────
  async getSubscriptions(guid) {
    return this._fetch(`/api/users/${guid}/subscriptions`);
  },

  async subscribe(guid, feedUrl) {
    const metadata = arguments[2] || null;
    return this._fetch(`/api/users/${guid}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({
        feedUrl,
        ...(metadata || {}),
      }),
    });
  },

  async unsubscribe(guid, feedId) {
    return this._fetch(`/api/users/${guid}/subscriptions/${feedId}`, {
      method: 'DELETE',
    });
  },

  async reorderSubscriptions(guid, feedIds) {
    return this._fetch(`/api/users/${guid}/subscriptions`, {
      method: 'PATCH',
      body: JSON.stringify({ order: feedIds }),
    });
  },

  // ─── Progress ─────────────────────────────────────────
  async getProgress(guid) {
    return this._fetch(`/api/users/${guid}/progress`);
  },

  async updateProgress(guid, episodeGuid, data, requestOptions = {}) {
    const safeEpisodeGuid = encodeURIComponent(String(episodeGuid || ''));
    return this._fetch(`/api/users/${guid}/progress/${safeEpisodeGuid}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...requestOptions,
    });
  },

  async getPlaybackSession(guid) {
    return this._fetch(`/api/users/${guid}/playback-session`);
  },

  async updatePlaybackSession(guid, session, requestOptions = {}) {
    return this._fetch(`/api/users/${guid}/playback-session`, {
      method: 'PUT',
      body: JSON.stringify(session),
      ...requestOptions,
    });
  },

  async clearPlaybackSession(guid, episodeGuid, requestOptions = {}) {
    const suffix = episodeGuid ? `?episodeGuid=${encodeURIComponent(episodeGuid)}` : '';
    return this._fetch(`/api/users/${guid}/playback-session${suffix}`, {
      method: 'DELETE',
      ...requestOptions,
    });
  },

  async sendMediaCommand(guid, command, data = {}) {
    return this._fetch(`/api/ha/media-player/${guid}/command`, {
      method: 'POST',
      body: JSON.stringify({
        command,
        ...(data || {}),
      }),
    });
  },

  async getQueue(guid) {
    return this._fetch(`/api/users/${guid}/queue`);
  },

  async updateQueue(guid, queue, metadata = {}, requestOptions = {}) {
    return this._fetch(`/api/users/${guid}/queue`, {
      method: 'PUT',
      body: JSON.stringify({
        queue: Array.isArray(queue) ? queue : [],
        mode: metadata.mode,
        currentEpisodeGuid: metadata.currentEpisodeGuid,
        updatedAt: metadata.updatedAt,
      }),
      ...requestOptions,
    });
  },

  // ─── History ──────────────────────────────────────────
  async getHistory(guid, limit = 50, offset = 0) {
    return this._fetch(`/api/users/${guid}/history?limit=${limit}&offset=${offset}`);
  },

  async addHistory(guid, entry) {
    return this._fetch(`/api/users/${guid}/history`, {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  },

  // ─── Stats ────────────────────────────────────────────
  async getStats(guid) {
    return this._fetch(`/api/users/${guid}/stats`);
  },

  async updateStats(guid, listenedDelta, skippedDelta) {
    return this._fetch(`/api/users/${guid}/stats`, {
      method: 'PUT',
      body: JSON.stringify({ listenedDelta, skippedDelta }),
    });
  },

  // ─── Podcasts ─────────────────────────────────────────
  async getPodcast(feedId, limit = 100, offset = 0) {
    return this._fetch(`/api/podcasts/${feedId}?limit=${limit}&offset=${offset}`);
  },

  async refreshPodcast(feedId) {
    const podcast = await this.getPodcast(feedId, 500, 0);
    return {
      ok: true,
      feedId,
      refreshedAt: new Date().toISOString(),
      episodeCount: Array.isArray(podcast?.episodes) ? podcast.episodes.length : 0,
    };
  },

  async markEpisodesSeen(feedId, guid, episodeGuids) {
    return this._fetch(`/api/podcasts/${feedId}/seen`, {
      method: 'POST',
      body: JSON.stringify({ guid, episodeGuids }),
    });
  },

  // ─── Search ───────────────────────────────────────────
  async search(query, guid) {
    const g = guid || this._getGuid() || '';
    const cfg = this.getServerConnectionConfig();
    if (!cfg.enabled || !cfg.host) {
      return this._searchAppleCatalog(query);
    }
    return this._fetch(`/api/search?q=${encodeURIComponent(query)}&guid=${encodeURIComponent(g)}`);
  },

  // ─── Feed Refresh ──────────────────────────────────────
  async refreshUserFeeds(guid) {
    return this._fetch(`/api/users/${guid}/feeds/refresh`, {
      method: 'POST',
    });
  },

  // ─── Sync ──────────────────────────────────────────────
  async getSyncSnapshot(guid) {
    return this._fetch(`/api/users/${guid}/sync/snapshot`, {
      method: 'GET',
    });
  },

  async getBootstrapSyncState(guid) {
    return this._fetch(`/api/users/${guid}/sync/bootstrap`, {
      method: 'GET',
    });
  },

  async pushSyncState(guid, state) {
    return this._fetch(`/api/users/${guid}/sync/push`, {
      method: 'POST',
      body: JSON.stringify(state || {}),
    });
  },

  async pullSyncState(guid) {
    return this._fetch(`/api/users/${guid}/sync/pull`, {
      method: 'POST',
    });
  },

  // ─── Cast ─────────────────────────────────────────────
  async getCastDevices() {
    return this._fetch('/api/cast/devices');
  },

  async castPlay(deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration, feedId = '') {
    return this._fetch('/api/cast/play', {
      method: 'POST',
      body: JSON.stringify({ deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration, feedId }),
    });
  },

  async castPause() {
    return this._fetch('/api/cast/pause', { method: 'POST' });
  },

  async castResume() {
    return this._fetch('/api/cast/resume', { method: 'POST' });
  },

  async castStop() {
    return this._fetch('/api/cast/stop', { method: 'POST' });
  },

  async setCastVolume(volume) {
    return this._fetch('/api/cast/setVolume', {
      method: 'POST',
      body: JSON.stringify({ level: volume }),
    });
  },

  async castSeek(position) {
    return this._fetch('/api/cast/seek', {
      method: 'POST',
      body: JSON.stringify({ position }),
    });
  },

  async getCastSession() {
    return this._fetch('/api/cast/session');
  },

  async getCastState() {
    return this._fetch('/api/cast/state');
  },

  async updateCastState(state) {
    return this._fetch('/api/cast/state', {
      method: 'PUT',
      body: JSON.stringify(state || {}),
    });
  },

  async clearCastState(ownerGuid) {
    const suffix = ownerGuid ? `?ownerGuid=${encodeURIComponent(ownerGuid)}` : '';
    return this._fetch(`/api/cast/state${suffix}`, {
      method: 'DELETE',
    });
  },
};

// Expose globally
window.api = api;
