/**
 * pages/packages.js — Paket Terapi & Kuota Sesi Klien:
 * - Tab 1: Paket Aktif Klien (CPK00001, Sisa Sesi kontras jelas, Tanggal Mulai & Kedaluwarsa akurat)
 * - Tab 2: Master Paket Terapi (PKG00001, Tambah/Edit/Hapus paket)
 * - Pagination 10 data/halaman, default sort ID DESC, klik header tabel, SWR cache, & Optimistic Delete.
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  esc,
  formatRupiah,
  formatRupiahInput,
  parseRupiahInput,
  formatDateId,
  todayInputDate,
  statusBadge,
  renderSkeletonTable,
  renderPagination,
  sortableTh,
  bindSortableHeaders,
  mountClientAutocomplete,
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

function addDaysClientDate(yyyyMmDd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd || '').trim());
  if (!m) return '';
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.round(Number(days) || 0), 12, 0, 0));
  const pad = (n) => String(n).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export async function renderPackagesPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAdd = can('packages:add');
  const canEdit = can('packages:edit');
  const canDelete = can('packages:delete');

  let activeTab = (route && route.query && route.query.tab === 'master') ? 'master' : 'client';
  let therapistOptions = !isTherapist
    ? ((storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [])
    : [];

  const cpkState = { page: 1, limit: 10, q: '', status: '', sort: { field: 'client_package_code', dir: 'desc' } };
  const pkgState = { page: 1, limit: 10, q: '', status: '', sort: { field: 'package_code', dir: 'desc' } };
  let fetchSeq = 0;

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Paket Terapi &amp; Kuota Sesi Klien</h2>
          <p class="card-desc">Pantau sisa sesi paket klien secara akurat dan kelola katalog master paket terapi klinik.</p>
        </div>
        <div class="flex-gap">
          ${canAdd ? '<button type="button" class="btn btn-soft" id="btn-add-master-pkg">+ Tambah Master Paket</button>' : ''}
          ${canAdd ? '<button type="button" class="btn btn-primary" id="btn-assign-client-pkg">+ Daftarkan Paket Klien</button>' : ''}
        </div>
      </div>

      <div class="pill-tabs mb-3" role="tablist">
        <button type="button" class="pill-tab ${activeTab === 'client' ? 'is-active' : ''}" data-pkg-tab="client">Paket Aktif Klien</button>
        <button type="button" class="pill-tab ${activeTab === 'master' ? 'is-active' : ''}" data-pkg-tab="master">Master Paket Terapi</button>
      </div>

      <div id="pkg-client-pane" ${activeTab === 'client' ? '' : 'hidden'}>
        <div class="filter-bar">
          <input type="search" id="cpk-search" class="input" placeholder="Cari nama klien, kode CLICH, kode CPK, atau nama paket...">
          <select id="cpk-filter-status" class="select" aria-label="Filter status paket klien">
            <option value="">Semua Status</option>
            <option value="ACTIVE">Aktif</option>
            <option value="COMPLETED">Selesai (Habis)</option>
            <option value="EXPIRED">Kedaluwarsa</option>
            <option value="CANCELLED">Dibatalkan</option>
          </select>
        </div>
        <div id="cpk-list-wrap">${renderSkeletonTable(5)}</div>
        <div id="cpk-pagination"></div>
      </div>

      <div id="pkg-master-pane" ${activeTab === 'master' ? '' : 'hidden'}>
        <div class="filter-bar">
          <input type="search" id="pkg-search" class="input" placeholder="Cari kode PKG, nama paket, atau deskripsi...">
          <select id="pkg-filter-status" class="select" aria-label="Filter status master paket">
            <option value="">Semua Status</option>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">Nonaktif</option>
          </select>
        </div>
        <div id="pkg-list-wrap">${renderSkeletonTable(5)}</div>
        <div id="pkg-pagination"></div>
      </div>
    </section>
  `;

  const cpkPane = container.querySelector('#pkg-client-pane');
  const masterPane = container.querySelector('#pkg-master-pane');
  const cpkListWrap = container.querySelector('#cpk-list-wrap');
  const cpkPagWrap = container.querySelector('#cpk-pagination');
  const pkgListWrap = container.querySelector('#pkg-list-wrap');
  const pkgPagWrap = container.querySelector('#pkg-pagination');
  const btnAssign = container.querySelector('#btn-assign-client-pkg');
  const btnMaster = container.querySelector('#btn-add-master-pkg');

  if (!isTherapist && therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false }).then((opts) => { therapistOptions = opts; }).catch(() => {});
  }

  function switchTab(tab) {
    activeTab = tab;
    container.querySelectorAll('[data-pkg-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.pkgTab === tab));
    cpkPane.hidden = tab !== 'client';
    masterPane.hidden = tab !== 'master';
    if (tab === 'client') loadClientPackages();
    else loadMasterPackages();
  }

  container.querySelectorAll('[data-pkg-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.pkgTab));
  });

  // ==========================================================================
  // 1. Paket Aktif Klien
  // ==========================================================================

  async function loadClientPackages({ force = false, silent = false } = {}) {
    const mySeq = ++fetchSeq;
    const isDefaultCpk = cpkState.page === 1 && !cpkState.q && !cpkState.status &&
      cpkState.sort.field === 'client_package_code' && cpkState.sort.dir === 'desc';
    const key = isDefaultCpk
      ? 'packages:cpk:p1:default'
      : `packages:cpk:p${cpkState.page}:q=${cpkState.q}:s=${cpkState.status}:sf=${cpkState.sort.field}:${cpkState.sort.dir}`;
    const cached = storeGet(key);

    if (cached && Array.isArray(cached.data) && !force) {
      renderClientPackagesTable(cached.data);
      renderPagination(cpkPagWrap, cached.meta, (p) => { cpkState.page = p; loadClientPackages(); });
      if (storeIsFresh(key, 25000)) return;
    } else if (!silent) {
      cpkListWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('clientPackages.list', {
        page: cpkState.page,
        limit: cpkState.limit,
        q: cpkState.q,
        sort: cpkState.sort,
        filters: { status: cpkState.status || undefined }
      });
      if (mySeq !== fetchSeq) return;
      const items = (res.data && res.data.items) || [];
      const { changed } = storeSet(key, items, res.meta);
      if (!cached || force || changed) {
        renderClientPackagesTable(items);
        renderPagination(cpkPagWrap, res.meta, (p) => { cpkState.page = p; loadClientPackages(); });
      }
    } catch (err) {
      if (!cached) {
        cpkListWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat paket klien</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function renderClientPackagesTable(items) {
    if (items.length === 0) {
      cpkListWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada paket klien terdaftar</p>
          <p class="empty-state-desc">Klik "+ Daftarkan Paket Klien" untuk mulai mencatat kuota paket terapi klien.</p>
        </div>
      `;
      return;
    }

    cpkListWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID Paket', 'client_package_code', cpkState.sort)}
              <th>Klien</th>
              <th>Paket &amp; Terapis</th>
              <th>Keterangan Sisa Sesi</th>
              ${sortableTh('Mulai & Kedaluwarsa', 'start_date', cpkState.sort)}
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((cp) => `
              <tr data-row-id="${esc(cp.client_package_id)}">
                <td><span class="code-chip">${esc(cp.client_package_code)}</span></td>
                <td>
                  <button type="button" class="link-btn" data-open-cln="${esc(cp.client_id)}">${esc(cp.client_name || '-')}</button>
                  <div class="mt-2"><span class="code-chip">${esc(cp.client_code || '')}</span></div>
                </td>
                <td>
                  <div><strong>${esc(cp.package_name)}</strong></div>
                  <div class="text-xs text-muted">Terapis: ${esc(cp.therapist_name || '-')} • ${esc(formatRupiah(cp.price))}</div>
                </td>
                <td>
                  <span class="quota-chip ${Number(cp.remaining_sessions) <= 0 ? 'is-empty' : ''}">
                    Sisa ${esc(cp.remaining_sessions)} dari ${esc(cp.total_sessions)} Sesi
                  </span>
                  <div class="text-xs text-muted mt-2">Terpakai: <strong>${esc(cp.used_sessions)}</strong> sesi</div>
                </td>
                <td class="text-xs font-mono">
                  <div>Mulai: <strong>${esc(formatDateId(cp.start_date))}</strong></div>
                  <div class="mt-2">Kadaluwarsa: <strong>${esc(formatDateId(cp.expiry_date))}</strong></div>
                </td>
                <td>${statusBadge('client_package', cp.status)}</td>
                <td>
                  <div class="table-actions">
                    ${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-cpk="${esc(cp.client_package_id)}">Edit</button>` : ''}
                    ${canDelete ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-cpk="${esc(cp.client_package_id)}">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    bindSortableHeaders(cpkListWrap, cpkState.sort, () => {
      cpkState.page = 1;
      loadClientPackages();
    });

    const byId = Object.fromEntries(items.map((x) => [x.client_package_id, x]));
    cpkListWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    cpkListWrap.querySelectorAll('[data-edit-cpk]').forEach((b) => b.addEventListener('click', () => openClientPackageModal(byId[b.dataset.editCpk], null, b)));
    cpkListWrap.querySelectorAll('[data-del-cpk]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delCpk];
        if (!rec) return;
        const ok = await confirmDialog({
          title: 'Hapus Paket Klien',
          message: `Hapus paket "${rec.package_name}" (${rec.client_package_code}) milik ${rec.client_name}?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = b.closest('tr');
        setButtonLoading(b, true, 'Menghapus...');
        markRowDeleting(rowEl, true);
        const delReq = apiCall('clientPackages.delete', { client_package_id: rec.client_package_id, expected_version: rec.version }, { write: true });
        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();
        storeUpdateListItems('packages:cpk', (arr) => arr.filter((i) => i.client_package_id !== rec.client_package_id));

        try {
          await delReq;
          storeInvalidate('packages');
          storeInvalidate('clients');
          toast('Paket klien berhasil dihapus.', 'success');
          loadClientPackages({ force: true, silent: true });
        } catch (err) {
          storeInvalidate('packages');
          toast(err.message, 'danger');
          loadClientPackages({ force: true, silent: true });
        }
      });
    });
  }

  async function openClientPackageModal(existing = null, prefillClient = null, triggerBtn = null) {
    const isEdit = Boolean(existing);
    let masterOptions = [];
    if (triggerBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
    try {
      const [mRes, tOpts] = await Promise.all([
        apiCall('packages.options', {}),
        !isTherapist && therapistOptions.length === 0 ? getTherapistsOptionsCached({ activeOnly: false }) : Promise.resolve(therapistOptions)
      ]);
      masterOptions = (mRes.data && mRes.data.items) || [];
      therapistOptions = tOpts || [];
    } catch (_) {
      masterOptions = [];
    } finally {
      if (triggerBtn) setButtonLoading(triggerBtn, false);
    }

    const defaultStart = isEdit ? existing.start_date : todayInputDate();
    const defaultExpiry = isEdit ? existing.expiry_date : addDaysClientDate(defaultStart, 90);

    const modal = openModal({
      title: isEdit ? `Edit Paket Klien — ${existing.client_package_code}` : 'Daftarkan Paket Terapi ke Klien',
      size: 'lg',
      bodyHtml: `
        ${isEdit ? `
          <div class="context-item flex-between mb-3 text-sm">
            <div><strong>ID Paket:</strong> <span class="code-chip">${esc(existing.client_package_code)}</span></div>
            <div><strong>Klien:</strong> ${esc(existing.client_name)} <span class="code-chip">${esc(existing.client_code)}</span></div>
          </div>
        ` : ''}
        <form id="cpk-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field field-span-full">
              <label>Klien <span class="req-star">*</span></label>
              <div id="cpk-client-ac"></div>
            </div>
            ${!isEdit ? `
              <div class="field field-span-full">
                <label for="cpk-master">Pilih dari Master Paket (Opsional — isi otomatis)</label>
                <select id="cpk-master" name="package_id" class="select">
                  <option value="">-- Paket Kustom / Isi Manual --</option>
                  ${masterOptions.map((m) => `
                    <option value="${esc(m.package_id)}"
                      data-name="${esc(m.package_name)}"
                      data-sessions="${esc(m.total_sessions)}"
                      data-days="${esc(m.validity_days)}"
                      data-price="${esc(m.price)}">
                      ${esc(m.package_code)} — ${esc(m.package_name)} (${esc(m.total_sessions)} Sesi • ${esc(m.validity_days)} Hari • ${esc(formatRupiah(m.price))})
                    </option>
                  `).join('')}
                </select>
              </div>
            ` : ''}
            <div class="field">
              <label for="cpk-name">Nama Paket <span class="req-star">*</span></label>
              <input id="cpk-name" name="package_name" class="input" type="text" value="${esc(isEdit ? existing.package_name : '')}" placeholder="mis. Paket Intensif 4 Sesi" required>
            </div>
            ${!isTherapist ? `
              <div class="field">
                <label for="cpk-trp">Terapis Penanggung Jawab</label>
                <select id="cpk-trp" name="therapist_id" class="select">
                  <option value="">-- Pilih Terapis --</option>
                  ${therapistOptions.map((t) => `
                    <option value="${esc(t.therapist_id)}" ${(isEdit && existing.therapist_id === t.therapist_id) || (prefillClient && prefillClient.primary_therapist_id === t.therapist_id) ? 'selected' : ''}>
                      ${esc(t.full_name)} (${esc(t.code)})
                    </option>
                  `).join('')}
                </select>
              </div>
            ` : ''}
            <div class="field">
              <label for="cpk-total">Total Sesi Paket <span class="req-star">*</span></label>
              <input id="cpk-total" name="total_sessions" class="input" type="number" min="1" max="200" value="${esc(isEdit ? existing.total_sessions : 4)}" required>
            </div>
            <div class="field">
              <label for="cpk-used">Sesi Sudah Terpakai</label>
              <input id="cpk-used" name="used_sessions" class="input" type="number" min="0" max="200" value="${esc(isEdit ? existing.used_sessions : 0)}">
              <span class="field-hint" id="cpk-remain-preview" style="color:var(--color-text);font-weight:700;"></span>
            </div>
            <div class="field">
              <label for="cpk-start">Tanggal Mulai <span class="req-star">*</span></label>
              <input id="cpk-start" name="start_date" class="input" type="date" value="${esc(defaultStart)}" required>
            </div>
            <div class="field">
              <label for="cpk-expiry">Tanggal Kedaluwarsa <span class="req-star">*</span></label>
              <input id="cpk-expiry" name="expiry_date" class="input" type="date" value="${esc(defaultExpiry)}" required>
            </div>
            <div class="field">
              <label for="cpk-price">Harga Paket (Rp)</label>
              <div class="input-currency-wrap">
                <span class="input-currency-prefix" aria-hidden="true">Rp</span>
                <input id="cpk-price" name="price" class="input" type="text" inputmode="numeric" autocomplete="off"
                  data-rupiah-input value="${esc(formatRupiahInput(isEdit ? existing.price : 0))}" placeholder="0">
              </div>
            </div>
            ${isEdit ? `
              <div class="field">
                <label for="cpk-status">Status Paket</label>
                <select id="cpk-status" name="status" class="select">
                  <option value="ACTIVE" ${existing.status === 'ACTIVE' ? 'selected' : ''}>Aktif</option>
                  <option value="COMPLETED" ${existing.status === 'COMPLETED' ? 'selected' : ''}>Selesai (Habis)</option>
                  <option value="EXPIRED" ${existing.status === 'EXPIRED' ? 'selected' : ''}>Kedaluwarsa</option>
                  <option value="CANCELLED" ${existing.status === 'CANCELLED' ? 'selected' : ''}>Dibatalkan</option>
                </select>
              </div>
            ` : ''}
            <div class="field field-span-full">
              <label for="cpk-notes">Catatan Paket</label>
              <textarea id="cpk-notes" name="notes" class="textarea" rows="2">${esc(isEdit ? existing.notes : '')}</textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="cpk-form" class="btn btn-primary" id="btn-save-cpk">${isEdit ? 'Simpan Perubahan' : 'Simpan Paket Klien'}</button>
      `
    });

    const form = modal.querySelector('#cpk-form');
    const saveBtn = modal.querySelector('#btn-save-cpk');
    const masterSel = modal.querySelector('#cpk-master');
    const totalInput = modal.querySelector('#cpk-total');
    const usedInput = modal.querySelector('#cpk-used');
    const startInput = modal.querySelector('#cpk-start');
    const expiryInput = modal.querySelector('#cpk-expiry');
    const remainPreview = modal.querySelector('#cpk-remain-preview');
    let activeValidityDays = 90;

    function updateRemainPreview() {
      const tot = Math.max(Number(totalInput.value || 0), 0);
      const usd = Math.max(Number(usedInput.value || 0), 0);
      const rem = Math.max(0, tot - usd);
      remainPreview.textContent = `Sisa Sesi Aktif: ${rem} dari ${tot} Sesi`;
    }
    updateRemainPreview();
    totalInput.addEventListener('input', updateRemainPreview);
    usedInput.addEventListener('input', updateRemainPreview);

    masterSel?.addEventListener('change', () => {
      const opt = masterSel.selectedOptions[0];
      if (!opt || !opt.value) return;
      form.package_name.value = opt.dataset.name || '';
      totalInput.value = opt.dataset.sessions || 4;
      form.price.value = formatRupiahInput(opt.dataset.price || 0);
      activeValidityDays = Number(opt.dataset.days || 90);
      if (startInput.value) {
        expiryInput.value = addDaysClientDate(startInput.value, activeValidityDays);
      }
      updateRemainPreview();
    });

    startInput.addEventListener('change', () => {
      if (!isEdit && startInput.value) {
        expiryInput.value = addDaysClientDate(startInput.value, activeValidityDays);
      }
    });

    const ac = mountClientAutocomplete(modal.querySelector('#cpk-client-ac'), {
      inputName: 'client_id',
      initialClient: isEdit
        ? { client_id: existing.client_id, full_name: existing.client_name, client_code: existing.client_code }
        : prefillClient,
      onSelect: (c) => {
        if (!isTherapist && form.therapist_id && !form.therapist_id.value && c.primary_therapist_id) {
          form.therapist_id.value = c.primary_therapist_id;
        }
      }
    });
    if (isEdit) {
      const acInput = modal.querySelector('[data-ac-input]');
      if (acInput) acInput.disabled = true;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      const clientId = ac.getValue();
      if (!clientId) {
        toast('Silakan pilih klien terlebih dahulu.', 'warning');
        return;
      }

      setButtonLoading(saveBtn, true, 'Menyimpan...');
      const payload = {
        client_id: clientId,
        package_id: form.package_id ? form.package_id.value : '',
        package_name: form.package_name.value.trim(),
        therapist_id: form.therapist_id ? form.therapist_id.value : '',
        total_sessions: Number(totalInput.value || 1),
        used_sessions: Number(usedInput.value || 0),
        price: parseRupiahInput(form.price.value),
        start_date: startInput.value,
        expiry_date: expiryInput.value,
        notes: form.notes.value.trim()
      };
      if (isEdit && form.status) payload.status = form.status.value;

      try {
        if (isEdit) {
          payload.client_package_id = existing.client_package_id;
          payload.expected_version = existing.version;
          await apiCall('clientPackages.update', payload, { write: true });
          toast('Paket klien berhasil diperbarui.', 'success');
        } else {
          await apiCall('clientPackages.create', payload, { write: true });
          toast('Paket klien baru berhasil didaftarkan.', 'success');
        }
        closeModal();
        storeInvalidate('packages');
        storeInvalidate('clients');
        switchTab('client');
        loadClientPackages({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  // ==========================================================================
  // 2. Master Paket Terapi
  // ==========================================================================

  async function loadMasterPackages({ force = false, silent = false } = {}) {
    const mySeq = ++fetchSeq;
    const isDefaultPkg = pkgState.page === 1 && !pkgState.q && !pkgState.status &&
      pkgState.sort.field === 'package_code' && pkgState.sort.dir === 'desc';
    const key = isDefaultPkg
      ? 'packages:master:p1:default'
      : `packages:master:p${pkgState.page}:q=${pkgState.q}:s=${pkgState.status}:sf=${pkgState.sort.field}:${pkgState.sort.dir}`;
    const cached = storeGet(key);

    if (cached && Array.isArray(cached.data) && !force) {
      renderMasterPackagesTable(cached.data);
      renderPagination(pkgPagWrap, cached.meta, (p) => { pkgState.page = p; loadMasterPackages(); });
      if (storeIsFresh(key, 30000)) return;
    } else if (!silent) {
      pkgListWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('packages.list', {
        page: pkgState.page,
        limit: pkgState.limit,
        q: pkgState.q,
        sort: pkgState.sort,
        filters: { status: pkgState.status || undefined }
      });
      if (mySeq !== fetchSeq) return;
      const items = (res.data && res.data.items) || [];
      const { changed } = storeSet(key, items, res.meta);
      if (!cached || force || changed) {
        renderMasterPackagesTable(items);
        renderPagination(pkgPagWrap, res.meta, (p) => { pkgState.page = p; loadMasterPackages(); });
      }
    } catch (err) {
      if (!cached) {
        pkgListWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat master paket</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function renderMasterPackagesTable(items) {
    if (items.length === 0) {
      pkgListWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada master paket terapi</p>
          <p class="empty-state-desc">Klik "+ Tambah Master Paket" untuk membuat template paket sesi klinik.</p>
        </div>
      `;
      return;
    }

    pkgListWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('Kode Paket', 'package_code', pkgState.sort)}
              <th>Nama Paket</th>
              <th>Jumlah Sesi</th>
              <th>Masa Berlaku</th>
              <th>Harga</th>
              <th>Layanan</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((p) => `
              <tr data-row-id="${esc(p.package_id)}">
                <td><span class="code-chip">${esc(p.package_code)}</span></td>
                <td>
                  <div><strong>${esc(p.package_name)}</strong></div>
                  ${p.description ? `<div class="text-xs text-muted">${esc(p.description)}</div>` : ''}
                </td>
                <td><span class="session-chip">${esc(p.total_sessions)} Sesi</span></td>
                <td class="text-sm">${esc(p.validity_days)} Hari</td>
                <td class="font-mono"><strong>${esc(formatRupiah(p.price))}</strong></td>
                <td>${statusBadge('mode', p.service_mode)}</td>
                <td>${statusBadge('package', p.status)}</td>
                <td>
                  <div class="table-actions">
                    ${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-pkg="${esc(p.package_id)}">Edit</button>` : ''}
                    ${canDelete ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-pkg="${esc(p.package_id)}">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    bindSortableHeaders(pkgListWrap, pkgState.sort, () => {
      pkgState.page = 1;
      loadMasterPackages();
    });

    const byId = Object.fromEntries(items.map((x) => [x.package_id, x]));
    pkgListWrap.querySelectorAll('[data-edit-pkg]').forEach((b) => b.addEventListener('click', () => openMasterPackageModal(byId[b.dataset.editPkg])));
    pkgListWrap.querySelectorAll('[data-del-pkg]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delPkg];
        if (!rec) return;
        const ok = await confirmDialog({
          title: 'Hapus Master Paket',
          message: `Hapus master paket "${rec.package_name}" (${rec.package_code})?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = b.closest('tr');
        setButtonLoading(b, true, 'Menghapus...');
        markRowDeleting(rowEl, true);
        const delReq = apiCall('packages.delete', { package_id: rec.package_id, expected_version: rec.version }, { write: true });
        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();
        storeUpdateListItems('packages:master', (arr) => arr.filter((i) => i.package_id !== rec.package_id));

        try {
          await delReq;
          storeInvalidate('packages');
          toast('Master paket dihapus.', 'success');
          loadMasterPackages({ force: true, silent: true });
        } catch (err) {
          storeInvalidate('packages');
          toast(err.message, 'danger');
          loadMasterPackages({ force: true, silent: true });
        }
      });
    });
  }

  function openMasterPackageModal(existing = null) {
    const isEdit = Boolean(existing);
    const modal = openModal({
      title: isEdit ? `Edit Master Paket — ${existing.package_code}` : 'Tambah Master Paket Terapi Baru',
      size: 'md',
      bodyHtml: `
        <form id="master-pkg-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field field-span-full">
              <label for="mp-name">Nama Paket Terapi <span class="req-star">*</span></label>
              <input id="mp-name" name="package_name" class="input" type="text" value="${esc(isEdit ? existing.package_name : '')}" placeholder="mis. Paket Hipnoterapi 4 Sesi" required>
            </div>
            <div class="field">
              <label for="mp-sessions">Jumlah Sesi <span class="req-star">*</span></label>
              <input id="mp-sessions" name="total_sessions" class="input" type="number" min="1" max="200" value="${esc(isEdit ? existing.total_sessions : 4)}" required>
            </div>
            <div class="field">
              <label for="mp-days">Masa Berlaku (Hari) <span class="req-star">*</span></label>
              <input id="mp-days" name="validity_days" class="input" type="number" min="1" max="3650" value="${esc(isEdit ? existing.validity_days : 90)}" required>
            </div>
            <div class="field">
              <label for="mp-price">Harga Paket (Rp) <span class="req-star">*</span></label>
              <div class="input-currency-wrap">
                <span class="input-currency-prefix" aria-hidden="true">Rp</span>
                <input id="mp-price" name="price" class="input" type="text" inputmode="numeric" autocomplete="off"
                  data-rupiah-input value="${esc(formatRupiahInput(isEdit ? existing.price : 1500000))}" placeholder="1.500.000" required>
              </div>
            </div>
            <div class="field">
              <label for="mp-mode">Mode Layanan</label>
              <select id="mp-mode" name="service_mode" class="select">
                <option value="BOTH" ${(!isEdit || existing.service_mode === 'BOTH') ? 'selected' : ''}>Online &amp; Offline</option>
                <option value="OFFLINE" ${isEdit && existing.service_mode === 'OFFLINE' ? 'selected' : ''}>Offline</option>
                <option value="ONLINE" ${isEdit && existing.service_mode === 'ONLINE' ? 'selected' : ''}>Online</option>
              </select>
            </div>
            <div class="field">
              <label for="mp-status">Status</label>
              <select id="mp-status" name="status" class="select">
                <option value="ACTIVE" ${(!isEdit || existing.status === 'ACTIVE') ? 'selected' : ''}>Aktif</option>
                <option value="INACTIVE" ${isEdit && existing.status === 'INACTIVE' ? 'selected' : ''}>Nonaktif</option>
              </select>
            </div>
            <div class="field field-span-full">
              <label for="mp-desc">Deskripsi / Ketentuan Paket</label>
              <textarea id="mp-desc" name="description" class="textarea" rows="2">${esc(isEdit ? existing.description : '')}</textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="master-pkg-form" class="btn btn-primary" id="btn-save-mp">${isEdit ? 'Simpan Perubahan' : 'Tambah Master Paket'}</button>
      `
    });

    const form = modal.querySelector('#master-pkg-form');
    const saveBtn = modal.querySelector('#btn-save-mp');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');

      const payload = {
        package_name: form.package_name.value.trim(),
        total_sessions: Number(form.total_sessions.value || 1),
        validity_days: Number(form.validity_days.value || 90),
        price: parseRupiahInput(form.price.value),
        service_mode: form.service_mode.value,
        status: form.status.value,
        description: form.description.value.trim()
      };

      try {
        if (isEdit) {
          payload.package_id = existing.package_id;
          payload.expected_version = existing.version;
          await apiCall('packages.update', payload, { write: true });
          toast('Master paket berhasil diperbarui.', 'success');
        } else {
          await apiCall('packages.create', payload, { write: true });
          toast('Master paket baru berhasil ditambahkan.', 'success');
        }
        closeModal();
        storeInvalidate('packages');
        switchTab('master');
        loadMasterPackages({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  btnAssign?.addEventListener('click', () => openClientPackageModal(null, null, btnAssign));
  btnMaster?.addEventListener('click', () => openMasterPackageModal(null));

  let debounceCpk = null;
  container.querySelector('#cpk-search').addEventListener('input', (e) => {
    clearTimeout(debounceCpk);
    debounceCpk = setTimeout(() => { cpkState.q = e.target.value.trim(); cpkState.page = 1; loadClientPackages(); }, 250);
  });
  container.querySelector('#cpk-filter-status').addEventListener('change', (e) => {
    cpkState.status = e.target.value;
    cpkState.page = 1;
    loadClientPackages();
  });

  let debouncePkg = null;
  container.querySelector('#pkg-search').addEventListener('input', (e) => {
    clearTimeout(debouncePkg);
    debouncePkg = setTimeout(() => { pkgState.q = e.target.value.trim(); pkgState.page = 1; loadMasterPackages(); }, 250);
  });
  container.querySelector('#pkg-filter-status').addEventListener('change', (e) => {
    pkgState.status = e.target.value;
    pkgState.page = 1;
    loadMasterPackages();
  });

  if (activeTab === 'master') {
    await loadMasterPackages({ force: Boolean(route && route.forceRefresh) });
  } else {
    await loadClientPackages({ force: Boolean(route && route.forceRefresh) });
  }

  if (route && route.query && route.query.new_assign === '1' && canAdd) {
    let prefill = null;
    if (route.query.client_id) {
      try {
        const cRes = await apiCall('clients.get', { client_id: route.query.client_id });
        prefill = cRes.data && cRes.data.client;
      } catch (_) {}
    }
    openClientPackageModal(null, prefill, btnAssign);
  }
}
