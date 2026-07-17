/* Podwaffle server API. The Home Assistant add-on is authoritative; durable
   offline behavior is added by offlineStore.js. */

function formatDuration(seconds) {
  if (!seconds || Number.isNaN(Number(seconds))) return '';
  const total = Math.floor(Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return minutes > 0 ? `${minutes} mins` : `${total % 60}s`;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  if (value.getTime() === today.getTime()) return 'Today';
  if (value.getTime() === today.getTime() - 86400000) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function sanitizeText(value) { return String(value || ''); }
function debounce(fn, delay) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

Object.assign(window, { formatDuration, formatDate, formatTime, sanitizeText, debounce });

class PodwaffleApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'PodwaffleApiError';
    this.status = status;
    this.payload = payload;
  }
}

const api = {
  _SERVER_CONFIG_KEY: 'podwaffle_server_connection',

  _normalizeServerConfig(config = {}) {
    let baseUrl = String(config.baseUrl || config.url || '').trim().replace(/\/+$/, '');
    if (!baseUrl && config.host) {
      const protocol = config.secure ? 'https' : 'http';
      baseUrl = `${protocol}://${String(config.host).trim()}${config.port ? `:${config.port}` : ''}`;
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
    let host = '';
    let port = '';
    let secure = false;
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        host = parsed.hostname;
        port = parsed.port;
        secure = parsed.protocol === 'https:';
        baseUrl = parsed.href.replace(/\/+$/, '');
      } catch (_) {}
    }
    return {
      enabled: config.enabled !== false,
      baseUrl,
      host,
      port,
      secure,
      accessKey: String(config.accessKey || ''),
      updatedAt: config.updatedAt || new Date().toISOString(),
    };
  },

  getServerConnectionConfig() {
    try {
      const raw = localStorage.getItem(this._SERVER_CONFIG_KEY);
      return this._normalizeServerConfig(raw ? JSON.parse(raw) : { enabled: true });
    } catch (_) {
      return this._normalizeServerConfig({ enabled: true });
    }
  },

  saveServerConnectionConfig(config) {
    const current = this.getServerConnectionConfig();
    const normalized = this._normalizeServerConfig({ ...current, ...config, enabled: true, updatedAt: new Date().toISOString() });
    localStorage.setItem(this._SERVER_CONFIG_KEY, JSON.stringify(normalized));
    return normalized;
  },

  clearServerConnectionConfig() {
    localStorage.removeItem(this._SERVER_CONFIG_KEY);
    return this.getServerConnectionConfig();
  },

  setAccessKey(accessKey) {
    return this.saveServerConnectionConfig({ accessKey: String(accessKey || '') });
  },

  _getRemoteBaseOrigin() {
    return this.getServerConnectionConfig().baseUrl || '';
  },

  _sameOriginBasePath() {
    return String(window.APP_BASE_PATH || '').replace(/\/+$/, '');
  },

  _buildUrl(url) {
    const remote = this._getRemoteBaseOrigin();
    if (remote) return `${remote}${url.startsWith('/') ? url : `/${url}`}`;
    return `${this._sameOriginBasePath()}${url.startsWith('/') ? url : `/${url}`}`;
  },

  getWebSocketUrl() {
    const remote = this._getRemoteBaseOrigin();
    if (remote) {
      const parsed = new URL(remote);
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/ws`;
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    }
    if (!/^https?:$/i.test(location.protocol)) return '';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${this._sameOriginBasePath()}/ws`;
  },

  async _fetch(url, options = {}) {
    const config = this.getServerConnectionConfig();
    if (!config.enabled) throw new PodwaffleApiError('Server connection is disabled');
    if (!config.baseUrl && !/^https?:$/i.test(location.protocol)) {
      throw new PodwaffleApiError('Configure the Podwaffle add-on URL first');
    }

    const requestOptions = { ...options };
    const timeoutMs = Number(requestOptions.timeoutMs || 10000);
    delete requestOptions.timeoutMs;
    const controller = requestOptions.keepalive ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const clientId = window.getPodwaffleClientId?.() || localStorage.getItem('podwaffle_client_id') || '';
    const headers = {
      Accept: 'application/json',
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(config.accessKey ? { 'X-Podwaffle-Key': config.accessKey } : {}),
      ...(clientId ? { 'X-Podwaffle-Client': clientId } : {}),
      ...(requestOptions.headers || {}),
    };

    try {
      const response = await fetch(this._buildUrl(url), {
        ...requestOptions,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
      if (!response.ok) {
        const message = payload?.error || payload?.details || payload || `HTTP ${response.status}`;
        throw new PodwaffleApiError(String(message), response.status, payload);
      }
      return payload;
    } catch (err) {
      if (err?.name === 'AbortError') throw new PodwaffleApiError('Server request timed out');
      throw err;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  },

  getPublicStatus() {
    return this._fetch('/api/status', { timeoutMs: 5000 });
  },
  getProfiles() { return this._fetch('/api/profiles'); },
  getAdminStatus() { return this._fetch('/api/admin/status'); },

  async checkConnectionHealth(timeoutMs = 5000) {
    const startedAt = Date.now();
    try {
      const payload = await this._fetch('/api/health', { timeoutMs });
      return { ok: true, mode: 'server', message: 'Connected', latencyMs: Date.now() - startedAt, checkedAt: new Date().toISOString(), payload };
    } catch (err) {
      return { ok: false, mode: 'server', message: err.message || 'Connection failed', status: err.status || 0, checkedAt: new Date().toISOString() };
    }
  },

  getUser(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}`); },
  updateSettings(guid, settings) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/settings`, { method: 'PUT', body: JSON.stringify(settings) }); },
  getSubscriptions(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/subscriptions`); },
  subscribe(guid, feedUrl, metadata = null) {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/subscriptions`, { method: 'POST', body: JSON.stringify({ feedUrl, ...(metadata || {}) }) });
  },
  unsubscribe(guid, feedId) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/subscriptions/${encodeURIComponent(feedId)}`, { method: 'DELETE' }); },
  reorderSubscriptions(guid, feedIds) {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/subscriptions`, { method: 'PATCH', body: JSON.stringify({ order: feedIds }) });
  },
  getProgress(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/progress`); },
  updateProgress(guid, episodeGuid, data, requestOptions = {}) {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/progress/${encodeURIComponent(episodeGuid)}`, { method: 'PUT', body: JSON.stringify(data), ...requestOptions });
  },
  getPlaybackSession(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/playback-session`); },
  updatePlaybackSession(guid, session, requestOptions = {}) {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/playback-session`, { method: 'PUT', body: JSON.stringify(session), ...requestOptions });
  },
  clearPlaybackSession(guid, episodeGuid, requestOptions = {}) {
    const query = new URLSearchParams();
    if (episodeGuid) query.set('episodeGuid', episodeGuid);
    const clientId = window.getPodwaffleClientId?.() || localStorage.getItem('podwaffle_client_id') || '';
    if (clientId) query.set('clientId', clientId);
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/playback-session${query.size ? `?${query}` : ''}`, { method: 'DELETE', ...requestOptions });
  },
  sendMediaCommand(guid, command, data = {}) {
    return this._fetch(`/api/ha/media-player/${encodeURIComponent(guid)}/command`, { method: 'POST', body: JSON.stringify({ command, ...data }) });
  },
  getPushConfig() { return this._fetch('/api/push/config'); },
  registerPushDevice(guid, token, clientId = '') {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/push/register`, { method: 'POST', body: JSON.stringify({ token, clientId }) });
  },
  sendPushCommand(guid, command, data = {}) {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/push/command`, { method: 'POST', body: JSON.stringify({ command, data }) });
  },
  getQueue(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/queue`); },
  updateQueue(guid, queue, metadata = {}, requestOptions = {}) {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/queue`, { method: 'PUT', body: JSON.stringify({ queue, ...metadata }), ...requestOptions });
  },
  async getHistory(guid, limit = 50, offset = 0) {
    const result = await this._fetch(`/api/users/${encodeURIComponent(guid)}/history?limit=${limit}&offset=${offset}`);
    return Array.isArray(result) ? result : (result?.history || []);
  },
  addHistory(guid, entry) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/history`, { method: 'POST', body: JSON.stringify(entry) }); },
  getStats(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/stats`); },
  updateStats(guid, listenedDelta, skippedDelta, mutationId = '') {
    return this._fetch(`/api/users/${encodeURIComponent(guid)}/stats`, { method: 'PUT', body: JSON.stringify({ listenedDelta, skippedDelta, mutationId }) });
  },
  getPodcast(feedId, limit = 100, offset = 0) { return this._fetch(`/api/podcasts/${encodeURIComponent(feedId)}?limit=${limit}&offset=${offset}`); },
  async refreshPodcast(feedId) {
    const guid = localStorage.getItem('podwaffle_guid');
    if (guid) await this.refreshUserFeeds(guid);
    const podcast = await this.getPodcast(feedId, 500, 0);
    return { ok: true, feedId, refreshedAt: new Date().toISOString(), episodeCount: podcast?.episodes?.length || 0 };
  },
  markEpisodesSeen(feedId, guid, episodeGuids) {
    return this._fetch(`/api/podcasts/${encodeURIComponent(feedId)}/seen`, { method: 'POST', body: JSON.stringify({ guid, episodeGuids }) });
  },
  search(query, guid = localStorage.getItem('podwaffle_guid') || '') {
    return this._fetch(`/api/search?q=${encodeURIComponent(query)}&guid=${encodeURIComponent(guid)}`);
  },
  refreshUserFeeds(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/feeds/refresh`, { method: 'POST' }); },
  getBootstrapSyncState(guid) { return this._fetch(`/api/users/${encodeURIComponent(guid)}/sync/bootstrap`); },
  getCastDevices() { return this._fetch('/api/cast/devices'); },
  castPlay(deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration, feedId = '') {
    return this._fetch('/api/cast/play', { method: 'POST', body: JSON.stringify({ deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration, feedId }) });
  },
  castPause() { return this._fetch('/api/cast/pause', { method: 'POST', body: JSON.stringify({ userGuid: localStorage.getItem('podwaffle_guid') }) }); },
  castResume() { return this._fetch('/api/cast/resume', { method: 'POST', body: JSON.stringify({ userGuid: localStorage.getItem('podwaffle_guid') }) }); },
  castStop() { return this._fetch('/api/cast/stop', { method: 'POST', body: JSON.stringify({ userGuid: localStorage.getItem('podwaffle_guid') }) }); },
  setCastVolume(level) { return this._fetch('/api/cast/setVolume', { method: 'POST', body: JSON.stringify({ userGuid: localStorage.getItem('podwaffle_guid'), level }) }); },
  castSeek(position) { return this._fetch('/api/cast/seek', { method: 'POST', body: JSON.stringify({ userGuid: localStorage.getItem('podwaffle_guid'), position }) }); },
  getCastSession() { return this._fetch('/api/cast/session'); },
};

window.PodwaffleApiError = PodwaffleApiError;
window.api = api;
