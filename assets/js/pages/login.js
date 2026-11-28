/**
 * pages/login.js — Halaman Login (Username + Password + Show/Hide)
 * dan tampilan Wajib Ganti Password untuk akun baru / reset.
 */

import { apiCall } from '../api.js';
import { isGasUrlConfigured } from '../config.js';
import { setSession, getPublicSettings, getUser, performLogout } from '../auth.js';
import { esc, clearFieldErrors, showFieldErrors, toast, authLoader, setButtonLoading } from '../ui.js';
import { storeSet, prefetchCoreModules } from '../store.js';
import { animatePageEnter } from '../motion.js';

export function renderLoginView(container, { onLoginSuccess }) {
  const pub = getPublicSettings() || {};
  const clinicName = pub.clinic_name || 'ICH HYPNOTHERAPY';
  const clinicAddress = pub.clinic_address || '';
  const clinicPhone = pub.clinic_phone || '';
  const needsConfig = !isGasUrlConfigured();

  container.innerHTML = `
    <div class="auth-split-card">
      <section class="auth-info-panel" aria-label="Informasi Klinik dan Sistem">
        <div class="auth-info-top">
          <div class="auth-info-badge">Portal Internal Staf Klinik</div>
          <div class="auth-info-brand">
            <div class="auth-logo auth-logo-light" aria-hidden="true">ICH</div>
            <div>
              <h1 class="auth-title auth-info-title">${esc(clinicName)}</h1>
              <p class="auth-info-sub">Sistem Manajemen Klinik &amp; Rekam Medis Terpadu</p>
            </div>
          </div>
          <p class="auth-info-lead">
            Kelola seluruh operasional klinik hipnoterapi—mulai dari pendaftaran klien, kalender kegiatan &amp; penjadwalan sesi, assessment, RME, hingga keuangan—dalam satu portal yang cepat dan aman.
          </p>
        </div>

        <ul class="auth-info-list">
          <li class="auth-info-item">
            <span class="auth-info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>
            </span>
            <div>
              <strong>Data Klien &amp; Riwayat Terpadu</strong>
              <span>ID klien permanen anti-duplikat WhatsApp dengan histori sesi lengkap.</span>
            </div>
          </li>
          <li class="auth-info-item">
            <span class="auth-info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2"/></svg>
            </span>
            <div>
              <strong>Kalender Kegiatan &amp; Penjadwalan</strong>
              <span>Pantau jadwal sesi terapi harian dan agenda klinik dalam satu kalender.</span>
            </div>
          </li>
          <li class="auth-info-item">
            <span class="auth-info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            </span>
            <div>
              <strong>Assessment &amp; RME Klinis Privat</strong>
              <span>Context Reference otomatis per klien dengan isolasi hak akses peran.</span>
            </div>
          </li>
          <li class="auth-info-item">
            <span class="auth-info-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>
            </span>
            <div>
              <strong>Paket, Kas, Komisi &amp; Laporan</strong>
              <span>Kontrol kuota paket klien, bagi hasil terapis, dan cetak laporan PDF/CSV.</span>
            </div>
          </li>
        </ul>

        <div class="auth-info-footer">
          <div class="auth-info-sec-pill">🔒 Akses Terproteksi • Sesi Otomatis Keluar Saat Tidak Aktif</div>
          ${(clinicAddress || clinicPhone) ? `
            <div class="auth-info-contact">
              ${clinicAddress ? `<span>📍 ${esc(clinicAddress)}</span>` : ''}
              ${clinicPhone ? `<span>📞 ${esc(clinicPhone)}</span>` : ''}
            </div>
          ` : ''}
        </div>
      </section>

      <section class="auth-form-panel" aria-label="Form Masuk Staf">
        <div class="auth-form-head">
          <span class="auth-form-eyebrow">Masuk Staf Internal</span>
          <h2 class="auth-form-title">Selamat Datang Kembali</h2>
          <p class="auth-subtitle">Silakan masukkan username dan password akun Anda untuk melanjutkan.</p>
        </div>

        ${needsConfig ? `
          <div class="auth-notice" role="alert">
            <strong>Konfigurasi Backend Belum Diisi:</strong>
            Buka <code>frontend/assets/js/config.js</code> dan ganti <code>GAS_URL</code> dengan URL Web App GAS (<code>/exec</code>) Anda.
          </div>
        ` : ''}

        <form id="login-form" novalidate>
          <div class="field">
            <label for="login-username">Username <span class="req-star">*</span></label>
            <input id="login-username" name="username" type="text" class="input"
              autocomplete="username" autocapitalize="none" spellcheck="false"
              placeholder="Masukkan username staf" required>
          </div>

          <div class="field">
            <label for="login-password">Password <span class="req-star">*</span></label>
            <div class="input-password-wrap">
              <input id="login-password" name="password" type="password" class="input"
                autocomplete="current-password" placeholder="Masukkan password" required>
              <button type="button" id="btn-toggle-login-pw" class="btn-toggle-pw"
                aria-pressed="false" aria-label="Tampilkan atau sembunyikan password">Tampil</button>
            </div>
          </div>

          <div id="login-global-error" class="form-alert-error mb-3" role="alert" hidden></div>

          <button type="submit" id="btn-login-submit" class="btn btn-primary btn-block mt-2">
            Masuk ke Aplikasi
          </button>
        </form>

        <p class="auth-footer-note">
          Butuh bantuan akses atau lupa password? Hubungi <strong>Admin / Owner</strong> klinik Anda.
        </p>
      </section>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const pwInput = container.querySelector('#login-password');
  const toggleBtn = container.querySelector('#btn-toggle-login-pw');
  const errBox = container.querySelector('#login-global-error');
  const submitBtn = container.querySelector('#btn-login-submit');

  toggleBtn.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggleBtn.textContent = show ? 'Sembunyi' : 'Tampil';
    toggleBtn.setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    errBox.hidden = true;
    errBox.textContent = '';

    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) {
      showFieldErrors(form, {
        username: !username ? 'Username wajib diisi.' : '',
        password: !password ? 'Password wajib diisi.' : ''
      });
      return;
    }

    setButtonLoading(submitBtn, true, 'Memverifikasi...');
    authLoader.show('Memverifikasi akun Anda...');
    try {
      const res = await apiCall('auth.login', { username, password }, { skipAuth: true, hideTopLoader: true });
      setSession(res.data.token, res.data.user, res.data.permissions);
      // Login Piggyback Hydration: simpan data dashboard langsung ke RAM agar tampil 0ms
      if (res.data.initial_dashboard) {
        storeSet('dashboard:summary', res.data.initial_dashboard);
      }
      if (res.data.user && !res.data.user.must_change_password) {
        setTimeout(() => prefetchCoreModules(true), 60);
      }
      toast(`Selamat datang, ${res.data.user.full_name}`, 'success');
      onLoginSuccess(res.data.user);
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      const msg = (err && err.message) || 'Gagal login. Periksa kembali username dan password Anda.';
      errBox.textContent = msg;
      errBox.hidden = false;
      toast(msg, 'danger');
    } finally {
      authLoader.hide();
      setButtonLoading(submitBtn, false);
    }
  });

  animatePageEnter(container.querySelector('.auth-split-card'));
  form.username.focus();
}

export function renderMustChangePasswordView(container, { onComplete }) {
  const user = getUser();
  container.innerHTML = `
    <div class="auth-card">
      <div class="auth-header">
        <div class="auth-logo" aria-hidden="true">🔒</div>
        <h1 class="auth-title">Wajib Ganti Password</h1>
        <p class="auth-subtitle">Halo <strong>${esc(user ? user.full_name : '')}</strong>, demi keamanan silakan buat password baru Anda.</p>
      </div>

      <form id="must-change-pw-form" novalidate>
        <div class="field">
          <label for="cur-pw">Password Sementara Saat Ini <span class="req-star">*</span></label>
          <input id="cur-pw" name="current_password" type="password" class="input" autocomplete="current-password" required>
        </div>

        <div class="field">
          <label for="new-pw">Password Baru <span class="req-star">*</span></label>
          <input id="new-pw" name="new_password" type="password" class="input" autocomplete="new-password" required>
          <span class="field-hint">Minimal 8 karakter, wajib mengandung huruf dan angka.</span>
        </div>

        <div class="field">
          <label for="confirm-pw">Ulangi Password Baru <span class="req-star">*</span></label>
          <input id="confirm-pw" name="confirm_password" type="password" class="input" autocomplete="new-password" required>
        </div>

        <div id="mcp-error" class="form-alert-error mb-3" role="alert" hidden></div>

        <button type="submit" id="btn-mcp-submit" class="btn btn-primary btn-block mt-2">
          Simpan Password Baru &amp; Masuk
        </button>
        <button type="button" id="btn-mcp-logout" class="btn btn-ghost btn-block mt-2">
          Keluar
        </button>
      </form>
    </div>
  `;

  const form = container.querySelector('#must-change-pw-form');
  const errBox = container.querySelector('#mcp-error');
  const submitBtn = container.querySelector('#btn-mcp-submit');

  container.querySelector('#btn-mcp-logout').addEventListener('click', () => {
    performLogout();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    errBox.hidden = true;

    const currentPassword = form.current_password.value;
    const newPassword = form.new_password.value;
    const confirmPassword = form.confirm_password.value;

    if (newPassword !== confirmPassword) {
      showFieldErrors(form, { confirm_password: 'Konfirmasi password tidak sama.' });
      return;
    }

    setButtonLoading(submitBtn, true, 'Menyimpan password...');
    try {
      const res = await apiCall('auth.changePassword', {
        current_password: currentPassword,
        new_password: newPassword
      }, { write: true });
      setSession(res.data.token, res.data.user, res.data.permissions);
      toast('Password berhasil diperbarui.', 'success');
      onComplete();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      const msg = (err && err.message) || 'Gagal menyimpan password baru.';
      errBox.textContent = msg;
      errBox.hidden = false;
      toast(msg, 'danger');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });

  animatePageEnter(container.querySelector('.auth-card'));
}
