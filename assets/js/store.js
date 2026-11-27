/**
 * store.js — In-Memory Stale-While-Revalidate (SWR) & Background Prefetch Store.
 * KEAMANAN PRIVASI KLINIS:
 * - Seluruh cache hanya hidup di memori RAM JS (TIDAK PERNAH menyentuh localStorage).
 * - Otomatis dibersihkan saat Logout, sesi berakhir, atau tab ditutup.
 */

import { apiCall } from './api.js';

const memCache = new Map();
let prefetchInFlight = null;
let lastPrefetchAt = 0;

function computeSignature(val) {
  try {
    return JSON.stringify(val);
  } catch (_) {
    return String(Date.now());
  }
}

export function storeGet(key) {
  return memCache.get(key) || null;
}

export function storeSet(key, data, meta = null) {
  const sig = computeSignature({ data, meta });
  const prev = memCache.get(key);
  const changed = !prev || prev.sig !== sig;
  const entry = { data, meta, ts: Date.now(), sig };
  memCache.set(key, entry);
  return { entry, changed };
}

export function storeIsFresh(key, ttlMs = 45000) {
  const entry = memCache.get(key);
  return Boolean(entry && (Date.now() - entry.ts) < ttlMs);
}

export function storeInvalidate(prefix) {
  if (!prefix) return;
  for (const key of Array.from(memCache.keys())) {
    if (key === prefix || key.startsWith(prefix + ':')) {
      memCache.delete(key);
    }
  }
}

export function storeClearAll() {
  memCache.clear();
  prefetchInFlight = null;
  lastPrefetchAt = 0;
}

/**
 * Perbarui item di cache list secara optimistik (misal saat hapus/edit baris).
 */
export function storeUpdateListItems(prefix, updaterFn) {
  for (const [key, entry] of memCache.entries()) {
    if ((key === prefix || key.startsWith(prefix + ':')) && entry && Array.isArray(entry.data)) {
      const nextItems = updaterFn(entry.data.slice());
      const nextMeta = entry.meta ? Object.assign({}, entry.meta) : null;
      if (nextMeta && typeof nextMeta.total === 'number') {
        const diff = nextItems.length - entry.data.length;
        nextMeta.total = Math.max(0, nextMeta.total + diff);
      }
      storeSet(key, nextItems, nextMeta);
    }
  }
}

/**
 * Ambil opsi terapis secara instan dari RAM bila tersedia, lalu segarkan di latar.
 */
export async function getTherapistsOptionsCached({ activeOnly = false, unlinkedOnly = false, excludeUserId = '' } = {}) {
  // Opsi unlinked_only khusus form Users selalu ambil segar agar tautan 1:1 akurat
  if (unlinkedOnly) {
    const res = await apiCall('therapists.options', {
      active_only: activeOnly,
      unlinked_only: true,
      exclude_user_id: excludeUserId
    });
    return (res.data && res.data.items) || [];
  }

  const key = activeOnly ? 'therapists:options:active' : 'therapists:options:all';
  const cached = storeGet(key);
  if (cached && Array.isArray(cached.data)) {
    if (!storeIsFresh(key, 60000)) {
      apiCall('therapists.options', { active_only: activeOnly }, { silentBackground: true })
        .then((res) => storeSet(key, (res.data && res.data.items) || []))
        .catch(() => {});
    }
    return cached.data;
  }

  const allCached = storeGet('therapists:options:all');
  if (activeOnly && allCached && Array.isArray(allCached.data)) {
    return allCached.data.filter((t) => t.status === 'ACTIVE');
  }

  const res = await apiCall('therapists.options', { active_only: activeOnly });
  const items = (res.data && res.data.items) || [];
  storeSet(key, items);
  return items;
}

/**
 * Prefetch diam-diam 1 round-trip setelah login/dashboard agar pindah antar 8+ menu utama instan (<50ms).
 */
export function prefetchCoreModules(force = false) {
  const now = Date.now();
  if (!force && (prefetchInFlight || (now - lastPrefetchAt) < 45000)) {
    return prefetchInFlight;
  }

  prefetchInFlight = apiCall('app.bootstrap', {}, { background: true })
    .then((res) => {
      const b = (res && res.data) || {};
      if (Array.isArray(b.therapists_options)) {
        storeSet('therapists:options:all', b.therapists_options);
        storeSet('therapists:options:active', b.therapists_options.filter((t) => t.status === 'ACTIVE'));
      }
      if (b.therapists_page1 && Array.isArray(b.therapists_page1.items)) {
        storeSet('therapists:list:p1:default', b.therapists_page1.items, b.therapists_page1.meta);
      }
      if (b.clients_page1 && Array.isArray(b.clients_page1.items)) {
        storeSet('clients:list:p1:default', b.clients_page1.items, b.clients_page1.meta);
      }
      if (b.appointments_page1 && Array.isArray(b.appointments_page1.items)) {
        storeSet('appointments:list:p1:default', b.appointments_page1.items, b.appointments_page1.meta);
      }
      if (b.assessments_page1 && Array.isArray(b.assessments_page1.items)) {
        storeSet('assessments:list:p1:default', b.assessments_page1.items, b.assessments_page1.meta);
      }
      if (b.rme_page1 && Array.isArray(b.rme_page1.items)) {
        storeSet('rme:list:p1:default', b.rme_page1.items, b.rme_page1.meta);
      }
      if (b.client_packages_page1 && Array.isArray(b.client_packages_page1.items)) {
        storeSet('packages:cpk:p1:default', b.client_packages_page1.items, b.client_packages_page1.meta);
      }
      if (b.packages_page1 && Array.isArray(b.packages_page1.items)) {
        storeSet('packages:master:p1:default', b.packages_page1.items, b.packages_page1.meta);
      }
      if (b.payments_page1 && Array.isArray(b.payments_page1.items)) {
        storeSet(
          'payments:list:p1:default',
          { items: b.payments_page1.items, summary: b.payments_page1.summary },
          b.payments_page1.meta
        );
      }
      if (b.commissions_page1 && Array.isArray(b.commissions_page1.items)) {
        storeSet(
          'commissions:list:p1:default',
          { items: b.commissions_page1.items, summary: b.commissions_page1.summary },
          b.commissions_page1.meta
        );
      }
      lastPrefetchAt = Date.now();
    })
    .catch(() => {
      // Prefetch latar belakang bersifat non-blocking
    })
    .finally(() => {
      prefetchInFlight = null;
    });

  return prefetchInFlight;
}

/**
 * Prefetch diam-diam saat kursor mengarah (hover/focus) ke menu sekunder di sidebar
 * (Pengguna, Laporan, Audit Log, atau modul inti jika belum terisi di RAM).
 */
export function prefetchRouteIntent(routeId) {
  if (!routeId) return;
  const silentOpts = { background: true };

  if (routeId === 'dashboard' && !storeIsFresh('dashboard:summary', 30000)) {
    apiCall('dashboard.summary', { upcoming_limit: 15 }, silentOpts)
      .then((res) => res && res.data && storeSet('dashboard:summary', res.data))
      .catch(() => {});
    return;
  }
  if (routeId === 'users' && !storeIsFresh('users:list:p1:default', 30000)) {
    apiCall('users.list', { page: 1, limit: 10, sort: { field: 'created_at', dir: 'desc' } }, silentOpts)
      .then((res) => res && res.data && storeSet('users:list:p1:default', { items: res.data.items || [], role_defaults: res.data.role_defaults }, res.meta))
      .catch(() => {});
    return;
  }
  if (routeId === 'audit' && !storeIsFresh('audit:list:p1:default', 20000)) {
    apiCall('audit.list', { page: 1, limit: 10, sort: { field: 'timestamp', dir: 'desc' } }, silentOpts)
      .then((res) => res && res.data && storeSet('audit:list:p1:default', res.data.items || [], res.meta))
      .catch(() => {});
    return;
  }
  if (routeId === 'reports') {
    const now = new Date();
    const wib = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
    const monthStart = today.slice(0, 8) + '01';
    const rKey = `reports:summary:${monthStart}:${today}:`;
    if (!storeIsFresh(rKey, 30000)) {
      apiCall('reports.summary', { date_from: monthStart, date_to: today }, silentOpts)
        .then((res) => res && res.data && storeSet(rKey, res.data))
        .catch(() => {});
    }
    return;
  }
  if (routeId === 'clients' || routeId === 'appointments' || routeId === 'assessments' ||
      routeId === 'rme' || routeId === 'packages' || routeId === 'payments' ||
      routeId === 'commissions' || routeId === 'therapists') {
    if (!storeIsFresh(`${routeId === 'packages' ? 'packages:cpk' : routeId + ':list'}:p1:default`, 40000)) {
      prefetchCoreModules(false);
    }
  }
}

/**
 * Prefetch diam-diam halaman berikutnya (page + 1) saat pagination memiliki halaman lanjutan,
 * sehingga klik "Berikutnya →" atau nomor halaman terasa instan (<50ms).
 */
export function prefetchNextPage(nextKey, action, payload, extractDataFn = null) {
  if (!nextKey || storeIsFresh(nextKey, 25000)) return;
  apiCall(action, payload, { background: true })
    .then((res) => {
      if (!res || !res.data) return;
      const val = typeof extractDataFn === 'function' ? extractDataFn(res.data) : (res.data.items || []);
      storeSet(nextKey, val, res.meta);
    })
    .catch(() => {});
}
