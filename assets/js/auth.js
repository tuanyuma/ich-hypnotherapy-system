/**
 * auth.js — Manajemen sesi frontend (sessionStorage only demi privasi perangkat bersama),
 * helper cek permission UI, dan auto-logout idle.
 */

import { apiCall } from './api.js';
import { storeClearAll } from './store.js';
import { authLoader } from './ui.js';

const STORAGE_KEY = 'ich_hypno_session_v1';

let state = {
  token: '',
  user: null,
  permissions: [],
  publicSettings: {
    clinic_name: 'ICH HYPNOTHERAPY',
    idle_logout_min: '60'
  }
};

let idleTimerId = null;
let onSessionClearedCb = () => {};

function loadFromSessionStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.user) {
      state.token = String(parsed.token);
      state.user = parsed.user;
      state.permissions = Array.isArray(parsed.permissions) ? parsed.permissions : [];
    }
  } catch (_) {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

function persistSession() {
  try {
    if (state.token && state.user) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: state.token,
        user: state.user,
        permissions: state.permissions
      }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (_) {
    // Abaikan jika sessionStorage dibatasi browser
  }
}

loadFromSessionStorage();

export function setSessionClearedHandler(fn) {
  onSessionClearedCb = typeof fn === 'function' ? fn : () => {};
}

export function setPublicSettings(settings) {
  if (settings && typeof settings === 'object') {
    state.publicSettings = Object.assign({}, state.publicSettings, settings);
  }
}

export function getPublicSettings() {
  return state.publicSettings;
}

export function setSession(token, user, permissions) {
  state.token = String(token || '');
  state.user = user || null;
  state.permissions = Array.isArray(permissions) ? permissions : [];
  persistSession();
  resetIdleTimer();
}

export function clearSession(reason) {
  state.token = '';
  state.user = null;
  state.permissions = [];
  persistSession();
  storeClearAll();
  stopIdleTimer();
  onSessionClearedCb(reason || '');
}

export function getToken() {
  return state.token;
}

export function getUser() {
  return state.user;
}

export function getPermissions() {
  return state.permissions;
}

export function isAuthenticated() {
  return Boolean(state.token && state.user);
}

export function can(perm) {
  if (!perm) return true;
  return state.permissions.indexOf(perm) !== -1;
}

export function roleLabel(role) {
  const map = {
    OWNER: 'Pemilik (Owner)',
    ADMIN: 'Admin',
    THERAPIST: 'Terapis',
    CUSTOMER_SERVICE: 'Customer Service'
  };
  return map[role] || role || '-';
}

export async function verifySessionWithServer() {
  if (!state.token) return false;
  try {
    const res = await apiCall('auth.me', {});
    setSession(state.token, res.data.user, res.data.permissions);
    return true;
  } catch (err) {
    if (err.code === 'MUST_CHANGE_PASSWORD') {
      return true;
    }
    clearSession();
    return false;
  }
}

export async function performLogout() {
  const hasToken = Boolean(state.token);
  authLoader.show('Mengakhiri sesi dengan aman...');
  try {
    if (hasToken) {
      await apiCall('auth.logout', {}, { hideTopLoader: true });
    }
  } catch (_) {
    // Tetap bersihkan sesi lokal walau jaringan gagal
  } finally {
    authLoader.hide();
    clearSession('LOGOUT');
  }
}

// ============================================================================
// Auto-Logout Idle (default 60 menit sesuai PRD §5)
// ============================================================================

export function stopIdleTimer() {
  if (idleTimerId) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
}

export function resetIdleTimer() {
  stopIdleTimer();
  if (!isAuthenticated()) return;
  const mins = Math.max(parseInt(state.publicSettings.idle_logout_min || '60', 10) || 60, 5);
  idleTimerId = setTimeout(() => {
    if (isAuthenticated()) {
      performLogout().then(() => {
        onSessionClearedCb('IDLE_TIMEOUT');
      });
    }
  }, mins * 60 * 1000);
}

export function initIdleActivityWatcher() {
  const events = ['click', 'keydown', 'touchstart', 'scroll'];
  let throttle = 0;
  const onActivity = () => {
    const now = Date.now();
    if (now - throttle < 15000) return;
    throttle = now;
    if (isAuthenticated()) {
      resetIdleTimer();
    }
  };
  events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
}
