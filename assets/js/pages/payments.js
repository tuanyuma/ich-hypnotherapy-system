/**
 * pages/payments.js — Pembayaran & Kas (PAYMENTS):
 * - 3 Kartu Ringkasan Kas (Pemasukan, Pengeluaran, Saldo Kas Bersih)
 * - Pagination 10 data/halaman, default sort PAY00001 DESC, klik header tabel (ID & Tanggal)
 * - Auto-hitung komisi terapis saat mencatat pembayaran sesi/paket LUNAS.
 */

import { apiCall } from '../api.js';
import { can } from '../auth.js';
import { navigate } from '../router.js';
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
  storeUpdateListItems,
  getTherapistsOptionsCached
} from '../store.js';
import { animateRowRemove } from '../motion.js';

const CATEGORY_LABELS = {
  SESI_TERAPI: 'Sesi Terapi',
  PAKET_TERAPI: 'Paket Terapi',
  ASSESSMENT: 'Assessment Awal',
  KOMISI_TERAPIS: 'Pencairan Komisi Terapis',
  OPERASIONAL: 'Operasional Klinik',
  LAINNYA: 'Lainnya'
};

export async function renderPaymentsPage(container, route) {
  const canAdd = can('payments:add');
  const canEdit = can('payments:edit');
  const canDelete = can('payments:delete');

  let therapistOptions = (storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [];
  const state = {
    page: 1,
    limit: 10,
    q: '',
    payment_type: '',
    category: '',
    status: '',
    date_from: '',
    date_to: '',
    sort: { field: 'payment_code', dir: 'desc' }
  };
  let fetchSeq = 0;

  container.innerHTML = `
    <div class="kpi-grid mb-3" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));">
      <article class="kpi-card">
        <div class="kpi-label">Total Pemasukan (Filter)</div>
        <div class="kpi-value" id="pay-sum-in" style="color:var(--color-success);">Rp 0</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Total Pengeluaran (Filter)</div>
        <div class="kpi-value" id="pay-sum-out" style="color:var(--color-danger);">Rp 0</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Saldo Kas Bersih</div>
        <div class="kpi-value" id="pay-sum-net">Rp 0</div>
      </article>
    </div>

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Buku Pembayaran &amp; Kas</h2>
          <p class="card-desc">Seluruh transaksi pemasukan sesi/paket dan pengeluaran klinik (maks. 10 data/halaman).</p>
        </div>
        ${canAdd ? '<button type="button" class="btn btn-primary" id="btn-add-payment">+ Catat Transaksi Kas</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="pay-search" class="input" placeholder="Cari ID PAY, nama klien, kode CLICH, terapis, keterangan...">
        <select id="pay-filter-type" class="select" aria-label="Filter jenis kas">
          <option value="">Pemasukan &amp; Pengeluaran</option>
          <option value="INCOME">Pemasukan</option>
          <option value="EXPENSE">Pengeluaran</option>
        </select>
        <select id="pay-filter-cat" class="select" aria-label="Filter kategori">
          <option value="">Semua Kategori</option>
          ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
        </select>
        <select id="pay-filter-status" class="select" aria-label="Filter status">
          <option value="">Semua Status</option>
          <option value="LUNAS">Lunas</option>
          <option value="DP">DP / Cicilan</option>
          <option value="BATAL">Batal</option>
        </select>
        <input type="date" id="pay-filter-from" class="input" aria-label="Dari tanggal" title="Dari tanggal">
        <input type="date" id="pay-filter-to" class="input" aria-label="Sampai tanggal" title="Sampai tanggal">
      </div>

      <div id="pay-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="pay-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#pay-list-wrap');
  const pagWrap = container.querySelector('#pay-pagination');
  const sumInEl = container.querySelector('#pay-sum-in');
  const sumOutEl = container.querySelector('#pay-sum-out');
  const sumNetEl = container.querySelector('#pay-sum-net');
  const addBtn = container.querySelector('#btn-add-payment');

  if (therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false }).then((opts) => { therapistOptions = opts; }).catch(() => {});
  }

  function paintSummary(sum) {
    if (!sum) return;
    sumInEl.textContent = formatRupiah(sum.total_income || 0);
    sumOutEl.textContent = formatRupiah(sum.total_expense || 0);
    sumNetEl.textContent = formatRupiah(sum.net_balance || 0);
  }

  async function loadPayments({ force = false, silent = false } = {}) {
    const mySeq = ++fetchSeq;
    const isDefaultPay = state.page === 1 && !state.q && !state.payment_type && !state.category &&
      !state.status && !state.date_from && !state.date_to &&
      state.sort.field === 'payment_code' && state.sort.dir === 'desc';
    const key = isDefaultPay
      ? 'payments:list:p1:default'
      : `payments:list:p${state.page}:q=${state.q}:t=${state.payment_type}:c=${state.category}:s=${state.status}:f=${state.date_from}:to=${state.date_to}:sf=${state.sort.field}:${state.sort.dir}`;
    const cached = storeGet(key);

    if (cached && cached.data && !force) {
      paintSummary(cached.data.summary);
      renderTable(cached.data.items || []);
      renderPagination(pagWrap, cached.meta, (p) => { state.page = p; loadPayments(); });
      if (storeIsFresh(key, 25000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('payments.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        sort: state.sort,
        filters: {
          payment_type: state.payment_type || undefined,
          category: state.category || undefined,
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
        renderPagination(pagWrap, res.meta, (p) => { state.page = p; loadPayments(); });
      }
    } catch (err) {
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat transaksi kas</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada transaksi kas</p>
          <p class="empty-state-desc">Catat pemasukan pembayaran sesi/paket atau pengeluaran klinik melalui tombol di atas.</p>
        </div>
      `;
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID Transaksi', 'payment_code', state.sort)}
              ${sortableTh('Tanggal', 'payment_date', state.sort)}
              <th>Tipe &amp; Kategori</th>
              <th>Klien / Terapis</th>
              <th>Metode</th>
              <th>Nominal</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((p) => `
              <tr data-row-id="${esc(p.payment_id)}">
                <td><span class="code-chip">${esc(p.payment_code)}</span></td>
                <td class="font-mono text-sm"><strong>${esc(formatDateId(p.payment_date))}</strong></td>
                <td>
                  <div>${statusBadge('payment_type', p.payment_type)}</div>
                  <div class="text-xs text-muted mt-2">${esc(CATEGORY_LABELS[p.category] || p.category)}</div>
                </td>
                <td class="text-sm">
                  ${p.client_name ? `<div><button type="button" class="link-btn" data-open-cln="${esc(p.client_id)}">${esc(p.client_name)}</button> <span class="code-chip">${esc(p.client_code)}</span></div>` : ''}
                  ${p.therapist_name ? `<div class="text-xs text-muted mt-2">Terapis: ${esc(p.therapist_name)}</div>` : ''}
                  ${p.description ? `<div class="text-xs text-muted mt-2">${esc(p.description)}</div>` : ''}
                </td>
                <td class="text-xs font-mono"><strong>${esc(p.payment_method)}</strong></td>
                <td class="font-mono">
                  <strong style="color:${p.payment_type === 'EXPENSE' ? 'var(--color-danger)' : 'var(--color-success)'};">
                    ${p.payment_type === 'EXPENSE' ? '-' : '+'}${esc(formatRupiah(p.amount))}
                  </strong>
                </td>
                <td>${statusBadge('payment', p.status)}</td>
                <td>
                  <div class="table-actions">
                    ${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-pay="${esc(p.payment_id)}">Edit</button>` : ''}
                    ${canDelete ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-pay="${esc(p.payment_id)}">Hapus</button>` : ''}
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
      loadPayments();
    });

    const byId = Object.fromEntries(items.map((x) => [x.payment_id, x]));
    listWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    listWrap.querySelectorAll('[data-edit-pay]').forEach((b) => b.addEventListener('click', () => openPaymentModal(byId[b.dataset.editPay], b)));
    listWrap.querySelectorAll('[data-del-pay]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delPay];
        if (!rec) return;
        const ok = await confirmDialog({
          title: 'Hapus Transaksi Kas',
          message: `Hapus transaksi ${rec.payment_code} senilai ${formatRupiah(rec.amount)}? Komisi belum cair yang terkait juga akan ikut dibatalkan.`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = b.closest('tr');
        setButtonLoading(b, true, 'Menghapus...');
        markRowDeleting(rowEl, true);
        const delReq = apiCall('payments.delete', { payment_id: rec.payment_id, expected_version: rec.version }, { write: true });
        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();

        try {
          await delReq;
          storeInvalidate('payments');
          storeInvalidate('commissions');
          storeInvalidate('reports');
          toast('Transaksi kas dihapus.', 'success');
          loadPayments({ force: true, silent: true });
        } catch (err) {
          storeInvalidate('payments');
          toast(err.message, 'danger');
          loadPayments({ force: true, silent: true });
        }
      });
    });
  }

  async function openPaymentModal(existing = null, triggerBtn = null) {
    const isEdit = Boolean(existing);
    if (therapistOptions.length === 0) {
      if (triggerBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
      try {
        therapistOptions = await getTherapistsOptionsCached({ activeOnly: false });
      } catch (_) {} finally {
        if (triggerBtn) setButtonLoading(triggerBtn, false);
      }
    }

    const modal = openModal({
      title: isEdit ? `Edit Transaksi Kas — ${existing.payment_code}` : 'Catat Transaksi Pembayaran & Kas',
      size: 'lg',
      bodyHtml: `
        <form id="pay-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field">
              <label for="py-date">Tanggal Transaksi <span class="req-star">*</span></label>
              <input id="py-date" name="payment_date" class="input" type="date" value="${esc(isEdit ? existing.payment_date : todayInputDate())}" required>
            </div>
            <div class="field">
              <label for="py-type">Jenis Kas <span class="req-star">*</span></label>
              <select id="py-type" name="payment_type" class="select">
                <option value="INCOME" ${(!isEdit || existing.payment_type === 'INCOME') ? 'selected' : ''}>Pemasukan (+)</option>
                <option value="EXPENSE" ${isEdit && existing.payment_type === 'EXPENSE' ? 'selected' : ''}>Pengeluaran (-)</option>
              </select>
            </div>
            <div class="field">
              <label for="py-cat">Kategori <span class="req-star">*</span></label>
              <select id="py-cat" name="category" class="select">
                ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `
                  <option value="${esc(k)}" ${(isEdit && existing.category === k) ? 'selected' : ''}>${esc(v)}</option>
                `).join('')}
              </select>
            </div>
            <div class="field">
              <label for="py-method">Metode Pembayaran <span class="req-star">*</span></label>
              <select id="py-method" name="payment_method" class="select">
                <option value="TRANSFER" ${(!isEdit || existing.payment_method === 'TRANSFER') ? 'selected' : ''}>Transfer Bank</option>
                <option value="QRIS" ${isEdit && existing.payment_method === 'QRIS' ? 'selected' : ''}>QRIS</option>
                <option value="TUNAI" ${isEdit && existing.payment_method === 'TUNAI' ? 'selected' : ''}>Tunai</option>
                <option value="KARTU" ${isEdit && existing.payment_method === 'KARTU' ? 'selected' : ''}>Kartu Debit / Kredit</option>
              </select>
            </div>
            <div class="field">
              <label for="py-amount">Nominal (Rp) <span class="req-star">*</span></label>
              <input id="py-amount" name="amount" class="input" type="number" min="1" step="1000" value="${esc(isEdit ? existing.amount : '')}" placeholder="500000" required>
            </div>
            <div class="field">
              <label for="py-status">Status Pembayaran</label>
              <select id="py-status" name="status" class="select">
                <option value="LUNAS" ${(!isEdit || existing.status === 'LUNAS') ? 'selected' : ''}>Lunas</option>
                <option value="DP" ${isEdit && existing.status === 'DP' ? 'selected' : ''}>DP / Cicilan</option>
                <option value="BATAL" ${isEdit && existing.status === 'BATAL' ? 'selected' : ''}>Batal</option>
              </select>
            </div>
            <div class="field">
              <label>Klien Terkait (Opsional)</label>
              <div id="py-client-ac"></div>
            </div>
            <div class="field">
              <label for="py-trp">Terapis Terkait (Opsional)</label>
              <select id="py-trp" name="therapist_id" class="select">
                <option value="">-- Tanpa Terapis --</option>
                ${therapistOptions.map((t) => `
                  <option value="${esc(t.therapist_id)}" ${isEdit && existing.therapist_id === t.therapist_id ? 'selected' : ''}>
                    ${esc(t.full_name)} (${esc(t.code)})
                  </option>
                `).join('')}
              </select>
            </div>
            ${!isEdit ? `
              <div class="field field-span-full">
                <label class="perm-check">
                  <input type="checkbox" id="py-auto-comm" checked>
                  <span>Hitung &amp; catat otomatis bagi hasil/komisi terapis bila Pemasukan Layanan berstatus Lunas</span>
                </label>
              </div>
            ` : ''}
            <div class="field field-span-full">
              <label for="py-desc">Keterangan / Catatan Kas</label>
              <textarea id="py-desc" name="description" class="textarea" rows="2" placeholder="mis. Pembayaran Sesi #1 atau pembelian perlengkapan ruang terapi">${esc(isEdit ? existing.description : '')}</textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="pay-form" class="btn btn-primary" id="btn-save-pay">${isEdit ? 'Simpan Perubahan' : 'Simpan Transaksi'}</button>
      `
    });

    const form = modal.querySelector('#pay-form');
    const saveBtn = modal.querySelector('#btn-save-pay');
    const ac = mountClientAutocomplete(modal.querySelector('#py-client-ac'), {
      inputName: 'client_id',
      initialClient: isEdit && existing.client_id
        ? { client_id: existing.client_id, full_name: existing.client_name, client_code: existing.client_code }
        : null,
      onSelect: (c) => {
        if (form.therapist_id && !form.therapist_id.value && c.primary_therapist_id) {
          form.therapist_id.value = c.primary_therapist_id;
        }
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');

      const payload = {
        payment_date: form.payment_date.value,
        payment_type: form.payment_type.value,
        category: form.category.value,
        payment_method: form.payment_method.value,
        amount: Number(form.amount.value || 0),
        status: form.status.value,
        client_id: ac.getValue(),
        therapist_id: form.therapist_id.value,
        description: form.description.value.trim(),
        auto_commission: modal.querySelector('#py-auto-comm') ? modal.querySelector('#py-auto-comm').checked : false
      };

      try {
        if (isEdit) {
          payload.payment_id = existing.payment_id;
          payload.expected_version = existing.version;
          await apiCall('payments.update', payload, { write: true });
          toast('Transaksi kas berhasil diperbarui.', 'success');
        } else {
          const res = await apiCall('payments.create', payload, { write: true });
          const commInfo = res.data && res.data.commission
            ? ` (+ Komisi ${res.data.commission.commission_code} tercatat otomatis)`
            : '';
          toast(`Transaksi kas berhasil disimpan${commInfo}.`, 'success');
        }
        closeModal();
        storeInvalidate('payments');
        storeInvalidate('commissions');
        storeInvalidate('reports');
        loadPayments({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  addBtn?.addEventListener('click', () => openPaymentModal(null, addBtn));

  let debounce = null;
  container.querySelector('#pay-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadPayments(); }, 250);
  });
  container.querySelector('#pay-filter-type').addEventListener('change', (e) => { state.payment_type = e.target.value; state.page = 1; loadPayments(); });
  container.querySelector('#pay-filter-cat').addEventListener('change', (e) => { state.category = e.target.value; state.page = 1; loadPayments(); });
  container.querySelector('#pay-filter-status').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; loadPayments(); });
  container.querySelector('#pay-filter-from').addEventListener('change', (e) => { state.date_from = e.target.value; state.page = 1; loadPayments(); });
  container.querySelector('#pay-filter-to').addEventListener('change', (e) => { state.date_to = e.target.value; state.page = 1; loadPayments(); });

  await loadPayments({ force: Boolean(route && route.forceRefresh) });
}
