const AUDIO_CACHE_NAME = 'podwaffle-audio-v3';
const IMAGE_CACHE_NAME = 'podwaffle-images-v1';

function createRangeResponse(rangeHeader, response) {
  if (!rangeHeader || !response || response.type === 'opaque') {
    return Promise.resolve(response);
  }

  const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader);
  if (!match) {
    return Promise.resolve(response);
  }

  return response.arrayBuffer().then((buffer) => {
    const totalLength = buffer.byteLength;
    const start = parseInt(match[1], 10);
    const requestedEnd = match[2] ? parseInt(match[2], 10) : totalLength - 1;
    const end = Math.min(requestedEnd, totalLength - 1);

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= totalLength) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${totalLength}`
        }
      });
    }

    const sliced = buffer.slice(start, end + 1);
    const headers = new Headers(response.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${totalLength}`);
    headers.set('Content-Length', String(end - start + 1));
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'audio/mpeg');
    }

    return new Response(sliced, {
      status: 206,
      statusText: 'Partial Content',
      headers,
    });
  }).catch(() => response);
}

// On install: skip waiting
self.addEventListener('install', event => { 
  self.skipWaiting(); 
});

// On activate: claim clients, evict stale entries
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const valid = new Set([AUDIO_CACHE_NAME, IMAGE_CACHE_NAME]);
      for (const key of keys) {
        if (!valid.has(key)) {
          await caches.delete(key);
        }
      }
    })
  );
  self.clients.claim();
});

function isAudioRequest(request, url) {
  if (request.method !== 'GET') return false;
  const extensionMatch = /\.(mp3|m4a|ogg|wav|aac|opus|flac)$/i.test(url.pathname);
  const rangeRequest = request.headers.get('range') !== null;
  const hintedAudio = url.searchParams.has('_audio');
  return extensionMatch || rangeRequest || hintedAudio;
}

function isArtworkRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (request.destination === 'image') return true;
  return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(url.pathname);
}

function looksLikeAudioResponse(response) {
  if (!response) return false;
  if (response.type === 'opaque') return false;
  const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
  return contentType.startsWith('audio/') || contentType.includes('application/octet-stream');
}

// On fetch: intercept audio + image requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (isArtworkRequest(event.request, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const cached = await cache.match(event.request);

      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        networkFetch.catch(() => null);
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;
      return new Response('', { status: 504, statusText: 'Image unavailable' });
    })());
    return;
  }

  if (!isAudioRequest(event.request, url)) {
    return;
  }

  event.respondWith(
    caches.open(AUDIO_CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) {
        if (!looksLikeAudioResponse(cached) || cached.type === 'opaque') {
          await cache.delete(event.request);
        } else {
          console.log('[SW] Serving from cache:', url.href);
          return createRangeResponse(event.request.headers.get('range'), cached.clone());
        }
      }

      // Fetch and cache
      try {
        const response = await fetch(event.request);

        if (!looksLikeAudioResponse(response)) {
          return response;
        }

        // Cache successful complete responses only (range 206 responses are intentionally excluded)
        if (response.status === 200 && response.type !== 'opaque') {
          cache.put(event.request, response.clone());
          console.log('[SW] Cached audio:', url.href);
        }

        return response;
      } catch (err) {
        console.error('[SW] Fetch failed:', err);
        throw err;
      }
    })
  );
});
