// GunplaSet PWA Service Worker v2.0
const CACHE_NAME = 'gunplaset-core-v2.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/apple-touch-icon.png'
];

// 1. Install: Pre-cache core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline app shell');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate: Clean up previous versions & take immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch: Intelligent Hybrid Caching Strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // Bypass Cache for Real-Time Backend APIs (User Profile, Cloud Sync, Analytics)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests (HTML document): Network-First with Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          console.log('[ServiceWorker] Network offline, serving cached index.html shell');
          const cache = await caches.open(CACHE_NAME);
          const cachedHtml = await cache.match('./index.html') || await cache.match('./');
          if (cachedHtml) return cachedHtml;
          return new Response('<html><body><h2>오프라인 상태입니다</h2><p>GunplaSet 앱이 오프라인 모드로 실행되었습니다.</p></body></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        })
    );
    return;
  }

  // Static Local Images and Assets: Cache-First with Network Revalidation
  if (url.origin === location.origin && (url.pathname.includes('/images/') || url.pathname.endsWith('.json') || url.pathname.endsWith('.js'))) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Asynchronously update cache in background
          fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Default: Stale-While-Revalidate for other resources
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
