/**
 * pages/users.js — Manajemen Pengguna & Staf (F3):
 * - SWR in-memory cache + background refresh via Top Progress Bar
 * - Inline spinner di tombol +Tambah/Edit (saat muat opsi terapis unlinked),
 *   tombol simpan modal, Reset Sandi, dan Aktifkan/Nonaktifkan.
 */

import { apiCall } from '../api.js';
import { can, getUser, roleLabel } from '../auth.js';
import {
  esc,
  statusBadge,
  formatDateTimeId,
  renderSkeletonTable,
  renderPagination,
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

export async function renderUsersPage(container, route) {
  const actor = getUser();
  const state = { page: 1, limit: 20, q: '', role: '', status: '' };
  let activeFetchId = 0;

  function buildCacheKey() {
    return `users:list:p${state.page}:q=${state.q}:r=${state.role}:s=${state.status}`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Daftar Akun Staf</h2>
          <p class="card-desc">1 pengguna = 1 akun login = 1 role. Menonaktifkan akun tidak menghapus riwayat klinik.</p>
        </div>
        ${can('users:add') ? '<button type="button" class="btn btn-primary" id="btn-add-user">+ Tambah Pengguna</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="users-search" class="input" placeholder="Cari nama, username, atau terapis...">
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

    if (cached && Array.isArray(cached.data) && !force) {
      renderTable(cached.data);
      renderPagination(pagWrap, cached.meta, (p) => {
        state.page = p;
        loadUsers();
      });
      if (storeIsFresh(key, 35000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('users.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        filters: {
          role: state.role || undefined,
          status: state.status || undefined
        }
      });
      if (fetchId !== activeFetchId) return;
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
              <th>Nama &amp; Username</th>
              <th>Role</th>
              <th>Terapis Tertaut</th>
              <th>Status</th>
              <th>Login Terakhir</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((u) => {
              const manageable = canManageRow(u);
              const isSelf = actor && actor.user_id === u.user_id;
              return `
                <tr data-row-id="${esc(u.user_id)}">
                  <td>
                    <div><strong>${esc(u.full_name)}</strong> ${isSelf ? '<span class="badge badge-primary">Anda</span>' : ''}</div>
                    <div class="text-xs text-muted font-mono">@${esc(u.username)}</div>
                  </td>
                  <td><span class="badge badge-neutral">${esc(roleLabel(u.role))}</span></td>
                  <td>${u.therapist_id ? `<strong>${esc(u.therapist_name || u.therapist_id)}</strong>` : '<span class="text-muted">-</span>'}</td>
                  <td>
                    ${statusBadge('user', u.status)}
                    ${u.is_locked ? '<span class="badge badge-warning">Terkunci</span>' : ''}
                    ${u.must_change_password ? '<div class="text-xs text-muted mt-2">Wajib ganti sandi</div>' : ''}
                  </td>
                  <td class="text-xs">${esc(formatDateTimeId(u.last_login_at))}</td>
                  <td>
                    <div class="table-actions">
                      ${manageable && can('users:edit') ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-user="${esc(u.user_id)}">Edit</button>` : ''}
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

    const modal = openModal({
      title: isEdit ? `Edit Pengguna — ${existing.username}` : 'Tambah Pengguna Baru',
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
              <label for="u-role">Role <span class="req-star">*</span></label>
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
              <span class="field-hint">${therapistOptions.length === 0 ? 'Belum ada terapis aktif yang bebas tautan. Buat di menu Data Terapis terlebih dahulu.' : '1 Data Terapis hanya dapat tertaut ke 1 akun aktif.'}</span>
            </div>
            ${!isEdit ? `
              <div class="field field-span-full">
                <label for="u-password">Password Awal (Opsional)</label>
                <input id="u-password" name="password" class="input" type="text" autocomplete="new-password"
                  placeholder="Kosongkan agar sistem membuatkan sandi acak kuat otomatis">
                <span class="field-hint">Minimal 8 karakter (huruf &amp; angka). Pengguna tetap wajib ganti password saat login pertama.</span>
              </div>
            ` : ''}
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
    const saveBtn = modal.querySelector('#btn-save-user');

    roleSelect.addEventListener('change', () => {
      therapistWrap.hidden = roleSelect.value !== 'THERAPIST';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');

      const payload = {
        username: form.username.value.trim(),
        full_name: form.full_name.value.trim(),
        role: form.role.value,
        therapist_id: form.role.value === 'THERAPIST' ? form.therapist_id.value : ''
      };

      try {
        if (isEdit) {
          payload.user_id = existing.user_id;
          payload.expected_version = existing.version;
          await apiCall('users.update', payload, { write: true });
          closeModal();
          toast('Akun pengguna berhasil diperbarui.', 'success');
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
