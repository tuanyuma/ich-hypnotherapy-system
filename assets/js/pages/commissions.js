/**
 * pages/commissions.js — Komisi / Bagi Hasil Terapis (COMMISSIONS):
 * - 3 Kartu Ringkasan (Belum Dibayar, Sudah Dibayar, Total Komisi)
 * - Pagination 10 data/halaman, default sort COM00001 DESC, klik header tabel
 * - Aksi "Tandai Cair" (opsional catat otomatis ke Pengeluaran Kas).
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import {
  esc,
  formatRupiah,
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
  getTherapistsOptionsCached
} from '../store.js';
import { animateRowRemove } from '../motion.js';

export async function renderCommissionsPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAdd = can('commissions:add');
  const canEdit = can('commissions:edit');
  const canDelete = can('commissions:delete');

  let therapistOptions = !isTherapist
    ? ((storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [])
    : [];

  const state = {
    page: 1,
    limit: 10,
    q: '',
    therapist_id: '',
    status: '',
    date_from: '',
    date_to: '',
    sort: { field: 'commission_code', dir: 'desc' }
  };
  let fetchSeq = 0;

  container.innerHTML = `
    <div class="kpi-grid mb-3" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));">
      <article class="kpi-card">
        <div class="kpi-label">Komisi Belum Dibayar</div>
        <div class="kpi-value" id="com-sum-unpaid" style="color:var(--color-warning);">Rp 0</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Komisi Sudah Dibayar</div>
        <div class="kpi-value" id="com-sum-paid" style="color:var(--color-success);">Rp 0</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Total Akumulasi Komisi</div>
        <div class="kpi-value" id="com-sum-all">Rp 0</div>
      </article>
    </div>

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Daftar Komisi / Bagi Hasil Terapis</h2>
          <p class="card-desc">Komisi tercatat otomatis dari pembayaran layanan Lunas atau dapat ditambahkan manual.</p>
        </div>
        ${canAdd ? '<button type="button" class="btn btn-primary" id="btn-add-comm">+ Catat Komisi Manual</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="com-search" class="input" placeholder="Cari ID COM, nama terapis, nama klien, atau catatan...">
        ${!isTherapist ? `
          <select id="com-filter-trp" class="select" aria-label="Filter terapis">
            <option value="">Semua Terapis</option>
            ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('')}
          </select>
        ` : ''}
        <select id="com-filter-status" class="select" aria-label="Filter status komisi">
          <option value="">Semua Status</option>
          <option value="UNPAID">Belum Dibayar</option>
          <option value="PAID">Sudah Dibayar</option>
          <option value="VOID">Batal / Void</option>
        </select>
        <input type="date" id="com-filter-from" class="input" aria-label="Dari tanggal" title="Dari tanggal">
        <input type="date" id="com-filter-to" class="input" aria-label="Sampai tanggal" title="Sampai tanggal">
      </div>

      <div id="com-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="com-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#com-list-wrap');
  const pagWrap = container.querySelector('#com-pagination');
  const unpaidEl = container.querySelector('#com-sum-unpaid');
  const paidEl = container.querySelector('#com-sum-paid');
  const allEl = container.querySelector('#com-sum-all');
  const addBtn = container.querySelector('#btn-add-comm');

  if (!isTherapist && therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false }).then((opts) => {
      therapistOptions = opts;
      const sel = container.querySelector('#com-filter-trp');
      if (sel) {
        const prev = sel.value;
        sel.innerHTML = '<option value="">Semua Terapis</option>' + opts.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('');
        sel.value = prev;
      }
    }).catch(() => {});
  }

  function paintSummary(sum) {
    if (!sum) return;
    unpaidEl.textContent = formatRupiah(sum.total_unpaid || 0);
    paidEl.textContent = formatRupiah(sum.total_paid || 0);
    allEl.textContent = formatRupiah(sum.total_all || 0);
  }

  async function loadCommissions({ force = false, silent = false } = {}) {
    const mySeq = ++fetchSeq;
    const key = `commissions:list:p${state.page}:q=${state.q}:t=${state.therapist_id}:s=${state.status}:f=${state.date_from}:to=${state.date_to}:sf=${state.sort.field}:${state.sort.dir}`;
    const cached = storeGet(key);

    if (cached && cached.data && !force) {
      paintSummary(cached.data.summary);
      renderTable(cached.data.items || []);
      renderPagination(pagWrap, cached.meta, (p) => { state.page = p; loadCommissions(); });
      if (storeIsFresh(key, 25000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('commissions.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        sort: state.sort,
        filters: {
          therapist_id: state.therapist_id || undefined,
          status: state.status || undefined,
          date_from: state.date_from || undefined,
          date_to: state.date_to || undefined
        }
      });
      if (mySeq !== fetchSeq) return;
      const payloadData = { items: (res.data && res.data.items) || [], summary: res.data && res.data.summary };
      const { changed } = storeSet(key, payloadData, res.meta);
      if (!cached || force || changed) {
        paintSummary(payloadData.summary);
        renderTable(payloadData.items);
        renderPagination(pagWrap, res.meta, (p) => { state.page = p; loadCommissions(); });
      }
    } catch (err) {
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat data komisi</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada data komisi sesuai filter</p></div>';
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID Komisi', 'commission_code', state.sort)}
              ${sortableTh('Tanggal', 'earned_date', state.sort)}
              <th>Terapis</th>
              <th>Klien &amp; Catatan</th>
              <th>Dasar &amp; Skema</th>
              <th>Nominal Komisi</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((c) => `
              <tr data-row-id="${esc(c.commission_id)}">
                <td><span class="code-chip">${esc(c.commission_code)}</span></td>
                <td class="font-mono text-sm">
                  <div><strong>${esc(formatDateId(c.earned_date))}</strong></div>
                  ${c.paid_date ? `<div class="text-xs text-muted">Cair: ${esc(formatDateId(c.paid_date))}</div>` : ''}
                </td>
                <td>
                  <div><strong>${esc(c.therapist_name || '-')}</strong></div>
                  ${c.therapist_code ? `<div class="mt-2"><span class="code-chip">${esc(c.therapist_code)}</span></div>` : ''}
                </td>
                <td class="text-sm">
                  ${c.client_name ? `<div>${esc(c.client_name)} <span class="code-chip">${esc(c.client_code)}</span></div>` : ''}
                  ${c.notes ? `<div class="text-xs text-muted mt-2">${esc(c.notes)}</div>` : ''}
                </td>
                <td class="text-xs font-mono">
                  <div>Dasar: ${esc(formatRupiah(c.base_amount))}</div>
                  <div class="text-muted">${c.commission_type === 'FIXED' ? 'Tetap' : `${esc(c.commission_rate)}%`}</div>
                </td>
                <td class="font-mono"><strong>${esc(formatRupiah(c.commission_amount))}</strong></td>
                <td>${statusBadge('commission', c.status)}</td>
                <td>
                  <div class="table-actions">
                    ${canEdit && c.status === 'UNPAID' ? `<button type="button" class="btn btn-soft btn-sm" data-pay-comm="${esc(c.commission_id)}">Tandai Cair</button>` : ''}
                    ${canDelete ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-comm="${esc(c.commission_id)}">Hapus</button>` : ''}
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
      loadCommissions();
    });

    const byId = Object.fromEntries(items.map((x) => [x.commission_id, x]));
    listWrap.querySelectorAll('[data-pay-comm]').forEach((b) => b.addEventListener('click', () => openMarkPaidModal(byId[b.dataset.payComm])));
    listWrap.querySelectorAll('[data-del-comm]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delComm];
        if (!rec) return;
        const ok = await confirmDialog({
          title: 'Hapus Catatan Komisi',
          message: `Hapus komisi ${rec.commission_code} milik ${rec.therapist_name} (${formatRupiah(rec.commission_amount)})?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = b.closest('tr');
        setButtonLoading(b, true, 'Menghapus...');
        markRowDeleting(rowEl, true);
        const delReq = apiCall('commissions.delete', { commission_id: rec.commission_id, expected_version: rec.version }, { write: true });
        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();

        try {
          await delReq;
          storeInvalidate('commissions');
          storeInvalidate('reports');
          toast('Komisi berhasil dihapus.', 'success');
          loadCommissions({ force: true, silent: true });
        } catch (err) {
          storeInvalidate('commissions');
          toast(err.message, 'danger');
          loadCommissions({ force: true, silent: true });
        }
      });
    });
  }

  function openMarkPaidModal(rec) {
    const modal = openModal({
      title: `Cairkan Komisi — ${rec.commission_code}`,
      size: 'md',
      bodyHtml: `
        <div class="context-item mb-3 text-sm">
          <div><strong>Terapis:</strong> ${esc(rec.therapist_name)}</div>
          <div class="mt-2"><strong>Nominal Bagi Hasil:</strong> <span class="font-mono">${esc(formatRupiah(rec.commission_amount))}</span></div>
        </div>
        <form id="mark-paid-form" novalidate>
          <div class="field">
            <label for="mp-paid-date">Tanggal Pencairan <span class="req-star">*</span></label>
            <input id="mp-paid-date" name="paid_date" class="input" type="date" value="${esc(todayInputDate())}" required>
          </div>
          <div class="field">
            <label class="perm-check">
              <input type="checkbox" id="mp-record-expense" checked>
              <span>Catat otomatis sebagai Pengeluaran di menu Pembayaran &amp; Kas</span>
            </label>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="mark-paid-form" class="btn btn-primary" id="btn-confirm-paid">Konfirmasi Cair</button>
      `
    });

    const form = modal.querySelector('#mark-paid-form');
    const btn = modal.querySelector('#btn-confirm-paid');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setButtonLoading(btn, true, 'Memproses...');
      try {
        await apiCall('commissions.markPaid', {
          commission_id: rec.commission_id,
          expected_version: rec.version,
          paid_date: form.paid_date.value,
          record_expense: modal.querySelector('#mp-record-expense').checked
        }, { write: true });
        closeModal();
        storeInvalidate('commissions');
        storeInvalidate('payments');
        storeInvalidate('reports');
        toast(`Komisi ${rec.commission_code} ditandai Sudah Dibayar.`, 'success');
        loadCommissions({ force: true, silent: true });
      } catch (err) {
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(btn, false);
      }
    });
  }

  async function openCreateCommissionModal(triggerBtn) {
    if (therapistOptions.length === 0) {
      if (triggerBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
      try {
        therapistOptions = await getTherapistsOptionsCached({ activeOnly: false });
      } catch (_) {} finally {
        if (triggerBtn) setButtonLoading(triggerBtn, false);
      }
    }

    const modal = openModal({
      title: 'Catat Komisi / Bagi Hasil Manual',
      size: 'md',
      bodyHtml: `
        <form id="comm-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field field-span-full">
              <label for="cm-trp">Terapis <span class="req-star">*</span></label>
              <select id="cm-trp" name="therapist_id" class="select" required>
                <option value="">-- Pilih Terapis --</option>
                ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)} (${esc(t.code)})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="cm-date">Tanggal Komisi <span class="req-star">*</span></label>
              <input id="cm-date" name="earned_date" class="input" type="date" value="${esc(todayInputDate())}" required>
            </div>
            <div class="field">
              <label for="cm-base">Nominal Dasar Layanan (Rp)</label>
              <input id="cm-base" name="base_amount" class="input" type="number" min="0" step="1000" value="500000">
            </div>
            <div class="field field-span-full">
              <label for="cm-amt">Nominal Komisi Diterima Terapis (Rp) <span class="req-star">*</span></label>
              <input id="cm-amt" name="commission_amount" class="input" type="number" min="1" step="1000" placeholder="Kosongkan untuk hitung otomatis sesuai skema terapis">
            </div>
            <div class="field field-span-full">
              <label>Klien Terkait (Opsional)</label>
              <div id="cm-client-ac"></div>
            </div>
            <div class="field field-span-full">
              <label for="cm-notes">Catatan</label>
              <textarea id="cm-notes" name="notes" class="textarea" rows="2"></textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="comm-form" class="btn btn-primary" id="btn-save-comm">Simpan Komisi</button>
      `
    });

    const form = modal.querySelector('#comm-form');
    const saveBtn = modal.querySelector('#btn-save-comm');
    const ac = mountClientAutocomplete(modal.querySelector('#cm-client-ac'), { inputName: 'client_id' });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');
      try {
        await apiCall('commissions.create', {
          therapist_id: form.therapist_id.value,
          earned_date: form.earned_date.value,
          base_amount: Number(form.base_amount.value || 0),
          commission_amount: form.commission_amount.value ? Number(form.commission_amount.value) : '',
          client_id: ac.getValue(),
          notes: form.notes.value.trim()
        }, { write: true });
        closeModal();
        storeInvalidate('commissions');
        storeInvalidate('reports');
        toast('Komisi manual berhasil dicatat.', 'success');
        loadCommissions({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  addBtn?.addEventListener('click', () => openCreateCommissionModal(addBtn));

  let debounce = null;
  container.querySelector('#com-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadCommissions(); }, 250);
  });
  container.querySelector('#com-filter-trp')?.addEventListener('change', (e) => { state.therapist_id = e.target.value; state.page = 1; loadCommissions(); });
  container.querySelector('#com-filter-status').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; loadCommissions(); });
  container.querySelector('#com-filter-from').addEventListener('change', (e) => { state.date_from = e.target.value; state.page = 1; loadCommissions(); });
  container.querySelector('#com-filter-to').addEventListener('change', (e) => { state.date_to = e.target.value; state.page = 1; loadCommissions(); });

  await loadCommissions({ force: Boolean(route && route.forceRefresh) });
}
