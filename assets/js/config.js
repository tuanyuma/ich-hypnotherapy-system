/**
 * config.js — Konfigurasi publik frontend ICH HYPNOTHERAPY.
 * ATURAN R11: File ini HANYA boleh memuat URL Web App GAS (/exec).
 * DILARANG keras menyimpan rahasia, token, password, atau API key di sini.
 */

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzmWWMni6fyPYg_3YRI6WBUOWSxAwldSDd5omHvWPF04xeqQUOt5IBD-idlGDUWQsqvfw/exec';

export const APP_FRONTEND_CONFIG = Object.freeze({
  GAS_URL: (typeof window !== 'undefined' && window.__ICH_GAS_URL__) || DEFAULT_GAS_URL,
  REQUEST_TIMEOUT_MS: 25000
});

export function isGasUrlConfigured() {
  return Boolean(
    APP_FRONTEND_CONFIG.GAS_URL &&
    APP_FRONTEND_CONFIG.GAS_URL.indexOf('MASUKKAN_DEPLOYMENT_ID_GAS_ANDA') === -1 &&
    /^https?:\/\//i.test(APP_FRONTEND_CONFIG.GAS_URL)
  );
}
