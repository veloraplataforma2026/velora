/* ============================================================
   VELORA — Service Worker
   PWA: offline support, asset caching, push notifications
   ============================================================ */

const CACHE_NAME = 'velora-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css?v=8',
  '/css/components.css?v=8',
  '/css/animations.css?v=8',
  '/js/app.js?v=8',
  '/js/firebase-config.js?v=8',
  '/js/auth.js?v=8',
  '/js/ui.js?v=8',
  '/js/swipe.js?v=8',
  '/js/chat.js?v=8',
  '/js/gallery.js?v=8',
  '/js/currency.js?v=8',
  '/js/profile.js?v=8',
  '/js/i18n.js?v=8',
  '/js/cloudinary.js?v=8',
  '/js/analytics.js?v=8',
  '/js/notifications.js?v=8',
  '/js/moderation.js?v=8',
  '/js/stories.js?v=8',
  '/assets/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for API/Firebase calls, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and cross-origin Firebase/Cloudinary requests
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit')) return;
  if (url.hostname.includes('cloudinary.com')) return;
  if (url.hostname.includes('stripe.com')) return;

  // Cache-first for same-origin assets
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback for navigation
          if (e.request.mode === 'navigate') return caches.match('/index.html');
        });
      })
    );
    return;
  }

  // Network-first for Google Fonts
  if (url.hostname.includes('fonts.')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});

// Push notification handler
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'VELORA', body: e.data.text() }; }

  const options = {
    body:    data.body  || 'Você tem uma nova notificação!',
    icon:    '/assets/icon-192.png',
    badge:   '/assets/icon-192.png',
    tag:     data.tag   || 'velora-notification',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: data.actions || [],
  };

  e.waitUntil(self.registration.showNotification(data.title || 'VELORA', options));
});

// Click on notification → open or focus the app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl }); return; }
      return clients.openWindow(targetUrl);
    })
  );
});
