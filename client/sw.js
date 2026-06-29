const CACHE_NAME = 'podwaffle-media-v1';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// On install: skip waiting
self.addEventListener('install', event => { 
  self.skipWaiting(); 
});

// On activate: claim clients, evict stale entries
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const keys = await cache.keys();
      const now = Date.now();
      for (const request of keys) {
        const response = await cache.match(request);
        const dateHeader = response?.headers.get('sw-cached-at');
        if (dateHeader) {
          const cachedAt = parseInt(dateHeader);
          if (now - cachedAt > MAX_AGE_MS) {
            await cache.delete(request);
            console.log('[SW] Evicted stale cache entry:', request.url);
          }
        }
      }
    })
  );
  self.clients.claim();
});

// On fetch: intercept audio requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Only cache GET requests
  if (event.request.method !== 'GET') return;
  
  // Only cache audio file requests (mp3, m4a, ogg, etc.)
  // Often podcast URLs don't have clear extensions, so we also check for typical audio headers or parameters if possible.
  // We'll use a broad check for known audio extensions.
  const isAudio = /\.(mp3|m4a|ogg|wav|aac|opus)/i.test(url.pathname);
  
  // For requests from our own player, we might append ?_audio=1 or rely on range headers
  const isPlayerAudioRequest = event.request.headers.get('range') !== null || url.searchParams.has('_audio');
  
  if (!isAudio && !isPlayerAudioRequest) {
    return; // Let browser handle normally
  }
  
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) {
        console.log('[SW] Serving from cache:', url.href);
        return cached;
      }
      
      // Fetch and cache
      try {
        const response = await fetch(event.request);
        
        // Only cache successful complete responses (not 206 Partial Content, caching partials gets complicated)
        // If we want to cache properly, we should cache the full 200 OK.
        // The browser's native audio element handles range requests automatically if the file is served from cache.
        if (response.status === 200) {
          // Clone and add timestamp header
          const headers = new Headers(response.headers);
          headers.set('sw-cached-at', Date.now().toString());
          const cachedResponse = new Response(await response.clone().blob(), {
            status: response.status,
            statusText: response.statusText,
            headers
          });
          cache.put(event.request, cachedResponse);
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
