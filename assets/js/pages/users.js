/**
 * pages/users.js — Manajemen Pengguna, Staf & Checklist Hak Akses per Akun:
 * - Checklist Hak Akses interaktif per modul (tersimpan nyata ke USERS.custom_permissions di Google Sheets)
 * - Pagination 10 data/halaman + default sort ID/terbaru DESC + klik header
 * - Status soft-delete, reset password sementara, & tautan 1:1 THERAPIST_ID.
 */

import { apiCall } from '../api.js';
import { can, getUser, roleLabel, verifySessionWithServer } from '../auth.js';
import {
  esc,
  statusBadge,
  formatDateTimeId,
  renderSkeletonTable,
  renderPagination,
  sortableTh,
  bindSortableHeaders,
  openModal,
  closeModal,
  confirmDialog,
  clearFieldErrors,
  showFieldErrors,
  setButtonLoading,
  toast
} from '../ui.js';
import {
  storeGet,
  storeSet,
  storeIsFresh,
  storeInvalidate,
  getTherapistsOptionsCached
} from '../store.js';

const PERMISSION_MODULES = [
  {
    title: 'Data Klien',
    items: [
      ['clients:view', 'Lihat'],
      ['clients:add', 'Tambah'],
      ['clients:edit', 'Edit'],
      ['clients:delete', 'Hapus'],
      ['clients:export', 'Ekspor']
    ]
  },
  {
    title: 'Jadwal / Appointment',
    items: [
      ['appointments:view', 'Lihat'],
      ['appointments:add', 'Tambah'],
      ['appointments:edit', 'Edit'],
      ['appointments:delete', 'Batalkan']
    ]
  },
  {
    title: 'Kalender Kegiatan',
    items: [
      ['calendar:view', 'Lihat Kalender'],
      ['calendar:add', 'Tambah Kegiatan'],
      ['calendar:edit', 'Edit Kegiatan'],
      ['calendar:delete', 'Hapus Kegiatan']
    ]
  },
  {
    title: 'Kalender Kegiatan',
    items: [
      ['calendar:view', 'Lihat'],
      ['calendar:add', 'Tambah Kegiatan'],
      ['calendar:edit', 'Edit Kegiatan'],
      ['calendar:delete', 'Hapus Kegiatan']
    ]
  },
  {
    title: 'Kalender Kegiatan',
    items: [
      ['calendar:view', 'Lihat'],
      ['calendar:add', 'Tambah'],
      ['calendar:edit', 'Edit'],
      ['calendar:delete', 'Hapus']
    ]
  },
  {
    title: 'Assessment Awal',
    items: [
      ['assessments:view', 'Lihat'],
      ['assessments:add', 'Tambah'],
      ['assessments:edit', 'Edit'],
      ['assessments:delete', 'Hapus']
    ]
  },
  {
    title: 'RME / Sesi Terapi',
    items: [
      ['rme:view', 'Lihat'],
      ['rme:add', 'Tambah'],
      ['rme:edit', 'Edit'],
      ['rme:delete', 'Hapus']
    ]
  },
  {
    title: 'Paket Terapi & Kuota',
    items: [
      ['packages:view', 'Lihat'],
      ['packages:add', 'Tambah'],
      ['packages:edit', 'Edit'],
      ['packages:delete', 'Hapus']
    ]
  },
  {
    title: 'Pembayaran & Kas',
    items: [
      ['payments:view', 'Lihat'],
      ['payments:add', 'Tambah'],
      ['payments:edit', 'Edit'],
      ['payments:delete', 'Hapus']
    ]
  },
  {
    title: 'Komisi / Bagi Hasil',
    items: [
      ['commissions:view', 'Lihat'],
      ['commissions:add', 'Tambah'],
      ['commissions:edit', 'Tandai Cair'],
      ['commissions:delete', 'Hapus']
    ]
  },
  {
    title: 'Laporan Klinik',
    items: [
      ['reports:view', 'Lihat Laporan'],
      ['reports:export', 'Cetak / CSV']
    ]
  },
  {
    title: 'Data Terapis',
    items: [
      ['therapists:view', 'Lihat'],
      ['therapists:add', 'Tambah'],
      ['therapists:edit', 'Edit'],
      ['therapists:delete', 'Hapus'],
      ['therapists:view_commission', 'Lihat Skema Komisi']
    ]
  },
  {
    title: 'Pengguna, Audit & Pengaturan',
    items: [
      ['users:view', 'Lihat User'],
      ['users:add', 'Tambah User'],
      ['users:edit', 'Edit User'],
      ['users:delete', 'Nonaktifkan User'],
      ['users:reset_password', 'Reset Sandi'],
      ['audit:view', 'Lihat Audit Log'],
      ['settings:view', 'Lihat Pengaturan'],
      ['ai:use', 'Gunakan Asisten AI']
    ]
  }
];

const FALLBACK_ROLE_DEFAULTS = {
  ADMIN: [
    'dashboard:view',
    'users:view', 'users:add', 'users:edit', 'users:delete', 'users:reset_password',
    'therapists:view', 'therapists:add', 'therapists:edit', 'therapists:delete', 'therapists:view_commission',
    'clients:view', 'clients:add', 'clients:edit', 'clients:delete', 'clients:export',
    'assessments:view', 'assessments:add', 'assessments:edit', 'assessments:delete',
    'appointments:view', 'appointments:add', 'appointments:edit', 'appointments:delete',
    'calendar:view', 'calendar:add', 'calendar:edit', 'calendar:delete',
    'rme:view', 'rme:add', 'rme:edit', 'rme:delete',
    'packages:view', 'packages:add', 'packages:edit', 'packages:delete',
    'payments:view', 'payments:add', 'payments:edit', 'payments:delete',
    'commissions:view', 'commissions:add', 'commissions:edit', 'commissions:delete',
    'reports:view', 'reports:export',
    'audit:view', 'settings:view', 'ai:use'
  ],
  THERAPIST: [
    'dashboard:view', 'therapists:view',
    'clients:view', 'clients:add', 'clients:edit',
    'assessments:view', 'assessments:add', 'assessments:edit', 'assessments:delete',
    'appointments:view', 'appointments:add', 'appointments:edit', 'appointments:delete',
    'calendar:view', 'calendar:add', 'calendar:edit',
    'rme:view', 'rme:add', 'rme:edit', 'rme:delete',
    'packages:view', 'commissions:view', 'ai:use'
  ],
  CUSTOMER_SERVICE: [
    'dashboard:view', 'therapists:view',
    'clients:view', 'clients:add', 'clients:edit',
    'appointments:view', 'appointments:add', 'appointments:edit', 'appointments:delete',
    'calendar:view', 'calendar:add', 'calendar:edit',
    'packages:view', 'packages:add', 'packages:edit',
    'payments:view', 'payments:add', 'payments:edit', 'ai:use'
  ]
};

export async function renderUsersPage(container, route) {
  const actor = getUser();
  const state = {
    page: 1,
    limit: 10,
    q: '',
    role: '',
    status: '',
    sort: { field: 'created_at', dir: 'desc' }
  };
  let roleDefaultsMap = FALLBACK_ROLE_DEFAULTS;
  let activeFetchId = 0;

  function buildCacheKey() {
    if (
      state.page === 1 && !state.q && !state.role && !state.status &&
      state.sort.field === 'created_at' && state.sort.dir === 'desc'
    ) {
      return 'users:list:p1:default';
    }
    return `users:list:p${state.page}:l${state.limit}:q=${state.q}:r=${state.role}:s=${state.status}:sf=${state.sort.field}:${state.sort.dir}`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Daftar Akun Staf &amp; Hak Akses</h2>
          <p class="card-desc">Kelola akun login, tautan terapis, dan checklist hak akses spesifik per pengguna.</p>
        </div>
        ${can('users:add') ? '<button type="button" class="btn btn-primary" id="btn-add-user">+ Tambah Pengguna</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="users-search" class="input" placeholder="Cari nama, username, ID, atau terapis...">
        <select id="users-filter-role" class="select" aria-label="Filter role">
          <option value="">Semua Role</option>
          <option value="OWNER">Owner</option>
          <option value="ADMIN">Admin</option>
          <option value="THERAPIST">Terapis</option>
          <option value="CUSTOMER_SERVICE">Customer Service</option>
        </select>
        <select id="users-filter-status" class="select" aria-label="Filter status">
          <option value="">Semua Status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="INACTIVE">Nonaktif</option>
          <option value="SUSPENDED">Dibekukan</option>
        </select>
      </div>

      <div id="users-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="users-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#users-list-wrap');
  const pagWrap = container.querySelector('#users-pagination');
  const searchEl = container.querySelector('#users-search');
  const roleEl = container.querySelector('#users-filter-role');
  const statusEl = container.querySelector('#users-filter-status');

  function canManageRow(target) {
    if (!actor) return false;
    if (actor.role === 'OWNER') return true;
    if (actor.role === 'ADMIN' && target.role !== 'OWNER') return true;
    return false;
  }

  async function loadUsers({ force = false, silent = false } = {}) {
    const fetchId = ++activeFetchId;
    const key = buildCacheKey();
    const cached = storeGet(key);

    const cachedItems = cached && (Array.isArray(cached.data) ? cached.data : (cached.data && cached.data.items));
    if (Array.isArray(cachedItems) && !force) {
      if (cached.data && cached.data.role_defaults) {
        roleDefaultsMap = Object.assign({}, FALLBACK_ROLE_DEFAULTS, cached.data.role_defaults);
      }
      renderTable(cachedItems);
      renderPagination(pagWrap, cached.meta, (p) => {
        state.page = p;
        loadUsers();
      });
      if (storeIsFresh(key, 30000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('users.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        sort: state.sort,
        filters: {
          role: state.role || undefined,
          status: state.status || undefined
        }
      });
      if (fetchId !== activeFetchId) return;
      if (res.data && res.data.role_defaults) {
        roleDefaultsMap = Object.assign({}, FALLBACK_ROLE_DEFAULTS, res.data.role_defaults);
      }
      const items = (res.data && res.data.items) || [];
      const { changed } = storeSet(key, items, res.meta);
      if (!cached || force || changed) {
        renderTable(items);
        renderPagination(pagWrap, res.meta, (p) => {
          state.page = p;
          loadUsers();
        });
      }
    } catch (err) {
      if (fetchId !== activeFetchId) return;
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat pengguna</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada pengguna sesuai filter</p>
          <p class="empty-state-desc">Ubah kata kunci pencarian atau tambahkan akun staf baru.</p>
        </div>
      `;
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID User', 'user_id', state.sort)}
              <th>Nama &amp; Username</th>
              <th>Role &amp; Hak Akses</th>
              <th>Terapis Tertaut</th>
              <th>Status</th>
              ${sortableTh('Login Terakhir', 'last_login_at', state.sort)}
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((u) => {
              const manageable = canManageRow(u);
              const isSelf = actor && actor.user_id === u.user_id;
              const hasCustomPerms = Array.isArray(u.custom_permissions) && u.role !== 'OWNER';
              const permCount = Array.isArray(u.effective_permissions) ? u.effective_permissions.length : 0;
              return `
                <tr data-row-id="${esc(u.user_id)}">
                  <td><span class="code-chip">${esc(u.user_id)}</span></td>
                  <td>
                    <div><strong>${esc(u.full_name)}</strong> ${isSelf ? '<span class="badge badge-primary">Anda</span>' : ''}</div>
                    <div class="text-xs text-muted font-mono">@${esc(u.username)}</div>
                  </td>
                  <td>
                    <div><span class="badge badge-neutral">${esc(roleLabel(u.role))}</span></div>
                    <div class="text-xs text-muted mt-2">
                      ${u.role === 'OWNER'
                        ? 'Akses Penuh Sistem'
                        : `${permCount} izin aktif ${hasCustomPerms ? '<span class="badge badge-info" style="margin-left:4px;">Kustom</span>' : '(Default)'}`}
                    </div>
                  </td>
                  <td>${u.therapist_id ? `<strong>${esc(u.therapist_name || u.therapist_id)}</strong>` : '<span class="text-muted">-</span>'}</td>
                  <td>
                    ${statusBadge('user', u.status)}
                    ${u.is_locked ? '<span class="badge badge-warning">Terkunci</span>' : ''}
                    ${u.must_change_password ? '<div class="text-xs text-muted mt-2">Wajib ganti sandi</div>' : ''}
                  </td>
                  <td class="text-xs">${esc(formatDateTimeId(u.last_login_at))}</td>
                  <td>
                    <div class="table-actions">
                      ${manageable && can('users:edit') ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-user="${esc(u.user_id)}">Edit &amp; Akses</button>` : ''}
                      ${manageable && can('users:reset_password') ? `<button type="button" class="btn btn-soft btn-sm" data-reset-pw="${esc(u.user_id)}">Reset Sandi</button>` : ''}
                      ${manageable && !isSelf && u.status === 'ACTIVE' && can('users:delete') ? `
                        <button type="button" class="btn btn-danger-ghost btn-sm" data-status-user="${esc(u.user_id)}" data-next-status="INACTIVE">Nonaktifkan</button>
                      ` : ''}
                      ${manageable && !isSelf && u.status !== 'ACTIVE' && can('users:edit') ? `
                        <button type="button" class="btn btn-soft btn-sm" data-status-user="${esc(u.user_id)}" data-next-status="ACTIVE">Aktifkan</button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    bindSortableHeaders(listWrap, state.sort, () => {
      state.page = 1;
      loadUsers();
    });

    const byId = Object.fromEntries(items.map((u) => [u.user_id, u]));

    listWrap.querySelectorAll('[data-edit-user]').forEach((btn) => {
      btn.addEventListener('click', () => openUserFormModal(byId[btn.dataset.editUser], btn));
    });
    listWrap.querySelectorAll('[data-reset-pw]').forEach((btn) => {
      btn.addEventListener('click', () => handleResetPassword(byId[btn.dataset.resetPw], btn));
    });
    listWrap.querySelectorAll('[data-status-user]').forEach((btn) => {
      btn.addEventListener('click', () => handleSetStatus(byId[btn.dataset.statusUser], btn.dataset.nextStatus, btn));
    });
  }

  function showTemporaryPasswordModal(username, tempPassword, heading) {
    const modal = openModal({
      title: heading,
      bodyHtml: `
        <p class="text-sm" style="margin:0 0 12px;">
          Catat atau salin password sementara di bawah ini sekarang. Password hanya ditampilkan sekali dan pengguna wajib menggantinya saat login pertama.
        </p>
        <div class="context-panel">
          <div class="text-xs text-muted">Username</div>
          <div class="font-mono" style="font-size:1rem;font-weight:700;margin-bottom:8px;">${esc(username)}</div>
          <div class="text-xs text-muted">Password Sementara</div>
          <div class="flex-between mt-2">
            <code class="font-mono" style="font-size:1.15rem;font-weight:700;color:var(--color-primary);">${esc(tempPassword)}</code>
            <button type="button" class="btn btn-soft btn-sm" id="btn-copy-temp-pw">Salin Sandi</button>
          </div>
        </div>
      `,
      footerHtml: '<button type="button" class="btn btn-primary" data-modal-close>Selesai</button>'
    });

    modal.querySelector('#btn-copy-temp-pw')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(tempPassword);
        toast('Password sementara disalin ke clipboard.', 'success');
      } catch (_) {
        toast('Salin manual password yang tampil di kotak.', 'info');
      }
    });
  }

  async function openUserFormModal(existing = null, triggerBtn = null) {
    const isEdit = Boolean(existing);
    let therapistOptions = [];
    if (triggerBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
    try {
      therapistOptions = await getTherapistsOptionsCached({
        activeOnly: true,
        unlinkedOnly: true,
        excludeUserId: existing ? existing.user_id : ''
      });
    } catch (_) {
      therapistOptions = [];
    } finally {
      if (triggerBtn) setButtonLoading(triggerBtn, false);
    }

    const canAssignOwner = actor && actor.role === 'OWNER';
    const currentRole = existing ? existing.role : 'CUSTOMER_SERVICE';
    const initialPerms = new Set(
      isEdit && Array.isArray(existing.effective_permissions)
        ? existing.effective_permissions
        : (roleDefaultsMap[currentRole] || FALLBACK_ROLE_DEFAULTS[currentRole] || [])
    );

    const modal = openModal({
      title: isEdit ? `Edit Akun & Hak Akses — ${existing.username}` : 'Tambah Pengguna Baru & Hak Akses',
      size: 'lg',
      bodyHtml: `
        <form id="user-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field">
              <label for="u-username">Username <span class="req-star">*</span></label>
              <input id="u-username" name="username" class="input" type="text" autocapitalize="none"
                value="${esc(existing ? existing.username : '')}" placeholder="mis. siti.cs" required>
              <span class="field-hint">3–30 karakter: huruf kecil, angka, titik, atau garis bawah.</span>
            </div>
            <div class="field">
              <label for="u-fullname">Nama Lengkap <span class="req-star">*</span></label>
              <input id="u-fullname" name="full_name" class="input" type="text"
                value="${esc(existing ? existing.full_name : '')}" required>
            </div>
            <div class="field">
              <label for="u-role">Role Dasar <span class="req-star">*</span></label>
              <select id="u-role" name="role" class="select">
                ${canAssignOwner ? `<option value="OWNER" ${currentRole === 'OWNER' ? 'selected' : ''}>Pemilik (Owner)</option>` : ''}
                <option value="ADMIN" ${currentRole === 'ADMIN' ? 'selected' : ''}>Admin</option>
                <option value="THERAPIST" ${currentRole === 'THERAPIST' ? 'selected' : ''}>Terapis</option>
                <option value="CUSTOMER_SERVICE" ${currentRole === 'CUSTOMER_SERVICE' ? 'selected' : ''}>Customer Service</option>
              </select>
            </div>
            <div class="field" id="u-therapist-wrap" ${currentRole === 'THERAPIST' ? '' : 'hidden'}>
              <label for="u-therapist">Tautkan Data Terapis <span class="req-star">*</span></label>
              <select id="u-therapist" name="therapist_id" class="select">
                <option value="">-- Pilih Terapis Aktif --</option>
                ${therapistOptions.map((t) => `
                  <option value="${esc(t.therapist_id)}" ${existing && existing.therapist_id === t.therapist_id ? 'selected' : ''}>
                    ${esc(t.full_name)} (${esc(t.code)})
                  </option>
                `).join('')}
              </select>
              <span class="field-hint">${therapistOptions.length === 0 ? 'Belum ada terapis aktif yang bebas tautan.' : '1 Data Terapis hanya tertaut ke 1 akun aktif.'}</span>
            </div>
            ${!isEdit ? `
              <div class="field field-span-full">
                <label for="u-password">Password Awal (Opsional)</label>
                <input id="u-password" name="password" class="input" type="text" autocomplete="new-password"
                  placeholder="Kosongkan agar sistem membuatkan sandi acak kuat otomatis">
                <span class="field-hint">Minimal 8 karakter (huruf &amp; angka). Pengguna wajib ganti password saat login pertama.</span>
              </div>
            ` : ''}
          </div>

          <div id="u-perm-section" class="mt-4" ${currentRole === 'OWNER' ? 'hidden' : ''}>
            <div class="flex-between">
              <div>
                <strong class="text-sm">Checklist Hak Akses Modul</strong>
                <div class="text-xs text-muted">Centang izin spesifik akun ini. Perubahan disimpan langsung ke database &amp; bertahan saat login ulang.</div>
              </div>
              <button type="button" class="btn btn-soft btn-sm" id="btn-reset-perm-default">Reset ke Default Role</button>
            </div>
            <div class="perm-grid" id="u-perm-grid">
              ${PERMISSION_MODULES.map((mod) => `
                <div class="perm-group-card">
                  <div class="perm-group-title">${esc(mod.title)}</div>
                  <div class="perm-checks-wrap">
                    ${mod.items.map(([permKey, permLabel]) => `
                      <label class="perm-check">
                        <input type="checkbox" name="perm_item" value="${esc(permKey)}" ${initialPerms.has(permKey) ? 'checked' : ''}>
                        <span>${esc(permLabel)}</span>
                      </label>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <div id="u-owner-perm-note" class="context-item text-xs mt-4" ${currentRole === 'OWNER' ? '' : 'hidden'}>
            Akun dengan role <strong>Pemilik (OWNER)</strong> otomatis memiliki seluruh hak akses penuh sistem (termasuk Edit Pengaturan &amp; Purge Audit Log).
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="user-form" class="btn btn-primary" id="btn-save-user">${isEdit ? 'Simpan Perubahan' : 'Buat Akun'}</button>
      `
    });

    const form = modal.querySelector('#user-form');
    const roleSelect = modal.querySelector('#u-role');
    const therapistWrap = modal.querySelector('#u-therapist-wrap');
    const permSection = modal.querySelector('#u-perm-section');
    const ownerNote = modal.querySelector('#u-owner-perm-note');
    const resetPermBtn = modal.querySelector('#btn-reset-perm-default');
    const saveBtn = modal.querySelector('#btn-save-user');

    function applyRoleDefaultsToCheckboxes(roleCode) {
      const defaults = new Set(roleDefaultsMap[roleCode] || FALLBACK_ROLE_DEFAULTS[roleCode] || []);
      form.querySelectorAll('input[name="perm_item"]').forEach((cb) => {
        cb.checked = defaults.has(cb.value);
      });
    }

    roleSelect.addEventListener('change', () => {
      const r = roleSelect.value;
      therapistWrap.hidden = r !== 'THERAPIST';
      permSection.hidden = r === 'OWNER';
      ownerNote.hidden = r !== 'OWNER';
      if (r !== 'OWNER') {
        applyRoleDefaultsToCheckboxes(r);
      }
    });

    resetPermBtn?.addEventListener('click', () => {
      applyRoleDefaultsToCheckboxes(roleSelect.value);
      toast('Checklist dikembalikan ke preset default role.', 'info');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');

      const selectedRole = form.role.value;
      const checkedPerms = ['dashboard:view'];
      if (selectedRole !== 'OWNER') {
        form.querySelectorAll('input[name="perm_item"]:checked').forEach((cb) => {
          checkedPerms.push(cb.value);
        });
      }

      const payload = {
        username: form.username.value.trim(),
        full_name: form.full_name.value.trim(),
        role: selectedRole,
        therapist_id: selectedRole === 'THERAPIST' ? form.therapist_id.value : '',
        permissions: selectedRole === 'OWNER' ? undefined : checkedPerms
      };

      try {
        if (isEdit) {
          payload.user_id = existing.user_id;
          payload.expected_version = existing.version;
          await apiCall('users.update', payload, { write: true });
          closeModal();
          toast('Akun & hak akses pengguna berhasil disimpan.', 'success');
          if (actor && actor.user_id === existing.user_id) {
            await verifySessionWithServer();
          }
        } else {
          if (form.password && form.password.value.trim()) {
            payload.password = form.password.value;
          }
          const res = await apiCall('users.create', payload, { write: true });
          closeModal();
          toast('Akun pengguna baru berhasil dibuat.', 'success');
          if (res.data && res.data.temporary_password) {
            showTemporaryPasswordModal(res.data.user.username, res.data.temporary_password, 'Akun Baru Berhasil Dibuat');
          }
        }
        storeInvalidate('users');
        loadUsers({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  async function handleSetStatus(user, nextStatus, btn) {
    const label = nextStatus === 'ACTIVE' ? 'mengaktifkan kembali' : 'menonaktifkan';
    const ok = await confirmDialog({
      title: nextStatus === 'ACTIVE' ? 'Aktifkan Akun' : 'Nonaktifkan Akun',
      message: `Yakin ingin ${label} akun "${user.full_name}" (@${user.username})? Riwayat klien, jadwal, dan RME tetap aman.`,
      confirmLabel: nextStatus === 'ACTIVE' ? 'Ya, Aktifkan' : 'Ya, Nonaktifkan',
      danger: nextStatus !== 'ACTIVE'
    });
    if (!ok) return;

    setButtonLoading(btn, true, 'Memproses...');
    try {
      await apiCall('users.setStatus', {
        user_id: user.user_id,
        status: nextStatus,
        expected_version: user.version
      }, { write: true });
      storeInvalidate('users');
      toast(`Status akun ${user.username} diperbarui menjadi ${nextStatus}.`, 'success');
      loadUsers({ force: true, silent: true });
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function handleResetPassword(user, btn) {
    const ok = await confirmDialog({
      title: 'Reset Password Pengguna',
      message: `Reset password akun "${user.full_name}" (@${user.username})? Semua sesi aktif pengguna ini akan langsung dicabut.`,
      confirmLabel: 'Ya, Reset Password',
      danger: true
    });
    if (!ok) return;

    setButtonLoading(btn, true, 'Mereset...');
    try {
      const res = await apiCall('users.resetPassword', {
        user_id: user.user_id,
        expected_version: user.version
      }, { write: true });
      storeInvalidate('users');
      showTemporaryPasswordModal(user.username, res.data.temporary_password, 'Password Berhasil Direset');
      loadUsers({ force: true, silent: true });
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  const addUserBtn = container.querySelector('#btn-add-user');
  addUserBtn?.addEventListener('click', () => openUserFormModal(null, addUserBtn));

  let debounce = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = searchEl.value.trim();
      state.page = 1;
      loadUsers();
    }, 250);
  });
  roleEl.addEventListener('change', () => { state.role = roleEl.value; state.page = 1; loadUsers(); });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; loadUsers(); });

  await loadUsers({ force: Boolean(route && route.forceRefresh) });
}
