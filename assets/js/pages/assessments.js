/**
 * pages/assessments.js — Assessment Awal & Anamnesis (F6):
 * Form input assessment dengan searchable autocomplete klien,
 * diikuti Tabel Riwayat Assessment di bawah form (Lihat, Edit, Hapus),
 * search, filter terapis/tanggal, dan pagination.
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
  mountClientAutocomplete,
  autoResizeTextarea,
  openModal,
  confirmDialog,
  clearFieldErrors,
  showFieldErrors,
  toast
} from '../ui.js';

export async function renderAssessmentsPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAdd = can('assessments:add');
  const canEdit = can('assessments:edit');
  const canDelete = can('assessments:delete');

  let therapistOptions = [];
  if (!isTherapist) {
    try {
      const optRes = await apiCall('therapists.options', { active_only: false });
      therapistOptions = (optRes.data && optRes.data.items) || [];
    } catch (_) {
      therapistOptions = [];
    }
  }

  let initialClient = null;
  if (route && route.query && route.query.client_id) {
    try {
      const cRes = await apiCall('clients.get', { client_id: route.query.client_id });
      initialClient = cRes.data && cRes.data.client;
    } catch (_) {
      initialClient = null;
    }
  }

  const listState = { page: 1, limit: 15, q: '', therapist_id: '', date_from: '', date_to: '' };
  let editingRecord = null;

  container.innerHTML = `
    ${canAdd || canEdit ? `
      <section class="card" id="asm-form-card">
        <div class="card-header">
          <div>
            <h2 class="card-title" id="asm-form-title">Input Assessment Awal &amp; Anamnesis</h2>
            <p class="card-desc">Pilih klien menggunakan pencarian cepat, lalu lengkapi hasil anamnesis awal.</p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-asm-cancel-edit" hidden>Batal Edit</button>
        </div>

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
                  ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)} (${esc(t.code)})</option>`).join('')}
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
              <input id="asm-date" name="assessment_date" class="input" type="date" value="${esc(todayInputDate())}" required>
            </div>
          </div>

          <div class="form-grid form-grid-2 mt-4">
            <div class="field field-span-full">
              <label for="asm-main">Keluhan Utama <span class="req-star">*</span></label>
              <textarea id="asm-main" name="main_complaint" class="textarea textarea-clinical"
                placeholder="Tuliskan keluhan utama klien secara menyeluruh..." required></textarea>
            </div>
            <div class="field">
              <label for="asm-history">Riwayat Keluhan</label>
              <textarea id="asm-history" name="complaint_history" class="textarea" placeholder="Sejak kapan, perkembangan gejala..."></textarea>
            </div>
            <div class="field">
              <label for="asm-triggers">Pemicu (Triggers)</label>
              <textarea id="asm-triggers" name="triggers" class="textarea" placeholder="Situasi, pola pikir, atau kejadian pemicu..."></textarea>
            </div>
            <div class="field">
              <label for="asm-med">Riwayat Medis / Psikologis</label>
              <textarea id="asm-med" name="medical_history" class="textarea" placeholder="Riwayat pengobatan, konsultasi sebelumnya..."></textarea>
            </div>
            <div class="field">
              <label for="asm-goals">Tujuan Terapi</label>
              <textarea id="asm-goals" name="therapy_goals" class="textarea" placeholder="Target perubahan yang diharapkan klien..."></textarea>
            </div>
            <div class="field">
              <label for="asm-risk">Skrining Risiko</label>
              <textarea id="asm-risk" name="risk_screening" class="textarea" placeholder="Catatan kehati-hatian klinis / kontraindikasi..."></textarea>
            </div>
            <div class="field">
              <label for="asm-rec">Rekomendasi Awal</label>
              <textarea id="asm-rec" name="recommendation" class="textarea" placeholder="Rencana jumlah sesi, pendekatan hipnoterapi..."></textarea>
            </div>
            <div class="field field-span-full">
              <label for="asm-notes">Catatan Tambahan</label>
              <textarea id="asm-notes" name="notes" class="textarea" rows="2"></textarea>
            </div>
          </div>

          <div class="flex-between mt-4">
            <span class="text-xs text-muted">Data anamnesis bersifat rahasia klinis dan tidak dapat diakses Customer Service.</span>
            <div class="flex-gap">
              <button type="button" class="btn btn-secondary" id="btn-asm-reset">Reset Form</button>
              <button type="submit" class="btn btn-primary" id="btn-asm-submit">Simpan Assessment</button>
            </div>
          </div>
        </form>
      </section>
    ` : ''}

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Riwayat Assessment Awal</h2>
          <p class="card-desc">Daftar assessment yang telah tercatat. Klik Lihat untuk membaca anamnesis lengkap.</p>
        </div>
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

  const form = container.querySelector('#asm-form');
  const formTitle = container.querySelector('#asm-form-title');
  const cancelEditBtn = container.querySelector('#btn-asm-cancel-edit');
  const submitBtn = container.querySelector('#btn-asm-submit');
  const listWrap = container.querySelector('#asm-list-wrap');
  const pagWrap = container.querySelector('#asm-pagination');

  let clientAc = null;
  if (form) {
    form.querySelectorAll('textarea').forEach((ta) => autoResizeTextarea(ta));
    clientAc = mountClientAutocomplete(container.querySelector('#asm-client-ac'), {
      inputName: 'client_id',
      initialClient,
      onSelect: (client) => {
        if (!isTherapist && form.therapist_id && !form.therapist_id.value && client.primary_therapist_id) {
          form.therapist_id.value = client.primary_therapist_id;
        }
      }
    });
    if (initialClient && !isTherapist && form.therapist_id && initialClient.primary_therapist_id) {
      form.therapist_id.value = initialClient.primary_therapist_id;
    }
  }

  function resetFormToCreate() {
    if (!form) return;
    editingRecord = null;
    clearFieldErrors(form);
    form.reset();
    form.assessment_date.value = todayInputDate();
    if (clientAc) clientAc.setClient(null);
    const acInput = form.querySelector('[data-ac-input]');
    if (acInput) acInput.disabled = false;
    formTitle.textContent = 'Input Assessment Awal & Anamnesis';
    submitBtn.textContent = 'Simpan Assessment';
    cancelEditBtn.hidden = true;
  }

  function populateFormForEdit(rec) {
    if (!form) return;
    editingRecord = rec;
    clearFieldErrors(form);
    if (clientAc) {
      clientAc.setClient({
        client_id: rec.client_id,
        full_name: rec.client_name,
        client_code: rec.client_code
      });
    }
    const acInput = form.querySelector('[data-ac-input]');
    if (acInput) acInput.disabled = true;
    if (!isTherapist && form.therapist_id) {
      form.therapist_id.value = rec.therapist_id || '';
    }
    form.assessment_date.value = rec.assessment_date || todayInputDate();
    form.main_complaint.value = rec.main_complaint || '';
    form.complaint_history.value = rec.complaint_history || '';
    form.triggers.value = rec.triggers || '';
    form.medical_history.value = rec.medical_history || '';
    form.therapy_goals.value = rec.therapy_goals || '';
    form.risk_screening.value = rec.risk_screening || '';
    form.recommendation.value = rec.recommendation || '';
    form.notes.value = rec.notes || '';
    form.querySelectorAll('textarea').forEach((ta) => ta.dispatchEvent(new Event('input')));

    formTitle.textContent = `Edit Assessment — ${rec.client_name} (${formatDateId(rec.assessment_date)})`;
    submitBtn.textContent = 'Perbarui Assessment';
    cancelEditBtn.hidden = false;
    container.querySelector('#asm-form-card')?.scrollIntoView({ behavior: 'smooth' });
  }

  if (form) {
    cancelEditBtn.addEventListener('click', resetFormToCreate);
    container.querySelector('#btn-asm-reset')?.addEventListener('click', resetFormToCreate);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      const clientId = clientAc ? clientAc.getValue() : '';
      if (!clientId) {
        toast('Silakan pilih klien dari daftar pencarian terlebih dahulu.', 'warning');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';

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
        if (editingRecord) {
          payload.assessment_id = editingRecord.assessment_id;
          payload.expected_version = editingRecord.version;
          await apiCall('assessments.update', payload, { write: true });
          toast('Assessment berhasil diperbarui.', 'success');
        } else {
          await apiCall('assessments.create', payload, { write: true });
          toast('Assessment awal berhasil disimpan.', 'success');
        }
        resetFormToCreate();
        loadAssessments();
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingRecord ? 'Perbarui Assessment' : 'Simpan Assessment';
      }
    });
  }

  async function loadAssessments() {
    listWrap.innerHTML = renderSkeletonTable(5);
    try {
      const res = await apiCall('assessments.list', {
        page: listState.page,
        limit: listState.limit,
        q: listState.q,
        filters: {
          therapist_id: listState.therapist_id || undefined,
          date_from: listState.date_from || undefined,
          date_to: listState.date_to || undefined
        }
      });
      const items = (res.data && res.data.items) || [];
      renderTable(items);
      renderPagination(pagWrap, res.meta, (p) => {
        listState.page = p;
        loadAssessments();
      });
    } catch (err) {
      listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat riwayat assessment</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      toast(err.message, 'danger');
    }
  }

  function openAssessmentViewModal(rec) {
    openModal({
      title: `Detail Assessment — ${rec.client_name}`,
      size: 'lg',
      bodyHtml: `
        <div class="flex-between mb-3 text-sm">
          <span><strong>Klien:</strong> ${esc(rec.client_name)} <span class="font-mono text-muted">(${esc(rec.client_code)})</span></span>
          <span><strong>Tanggal:</strong> ${esc(formatDateId(rec.assessment_date))} • <strong>Terapis:</strong> ${esc(rec.therapist_name || '-')}</span>
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
      listWrap.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada riwayat assessment</p></div>';
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Klien</th>
              <th>Terapis</th>
              <th>Keluhan Utama</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((a) => `
              <tr>
                <td class="font-mono text-sm"><strong>${esc(formatDateId(a.assessment_date))}</strong></td>
                <td>
                  <button type="button" class="link-btn" data-open-cln="${esc(a.client_id)}">${esc(a.client_name || '-')}</button>
                  <div class="text-xs text-muted font-mono">${esc(a.client_code || '')}</div>
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

    const byId = Object.fromEntries(items.map((a) => [a.assessment_id, a]));
    listWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    listWrap.querySelectorAll('[data-view-asm]').forEach((b) => b.addEventListener('click', () => openAssessmentViewModal(byId[b.dataset.viewAsm])));
    listWrap.querySelectorAll('[data-edit-asm]').forEach((b) => b.addEventListener('click', () => populateFormForEdit(byId[b.dataset.editAsm])));
    listWrap.querySelectorAll('[data-del-asm]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delAsm];
        const ok = await confirmDialog({
          title: 'Hapus Assessment',
          message: `Hapus (soft delete) assessment milik "${rec.client_name}" tanggal ${formatDateId(rec.assessment_date)}?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await apiCall('assessments.delete', { assessment_id: rec.assessment_id, expected_version: rec.version }, { write: true });
          toast('Assessment berhasil dihapus.', 'success');
          if (editingRecord && editingRecord.assessment_id === rec.assessment_id) resetFormToCreate();
          loadAssessments();
        } catch (err) {
          toast(err.message, 'danger');
        }
      });
    });
  }

  let debounce = null;
  container.querySelector('#asm-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { listState.q = e.target.value.trim(); listState.page = 1; loadAssessments(); }, 250);
  });
  container.querySelector('#asm-filter-trp')?.addEventListener('change', (e) => { listState.therapist_id = e.target.value; listState.page = 1; loadAssessments(); });
  container.querySelector('#asm-filter-from').addEventListener('change', (e) => { listState.date_from = e.target.value; listState.page = 1; loadAssessments(); });
  container.querySelector('#asm-filter-to').addEventListener('change', (e) => { listState.date_to = e.target.value; listState.page = 1; loadAssessments(); });

  loadAssessments();
}
