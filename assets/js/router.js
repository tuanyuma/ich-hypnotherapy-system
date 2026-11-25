/**
 * router.js — Hash SPA Router & definisi menu navigasi berbasis RBAC.
 */

import { can, isAuthenticated, getUser } from './auth.js';

export const NAV_ITEMS = [
  { id: 'dashboard', path: '#/dashboard', label: 'Dashboard', icon: '⌂', group: 'Utama', perm: 'dashboard:view', bottom: true },
  { id: 'clients', path: '#/clients', label: 'Data Klien', icon: '☺', group: 'Operasional', perm: 'clients:view', bottom: true },
  { id: 'appointments', path: '#/appointments', label: 'Jadwal', icon: '◷', group: 'Operasional', perm: 'appointments:view', bottom: true },
  { id: 'assessments', path: '#/assessments', label: 'Assessment', icon: '✎', group: 'Klinis', perm: 'assessments:view', bottom: false },
  { id: 'rme', path: '#/rme', label: 'RME / Sesi', icon: '✚', group: 'Klinis', perm: 'rme:view', bottom: true },
  { id: 'therapists', path: '#/therapists', label: 'Data Terapis', icon: '✦', group: 'Master', perm: 'therapists:view', bottom: false },
  { id: 'users', path: '#/users', label: 'Pengguna & Staf', icon: '⚙', group: 'Administrasi', perm: 'users:view', bottom: false },
  { id: 'audit', path: '#/audit', label: 'Audit Log', icon: '☰', group: 'Administrasi', perm: 'audit:view', bottom: false },
  { id: 'settings', path: '#/settings', label: 'Pengaturan', icon: '◈', group: 'Administrasi', perm: 'settings:view', bottom: false }
];

export function getAllowedNavItems() {
  return NAV_ITEMS.filter((item) => can(item.perm));
}

export function parseHashRoute() {
  const raw = (window.location.hash || '#/dashboard').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((v, k) => { query[k] = v; });
  }
  return {
    name: segments[0] || 'dashboard',
    param: segments[1] || '',
    query,
    raw: '#' + (pathPart || '/dashboard')
  };
}

export function navigate(hashPath) {
  if (window.location.hash === hashPath) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hashPath;
  }
}

export function getRouteGuardResult(route) {
  if (!isAuthenticated()) {
    return route.name === 'login' ? { allow: true } : { allow: false, redirect: '#/login' };
  }
  const user = getUser();
  if (user && user.must_change_password) {
    return { allow: false, mustChangePassword: true };
  }
  if (route.name === 'login') {
    return { allow: false, redirect: '#/dashboard' };
  }

  const navItem = NAV_ITEMS.find((n) => n.id === route.name);
  if (navItem && !can(navItem.perm)) {
    return { allow: false, forbidden: true };
  }
  return { allow: true };
}
