/* ============================================================
   Podwaffle — api.js
   API client module. All methods are async, throw on non-OK.
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

// ── API client
const api = {
  _buildUrl(url) {
    return (url.startsWith('/api/') && window.APP_BASE_PATH)
      ? window.APP_BASE_PATH + url
      : url;
  },

  _getGuid() {
    return localStorage.getItem('podwaffle_guid');
  },

  async _fetch(url, options = {}) {
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

  // ─── User ─────────────────────────────────────────────
  async createUser() {
    return this._fetch('/api/users', { method: 'POST' });
  },

  async getUser(guid) {
    return this._fetch(`/api/users/${guid}`);
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
    return this._fetch(`/api/users/${guid}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({ feedUrl }),
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

  async markEpisodesSeen(feedId, guid, episodeGuids) {
    return this._fetch(`/api/podcasts/${feedId}/seen`, {
      method: 'POST',
      body: JSON.stringify({ guid, episodeGuids }),
    });
  },

  // ─── Search ───────────────────────────────────────────
  async search(query, guid) {
    const g = guid || this._getGuid() || '';
    return this._fetch(`/api/search?q=${encodeURIComponent(query)}&guid=${encodeURIComponent(g)}`);
  },

  // ─── Cast ─────────────────────────────────────────────
  async getCastDevices() {
    return this._fetch('/api/cast/devices');
  },

  async castPlay(deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration) {
    return this._fetch('/api/cast/play', {
      method: 'POST',
      body: JSON.stringify({ deviceId, mediaUrl, startPosition, episodeGuid, userGuid, title, podcastTitle, imageUrl, duration }),
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
    return this._fetch('/api/cast/volume', {
      method: 'PUT',
      body: JSON.stringify({ volume }),
    });
  },

  async castSeek(position) {
    return this._fetch('/api/cast/seek', {
      method: 'PUT',
      body: JSON.stringify({ position }),
    });
  },

  async getCastState() {
    return this._fetch('/api/cast/state');
  },
};

// Expose globally
window.api = api;
