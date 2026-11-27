/**
 * app.js — Bootstrap aplikasi PWA ICH HYPNOTHERAPY, registrasi Service Worker,
 * binding shell responsif, routing SPA, dan modal ganti password mandiri.
 */

import { registerApiAuthHooks, registerApiProgressHooks, apiHealth, apiCall } from './api.js';
import {
  getToken,
  getUser,
  can,
  setSession,
  clearSession,
  setSessionClearedHandler,
  setPublicSettings,
  getPublicSettings,
  isAuthenticated,
  verifySessionWithServer,
  performLogout,
  initIdleActivityWatcher,
  roleLabel
} from './auth.js';
import { getAllowedNavItems, parseHashRoute, navigate, getRouteGuardResult } from './router.js';
import { esc, toast, openModal, closeModal, clearFieldErrors, showFieldErrors, topProgress, setButtonLoading } from './ui.js';
import { animatePageEnter } from './motion.js';
import { storeClearAll } from './store.js';
import { renderLoginView, renderMustChangePasswordView } from './pages/login.js';
import { renderDashboardPage } from './pages/dashboard.js';

const PAGE_LOADERS = {
  dashboard: {
    title: 'Dashboard Ringkasan',
    subtitle: 'KPI aktual dan jadwal sesi terdekat',
    load: async () => renderDashboardPage
  },
  users: {
    title: 'Manajemen Pengguna & Staf',
    subtitle: 'Kelola akun login, status aktif, dan tautan terapis',
    load: () => loadOptionalPage('./pages/users.js', 'renderUsersPage')
  },
  therapists: {
    title: 'Data Terapis',
    subtitle: 'Master profil, area, spesialisasi, dan layanan terapis',
    load: () => loadOptionalPage('./pages/therapists.js', 'renderTherapistsPage')
  },
  clients: {
    title: 'Data Klien',
    subtitle: 'Data induk klien, sumber informasi, dan riwayat sesi',
    load: () => loadOptionalPage('./pages/clients.js', 'renderClientsPage')
  },
  assessments: {
    title: 'Assessment Awal & Anamnesis',
    subtitle: 'Pencatatan anamnesis awal dan riwayat assessment klien',
    load: () => loadOptionalPage('./pages/assessments.js', 'renderAssessmentsPage')
  },
  appointments: {
    title: 'Jadwal / Appointment',
    subtitle: 'Penjadwalan sesi Online/Offline dan pengingat WhatsApp',
    load: () => loadOptionalPage('./pages/appointments.js', 'renderAppointmentsPage')
  },
  rme: {
    title: 'RME / Sesi Terapi',
    subtitle: 'Rekam medis sesi terapi dengan Context Reference otomatis',
    load: () => loadOptionalPage('./pages/rme.js', 'renderRmePage')
  },
  packages: {
    title: 'Paket Terapi & Kuota Sesi',
    subtitle: 'Kelola master paket terapi, paket aktif klien, sisa sesi, dan masa berlaku',
    load: () => loadOptionalPage('./pages/packages.js', 'renderPackagesPage')
  },
  payments: {
    title: 'Pembayaran & Kas',
    subtitle: 'Pencatatan pemasukan sesi/paket, pengeluaran operasional, dan saldo kas',
    load: () => loadOptionalPage('./pages/payments.js', 'renderPaymentsPage')
  },
  commissions: {
    title: 'Komisi / Bagi Hasil Terapis',
    subtitle: 'Perhitungan otomatis bagi hasil terapis dan status pencairan komisi',
    load: () => loadOptionalPage('./pages/commissions.js', 'renderCommissionsPage')
  },
  reports: {
    title: 'Laporan Operasional & Keuangan',
    subtitle: 'Rekapitulasi periode klinik, kinerja terapis, cetak PDF, dan unduh CSV',
    load: () => loadOptionalPage('./pages/reports.js', 'renderReportsPage')
  },
  audit: {
    title: 'Audit Log',
    subtitle: 'Rekam jejak otomatis seluruh aktivitas sistem',
    load: () => loadOptionalPage('./pages/auditLogs.js', 'renderAuditLogsPage')
  },
  settings: {
    title: 'Pengaturan Klinik',
    subtitle: 'Identitas klinik, template WhatsApp, dan durasi sesi default',
    load: () => loadOptionalPage('./pages/settings.js', 'renderSettingsPage')
  }
};

const APP_ASSET_VERSION = '2.3.2';

async function loadOptionalPage(modulePath, exportName) {
  try {
    const versionedPath = `${modulePath}?v=${APP_ASSET_VERSION}`;
    const mod = await import(versionedPath);
    if (typeof mod[exportName] === 'function') {
      try { sessionStorage.removeItem('ich_mod_reload_guard'); } catch (_) {}
      return mod[exportName];
    }
    throw new Error(`Export "${exportName}" tidak ditemukan di ${modulePath}`);
  } catch (err) {
    console.error('[ICH] Gagal memuat modul halaman:', modulePath, err);
    // Pemulihan otomatis 1x bila terjadi ketidakcocokan versi cache saat pembaruan aplikasi
    try {
      const guardKey = 'ich_mod_reload_guard';
      if (sessionStorage.getItem(guardKey) !== APP_ASSET_VERSION) {
        sessionStorage.setItem(guardKey, APP_ASSET_VERSION);
        window.location.reload();
        return () => {};
      }
    } catch (_) {}

    return (container) => {
      container.innerHTML = `
        <div class="card empty-state">
          <p class="empty-state-title">Gagal Memuat Halaman</p>
          <p class="empty-state-desc">Terdeteksi pembaruan versi aplikasi atau koneksi terputus sementara. Silakan muat ulang halaman agar seluruh modul sinkron.</p>
          <div class="flex-gap" style="justify-content:center;">
            <button type="button" class="btn btn-primary" onclick="window.location.reload()">Muat Ulang Aplikasi</button>
            <button type="button" class="btn btn-soft" onclick="window.location.hash='#/dashboard'">Kembali ke Dashboard</button>
          </div>
        </div>
      `;
    };
  }
}

// ============================================================================
// Shell Rendering & Drawer
// ============================================================================

function toggleDrawer(open) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!sidebar || !backdrop) return;
  sidebar.classList.toggle('is-open', Boolean(open));
  backdrop.hidden = !open;
}

function renderNavigation(activeRouteName) {
  const allowed = getAllowedNavItems();
  const sidebarNav = document.getElementById('sidebar-nav');
  const bottomNav = document.getElementById('bottom-nav');

  // Group sidebar links
  const groups = {};
  allowed.forEach((item) => {
    groups[item.group] = groups[item.group] || [];
    groups[item.group].push(item);
  });

  sidebarNav.innerHTML = Object.entries(groups).map(([groupName, items]) => `
    <div class="nav-group-label">${esc(groupName)}</div>
    ${items.map((item) => `
      <a class="nav-link ${item.id === activeRouteName ? 'is-active' : ''}" href="${esc(item.path)}">
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${esc(item.label)}</span>
      </a>
    `).join('')}
  `).join('');

  sidebarNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => toggleDrawer(false));
  });

  // Bottom navigation (maksimal 4 item utama + tombol Menu)
  const bottomItems = allowed.filter((i) => i.bottom).slice(0, 4);
  bottomNav.innerHTML = bottomItems.map((item) => `
    <a class="bottom-nav-item ${item.id === activeRouteName ? 'is-active' : ''}" href="${esc(item.path)}">
      <span class="bottom-nav-icon" aria-hidden="true">${item.icon}</span>
      <span>${esc(item.label.split(' ')[0])}</span>
    </a>
  `).join('') + `
    <button type="button" class="bottom-nav-item" id="btn-bottom-more">
      <span class="bottom-nav-icon" aria-hidden="true">☰</span>
      <span>Menu</span>
    </button>
  `;

  const moreBtn = bottomNav.querySelector('#btn-bottom-more');
  if (moreBtn) moreBtn.addEventListener('click', () => toggleDrawer(true));
}

function syncUserShellMeta() {
  const user = getUser();
  const clinicName = getPublicSettings().clinic_name || 'ICH HYPNOTHERAPY';
  document.title = `${clinicName} — Sistem Klinik Internal`;

  const brandEl = document.getElementById('sidebar-clinic-name');
  const avatarEl = document.getElementById('sidebar-user-avatar');
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const topBadge = document.getElementById('topbar-role-badge');
  const topCta = document.getElementById('btn-topbar-cta');

  if (brandEl) brandEl.textContent = clinicName;
  if (user) {
    if (avatarEl) avatarEl.textContent = (user.full_name || user.username || 'U').slice(0, 1).toUpperCase();
    if (nameEl) nameEl.textContent = user.full_name || user.username;
    if (roleEl) roleEl.textContent = roleLabel(user.role);
    if (topBadge) topBadge.textContent = roleLabel(user.role);
    if (topCta) topCta.hidden = !can('clients:add');
  }
}

function openChangePasswordModal() {
  const modal = openModal({
    title: 'Ganti Password Akun',
    bodyHtml: `
      <form id="self-change-pw-form" novalidate>
        <div class="field">
          <label for="self-cur-pw">Password Saat Ini <span class="req-star">*</span></label>
          <input id="self-cur-pw" name="current_password" type="password" class="input" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="self-new-pw">Password Baru <span class="req-star">*</span></label>
          <input id="self-new-pw" name="new_password" type="password" class="input" autocomplete="new-password" required>
          <span class="field-hint">Minimal 8 karakter, wajib mengandung huruf dan angka.</span>
        </div>
        <div class="field">
          <label for="self-confirm-pw">Konfirmasi Password Baru <span class="req-star">*</span></label>
          <input id="self-confirm-pw" name="confirm_password" type="password" class="input" autocomplete="new-password" required>
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
      <button type="submit" form="self-change-pw-form" class="btn btn-primary" id="btn-save-self-pw">Simpan Password</button>
    `
  });

  const form = modal.querySelector('#self-change-pw-form');
  const btn = modal.querySelector('#btn-save-self-pw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const cur = form.current_password.value;
    const next = form.new_password.value;
    const conf = form.confirm_password.value;
    if (next !== conf) {
      showFieldErrors(form, { confirm_password: 'Konfirmasi password tidak cocok.' });
      return;
    }
    setButtonLoading(btn, true, 'Menyimpan...');
    try {
      const res = await apiCall('auth.changePassword', { current_password: cur, new_password: next }, { write: true });
      setSession(res.data.token, res.data.user, res.data.permissions);
      closeModal();
      toast('Password berhasil diperbarui. Sesi di perangkat lain dicabut.', 'success');
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      toast(err.message, 'danger');
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

// ============================================================================
// Route Execution
// ============================================================================

async function renderCurrentRoute(forceRefresh = false) {
  const authRoot = document.getElementById('auth-root');
  const appShell = document.getElementById('app-shell');
  const mainContent = document.getElementById('main-content');

  const route = parseHashRoute();
  route.forceRefresh = Boolean(forceRefresh);
  const guard = getRouteGuardResult(route);

  if (guard.mustChangePassword) {
    appShell.hidden = true;
    authRoot.hidden = false;
    renderMustChangePasswordView(authRoot, {
      onComplete: () => navigate('#/dashboard')
    });
    return;
  }

  if (!guard.allow && guard.redirect) {
    if (guard.redirect === '#/login') {
      appShell.hidden = true;
      authRoot.hidden = false;
      renderLoginView(authRoot, {
        onLoginSuccess: (user) => {
          if (user && user.must_change_password) {
            renderCurrentRoute();
          } else {
            navigate('#/dashboard');
          }
        }
      });
      return;
    }
    navigate(guard.redirect);
    return;
  }

  if (route.name === 'login') {
    appShell.hidden = true;
    authRoot.hidden = false;
    renderLoginView(authRoot, {
      onLoginSuccess: (user) => {
        if (user && user.must_change_password) {
          renderCurrentRoute();
        } else {
          navigate('#/dashboard');
        }
      }
    });
    return;
  }

  authRoot.hidden = true;
  appShell.hidden = false;
  syncUserShellMeta();
  renderNavigation(route.name);

  if (guard.forbidden) {
    document.getElementById('page-title').textContent = 'Akses Ditolak';
    document.getElementById('page-subtitle').textContent = 'Anda tidak memiliki izin untuk membuka modul ini.';
    mainContent.innerHTML = `
      <div class="card empty-state">
        <p class="empty-state-title">Akses Ditolak (403)</p>
        <p class="empty-state-desc">Role akun Anda tidak diizinkan mengakses halaman ini.</p>
        <button type="button" class="btn btn-primary" onclick="window.location.hash='#/dashboard'">Kembali ke Dashboard</button>
      </div>
    `;
    return;
  }

  const def = PAGE_LOADERS[route.name] || PAGE_LOADERS.dashboard;
  document.getElementById('page-title').textContent = def.title;
  document.getElementById('page-subtitle').textContent = def.subtitle;

  const renderFn = await def.load();
  animatePageEnter(mainContent);
  await renderFn(mainContent, route);
}

// ============================================================================
// PWA Service Worker, Install Prompt & Connectivity Watchers
// ============================================================================

function initPwaSupport() {
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || swRefreshing) return;
      swRefreshing = true;
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch(() => {
          // Abaikan jika dijalankan di protokol non-HTTPS/non-localhost
        });
    });
  }

  let deferredPrompt = null;
  const installBtn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        installBtn.hidden = true;
      }
      deferredPrompt = null;
    });
  }

  const offlineBanner = document.getElementById('offline-banner');
  const syncOnline = () => {
    if (offlineBanner) offlineBanner.hidden = navigator.onLine !== false;
  };
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();
}

// ============================================================================
// App Initialization
// ============================================================================

async function bootstrap() {
  registerApiProgressHooks({
    onStart: () => topProgress.start(),
    onDone: () => topProgress.done()
  });

  registerApiAuthHooks({
    getToken,
    onUnauthenticated: (err) => {
      clearSession('EXPIRED');
      toast(err.message || 'Sesi berakhir. Silakan login kembali.', 'warning');
    },
    onMustChangePassword: () => {
      renderCurrentRoute();
    }
  });

  setSessionClearedHandler((reason) => {
    storeClearAll();
    if (reason === 'IDLE_TIMEOUT') {
      toast('Sesi berakhir otomatis karena tidak ada aktivitas.', 'warning');
    } else if (reason === 'LOGOUT') {
      toast('Anda telah keluar dari aplikasi.', 'info');
    }
    if (window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    } else {
      renderCurrentRoute();
    }
  });

  document.getElementById('btn-open-drawer')?.addEventListener('click', () => toggleDrawer(true));
  document.getElementById('btn-close-drawer')?.addEventListener('click', () => toggleDrawer(false));
  document.getElementById('drawer-backdrop')?.addEventListener('click', () => toggleDrawer(false));
  document.getElementById('btn-logout')?.addEventListener('click', () => performLogout());
  document.getElementById('btn-change-password')?.addEventListener('click', () => openChangePasswordModal());
  document.getElementById('btn-refresh-page')?.addEventListener('click', () => renderCurrentRoute(true));
  document.getElementById('btn-topbar-cta')?.addEventListener('click', () => navigate('#/clients?new=1'));
  document.getElementById('topbar-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('topbar-search-input');
    const q = input ? input.value.trim() : '';
    navigate(q ? `#/clients?q=${encodeURIComponent(q)}` : '#/clients');
  });

  window.addEventListener('hashchange', () => renderCurrentRoute());
  initIdleActivityWatcher();
  initPwaSupport();

  // Render rute awal segera agar halaman login tampil instan tanpa menunggu cold-start GAS
  if (isAuthenticated()) {
    await verifySessionWithServer();
  }

  if (!window.location.hash) {
    window.location.hash = isAuthenticated() ? '#/dashboard' : '#/login';
  } else {
    renderCurrentRoute();
  }

  // Muat pengaturan publik non-sensitif (nama klinik, durasi idle) di latar belakang
  apiHealth().then((health) => {
    if (health && health.ok && health.data && health.data.public_settings) {
      setPublicSettings(health.data.public_settings);
      const clinicName = health.data.public_settings.clinic_name;
      if (clinicName) {
        document.title = `${clinicName} — Sistem Klinik Internal`;
        const brandEl = document.getElementById('sidebar-clinic-name');
        if (brandEl) brandEl.textContent = clinicName;
        const authTitle = document.querySelector('#auth-root .auth-title');
        if (authTitle && window.location.hash === '#/login') authTitle.textContent = clinicName;
      }
    }
  }).catch(() => {});
}

bootstrap();
