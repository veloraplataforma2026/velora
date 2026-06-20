/* ============================================================
   VELORA — Service Worker
   Estratégia: network-first sempre (sem cache de assets).
   Cache só como fallback offline para navegação.
   Push notifications mantidas.
   ============================================================ */

const CACHE_NAME = 'velora-v4';

// Ao instalar: limpa tudo, ativa imediatamente
self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

// Ao ativar: apaga todos os caches antigos e assume controle
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first para tudo — sempre busca versão fresca do servidor
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Deixa Firebase/Cloudinary/Stripe passarem sem interceptar
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('cloudinary.com') ||
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('gstatic.com')
  ) return;

  // Network-first: busca do servidor, cai no cache só se offline
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Guarda só o index.html para fallback offline de navegação
        if (e.request.mode === 'navigate' && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put('/index.html', clone));
        }
        return response;
      })
      .catch(() => {
        if (e.request.mode === 'navigate') return caches.match('/index.html');
      })
  );
});

// ─── Push Notifications ───────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'VELORA', body: e.data.text() }; }

  const options = {
    body:    data.body    || 'Você tem uma nova notificação!',
    icon:    '/assets/icon.svg',
    badge:   '/assets/icon.svg',
    tag:     data.tag     || 'velora-notification',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: data.actions || [],
  };

  e.waitUntil(self.registration.showNotification(data.title || 'VELORA', options));
});

// ─── Notification Click ───────────────────────────────────
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
