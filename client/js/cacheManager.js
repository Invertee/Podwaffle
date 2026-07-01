/* ============================================================
   Podwaffle — cacheManager.js
   Client-side audio cache helper for offline/downloaded episodes.
   Exposes window.cacheManager.
   ============================================================ */

const cacheManager = {
  AUDIO_CACHE_NAME: 'podwaffle-audio-v3',
  TTL_MS: 14 * 24 * 60 * 60 * 1000,
  INDEX_STORAGE_KEY: 'podwaffle_audio_cache_index_v1',
  _statusByUrl: new Map(),
  _pendingDownloads: new Map(),
  _cacheIndex: {},

  init() {
    this._loadIndex();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    this.cleanupExpired().catch((err) => {
      console.warn('[cacheManager] Expiry cleanup failed:', err?.message || err);
    });
  },

  isSupported() {
    return typeof caches !== 'undefined' && typeof fetch !== 'undefined';
  },

  _resolveUrl(input) {
    const raw = typeof input === 'string' ? input : input?.audioUrl;
    if (!raw) return null;
    try {
      return new URL(raw, window.location.href).href;
    } catch (_) {
      return raw;
    }
  },

  _setStatus(input, status) {
    const url = this._resolveUrl(input);
    if (!url) return;
    this._statusByUrl.set(url, status);
    window.dispatchEvent(new CustomEvent('podwaffle:cache-status', {
      detail: { url, status }
    }));
  },

  _loadIndex() {
    try {
      const raw = localStorage.getItem(this.INDEX_STORAGE_KEY);
      this._cacheIndex = raw ? JSON.parse(raw) : {};
    } catch (_) {
      this._cacheIndex = {};
    }
  },

  _saveIndex() {
    try {
      localStorage.setItem(this.INDEX_STORAGE_KEY, JSON.stringify(this._cacheIndex || {}));
    } catch (_) {}
  },

  _markCached(url) {
    if (!url) return;
    this._cacheIndex[url] = Date.now();
    this._saveIndex();
  },

  _clearCachedMark(url) {
    if (!url) return;
    if (this._cacheIndex && this._cacheIndex[url]) {
      delete this._cacheIndex[url];
      this._saveIndex();
    }
  },

  _isExpired(url) {
    const ts = this._cacheIndex ? this._cacheIndex[url] : null;
    if (!ts || !Number.isFinite(ts)) return false;
    return (Date.now() - ts) > this.TTL_MS;
  },

  async _getCache() {
    return caches.open(this.AUDIO_CACHE_NAME);
  },

  _isCacheableAudioResponse(response) {
    if (!response || response.type === 'opaque' || !response.ok) return false;
    const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
    return contentType.startsWith('audio/') || contentType.includes('application/octet-stream');
  },

  async getStatus(input) {
    const url = this._resolveUrl(input);
    if (!url || !this.isSupported()) return 'unsupported';

    if (this._pendingDownloads.has(url)) return 'downloading';
    const known = this._statusByUrl.get(url);
    if (known === 'cached' || known === 'error') return known;

    const cache = await this._getCache();
    const cached = await cache.match(url);

    if (cached && cached.type === 'opaque') {
      await cache.delete(url);
      this._clearCachedMark(url);
      this._statusByUrl.set(url, 'uncached');
      return 'uncached';
    }

    if (cached && this._isExpired(url)) {
      await cache.delete(url);
      this._clearCachedMark(url);
      this._statusByUrl.set(url, 'uncached');
      return 'uncached';
    }

    const status = cached ? 'cached' : 'uncached';
    if (cached) {
      this._markCached(url);
    } else {
      this._clearCachedMark(url);
    }
    this._statusByUrl.set(url, status);
    return status;
  },

  async getStatuses(episodes = []) {
    const entries = await Promise.all((episodes || []).map(async (episode) => {
      const status = await this.getStatus(episode);
      return [episode.guid, status];
    }));
    return Object.fromEntries(entries);
  },

  async downloadEpisode(episode) {
    const url = this._resolveUrl(episode);
    if (!url || !this.isSupported()) {
      throw new Error('Caching is not supported in this browser.');
    }

    const existingStatus = await this.getStatus(url);
    if (existingStatus === 'cached') return 'cached';
    if (this._pendingDownloads.has(url)) return this._pendingDownloads.get(url);

    const task = (async () => {
      this._setStatus(url, 'downloading');
      try {
        const cache = await this._getCache();
        const response = await fetch(new Request(url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'reload'
        }));

        if (!this._isCacheableAudioResponse(response)) {
          throw new Error(`Audio response not cacheable (status=${response.status}, type=${response.type})`);
        }

        await cache.put(url, response.clone());
        this._markCached(url);
        this._setStatus(url, 'cached');
        return 'cached';
      } catch (err) {
        this._setStatus(url, 'error');
        throw err;
      } finally {
        this._pendingDownloads.delete(url);
      }
    })();

    this._pendingDownloads.set(url, task);
    return task;
  },

  async prefetchEpisodes(episodes = [], limit = 2) {
    if (!this.isSupported()) return;
    const candidates = (episodes || []).slice(0, limit);
    for (const episode of candidates) {
      try {
        const status = await this.getStatus(episode);
        if (status === 'uncached' || status === 'error') {
          await this.downloadEpisode(episode);
        }
      } catch (err) {
        console.warn('[cacheManager] Failed to prefetch episode:', episode?.title, err);
      }
    }
  },

  async deleteEpisode(episode) {
    const url = this._resolveUrl(episode);
    if (!url || !this.isSupported()) return false;

    const cache = await this._getCache();
    const deleted = await cache.delete(url);
    this._clearCachedMark(url);
    this._setStatus(url, 'uncached');
    return deleted;
  },

  async deleteEpisodes(episodes = []) {
    const tasks = (episodes || []).map((episode) => this.deleteEpisode(episode).catch(() => false));
    return Promise.all(tasks);
  },

  async cleanupExpired() {
    if (!this.isSupported()) return;
    const cache = await this._getCache();
    const requests = await cache.keys();
    const now = Date.now();

    for (const request of requests) {
      const url = request.url;
      const cachedAt = this._cacheIndex ? this._cacheIndex[url] : null;

      if (!cachedAt || !Number.isFinite(cachedAt)) {
        this._cacheIndex[url] = now;
        continue;
      }

      if ((now - cachedAt) > this.TTL_MS) {
        await cache.delete(request);
        this._setStatus(url, 'uncached');
        delete this._cacheIndex[url];
      }
    }

    const existingUrlSet = new Set(requests.map((r) => r.url));
    Object.keys(this._cacheIndex || {}).forEach((url) => {
      if (!existingUrlSet.has(url)) {
        delete this._cacheIndex[url];
      }
    });

    this._saveIndex();
  }
};

window.cacheManager = cacheManager;
