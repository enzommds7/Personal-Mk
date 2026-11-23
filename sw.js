// Cache apenas recursos estáticos. Dados pessoais ficam no armazenamento do app.
const CACHE_NAME = 'personalmk-static-v23';
const PRECACHE = [
  './index.html',
  './style.css?v=3.0',
  './app.js?v=3.0',
  './icon.svg'
];
const APP_PREFIXES = ['personalmk-static-', 'agenda-cache-'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name !== CACHE_NAME && APP_PREFIXES.some(prefix => name.startsWith(prefix))
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Não cachear APIs, endpoints dinâmicos nem caminhos desconhecidos.
  const path = url.pathname;
  const isNavigation = request.mode === 'navigate';
  const isStatic = /\/(?:index\.html|app\.js|style\.css|icon\.svg)$/.test(path);
  if (!isNavigation && !isStatic) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (isNavigation) {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || self.registration.scope;
  event.waitUntil((async () => {
    if (data.url && !data.url.startsWith(self.registration.scope)) {
      return self.clients.openWindow(data.url);
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
