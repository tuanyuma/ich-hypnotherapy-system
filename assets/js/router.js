/**
 * router.js — Hash SPA Router & definisi menu navigasi dengan ikon SVG garis bersih.
 */

import { can, isAuthenticated, getUser } from './auth.js';

const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  clients: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  appointments: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  assessments: '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>',
  rme: '<svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 7v6M9 10h6"/></svg>',
  packages: '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>',
  payments: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
  commissions: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9.5a3.5 3.5 0 0 0-3-1.5c-1.9 0-3 .9-3 2.2 0 2.6 6 1.8 6 4.6 0 1.3-1.2 2.2-3 2.2a3.8 3.8 0 0 1-3.2-1.5M12 6v12"/></svg>',
  reports: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>',
  therapists: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="M19 8h3m-1.5-1.5v3"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  audit: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};

export const NAV_ITEMS = [
  { id: 'dashboard', path: '#/dashboard', label: 'Dashboard', icon: ICONS.dashboard, group: 'Utama', perm: 'dashboard:view', bottom: true },
  { id: 'clients', path: '#/clients', label: 'Data Klien', icon: ICONS.clients, group: 'Operasional', perm: 'clients:view', bottom: true },
  { id: 'appointments', path: '#/appointments', label: 'Jadwal', icon: ICONS.appointments, group: 'Operasional', perm: 'appointments:view', bottom: true },
  { id: 'packages', path: '#/packages', label: 'Paket Terapi', icon: ICONS.packages, group: 'Operasional', perm: 'packages:view', bottom: false },
  { id: 'assessments', path: '#/assessments', label: 'Assessment', icon: ICONS.assessments, group: 'Klinis', perm: 'assessments:view', bottom: false },
  { id: 'rme', path: '#/rme', label: 'RME / Sesi', icon: ICONS.rme, group: 'Klinis', perm: 'rme:view', bottom: true },
  { id: 'payments', path: '#/payments', label: 'Pembayaran & Kas', icon: ICONS.payments, group: 'Keuangan', perm: 'payments:view', bottom: false },
  { id: 'commissions', path: '#/commissions', label: 'Komisi / Bagi Hasil', icon: ICONS.commissions, group: 'Keuangan', perm: 'commissions:view', bottom: false },
  { id: 'reports', path: '#/reports', label: 'Laporan', icon: ICONS.reports, group: 'Keuangan', perm: 'reports:view', bottom: false },
  { id: 'therapists', path: '#/therapists', label: 'Data Terapis', icon: ICONS.therapists, group: 'Master', perm: 'therapists:view', bottom: false },
  { id: 'users', path: '#/users', label: 'Pengguna & Staf', icon: ICONS.users, group: 'Administrasi', perm: 'users:view', bottom: false },
  { id: 'audit', path: '#/audit', label: 'Audit Log', icon: ICONS.audit, group: 'Administrasi', perm: 'audit:view', bottom: false },
  { id: 'settings', path: '#/settings', label: 'Pengaturan', icon: ICONS.settings, group: 'Administrasi', perm: 'settings:view', bottom: false }
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
