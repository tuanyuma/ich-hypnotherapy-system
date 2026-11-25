/**
 * pages/login.js — Halaman Login (Username + Password + Show/Hide)
 * dan tampilan Wajib Ganti Password untuk akun baru / reset.
 */

import { apiCall } from '../api.js';
import { isGasUrlConfigured } from '../config.js';
import { setSession, getPublicSettings, getUser, performLogout } from '../auth.js';
import { esc, clearFieldErrors, showFieldErrors, toast } from '../ui.js';

export function renderLoginView(container, { onLoginSuccess }) {
  const clinicName = getPublicSettings().clinic_name || 'ICH HYPNOTHERAPY';
  const needsConfig = !isGasUrlConfigured();

  container.innerHTML = `
    <div class="auth-card">
      <div class="auth-header">
        <div class="auth-logo" aria-hidden="true">ICH</div>
        <h1 class="auth-title">${esc(clinicName)}</h1>
        <p class="auth-subtitle">Portal Internal Staf Klinik</p>
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

        <div id="login-global-error" class="field-error mb-3" role="alert" hidden></div>

        <button type="submit" id="btn-login-submit" class="btn btn-primary btn-block mt-2">
          Masuk ke Aplikasi
        </button>
      </form>

      <p class="auth-footer-note">
        Akses terbatas untuk staf internal. Sesi berakhir otomatis saat tab ditutup atau tidak aktif.
      </p>
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

    submitBtn.disabled = true;
    submitBtn.textContent = 'Memverifikasi...';
    try {
      const res = await apiCall('auth.login', { username, password }, { skipAuth: true });
      setSession(res.data.token, res.data.user, res.data.permissions);
      toast(`Selamat datang, ${res.data.user.full_name}`, 'success');
      onLoginSuccess(res.data.user);
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      errBox.textContent = err.message || 'Gagal login.';
      errBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Masuk ke Aplikasi';
    }
  });

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

        <div id="mcp-error" class="field-error mb-3" role="alert" hidden></div>

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

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';
    try {
      const res = await apiCall('auth.changePassword', {
        current_password: currentPassword,
        new_password: newPassword
      });
      setSession(res.data.token, res.data.user, res.data.permissions);
      toast('Password berhasil diperbarui.', 'success');
      onComplete();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Simpan Password Baru & Masuk';
    }
  });
}
