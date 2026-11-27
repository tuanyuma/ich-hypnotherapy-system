/**
 * pages/assessments.js — Assessment Awal & Anamnesis (F6):
 * - Tampilan utama fokus langsung ke Tabel Riwayat Assessment Awal (list-first)
 * - Tombol "+ Tambah Assessment" & aksi "Edit" membuka Modal Form beranimasi GSAP smooth
 * - SWR in-memory cache + Top Progress Bar + inline spinner + Optimistic Delete dengan rollback.
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  esc,
  formatDateId,
  todayInputDate,
  renderSkeletonTable,
  renderPagination,
  sortableTh,
  bindSortableHeaders,
  mountClientAutocomplete,
  autoResizeTextarea,
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

export async function renderAssessmentsPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAdd = can('assessments:add');
  const canEdit = can('assessments:edit');
  const canDelete = can('assessments:delete');

  let therapistOptions = !isTherapist
    ? ((storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [])
    : [];

  const listState = {
    page: 1,
    limit: 10,
    q: '',
    therapist_id: '',
    date_from: '',
    date_to: '',
    sort: { field: 'assessment_code', dir: 'desc' }
  };
  let activeFetchId = 0;

  function buildCacheKey() {
    if (
      listState.page === 1 && !listState.q && !listState.therapist_id &&
      !listState.date_from && !listState.date_to &&
      listState.sort.field === 'assessment_code' && listState.sort.dir === 'desc'
    ) {
      return 'assessments:list:p1:default';
    }
    return `assessments:list:p${listState.page}:l${listState.limit}:q=${listState.q}:t=${listState.therapist_id}:f=${listState.date_from}:to=${listState.date_to}:sf=${listState.sort.field}:${listState.sort.dir}`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Riwayat Assessment Awal &amp; Anamnesis</h2>
          <p class="card-desc">Daftar assessment awal yang telah tercatat. Klik Lihat untuk membaca anamnesis lengkap atau Tambah Assessment untuk input baru.</p>
        </div>
        ${canAdd ? '<button type="button" class="btn btn-primary" id="btn-add-assessment">+ Tambah Assessment</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="asm-search" class="input" placeholder="Cari nama/kode klien, keluhan, atau tujuan...">
        ${!isTherapist ? `
          <select id="asm-filter-trp" class="select" aria-label="Filter terapis">
            <option value="">Semua Terapis</option>
            ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('')}
          </select>
        ` : ''}
        <input type="date" id="asm-filter-from" class="input" aria-label="Dari tanggal" title="Dari tanggal">
        <input type="date" id="asm-filter-to" class="input" aria-label="Sampai tanggal" title="Sampai tanggal">
      </div>

      <div id="asm-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="asm-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#asm-list-wrap');
  const pagWrap = container.querySelector('#asm-pagination');
  const addBtn = container.querySelector('#btn-add-assessment');

  // Isi opsi terapis untuk filter di latar belakang bila belum ada di RAM
  if (!isTherapist && therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false })
      .then((opts) => {
        therapistOptions = opts;
        const filterSelect = container.querySelector('#asm-filter-trp');
        if (filterSelect) {
          const prevF = filterSelect.value;
          filterSelect.innerHTML = '<option value="">Semua Terapis</option>' +
            opts.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('');
          filterSelect.value = prevF;
        }
      })
      .catch(() => {});
  }

  async function openAssessmentFormModal(existing = null, prefillClient = null, triggerBtn = null) {
    const isEdit = Boolean(existing);

    if (!isTherapist && therapistOptions.length === 0) {
      if (triggerBtn) setButtonLoading(triggerBtn, true, 'Memuat...');
      try {
        therapistOptions = await getTherapistsOptionsCached({ activeOnly: false });
      } catch (_) {
        therapistOptions = [];
      } finally {
        if (triggerBtn) setButtonLoading(triggerBtn, false);
      }
    }

    const selectedTherapistId = isEdit
      ? (existing.therapist_id || '')
      : (prefillClient && prefillClient.primary_therapist_id ? prefillClient.primary_therapist_id : '');

    const modal = openModal({
      title: isEdit
        ? `Edit Assessment — ${existing.client_name} (${formatDateId(existing.assessment_date)})`
        : 'Input Assessment Awal & Anamnesis',
      size: 'lg',
      bodyHtml: `
        ${isEdit ? `
          <div class="context-item flex-between mb-3 text-sm">
            <div><strong>ID Assessment:</strong> <span class="code-chip">${esc(existing.assessment_code || existing.assessment_id)}</span></div>
            <div><strong>ID Klien:</strong> <span class="code-chip">${esc(existing.client_code)}</span> • <strong>${esc(existing.client_name)}</strong></div>
          </div>
        ` : ''}
        <form id="asm-form" novalidate>
          <div class="form-grid form-grid-3">
            <div class="field">
              <label>Klien <span class="req-star">*</span></label>
              <div id="asm-client-ac"></div>
            </div>
            ${!isTherapist ? `
              <div class="field">
                <label for="asm-therapist">Terapis <span class="req-star">*</span></label>
                <select id="asm-therapist" name="therapist_id" class="select" required>
                  <option value="">-- Pilih Terapis --</option>
                  ${therapistOptions.map((t) => `
                    <option value="${esc(t.therapist_id)}" ${selectedTherapistId === t.therapist_id ? 'selected' : ''}>
                      ${esc(t.full_name)} (${esc(t.code)})
                    </option>
                  `).join('')}
                </select>
              </div>
            ` : `
              <div class="field">
                <label>Terapis</label>
                <input class="input" type="text" value="${esc(actor.full_name)} (Otomatis)" disabled>
              </div>
            `}
            <div class="field">
              <label for="asm-date">Tanggal Assessment <span class="req-star">*</span></label>
              <input id="asm-date" name="assessment_date" class="input" type="date"
                value="${esc(isEdit ? (existing.assessment_date || todayInputDate()) : todayInputDate())}" required>
            </div>
          </div>

          <div class="form-grid form-grid-2 mt-4">
            <div class="field field-span-full">
              <label for="asm-main">Keluhan Utama <span class="req-star">*</span></label>
              <textarea id="asm-main" name="main_complaint" class="textarea textarea-clinical"
                placeholder="Tuliskan keluhan utama klien secara menyeluruh..." required>${esc(isEdit ? existing.main_complaint : '')}</textarea>
            </div>
            <div class="field">
              <label for="asm-history">Riwayat Keluhan</label>
              <textarea id="asm-history" name="complaint_history" class="textarea"
                placeholder="Sejak kapan, perkembangan gejala...">${esc(isEdit ? existing.complaint_history : '')}</textarea>
            </div>
            <div class="field">
              <label for="asm-triggers">Pemicu (Triggers)</label>
              <textarea id="asm-triggers" name="triggers" class="textarea"
                placeholder="Situasi, pola pikir, atau kejadian pemicu...">${esc(isEdit ? existing.triggers : '')}</textarea>
            </div>
            <div class="field">
              <label for="asm-med">Riwayat Medis / Psikologis</label>
              <textarea id="asm-med" name="medical_history" class="textarea"
                placeholder="Riwayat pengobatan, konsultasi sebelumnya...">${esc(isEdit ? existing.medical_history : '')}</textarea>
            </div>
            <div class="field">
              <label for="asm-goals">Tujuan Terapi</label>
              <textarea id="asm-goals" name="therapy_goals" class="textarea"
                placeholder="Target perubahan yang diharapkan klien...">${esc(isEdit ? existing.therapy_goals : '')}</textarea>
            </div>
            <div class="field">
              <label for="asm-risk">Skrining Risiko</label>
              <textarea id="asm-risk" name="risk_screening" class="textarea"
                placeholder="Catatan kehati-hatian klinis / kontraindikasi...">${esc(isEdit ? existing.risk_screening : '')}</textarea>
            </div>
            <div class="field">
              <label for="asm-rec">Rekomendasi Awal</label>
              <textarea id="asm-rec" name="recommendation" class="textarea"
                placeholder="Rencana jumlah sesi, pendekatan hipnoterapi...">${esc(isEdit ? existing.recommendation : '')}</textarea>
            </div>
            <div class="field field-span-full">
              <label for="asm-notes">Catatan Tambahan</label>
              <textarea id="asm-notes" name="notes" class="textarea" rows="2">${esc(isEdit ? existing.notes : '')}</textarea>
            </div>
          </div>

          <p class="text-xs text-muted mt-4" style="margin-bottom:0;">
            Data anamnesis bersifat rahasia klinis dan tidak dapat diakses oleh Customer Service.
          </p>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="asm-form" class="btn btn-primary" id="btn-asm-submit">
          ${isEdit ? 'Perbarui Assessment' : 'Simpan Assessment'}
        </button>
      `
    });

    const form = modal.querySelector('#asm-form');
    const submitBtn = modal.querySelector('#btn-asm-submit');

    form.querySelectorAll('textarea').forEach((ta) => autoResizeTextarea(ta));

    const clientAc = mountClientAutocomplete(modal.querySelector('#asm-client-ac'), {
      inputName: 'client_id',
      initialClient: isEdit
        ? { client_id: existing.client_id, full_name: existing.client_name, client_code: existing.client_code }
        : prefillClient,
      onSelect: (client) => {
        if (!isTherapist && form.therapist_id && !form.therapist_id.value && client.primary_therapist_id) {
          form.therapist_id.value = client.primary_therapist_id;
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
      const clientId = clientAc ? clientAc.getValue() : '';
      if (!clientId) {
        toast('Silakan pilih klien dari daftar pencarian terlebih dahulu.', 'warning');
        return;
      }

      setButtonLoading(submitBtn, true, 'Menyimpan...');

      const payload = {
        client_id: clientId,
        assessment_date: form.assessment_date.value,
        main_complaint: form.main_complaint.value.trim(),
        complaint_history: form.complaint_history.value.trim(),
        triggers: form.triggers.value.trim(),
        medical_history: form.medical_history.value.trim(),
        therapy_goals: form.therapy_goals.value.trim(),
        risk_screening: form.risk_screening.value.trim(),
        recommendation: form.recommendation.value.trim(),
        notes: form.notes.value.trim()
      };
      if (!isTherapist && form.therapist_id) {
        payload.therapist_id = form.therapist_id.value;
      }

      try {
        if (isEdit) {
          payload.assessment_id = existing.assessment_id;
          payload.expected_version = existing.version;
          await apiCall('assessments.update', payload, { write: true });
          toast('Assessment berhasil diperbarui.', 'success');
        } else {
          await apiCall('assessments.create', payload, { write: true });
          toast('Assessment awal berhasil disimpan.', 'success');
        }
        closeModal();
        storeInvalidate('assessments');
        storeInvalidate('clients');
        loadAssessments({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });
  }

  async function loadAssessments({ force = false, silent = false } = {}) {
    const fetchId = ++activeFetchId;
    const key = buildCacheKey();
    const cached = storeGet(key);

    if (cached && Array.isArray(cached.data) && !force) {
      renderTable(cached.data);
      renderPagination(pagWrap, cached.meta, (p) => {
        listState.page = p;
        loadAssessments();
      });
      if (storeIsFresh(key, 30000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('assessments.list', {
        page: listState.page,
        limit: listState.limit,
        q: listState.q,
        sort: listState.sort,
        filters: {
          therapist_id: listState.therapist_id || undefined,
          date_from: listState.date_from || undefined,
          date_to: listState.date_to || undefined
        }
      });
      if (fetchId !== activeFetchId) return;
      const items = (res.data && res.data.items) || [];
      const { changed } = storeSet(key, items, res.meta);
      if (!cached || force || changed) {
        renderTable(items);
        renderPagination(pagWrap, res.meta, (p) => {
          listState.page = p;
          loadAssessments();
        });
      }
    } catch (err) {
      if (fetchId !== activeFetchId) return;
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat riwayat assessment</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function openAssessmentViewModal(rec) {
    openModal({
      title: `Detail Assessment — ${rec.client_name}`,
      size: 'lg',
      bodyHtml: `
        <div class="context-item flex-between mb-3 text-sm">
          <div>
            <strong>ID Assessment:</strong> <span class="code-chip">${esc(rec.assessment_code || rec.assessment_id)}</span>
            <span style="margin-left:8px;"><strong>Klien:</strong> ${esc(rec.client_name)} <span class="code-chip">${esc(rec.client_code)}</span></span>
          </div>
          <div><strong>Tanggal:</strong> ${esc(formatDateId(rec.assessment_date))} • <strong>Terapis:</strong> ${esc(rec.therapist_name || '-')}</div>
        </div>
        <div class="context-item"><strong>Keluhan Utama</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.main_complaint || '-')}</div></div>
        <div class="context-item"><strong>Riwayat Keluhan</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.complaint_history || '-')}</div></div>
        <div class="context-item"><strong>Pemicu (Triggers)</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.triggers || '-')}</div></div>
        <div class="context-item"><strong>Riwayat Medis / Psikologis</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.medical_history || '-')}</div></div>
        <div class="context-item"><strong>Tujuan Terapi</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.therapy_goals || '-')}</div></div>
        <div class="context-item"><strong>Skrining Risiko</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.risk_screening || '-')}</div></div>
        <div class="context-item"><strong>Rekomendasi</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.recommendation || '-')}</div></div>
        ${rec.notes ? `<div class="context-item"><strong>Catatan</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(rec.notes)}</div></div>` : ''}
      `,
      footerHtml: '<button type="button" class="btn btn-primary" data-modal-close>Tutup</button>'
    });
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada riwayat assessment</p>
          <p class="empty-state-desc">Klik tombol Tambah Assessment di atas untuk mencatat anamnesis awal klien.</p>
          ${canAdd ? '<button type="button" class="btn btn-primary btn-sm" id="btn-empty-add-asm">+ Tambah Assessment</button>' : ''}
        </div>
      `;
      listWrap.querySelector('#btn-empty-add-asm')?.addEventListener('click', (e) => {
        openAssessmentFormModal(null, null, e.currentTarget);
      });
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID Assessment', 'assessment_code', listState.sort)}
              ${sortableTh('Tanggal', 'assessment_date', listState.sort)}
              <th>Klien</th>
              <th>Terapis</th>
              <th>Keluhan Utama</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((a) => `
              <tr data-row-id="${esc(a.assessment_id)}">
                <td><span class="code-chip">${esc(a.assessment_code || a.assessment_id)}</span></td>
                <td class="font-mono text-sm"><strong>${esc(formatDateId(a.assessment_date))}</strong></td>
                <td>
                  <button type="button" class="link-btn" data-open-cln="${esc(a.client_id)}">${esc(a.client_name || '-')}</button>
                  <div class="mt-2"><span class="code-chip">${esc(a.client_code || '')}</span></div>
                </td>
                <td>${esc(a.therapist_name || '-')}</td>
                <td class="text-sm">${esc(String(a.main_complaint || '').slice(0, 110))}${String(a.main_complaint || '').length > 110 ? '…' : ''}</td>
                <td>
                  <div class="table-actions">
                    <button type="button" class="btn btn-soft btn-sm" data-view-asm="${esc(a.assessment_id)}">Lihat</button>
                    ${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-asm="${esc(a.assessment_id)}">Edit</button>` : ''}
                    ${canDelete ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-asm="${esc(a.assessment_id)}">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    bindSortableHeaders(listWrap, listState.sort, () => {
      listState.page = 1;
      loadAssessments();
    });

    const byId = Object.fromEntries(items.map((a) => [a.assessment_id, a]));
    listWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    listWrap.querySelectorAll('[data-view-asm]').forEach((b) => b.addEventListener('click', () => openAssessmentViewModal(byId[b.dataset.viewAsm])));
    listWrap.querySelectorAll('[data-edit-asm]').forEach((b) => b.addEventListener('click', () => openAssessmentFormModal(byId[b.dataset.editAsm], null, b)));
    listWrap.querySelectorAll('[data-del-asm]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delAsm];
        if (!rec) return;
        const ok = await confirmDialog({
          title: 'Hapus Assessment',
          message: `Hapus (soft delete) assessment milik "${rec.client_name}" tanggal ${formatDateId(rec.assessment_date)}?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = b.closest('tr');
        setButtonLoading(b, true, 'Menghapus...');
        markRowDeleting(rowEl, true);

        const deleteReq = apiCall('assessments.delete', {
          assessment_id: rec.assessment_id,
          expected_version: rec.version
        }, { write: true });

        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();

        storeUpdateListItems('assessments', (arr) => arr.filter((item) => item.assessment_id !== rec.assessment_id));
        const tbody = listWrap.querySelector('tbody');
        if (tbody && tbody.children.length === 0) renderTable([]);

        try {
          await deleteReq;
          storeInvalidate('assessments');
          storeInvalidate('clients');
          toast('Assessment berhasil dihapus.', 'success');
          loadAssessments({ force: true, silent: true });
        } catch (err) {
          storeInvalidate('assessments');
          toast(err.message, 'danger');
          loadAssessments({ force: true, silent: true });
        }
      });
    });
  }

  addBtn?.addEventListener('click', () => openAssessmentFormModal(null, null, addBtn));

  let debounce = null;
  container.querySelector('#asm-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { listState.q = e.target.value.trim(); listState.page = 1; loadAssessments(); }, 250);
  });
  container.querySelector('#asm-filter-trp')?.addEventListener('change', (e) => { listState.therapist_id = e.target.value; listState.page = 1; loadAssessments(); });
  container.querySelector('#asm-filter-from').addEventListener('change', (e) => { listState.date_from = e.target.value; listState.page = 1; loadAssessments(); });
  container.querySelector('#asm-filter-to').addEventListener('change', (e) => { listState.date_to = e.target.value; listState.page = 1; loadAssessments(); });

  await loadAssessments({ force: Boolean(route && route.forceRefresh) });

  // Auto-buka modal bila datang dari pintasan Dashboard (?new=1) atau Detail Klien (?client_id=...)
  const wantNew = Boolean(route && route.query && (route.query.new === '1' || route.query.client_id));
  if (wantNew && canAdd) {
    let prefillClient = null;
    if (route.query.client_id) {
      try {
        const cRes = await apiCall('clients.get', { client_id: route.query.client_id });
        prefillClient = cRes.data && cRes.data.client;
      } catch (_) {
        prefillClient = null;
      }
    }
    openAssessmentFormModal(null, prefillClient, addBtn);
  }
}
