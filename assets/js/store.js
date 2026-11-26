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
 * Prefetch diam-diam 1 round-trip setelah login/dashboard agar pindah menu instan (<50ms).
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
      if (b.clients_page1 && Array.isArray(b.clients_page1.items)) {
        storeSet('clients:list:p1:default', b.clients_page1.items, b.clients_page1.meta);
      }
      if (b.appointments_page1 && Array.isArray(b.appointments_page1.items)) {
        storeSet('appointments:list:p1:default', b.appointments_page1.items, b.appointments_page1.meta);
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
