/**
 * pages/therapists.js — Master Data Terapis (F4):
 * - SWR in-memory cache + Top Progress Bar background refresh
 * - Inline spinner di tombol Detail & modal simpan
 * - Optimistic Delete dengan animasi keluar halus + rollback otomatis bila gagal.
 */

import { apiCall } from '../api.js';
import { can } from '../auth.js';
import {
  esc,
  formatRupiah,
  statusBadge,
  renderSkeletonTable,
  renderPagination,
  openModal,
  closeModal,
  confirmDialog,
  clearFieldErrors,
  showFieldErrors,
  setButtonLoading,
  markRowDeleting,
  toast
} from '../ui.js';
import {
  storeGet,
  storeSet,
  storeIsFresh,
  storeInvalidate,
  storeUpdateListItems
} from '../store.js';
import { animateRowRemove } from '../motion.js';

export async function renderTherapistsPage(container, route) {
  const showCommission = can('therapists:view_commission');
  const state = { page: 1, limit: 20, q: '', status: '', service_mode: '' };
  let activeFetchId = 0;

  function buildCacheKey() {
    return `therapists:list:p${state.page}:q=${state.q}:s=${state.status}:m=${state.service_mode}`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Master Data Terapis</h2>
          <p class="card-desc">Kelola profil terapis, spesialisasi, mode layanan, dan tarif sesi klinik.</p>
        </div>
        ${can('therapists:add') ? '<button type="button" class="btn btn-primary" id="btn-add-therapist">+ Tambah Terapis</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="trp-search" class="input" placeholder="Cari kode, nama, area, atau spesialisasi...">
        <select id="trp-filter-status" class="select" aria-label="Filter status terapis">
          <option value="">Semua Status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="FROZEN">Dibekukan</option>
          <option value="INACTIVE">Tidak Aktif</option>
        </select>
        <select id="trp-filter-mode" class="select" aria-label="Filter mode layanan">
          <option value="">Semua Layanan</option>
          <option value="BOTH">Online &amp; Offline</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
        </select>
      </div>

      <div id="trp-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="trp-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#trp-list-wrap');
  const pagWrap = container.querySelector('#trp-pagination');
  const searchEl = container.querySelector('#trp-search');
  const statusEl = container.querySelector('#trp-filter-status');
  const modeEl = container.querySelector('#trp-filter-mode');

  async function loadTherapists({ force = false, silent = false } = {}) {
    const fetchId = ++activeFetchId;
    const key = buildCacheKey();
    const cached = storeGet(key);

    if (cached && Array.isArray(cached.data) && !force) {
      renderTable(cached.data);
      renderPagination(pagWrap, cached.meta, (p) => {
        state.page = p;
        loadTherapists();
      });
      if (storeIsFresh(key, 35000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('therapists.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        filters: {
          status: state.status || undefined,
          service_mode: state.service_mode || undefined
        }
      });
      if (fetchId !== activeFetchId) return;
      const items = (res.data && res.data.items) || [];
      const { changed } = storeSet(key, items, res.meta);
      if (!cached || force || changed) {
        renderTable(items);
        renderPagination(pagWrap, res.meta, (p) => {
          state.page = p;
          loadTherapists();
        });
      }
    } catch (err) {
      if (fetchId !== activeFetchId) return;
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat data terapis</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function formatCommission(t) {
    if (!showCommission || t.commission_value === undefined) return '-';
    return t.commission_type === 'FIXED'
      ? formatRupiah(t.commission_value)
      : `${Number(t.commission_value || 0)}%`;
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada data terapis</p>
          <p class="empty-state-desc">Tambahkan master terapis terlebih dahulu sebelum menautkan akun login Terapis.</p>
        </div>
      `;
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Kode &amp; Nama</th>
              <th>Area &amp; Spesialisasi</th>
              <th>Layanan</th>
              <th>Tarif Sesi</th>
              ${showCommission ? '<th>Komisi</th>' : ''}
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((t) => `
              <tr data-row-id="${esc(t.therapist_id)}">
                <td>
                  <div><button type="button" class="link-btn" data-view-trp="${esc(t.therapist_id)}">${esc(t.full_name)}</button></div>
                  <div class="text-xs text-muted font-mono">${esc(t.code)} ${t.phone ? `• ${esc(t.phone)}` : ''}</div>
                </td>
                <td>
                  <div>${esc(t.area || '-')}</div>
                  <div class="text-xs text-muted">${esc(t.specialization || '-')}</div>
                </td>
                <td>${statusBadge('mode', t.service_mode)}</td>
                <td class="font-mono">${esc(formatRupiah(t.session_fee))}</td>
                ${showCommission ? `<td class="font-mono">${esc(formatCommission(t))}</td>` : ''}
                <td>${statusBadge('therapist', t.status)}</td>
                <td>
                  <div class="table-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-view-trp="${esc(t.therapist_id)}">Detail</button>
                    ${can('therapists:edit') ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-trp="${esc(t.therapist_id)}">Edit</button>` : ''}
                    ${can('therapists:delete') ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-trp="${esc(t.therapist_id)}">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const byId = Object.fromEntries(items.map((t) => [t.therapist_id, t]));
    listWrap.querySelectorAll('[data-view-trp]').forEach((btn) => {
      btn.addEventListener('click', () => openTherapistDetailModal(btn.dataset.viewTrp, btn));
    });
    listWrap.querySelectorAll('[data-edit-trp]').forEach((btn) => {
      btn.addEventListener('click', () => openTherapistFormModal(byId[btn.dataset.editTrp]));
    });
    listWrap.querySelectorAll('[data-del-trp]').forEach((btn) => {
      btn.addEventListener('click', () => handleDeleteTherapist(byId[btn.dataset.delTrp], btn));
    });
  }

  async function openTherapistDetailModal(therapistId, triggerBtn = null) {
    const isActionBtn = triggerBtn && triggerBtn.classList.contains('btn');
    if (isActionBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
    try {
      const res = await apiCall('therapists.get', { therapist_id: therapistId });
      const t = res.data.therapist;
      openModal({
        title: `Profil Terapis — ${t.full_name}`,
        size: 'md',
        bodyHtml: `
          <div class="form-grid form-grid-2 text-sm">
            <div><span class="text-xs text-muted">Kode</span><div class="font-mono"><strong>${esc(t.code)}</strong></div></div>
            <div><span class="text-xs text-muted">Status</span><div>${statusBadge('therapist', t.status)}</div></div>
            <div><span class="text-xs text-muted">No. HP / WA</span><div class="font-mono">${esc(t.phone || '-')}</div></div>
            <div><span class="text-xs text-muted">Email</span><div>${esc(t.email || '-')}</div></div>
            <div><span class="text-xs text-muted">Area</span><div>${esc(t.area || '-')}</div></div>
            <div><span class="text-xs text-muted">Mode Layanan</span><div>${statusBadge('mode', t.service_mode)}</div></div>
            <div class="field-span-full"><span class="text-xs text-muted">Spesialisasi</span><div>${esc(t.specialization || '-')}</div></div>
            <div><span class="text-xs text-muted">Tarif Sesi</span><div class="font-mono"><strong>${esc(formatRupiah(t.session_fee))}</strong></div></div>
            ${showCommission ? `<div><span class="text-xs text-muted">Komisi</span><div class="font-mono"><strong>${esc(formatCommission(t))}</strong> (${esc(t.commission_type)})</div></div>` : ''}
            ${t.linked_user !== undefined ? `
              <div class="field-span-full">
                <span class="text-xs text-muted">Akun Login Tertaut</span>
                <div>${t.linked_user ? `<span class="font-mono">@${esc(t.linked_user.username)}</span> ${statusBadge('user', t.linked_user.status)}` : '<span class="text-muted">Belum tertaut ke akun pengguna</span>'}</div>
              </div>
            ` : ''}
            <div class="field-span-full"><span class="text-xs text-muted">Catatan</span><div>${esc(t.notes || '-')}</div></div>
          </div>
        `,
        footerHtml: '<button type="button" class="btn btn-primary" data-modal-close>Tutup</button>'
      });
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      if (isActionBtn) setButtonLoading(triggerBtn, false);
    }
  }

  function openTherapistFormModal(existing = null) {
    const isEdit = Boolean(existing);
    const modal = openModal({
      title: isEdit ? `Edit Terapis — ${existing.full_name}` : 'Tambah Terapis Baru',
      size: 'lg',
      bodyHtml: `
        <form id="therapist-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field">
              <label for="t-code">Kode Terapis (Opsional)</label>
              <input id="t-code" name="code" class="input" type="text"
                value="${esc(existing ? existing.code : '')}" placeholder="Kosongkan untuk kode otomatis (TRP-001)">
            </div>
            <div class="field">
              <label for="t-name">Nama Lengkap <span class="req-star">*</span></label>
              <input id="t-name" name="full_name" class="input" type="text"
                value="${esc(existing ? existing.full_name : '')}" required>
            </div>
            <div class="field">
              <label for="t-phone">No. HP / WhatsApp</label>
              <input id="t-phone" name="phone" class="input" type="tel"
                value="${esc(existing ? existing.phone : '')}" placeholder="0812xxxxxxxx">
            </div>
            <div class="field">
              <label for="t-email">Email</label>
              <input id="t-email" name="email" class="input" type="email"
                value="${esc(existing ? existing.email : '')}">
            </div>
            <div class="field">
              <label for="t-area">Area / Wilayah</label>
              <input id="t-area" name="area" class="input" type="text"
                value="${esc(existing ? existing.area : '')}" placeholder="mis. Jakarta Selatan">
            </div>
            <div class="field">
              <label for="t-spec">Spesialisasi</label>
              <input id="t-spec" name="specialization" class="input" type="text"
                value="${esc(existing ? existing.specialization : '')}" placeholder="mis. Kecemasan, Trauma, Insomnia">
            </div>
            <div class="field">
              <label for="t-fee">Tarif Sesi (Rp)</label>
              <input id="t-fee" name="session_fee" class="input" type="number" min="0" step="1000"
                value="${esc(existing ? existing.session_fee : 0)}">
            </div>
            <div class="field">
              <label for="t-mode">Mode Layanan</label>
              <select id="t-mode" name="service_mode" class="select">
                <option value="BOTH" ${(!existing || existing.service_mode === 'BOTH') ? 'selected' : ''}>Online &amp; Offline</option>
                <option value="ONLINE" ${existing && existing.service_mode === 'ONLINE' ? 'selected' : ''}>Online</option>
                <option value="OFFLINE" ${existing && existing.service_mode === 'OFFLINE' ? 'selected' : ''}>Offline</option>
              </select>
            </div>
            <div class="field">
              <label for="t-comm-type">Jenis Komisi</label>
              <select id="t-comm-type" name="commission_type" class="select">
                <option value="PERCENT" ${(!existing || existing.commission_type === 'PERCENT') ? 'selected' : ''}>Persentase (%)</option>
                <option value="FIXED" ${existing && existing.commission_type === 'FIXED' ? 'selected' : ''}>Nominal Tetap (Rp)</option>
              </select>
            </div>
            <div class="field">
              <label for="t-comm-val">Nilai Komisi</label>
              <input id="t-comm-val" name="commission_value" class="input" type="number" min="0"
                value="${esc(existing ? existing.commission_value : 0)}">
            </div>
            <div class="field">
              <label for="t-status">Status</label>
              <select id="t-status" name="status" class="select">
                <option value="ACTIVE" ${(!existing || existing.status === 'ACTIVE') ? 'selected' : ''}>Aktif</option>
                <option value="FROZEN" ${existing && existing.status === 'FROZEN' ? 'selected' : ''}>Dibekukan</option>
                <option value="INACTIVE" ${existing && existing.status === 'INACTIVE' ? 'selected' : ''}>Tidak Aktif</option>
              </select>
            </div>
            <div class="field field-span-full">
              <label for="t-notes">Catatan</label>
              <textarea id="t-notes" name="notes" class="textarea" rows="3">${esc(existing ? existing.notes : '')}</textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="therapist-form" class="btn btn-primary" id="btn-save-trp">${isEdit ? 'Simpan Perubahan' : 'Tambah Terapis'}</button>
      `
    });

    const form = modal.querySelector('#therapist-form');
    const saveBtn = modal.querySelector('#btn-save-trp');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');

      const payload = {
        code: form.code.value.trim(),
        full_name: form.full_name.value.trim(),
        phone: form.phone.value.trim(),
        email: form.email.value.trim(),
        area: form.area.value.trim(),
        specialization: form.specialization.value.trim(),
        session_fee: Number(form.session_fee.value || 0),
        commission_type: form.commission_type.value,
        commission_value: Number(form.commission_value.value || 0),
        service_mode: form.service_mode.value,
        status: form.status.value,
        notes: form.notes.value.trim()
      };

      try {
        if (isEdit) {
          payload.therapist_id = existing.therapist_id;
          payload.expected_version = existing.version;
          await apiCall('therapists.update', payload, { write: true });
          toast('Data terapis berhasil diperbarui.', 'success');
        } else {
          await apiCall('therapists.create', payload, { write: true });
          toast('Terapis baru berhasil ditambahkan.', 'success');
        }
        closeModal();
        storeInvalidate('therapists');
        storeInvalidate('dashboard');
        loadTherapists({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  async function handleDeleteTherapist(t, btn) {
    if (!t) return;
    const ok = await confirmDialog({
      title: 'Hapus Data Terapis',
      message: `Hapus (soft delete) terapis "${t.full_name}" (${t.code})? Riwayat klien dan sesi tetap tersimpan.`,
      confirmLabel: 'Ya, Hapus',
      danger: true
    });
    if (!ok) return;

    const rowEl = btn.closest('tr');
    setButtonLoading(btn, true, 'Menghapus...');
    markRowDeleting(rowEl, true);

    const deleteReq = apiCall('therapists.delete', {
      therapist_id: t.therapist_id,
      expected_version: t.version
    }, { write: true });

    await animateRowRemove(rowEl);
    if (rowEl && rowEl.parentElement) rowEl.remove();

    storeUpdateListItems('therapists', (arr) => arr.filter((item) => item.therapist_id !== t.therapist_id));
    const tbody = listWrap.querySelector('tbody');
    if (tbody && tbody.children.length === 0) renderTable([]);

    try {
      await deleteReq;
      storeInvalidate('therapists');
      storeInvalidate('dashboard');
      toast(`Data terapis "${t.full_name}" berhasil dihapus.`, 'success');
      loadTherapists({ force: true, silent: true });
    } catch (err) {
      storeInvalidate('therapists');
      toast(err.message, 'danger');
      loadTherapists({ force: true, silent: true });
    }
  }

  container.querySelector('#btn-add-therapist')?.addEventListener('click', () => openTherapistFormModal(null));

  let debounce = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = searchEl.value.trim(); state.page = 1; loadTherapists(); }, 250);
  });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; loadTherapists(); });
  modeEl.addEventListener('change', () => { state.service_mode = modeEl.value; state.page = 1; loadTherapists(); });

  await loadTherapists({ force: Boolean(route && route.forceRefresh) });
}
