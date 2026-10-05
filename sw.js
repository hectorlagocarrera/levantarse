// Service worker: funcionamiento sin conexión y gestión de clics en notificaciones.
const CACHE = 'levantarse-v5';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'schedule.js',
  'config.js',
  'calendar.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero para recibir actualizaciones; caché si no hay conexión.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});

// Avisos enviados por el servidor: llegan aunque el móvil esté bloqueado o la app cerrada.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* sin datos */ }
  const kind = data.kind || 'aviso';
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || 'Levántate', {
      body: data.body || '',
      tag: 'levantarse-' + kind,
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      requireInteraction: kind === 'stand',
      data,
    }),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => list.forEach((c) => c.postMessage({ type: 'push', kind }))),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./');
    }),
  );
});
