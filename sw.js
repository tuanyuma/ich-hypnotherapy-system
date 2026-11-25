/**
 * sw.js — Service Worker ICH HYPNOTHERAPY
 * KEBIJAKAN PRIVASI KLINIS:
 * - Hanya men-cache aset App Shell statis (HTML, CSS, JS, ikon).
 * - Seluruh panggilan API (script.google.com / POST / data pasien & RME)
 *   BERSIFAT NETWORK-ONLY dan TIDAK PERNAH disimpan di Cache Storage.
 */

const SHELL_CACHE = 'ich-hypno-shell-v3';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/css/tokens.css',
  './assets/css/app.css',
  './assets/js/config.js',
  './assets/js/api.js',
  './assets/js/auth.js',
  './assets/js/ui.js',
  './assets/js/router.js',
  './assets/js/app.js',
  './assets/js/pages/login.js',
  './assets/js/pages/dashboard.js',
  './assets/js/pages/users.js',
  './assets/js/pages/therapists.js',
  './assets/js/pages/clients.js',
  './assets/js/pages/assessments.js',
  './assets/js/pages/appointments.js',
  './assets/js/pages/rme.js',
  './assets/js/pages/auditLogs.js',
  './assets/js/pages/settings.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // JANGAN PERNAH cache POST atau panggilan ke Google Apps Script / origin eksternal
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Strategi Stale-While-Revalidate untuk App Shell same-origin
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
