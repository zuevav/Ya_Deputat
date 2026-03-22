const CACHE_NAME = 'ya-deputat-v250';
const STATIC_ASSETS = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/admin.js',
  '/js/deputy.js',
  '/js/offline.js',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.svg',
  '/icons/zetit-logo.png'
];

const API_CACHE = 'ya-deputat-api-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== API_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API GET requests — network first, cache fallback
  if (url.pathname.startsWith('/api/') && request.method === 'GET') {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(API_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => caches.match(request).then(cached => cached || new Response(JSON.stringify({ error: 'Нет соединения' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }

  // API POST/PUT/DELETE — pass through to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Uploads — pass through
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(r => {
        if (r.ok) { const c = r.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, c)); }
        return r;
      }).catch(() => new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(request).then(cached => {
      const fetched = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// Push notifications
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Я Депутат', {
    body: data.body || 'Новое уведомление',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    data: data.data || {},
    vibrate: [200, 100, 200]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data;
  let url = '/';
  if (data?.eventId) url = `/#event-${data.eventId}`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
