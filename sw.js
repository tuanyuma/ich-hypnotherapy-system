/**
 * sw.js — Service Worker ICH HYPNOTHERAPY
 * KEBIJAKAN PRIVASI KLINIS:
 * - Hanya men-cache aset App Shell statis (HTML, CSS, JS, ikon).
 * - Seluruh panggilan API (script.google.com / POST / data pasien & RME)
 *   BERSIFAT NETWORK-ONLY dan TIDAK PERNAH disimpan di Cache Storage.
 */

const SHELL_CACHE = 'ich-hypno-shell-v10';
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
  './assets/js/store.js',
  './assets/js/motion.js',
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
  './assets/js/pages/packages.js',
  './assets/js/pages/payments.js',
  './assets/js/pages/commissions.js',
  './assets/js/pages/reports.js',
  './assets/js/pages/auditLogs.js',
  './assets/js/pages/settings.js'
];

function isCodeAsset(req, url) {
  if (req.mode === 'navigate') return true;
  const p = url.pathname || '';
  return p === '/' || /\.(html|js|mjs|css|json)$/i.test(p);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: 'reload' })).catch(() => {})
        )
      )
    )
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

  // Strategi NETWORK-FIRST untuk HTML, JS, CSS, & JSON agar versi modul ES selalu sinkron
  // dan tidak pernah bentrok antara ui.js versi lama dengan halaman versi baru.
  if (isCodeAsset(req, url)) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Strategi Cache-First untuk aset statis biner (ikon, gambar)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
