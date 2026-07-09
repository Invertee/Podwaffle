const APP_SHELL_CACHE_NAME = 'podwaffle-shell-v3';
const AUDIO_CACHE_NAME = 'podwaffle-audio-v3';
const IMAGE_CACHE_NAME = 'podwaffle-images-v1';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/api.js',
  './js/app.js',
  './js/cacheManager.js',
  './js/castClient.js',
  './js/player.js',
  './js/components/nav.js',
  './js/components/episodeRow.js',
  './js/components/playerBar.js',
  './js/components/queue.js',
  './js/components/castModal.js',
  './js/views/podcasts.js',
  './js/views/podcastDetail.js',
  './js/views/inProgress.js',
  './js/views/discover.js',
  './js/views/history.js',
  './js/views/profile.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/play.svg',
  './icons/pause.svg',
  './icons/skip-backwards.svg',
  './icons/skip-forward.svg',
];

function isSameOrigin(url) {
  return new URL(url).origin === self.location.origin;
}

function isApiOrSocketRequest(url) {
  return /\/api(\/|$)/.test(url.pathname) || /\/ws(\/|$)/.test(url.pathname);
}

function isAppShellRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (!isSameOrigin(url.href)) return false;
  if (isApiOrSocketRequest(url)) return false;

  if (request.mode === 'navigate') return true;
  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'manifest' || request.destination === 'font') {
    return true;
  }

  return /\.(js|css|html|json|webmanifest)$/i.test(url.pathname);
}

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

async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  const precacheTasks = APP_SHELL_ASSETS.map(async (assetPath) => {
    try {
      await cache.add(new Request(assetPath, { cache: 'reload' }));
    } catch (err) {
      console.warn('[SW] Failed to precache asset:', assetPath, err?.message || err);
    }
  });
  await Promise.all(precacheTasks);
}

async function handleNavigationRequest(event) {
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse && networkResponse.ok && isSameOrigin(event.request.url)) {
      cache.put(event.request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (_) {
    const cachedPage = await cache.match(event.request, { ignoreSearch: true });
    if (cachedPage) return cachedPage;

    const cachedIndex = await cache.match('./index.html');
    if (cachedIndex) return cachedIndex;

    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function handleAppShellRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok && isSameOrigin(request.url)) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch.catch(() => {});
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;

  if (request.mode === 'navigate') {
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
  }

  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precacheAppShell();
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const valid = new Set([APP_SHELL_CACHE_NAME, AUDIO_CACHE_NAME, IMAGE_CACHE_NAME]);
    await Promise.all(keys.filter((key) => !valid.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate' && isSameOrigin(url.href) && !isApiOrSocketRequest(url)) {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  if (isArtworkRequest(request, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const cached = await cache.match(request);

      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response && (response.ok || response.type === 'opaque')) {
                return cache.put(request, response.clone());
              }
              return null;
            })
            .catch(() => null)
        );
        return cached;
      }

      const networkFetch = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        })
        .catch(() => null);

      const fresh = await networkFetch;
      if (fresh) return fresh;
      return new Response('', { status: 504, statusText: 'Image unavailable' });
    })());
    return;
  }

  if (isAudioRequest(request, url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          if (!looksLikeAudioResponse(cached) || cached.type === 'opaque') {
            await cache.delete(request);
          } else {
            return createRangeResponse(request.headers.get('range'), cached.clone());
          }
        }

        try {
          const response = await fetch(request);
          if (!looksLikeAudioResponse(response)) {
            return response;
          }

          if (response.status === 200 && response.type !== 'opaque') {
            cache.put(request, response.clone()).catch(() => {});
          }

          return response;
        } catch (err) {
          console.error('[SW] Audio fetch failed:', err);
          throw err;
        }
      })
    );
    return;
  }

  if (isAppShellRequest(request, url)) {
    event.respondWith(handleAppShellRequest(request));
  }
});
