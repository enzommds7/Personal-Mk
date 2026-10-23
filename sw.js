const CACHE_NAME = 'agenda-cache-v18';
const urlsToCache = [
  './index.html',
  './style.css?v=2.2',
  './app.js?v=2.2',
  './style.css',
  './app.js',
  './icon.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Só faz cache de GETs do próprio site. POSTs (Gemini, Spotify token) e APIs externas
  // passam direto — cache.put em POST lança erro e quebrava essas chamadas.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => { });
      return response;
    }).catch(() => caches.match(req))
  );
});

/* ────── Clique na notificação ────── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || self.registration.scope;

  event.waitUntil((async () => {
    // Link externo (ex: música no Spotify) → abre direto
    if (data.url && !data.url.startsWith(self.registration.scope)) {
      return self.clients.openWindow(data.url);
    }
    // Senão, foca o app se já estiver aberto
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});