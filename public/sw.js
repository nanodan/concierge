const CACHE_NAME = 'claude-chat-v42';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/css/themes/darjeeling.css',
  '/css/themes/claude.css',
  '/css/themes/nord.css',
  '/css/themes/budapest.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/messages.css',
  '/css/list.css',
  '/js/app.js',
  '/js/utils.js',
  '/js/state.js',
  '/js/websocket.js',
  '/js/render.js',
  '/js/markdown.js',
  '/js/conversations.js',
  '/js/ui.js',
  '/manifest.json',
  '/lib/highlight.min.js',
];

// API routes to cache for offline use
const CACHED_API_ROUTES = ['/api/conversations'];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket requests
  if (event.request.headers.get('upgrade') === 'websocket') return;

  // Cacheable API routes: network-first, fall back to cache
  if (CACHED_API_ROUTES.some(route => url.pathname === route || url.pathname.startsWith(route + '?'))) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Skip other API requests
  if (url.pathname.startsWith('/api/')) return;

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
