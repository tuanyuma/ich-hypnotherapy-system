/**
 * pages/clients.js — Data Induk Klien & Halaman Detail Klien (F5):
 * - SWR in-memory cache (tampil instan dari RAM & sinkronisasi latar via Top Progress Bar)
 * - Form CRUD klien dengan inline button spinner & cache opsi terapis instan
 * - Optimistic Delete dengan animasi keluar halus + rollback otomatis bila gagal
 * - Detail Klien (#/clients/:id) dengan SWR cache.
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  esc,
  SOURCE_CHANNEL_LABELS,
  statusBadge,
  formatDateId,
  formatTimeId,
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
  markRowDeleting,
  toast
} from '../ui.js';
import {
  storeGet,
  storeSet,
  storeIsFresh,
  storeInvalidate,
  storeUpdateListItems,
  getTherapistsOptionsCached
} from '../store.js';
import { animateRowRemove } from '../motion.js';

export async function renderClientsPage(container, route) {
  if (route && route.param) {
    await renderClientDetailView(container, route.param, Boolean(route.forceRefresh));
    return;
  }
  await renderClientsListView(container, route);
}

async function renderClientsListView(container, route) {
  const actor = getUser();
  const initialQ = (route && route.query && route.query.q) ? String(route.query.q).trim() : '';
  const state = {
    page: 1,
    limit: 10,
    q: initialQ,
    status: '',
    source_channel: '',
    sort: { field: 'client_code', dir: 'desc' }
  };
  let activeFetchId = 0;

  function buildCacheKey() {
    if (
      state.page === 1 && !state.q && !state.status && !state.source_channel &&
      state.sort.field === 'client_code' && state.sort.dir === 'desc'
    ) {
      return 'clients:list:p1:default';
    }
    return `clients:list:p${state.page}:l${state.limit}:q=${state.q}:s=${state.status}:src=${state.source_channel}:sf=${state.sort.field}:${state.sort.dir}`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Data Induk Klien</h2>
          <p class="card-desc">Klik baris klien untuk melihat detail &amp; riwayat lengkap. 1 Klien = 1 Stable ID (anti duplikat WhatsApp).</p>
        </div>
        ${can('clients:add') ? '<button type="button" class="btn btn-primary" id="btn-add-client">+ Klien Baru</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="cln-search" class="input" placeholder="Cari nama, kode ICH, ID, atau WhatsApp...">
        <select id="cln-filter-status" class="select" aria-label="Filter status klien">
          <option value="">Semua Status</option>
          <option value="BARU_DAFTAR">Baru Daftar</option>
          <option value="DALAM_PROSES">Dalam Proses</option>
          <option value="SELESAI">Selesai</option>
        </select>
        <select id="cln-filter-source" class="select" aria-label="Filter sumber informasi">
          <option value="">Semua Sumber Info</option>
          ${Object.entries(SOURCE_CHANNEL_LABELS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
        </select>
      </div>

      <div id="cln-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="cln-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#cln-list-wrap');
  const pagWrap = container.querySelector('#cln-pagination');
  const searchEl = container.querySelector('#cln-search');
  if (initialQ) searchEl.value = initialQ;
  const statusEl = container.querySelector('#cln-filter-status');
  const sourceEl = container.querySelector('#cln-filter-source');

  async function loadClients({ force = false, silent = false } = {}) {
    const fetchId = ++activeFetchId;
    const key = buildCacheKey();
    const cached = storeGet(key);

    if (cached && Array.isArray(cached.data) && !force) {
      renderTable(cached.data);
      renderPagination(pagWrap, cached.meta, (p) => {
        state.page = p;
        loadClients();
      });
      if (storeIsFresh(key, 30000)) {
        return;
      }
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('clients.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        sort: state.sort,
        filters: {
          status: state.status || undefined,
          source_channel: state.source_channel || undefined
        }
      });
      if (fetchId !== activeFetchId) return;
      const items = (res.data && res.data.items) || [];
      const { changed } = storeSet(key, items, res.meta);
      if (!cached || force || changed) {
        renderTable(items);
        renderPagination(pagWrap, res.meta, (p) => {
          state.page = p;
          loadClients();
        });
      }
    } catch (err) {
      if (fetchId !== activeFetchId) return;
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat data klien</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada data klien</p>
          <p class="empty-state-desc">Tambahkan klien baru atau ubah filter pencarian Anda.</p>
        </div>
      `;
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID Klien', 'client_code', state.sort)}
              <th>Nama Klien</th>
              <th>WhatsApp</th>
              <th>Sumber Info</th>
              <th>Terapis Utama</th>
              <th>Status</th>
              ${sortableTh('Terakhir Sesi', 'last_session_at', state.sort)}
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((c) => `
              <tr class="is-clickable-row" data-row-id="${esc(c.client_id)}" data-client-row="${esc(c.client_id)}" tabindex="0" title="Klik baris untuk melihat detail klien">
                <td><span class="code-chip">${esc(c.client_code)}</span></td>
                <td>
                  <div class="client-row-name">${esc(c.full_name)}</div>
                </td>
                <td class="font-mono text-sm">
                  <a href="https://wa.me/${esc(c.wa_normalized)}" target="_blank" rel="noopener noreferrer" class="link-btn">${esc(c.wa_normalized || c.phone_raw)}</a>
                </td>
                <td class="text-sm">
                  ${esc(SOURCE_CHANNEL_LABELS[c.source_channel] || c.source_channel || '-')}
                  ${c.source_detail ? `<div class="text-xs text-muted">${esc(c.source_detail)}</div>` : ''}
                </td>
                <td>${esc(c.primary_therapist_name || '-')}</td>
                <td>${statusBadge('client', c.status)}</td>
                <td class="text-xs">
                  <div><strong>${esc(formatDateId(c.last_session_at))}</strong></div>
                  <div class="text-muted">${esc(c.total_sessions || 0)} sesi tercatat</div>
                </td>
                <td>
                  <div class="table-actions table-actions-nowrap">
                    ${can('clients:edit') ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-cln="${esc(c.client_id)}">Edit</button>` : ''}
                    ${can('clients:delete') ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-cln="${esc(c.client_id)}">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    bindSortableHeaders(listWrap, state.sort, () => {
      state.page = 1;
      loadClients();
    });

    const byId = Object.fromEntries(items.map((c) => [c.client_id, c]));
    listWrap.querySelectorAll('[data-client-row]').forEach((row) => {
      const openRowDetail = () => {
        if (row.classList.contains('is-deleting')) return;
        navigate(`#/clients/${row.dataset.clientRow}`);
      };
      row.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, select, textarea')) return;
        const sel = window.getSelection ? window.getSelection().toString().trim() : '';
        if (sel) return;
        openRowDetail();
      });
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRowDetail();
        }
      });
    });
    listWrap.querySelectorAll('[data-edit-cln]').forEach((btn) => {
      btn.addEventListener('click', () => openClientFormModal(byId[btn.dataset.editCln], actor, () => {
        storeInvalidate('clients');
        storeInvalidate('dashboard');
        loadClients({ force: true, silent: true });
      }, btn));
    });
    listWrap.querySelectorAll('[data-del-cln]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const c = byId[btn.dataset.delCln];
        if (!c) return;
        const ok = await confirmDialog({
          title: 'Hapus Data Klien',
          message: `Hapus (soft delete) klien "${c.full_name}" (${c.client_code})?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = btn.closest('tr');
        setButtonLoading(btn, true, 'Menghapus...');
        markRowDeleting(rowEl, true);

        // Kirim hapus ke server sambil animasikan baris keluar (Optimistic UI)
        const deleteReq = apiCall('clients.delete', { client_id: c.client_id, expected_version: c.version }, { write: true });
        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();

        // Update RAM cache secara optimistik
        storeUpdateListItems('clients', (arr) => arr.filter((item) => item.client_id !== c.client_id));
        const tbody = listWrap.querySelector('tbody');
        if (tbody && tbody.children.length === 0) {
          renderTable([]);
        }

        try {
          await deleteReq;
          storeInvalidate('clients');
          storeInvalidate('dashboard');
          toast(`Klien "${c.full_name}" berhasil dihapus.`, 'success');
          loadClients({ force: true, silent: true });
        } catch (err) {
          // Rollback bila server menolak penghapusan
          storeInvalidate('clients');
          toast(err.message, 'danger');
          loadClients({ force: true, silent: true });
        }
      });
    });
  }

  const addBtn = container.querySelector('#btn-add-client');
  addBtn?.addEventListener('click', () => {
    openClientFormModal(null, actor, () => {
      storeInvalidate('clients');
      storeInvalidate('dashboard');
      loadClients({ force: true, silent: true });
    }, addBtn);
  });

  let debounce = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = searchEl.value.trim(); state.page = 1; loadClients(); }, 250);
  });
  statusEl.addEventListener('change', () => { state.status = statusEl.value; state.page = 1; loadClients(); });
  sourceEl.addEventListener('change', () => { state.source_channel = sourceEl.value; state.page = 1; loadClients(); });

  await loadClients({ force: Boolean(route && route.forceRefresh) });

  if (route && route.query && route.query.new === '1' && can('clients:add')) {
    openClientFormModal(null, actor, () => {
      storeInvalidate('clients');
      storeInvalidate('dashboard');
      loadClients({ force: true, silent: true });
    }, addBtn);
  }
}

async function openClientFormModal(existing, actor, onSaved, triggerBtn = null) {
  const isEdit = Boolean(existing);
  const isTherapist = actor && actor.role === 'THERAPIST';
  let therapistOptions = [];

  if (!isTherapist) {
    const hasCached = Boolean(storeGet('therapists:options:active') || storeGet('therapists:options:all'));
    if (!hasCached && triggerBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
    try {
      therapistOptions = await getTherapistsOptionsCached({ activeOnly: true });
    } catch (_) {
      therapistOptions = [];
    } finally {
      if (!hasCached && triggerBtn) setButtonLoading(triggerBtn, false);
    }
  }

  const currentSource = existing ? existing.source_channel : 'WHATSAPP';

  const modal = openModal({
    title: isEdit ? `Edit Klien — ${existing.full_name}` : 'Tambah Klien Baru',
    size: 'lg',
    bodyHtml: `
      <form id="client-form" novalidate>
        ${isEdit ? `
          <div class="context-item flex-between mb-3 text-sm">
            <div><strong>ID Klien Permanen:</strong> <span class="code-chip">${esc(existing.client_code)}</span></div>
            <div>${statusBadge('client', existing.status)}</div>
          </div>
        ` : ''}
        <div id="client-dup-banner" class="auth-notice" hidden></div>
        <div class="form-grid form-grid-2">
          <div class="field">
            <label for="c-name">Nama Lengkap <span class="req-star">*</span></label>
            <input id="c-name" name="full_name" class="input" type="text" value="${esc(existing ? existing.full_name : '')}" required>
          </div>
          <div class="field">
            <label for="c-wa">No. WhatsApp <span class="req-star">*</span></label>
            <input id="c-wa" name="phone_raw" class="input" type="tel" value="${esc(existing ? (existing.phone_raw || existing.wa_normalized) : '')}" placeholder="0812-3456-7890" required>
            <span class="field-hint">Otomatis dinormalisasi (628...) dan dicek anti-duplikat.</span>
          </div>
          <div class="field">
            <label for="c-gender">Jenis Kelamin</label>
            <select id="c-gender" name="gender" class="select">
              <option value="">-- Pilih --</option>
              <option value="L" ${existing && existing.gender === 'L' ? 'selected' : ''}>Laki-laki</option>
              <option value="P" ${existing && existing.gender === 'P' ? 'selected' : ''}>Perempuan</option>
            </select>
          </div>
          <div class="field">
            <label for="c-birth">Tanggal Lahir</label>
            <input id="c-birth" name="birth_date" class="input" type="date" value="${esc(existing ? existing.birth_date : '')}">
          </div>
          <div class="field">
            <label for="c-email">Email</label>
            <input id="c-email" name="email" class="input" type="email" value="${esc(existing ? existing.email : '')}">
          </div>
          <div class="field">
            <label for="c-source">Sumber Informasi <span class="req-star">*</span></label>
            <select id="c-source" name="source_channel" class="select">
              ${Object.entries(SOURCE_CHANNEL_LABELS).map(([k, v]) => `
                <option value="${esc(k)}" ${currentSource === k ? 'selected' : ''}>${esc(v)}</option>
              `).join('')}
            </select>
          </div>
          <div class="field" id="c-source-detail-wrap">
            <label for="c-source-detail">Detail Sumber <span id="c-source-req" class="req-star" ${currentSource === 'OTHER' ? '' : 'hidden'}>*</span></label>
            <input id="c-source-detail" name="source_detail" class="input" type="text"
              value="${esc(existing ? existing.source_detail : '')}" placeholder="mis. Direkomendasikan dr. Andi / iklan IG">
          </div>
          ${!isTherapist ? `
            <div class="field">
              <label for="c-therapist">Terapis Utama</label>
              <select id="c-therapist" name="primary_therapist_id" class="select">
                <option value="">-- Belum Ditentukan --</option>
                ${therapistOptions.map((t) => `
                  <option value="${esc(t.therapist_id)}" ${existing && existing.primary_therapist_id === t.therapist_id ? 'selected' : ''}>
                    ${esc(t.full_name)} (${esc(t.code)})
                  </option>
                `).join('')}
              </select>
            </div>
          ` : `
            <div class="field">
              <label>Terapis Utama</label>
              <input class="input" type="text" value="Otomatis tertaut ke profil Anda" disabled>
            </div>
          `}
          <div class="field">
            <label for="c-status">Status Klien</label>
            <select id="c-status" name="status" class="select">
              <option value="BARU_DAFTAR" ${(!existing || existing.status === 'BARU_DAFTAR') ? 'selected' : ''}>Baru Daftar</option>
              <option value="DALAM_PROSES" ${existing && existing.status === 'DALAM_PROSES' ? 'selected' : ''}>Dalam Proses</option>
              <option value="SELESAI" ${existing && existing.status === 'SELESAI' ? 'selected' : ''}>Selesai</option>
            </select>
          </div>
          <div class="field field-span-full">
            <label for="c-address">Alamat</label>
            <input id="c-address" name="address" class="input" type="text" value="${esc(existing ? existing.address : '')}">
          </div>
          <div class="field field-span-full">
            <label for="c-notes">Catatan Administratif</label>
            <textarea id="c-notes" name="notes" class="textarea" rows="3">${esc(existing ? existing.notes : '')}</textarea>
          </div>
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
      <button type="submit" form="client-form" class="btn btn-primary" id="btn-save-client">${isEdit ? 'Simpan Perubahan' : 'Simpan Klien'}</button>
    `
  });

  const form = modal.querySelector('#client-form');
  const sourceEl = modal.querySelector('#c-source');
  const reqStar = modal.querySelector('#c-source-req');
  const dupBanner = modal.querySelector('#client-dup-banner');
  const saveBtn = modal.querySelector('#btn-save-client');

  sourceEl.addEventListener('change', () => {
    reqStar.hidden = sourceEl.value !== 'OTHER';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    dupBanner.hidden = true;
    setButtonLoading(saveBtn, true, 'Menyimpan...');

    const payload = {
      full_name: form.full_name.value.trim(),
      phone_raw: form.phone_raw.value.trim(),
      gender: form.gender.value,
      birth_date: form.birth_date.value,
      email: form.email.value.trim(),
      address: form.address.value.trim(),
      source_channel: form.source_channel.value,
      source_detail: form.source_detail.value.trim(),
      status: form.status.value,
      notes: form.notes.value.trim()
    };
    if (!isTherapist && form.primary_therapist_id) {
      payload.primary_therapist_id = form.primary_therapist_id.value;
    }

    try {
      if (isEdit) {
        payload.client_id = existing.client_id;
        payload.expected_version = existing.version;
        await apiCall('clients.update', payload, { write: true });
        toast('Data klien berhasil diperbarui.', 'success');
      } else {
        await apiCall('clients.create', payload, { write: true });
        toast('Klien baru berhasil didaftarkan.', 'success');
      }
      closeModal();
      onSaved();
    } catch (err) {
      if (err.fields) showFieldErrors(form, err.fields);
      if (err.code === 'DUPLICATE' && err.conflict && err.conflict.client_id) {
        dupBanner.innerHTML = `
          <div><strong>Duplikat Terdeteksi:</strong> ${esc(err.message)}</div>
          <button type="button" class="btn btn-soft btn-sm mt-2" id="btn-open-conflict-cln">
            Buka Profil ${esc(err.conflict.full_name)} (${esc(err.conflict.client_code)})
          </button>
        `;
        dupBanner.hidden = false;
        dupBanner.querySelector('#btn-open-conflict-cln')?.addEventListener('click', () => {
          closeModal();
          navigate(`#/clients/${err.conflict.client_id}`);
        });
      }
      toast(err.message, 'danger');
    } finally {
      setButtonLoading(saveBtn, false);
    }
  });
}

// ============================================================================
// Halaman Detail Klien (#/clients/:id)
// ============================================================================

async function renderClientDetailView(container, clientId, forceRefresh = false) {
  const actor = getUser();
  const detailKey = `clients:detail:${clientId}`;
  const cached = storeGet(detailKey);
  let activeTab = 'appointments';

  function paintDetail(detail) {
    const c = detail.client;
    const appointments = detail.appointments || [];
    const hasAssessments = Array.isArray(detail.assessments) && can('assessments:view');
    const hasRme = Array.isArray(detail.rme_sessions) && can('rme:view');
    const hasPackages = Array.isArray(detail.client_packages) && can('packages:view');

    document.getElementById('page-title').textContent = `Detail Klien — ${c.full_name}`;
    document.getElementById('page-subtitle').textContent = `${c.client_code} • ${c.wa_normalized}`;

    container.innerHTML = `
      <div class="flex-between mb-3">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-back-clients">← Kembali ke Data Klien</button>
        <div class="flex-gap">
          <a href="https://wa.me/${esc(c.wa_normalized)}" target="_blank" rel="noopener noreferrer" class="btn btn-wa btn-sm">Chat WA</a>
          ${can('clients:edit') ? '<button type="button" class="btn btn-secondary btn-sm" id="btn-edit-detail-cln">Edit Biodata</button>' : ''}
          ${can('packages:add') ? '<button type="button" class="btn btn-soft btn-sm" id="btn-quick-pkg">+ Paket</button>' : ''}
          ${can('appointments:add') ? '<button type="button" class="btn btn-soft btn-sm" id="btn-quick-apt">+ Jadwal</button>' : ''}
          ${can('assessments:add') ? '<button type="button" class="btn btn-soft btn-sm" id="btn-quick-asm">+ Assessment</button>' : ''}
          ${can('rme:add') ? '<button type="button" class="btn btn-primary btn-sm" id="btn-quick-rme">+ Sesi RME</button>' : ''}
        </div>
      </div>

      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${esc(c.full_name)} <span class="code-chip" style="margin-left:6px;">${esc(c.client_code)}</span></h2>
            <p class="card-desc">Terakhir sesi: <strong>${esc(formatDateId(c.last_session_at))}</strong> • Total sesi: <strong>${esc(c.total_sessions || 0)}</strong></p>
          </div>
          ${statusBadge('client', c.status)}
        </div>

        <div class="form-grid form-grid-3 text-sm">
          <div><span class="text-xs text-muted">ID Klien Permanen</span><div><span class="code-chip">${esc(c.client_code)}</span></div></div>
          <div><span class="text-xs text-muted">WhatsApp</span><div class="font-mono">${esc(c.wa_normalized || c.phone_raw || '-')}</div></div>
          <div><span class="text-xs text-muted">Jenis Kelamin / Tgl Lahir</span><div>${c.gender === 'L' ? 'Laki-laki' : c.gender === 'P' ? 'Perempuan' : '-'} • ${esc(formatDateId(c.birth_date))}</div></div>
          <div><span class="text-xs text-muted">Email</span><div>${esc(c.email || '-')}</div></div>
          <div><span class="text-xs text-muted">Sumber Informasi</span><div>${esc(SOURCE_CHANNEL_LABELS[c.source_channel] || c.source_channel || '-')} ${c.source_detail ? `(${esc(c.source_detail)})` : ''}</div></div>
          <div><span class="text-xs text-muted">Terapis Utama</span><div>${esc(c.primary_therapist_name || '-')}</div></div>
          <div class="field-span-full"><span class="text-xs text-muted">Alamat</span><div>${esc(c.address || '-')}</div></div>
          ${c.notes ? `<div class="field-span-full"><span class="text-xs text-muted">Catatan</span><div>${esc(c.notes)}</div></div>` : ''}
        </div>
      </section>

      <section class="card">
        <div class="tabs-bar" role="tablist">
          <button type="button" class="tab-btn ${activeTab === 'appointments' ? 'is-active' : ''}" data-tab="appointments" role="tab">Jadwal (${appointments.length})</button>
          ${hasPackages ? `<button type="button" class="tab-btn ${activeTab === 'packages' ? 'is-active' : ''}" data-tab="packages" role="tab">Paket Terapi (${detail.client_packages.length})</button>` : ''}
          ${hasAssessments ? `<button type="button" class="tab-btn ${activeTab === 'assessments' ? 'is-active' : ''}" data-tab="assessments" role="tab">Assessment Awal (${detail.assessments.length})</button>` : ''}
          ${hasRme ? `<button type="button" class="tab-btn ${activeTab === 'rme' ? 'is-active' : ''}" data-tab="rme" role="tab">RME / Sesi Terapi (${detail.rme_sessions.length})</button>` : ''}
        </div>
        <div id="client-tab-content"></div>
      </section>
    `;

    const tabContent = container.querySelector('#client-tab-content');

    function renderTab(name) {
      activeTab = name;
      container.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.tab === name);
      });

      if (name === 'appointments') {
        if (appointments.length === 0) {
          tabContent.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada jadwal</p></div>';
          return;
        }
        tabContent.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Tanggal &amp; Jam</th><th>Terapis</th><th>Mode</th><th>Status</th><th>Catatan</th></tr></thead>
              <tbody>
                ${appointments.map((a) => `
                  <tr>
                    <td class="font-mono"><strong>${esc(formatDateId(a.scheduled_date))}</strong> ${esc(formatTimeId(a.start_time))} WIB</td>
                    <td>${esc(a.therapist_name || '-')}</td>
                    <td>${statusBadge('mode', a.session_mode)}</td>
                    <td>${statusBadge('appointment', a.status)}</td>
                    <td class="text-xs">${esc(a.cancel_reason ? `Alasan batal: ${a.cancel_reason}` : (a.notes || '-'))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else if (name === 'packages' && hasPackages) {
        const list = detail.client_packages;
        if (list.length === 0) {
          tabContent.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada paket terapi</p></div>';
          return;
        }
        tabContent.innerHTML = `
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Kode</th><th>Nama Paket</th><th>Kuota &amp; Sisa Sesi</th><th>Mulai &amp; Kedaluwarsa</th><th>Status</th></tr></thead>
              <tbody>
                ${list.map((cp) => `
                  <tr>
                    <td><span class="code-chip">${esc(cp.client_package_code || cp.client_package_id)}</span></td>
                    <td><strong>${esc(cp.package_name)}</strong></td>
                    <td>
                      <span class="quota-chip ${Number(cp.remaining_sessions) <= 0 ? 'is-empty' : ''}">
                        Sisa ${esc(cp.remaining_sessions)} dari ${esc(cp.total_sessions)} Sesi
                      </span>
                    </td>
                    <td class="text-xs">
                      <div>Mulai: <strong>${esc(formatDateId(cp.start_date))}</strong></div>
                      <div>Berlaku s/d: <strong>${esc(formatDateId(cp.expiry_date))}</strong></div>
                    </td>
                    <td>${statusBadge('client_package', cp.status)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else if (name === 'assessments' && hasAssessments) {
        const list = detail.assessments;
        if (list.length === 0) {
          tabContent.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada assessment awal</p></div>';
          return;
        }
        tabContent.innerHTML = list.map((a) => `
          <div class="context-item">
            <div class="flex-between">
              <strong>${esc(formatDateId(a.assessment_date))}</strong>
              <span class="text-xs text-muted">Terapis: ${esc(a.therapist_name || '-')}</span>
            </div>
            <div class="text-sm mt-2"><strong>Keluhan Utama:</strong> ${esc(a.main_complaint)}</div>
            ${a.therapy_goals ? `<div class="text-xs text-muted mt-2"><strong>Tujuan Terapi:</strong> ${esc(a.therapy_goals)}</div>` : ''}
            ${a.recommendation ? `<div class="text-xs text-muted mt-2"><strong>Rekomendasi:</strong> ${esc(a.recommendation)}</div>` : ''}
          </div>
        `).join('');
      } else if (name === 'rme' && hasRme) {
        const list = detail.rme_sessions;
        if (list.length === 0) {
          tabContent.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada catatan RME</p></div>';
          return;
        }
        tabContent.innerHTML = list.map((r) => `
          <div class="context-item">
            <div class="flex-between">
              <div>
                <span class="session-chip">Sesi ke-${esc(r.session_no)}</span>
                <strong style="margin-left:6px;">${esc(formatDateId(r.session_date))}</strong>
                ${statusBadge('mode', r.session_mode)}
              </div>
              <span class="text-xs text-muted">Terapis: ${esc(r.therapist_name || '-')} ${r.progress_score ? `• Kemajuan ${esc(r.progress_score)}/10` : ''}</span>
            </div>
            <div class="text-sm mt-2"><strong>Keluhan:</strong> ${esc(r.chief_complaint)}</div>
            ${r.intervention ? `<div class="text-xs text-muted mt-2"><strong>Intervensi:</strong> ${esc(r.intervention)}</div>` : ''}
            ${r.homework ? `<div class="text-xs text-muted mt-2"><strong>PR / Tugas Rumah:</strong> ${esc(r.homework)}</div>` : ''}
            ${r.next_focus ? `<div class="text-xs text-muted mt-2"><strong>Fokus Berikutnya:</strong> ${esc(r.next_focus)}</div>` : ''}
          </div>
        `).join('');
      }
    }

    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => renderTab(btn.dataset.tab));
    });
    renderTab(activeTab);

    container.querySelector('#btn-back-clients')?.addEventListener('click', () => navigate('#/clients'));
    const editBtn = container.querySelector('#btn-edit-detail-cln');
    editBtn?.addEventListener('click', () => {
      openClientFormModal(c, actor, () => {
        storeInvalidate('clients');
        storeInvalidate('dashboard');
        renderClientDetailView(container, clientId, true);
      }, editBtn);
    });
    container.querySelector('#btn-quick-pkg')?.addEventListener('click', () => navigate(`#/packages?client_id=${clientId}&new_assign=1`));
    container.querySelector('#btn-quick-apt')?.addEventListener('click', () => navigate(`#/appointments?client_id=${clientId}&new=1`));
    container.querySelector('#btn-quick-asm')?.addEventListener('click', () => navigate(`#/assessments?client_id=${clientId}`));
    container.querySelector('#btn-quick-rme')?.addEventListener('click', () => navigate(`#/rme?client_id=${clientId}`));
  }

  if (cached && cached.data && !forceRefresh) {
    paintDetail(cached.data);
    if (storeIsFresh(detailKey, 25000)) return;
  } else {
    container.innerHTML = renderSkeletonTable(6);
  }

  try {
    const res = await apiCall('clients.detail', { client_id: clientId });
    const { changed } = storeSet(detailKey, res.data);
    if (!cached || forceRefresh || changed) {
      paintDetail(res.data);
    }
  } catch (err) {
    if (!cached) {
      container.innerHTML = `
        <div class="card empty-state">
          <p class="empty-state-title">Tidak dapat memuat Detail Klien</p>
          <p class="empty-state-desc">${esc(err.message)}</p>
          <button type="button" class="btn btn-primary" onclick="window.location.hash='#/clients'">Kembali ke Data Klien</button>
        </div>
      `;
    }
    toast(err.message, 'danger');
  }
}
