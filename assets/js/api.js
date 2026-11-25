/**
 * api.js — Klien HTTP CORS-safe ke Google Apps Script Web App.
 * Seluruh aksi terproteksi dikirim via POST (Content-Type: text/plain;charset=utf-8)
 * dengan token di JSON body (tidak pernah di URL query string).
 */

import { APP_FRONTEND_CONFIG, isGasUrlConfigured } from './config.js';

let authHooks = {
  getToken: () => '',
  onUnauthenticated: () => {},
  onMustChangePassword: () => {}
};

export function registerApiAuthHooks(hooks) {
  authHooks = Object.assign({}, authHooks, hooks || {});
}

export function generateRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message || 'Terjadi kesalahan pada server.');
    this.name = 'ApiError';
    this.code = code || 'INTERNAL';
    this.fields = extra.fields || null;
    this.conflict = extra.conflict || null;
    this.corrId = extra.corr_id || '';
  }
}

export async function apiHealth() {
  if (!isGasUrlConfigured()) {
    return {
      ok: false,
      unconfigured: true,
      data: { app: 'ICH HYPNOTHERAPY', public_settings: { clinic_name: 'ICH HYPNOTHERAPY', idle_logout_min: '60' } }
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APP_FRONTEND_CONFIG.REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(APP_FRONTEND_CONFIG.GAS_URL + '?action=health', {
      method: 'GET',
      signal: controller.signal
    });
    const json = await res.json();
    return json;
  } catch (err) {
    return { ok: false, error: { code: 'NETWORK', message: 'Tidak dapat terhubung ke server klinik.' } };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiCall(action, payload = {}, options = {}) {
  if (!isGasUrlConfigured()) {
    throw new ApiError(
      'UNCONFIGURED',
      'URL backend GAS belum diatur. Isi GAS_URL di frontend/assets/js/config.js.'
    );
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('OFFLINE', 'Koneksi internet terputus. Periksa jaringan Anda.');
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || APP_FRONTEND_CONFIG.REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    action,
    token: options.skipAuth ? '' : authHooks.getToken(),
    request_id: options.requestId || (options.write ? generateRequestId() : ''),
    payload: payload || {}
  };

  try {
    const response = await fetch(APP_FRONTEND_CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: controller.signal
    });

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new ApiError('BAD_RESPONSE', 'Respons server tidak valid. Pastikan Web App GAS sudah di-deploy dengan akses Anyone.');
    }

    if (!json || json.ok !== true) {
      const errObj = (json && json.error) || {};
      const apiErr = new ApiError(errObj.code || 'INTERNAL', errObj.message || 'Permintaan gagal.', errObj);

      if (apiErr.code === 'UNAUTHENTICATED' && !options.skipAuth) {
        authHooks.onUnauthenticated(apiErr);
      } else if (apiErr.code === 'MUST_CHANGE_PASSWORD') {
        authHooks.onMustChangePassword(apiErr);
      }
      throw apiErr;
    }

    return json;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err && err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Permintaan melebihi batas waktu. Coba lagi sebentar.');
    }
    throw new ApiError('NETWORK', 'Gagal terhubung ke server. Periksa koneksi internet Anda.');
  } finally {
    clearTimeout(timer);
  }
}
