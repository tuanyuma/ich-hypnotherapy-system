/**
 * pages/rme.js — Rekam Medis Elektronik / Sesi Terapi (F8):
 * - Form pencatatan sesi lengkap dengan textarea lega & auto-resize
 * - Panel Context Reference otomatis saat klien dipilih (Assessment + 3 sesi terakhir + jadwal aktif + preview no. sesi)
 * - Penomoran sesi otomatis tanpa batas dari server
 * - Tabel Riwayat RME di bawah form (Lihat, Edit, Hapus), search, filter, dan pagination.
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  esc,
  formatDateId,
  todayInputDate,
  statusBadge,
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

export async function renderRmePage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAdd = can('rme:add');
  const canEdit = can('rme:edit');
  const canDelete = can('rme:delete');

  let therapistOptions = [];
  if (!isTherapist) {
    try {
      const optRes = await apiCall('therapists.options', { active_only: false });
      therapistOptions = (optRes.data && optRes.data.items) || [];
    } catch (_) {
      therapistOptions = [];
    }
  }

  const prefillClientId = route && route.query ? route.query.client_id : '';
  const prefillAptId = route && route.query ? route.query.appointment_id : '';
  let initialClient = null;
  if (prefillClientId) {
    try {
      const cRes = await apiCall('clients.get', { client_id: prefillClientId });
      initialClient = cRes.data && cRes.data.client;
    } catch (_) {
      initialClient = null;
    }
  }

  const listState = { page: 1, limit: 15, q: '', therapist_id: '', session_mode: '', date_from: '', date_to: '' };
  let editingRecord = null;

  container.innerHTML = `
    ${canAdd || canEdit ? `
      <div class="dashboard-split" id="rme-workspace">
        <section class="card" id="rme-form-card">
          <div class="card-header">
            <div>
              <h2 class="card-title" id="rme-form-title">Catat Sesi Terapi (RME)</h2>
              <p class="card-desc">Nomor sesi bertambah otomatis tanpa batas saat disimpan di server.</p>
            </div>
            <div class="flex-gap">
              <span id="rme-next-session-badge" class="badge badge-primary" hidden></span>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-rme-cancel-edit" hidden>Batal Edit</button>
            </div>
          </div>

          <form id="rme-form" novalidate>
            <div class="form-grid form-grid-2">
              <div class="field field-span-full">
                <label>Klien <span class="req-star">*</span></label>
                <div id="rme-client-ac"></div>
              </div>

              ${!isTherapist ? `
                <div class="field">
                  <label for="rme-trp">Terapis <span class="req-star">*</span></label>
                  <select id="rme-trp" name="therapist_id" class="select" required>
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

              <div class="field" id="rme-apt-wrap">
                <label for="rme-apt">Tautkan Jadwal Aktif (Opsional)</label>
                <select id="rme-apt" name="appointment_id" class="select">
                  <option value="">-- Tidak ditautkan ke jadwal --</option>
                </select>
                <span class="field-hint">Bila dipilih, status jadwal otomatis berubah menjadi Completed.</span>
              </div>

              <div class="field">
                <label for="rme-date">Tanggal Sesi <span class="req-star">*</span></label>
                <input id="rme-date" name="session_date" class="input" type="date" value="${esc(todayInputDate())}" required>
              </div>

              <div class="field">
                <label for="rme-mode">Jenis Sesi <span class="req-star">*</span></label>
                <select id="rme-mode" name="session_mode" class="select">
                  <option value="OFFLINE">Offline (Tatap Muka)</option>
                  <option value="ONLINE">Online (Video Call)</option>
                </select>
              </div>

              <div class="field field-span-full">
                <label for="rme-complaint">Keluhan Saat Ini <span class="req-star">*</span></label>
                <textarea id="rme-complaint" name="chief_complaint" class="textarea textarea-clinical"
                  placeholder="Tuliskan keluhan, kondisi emosional, atau perkembangan sejak sesi sebelumnya..." required></textarea>
              </div>

              <div class="field field-span-full">
                <label for="rme-obs">Observasi / Subjektif</label>
                <textarea id="rme-obs" name="observation" class="textarea"
                  placeholder="Ekspresi, bahasa tubuh, respons awal, tingkat relaksasi..."></textarea>
              </div>

              <div class="field field-span-full">
                <label for="rme-int">Teknik Intervensi Hipnoterapi</label>
                <textarea id="rme-int" name="intervention" class="textarea"
                  placeholder="Induksi, deepening, teknik terapi (regresi, parts therapy, anchoring, reframing, dll.)..."></textarea>
              </div>

              <div class="field">
                <label for="rme-resp">Respons Klien</label>
                <textarea id="rme-resp" name="client_response" class="textarea"
                  placeholder="Respons selama dan sesudah sesi..."></textarea>
              </div>

              <div class="field">
                <label for="rme-hw">Tugas Rumah (Homework)</label>
                <textarea id="rme-hw" name="homework" class="textarea"
                  placeholder="Latihan self-hypnosis, jurnal, atau afirmasi..."></textarea>
              </div>

              <div class="field">
                <label for="rme-next">Fokus Sesi Berikutnya</label>
                <textarea id="rme-next" name="next_focus" class="textarea"
                  placeholder="Agenda atau area yang perlu dilanjutkan di sesi mendatang..."></textarea>
              </div>

              <div class="field">
                <label for="rme-score">Skala Kemajuan (1–10)</label>
                <input id="rme-score" name="progress_score" class="input" type="number" min="1" max="10" placeholder="1 (awal) s.d. 10 (sangat baik)">
                <label for="rme-notes" class="mt-2">Catatan Tambahan</label>
                <textarea id="rme-notes" name="notes" class="textarea" rows="2"></textarea>
              </div>
            </div>

            <div class="flex-between mt-4">
              <span class="text-xs text-muted">Catatan klinis dilindungi server &amp; tidak dicatat mentah ke Audit Log.</span>
              <div class="flex-gap">
                <button type="button" class="btn btn-secondary" id="btn-rme-reset">Reset Form</button>
                <button type="submit" class="btn btn-primary" id="btn-rme-submit">Simpan Sesi RME</button>
              </div>
            </div>
          </form>
        </section>

        <aside class="context-panel" id="rme-context-panel" aria-live="polite">
          <div class="flex-between">
            <h2 class="card-title">Panel Context Reference</h2>
            <span class="badge badge-primary">Otomatis</span>
          </div>
          <p class="card-desc mt-2">Pilih klien di form sebelah untuk menampilkan ringkasan Assessment awal dan 3 sesi RME terakhir secara otomatis.</p>
          <div id="rme-context-body" class="mt-4">
            <div class="empty-state" style="padding:20px 10px;">
              <p class="empty-state-desc" style="margin:0;">Belum ada klien dipilih.</p>
            </div>
          </div>
        </aside>
      </div>
    ` : ''}

    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Riwayat RME / Sesi Terapi</h2>
          <p class="card-desc">Seluruh catatan sesi terapi dalam kewenangan Anda.</p>
        </div>
      </div>

      <div class="filter-bar">
        <input type="search" id="rme-search" class="input" placeholder="Cari klien, kode, keluhan, intervensi, atau fokus...">
        ${!isTherapist ? `
          <select id="rme-filter-trp" class="select" aria-label="Filter terapis">
            <option value="">Semua Terapis</option>
            ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('')}
          </select>
        ` : ''}
        <select id="rme-filter-mode" class="select" aria-label="Filter mode sesi">
          <option value="">Online &amp; Offline</option>
          <option value="OFFLINE">Offline</option>
          <option value="ONLINE">Online</option>
        </select>
        <input type="date" id="rme-filter-from" class="input" aria-label="Dari tanggal" title="Dari tanggal">
        <input type="date" id="rme-filter-to" class="input" aria-label="Sampai tanggal" title="Sampai tanggal">
      </div>

      <div id="rme-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="rme-pagination"></div>
    </section>
  `;

  const form = container.querySelector('#rme-form');
  const formTitle = container.querySelector('#rme-form-title');
  const nextBadge = container.querySelector('#rme-next-session-badge');
  const cancelEditBtn = container.querySelector('#btn-rme-cancel-edit');
  const submitBtn = container.querySelector('#btn-rme-submit');
  const contextBody = container.querySelector('#rme-context-body');
  const aptSelect = container.querySelector('#rme-apt');
  const aptWrap = container.querySelector('#rme-apt-wrap');
  const listWrap = container.querySelector('#rme-list-wrap');
  const pagWrap = container.querySelector('#rme-pagination');

  let clientAc = null;

  async function loadContextReference(clientId, selectedAptId = '') {
    if (!contextBody) return;
    if (!clientId) {
      if (nextBadge) nextBadge.hidden = true;
      if (aptSelect) aptSelect.innerHTML = '<option value="">-- Tidak ditautkan ke jadwal --</option>';
      contextBody.innerHTML = '<div class="empty-state" style="padding:20px 10px;"><p class="empty-state-desc" style="margin:0;">Belum ada klien dipilih.</p></div>';
      return;
    }

    contextBody.innerHTML = '<div class="skeleton" style="height:120px;width:100%;"></div>';
    try {
      const res = await apiCall('rme.context', { client_id: clientId });
      const ctx = res.data;

      if (nextBadge && !editingRecord) {
        nextBadge.textContent = `Sesi Berikutnya: #${ctx.next_session_no}`;
        nextBadge.hidden = false;
      }

      if (!isTherapist && form && form.therapist_id && !form.therapist_id.value && ctx.client.primary_therapist_id) {
        form.therapist_id.value = ctx.client.primary_therapist_id;
      }

      if (aptSelect && !editingRecord) {
        const openApts = ctx.open_appointments || [];
        aptSelect.innerHTML = '<option value="">-- Tidak ditautkan ke jadwal --</option>' +
          openApts.map((a) => `
            <option value="${esc(a.appointment_id)}" ${selectedAptId === a.appointment_id ? 'selected' : ''}>
              ${esc(formatDateId(a.scheduled_date))} ${esc(a.start_time)} WIB (${esc(a.session_mode)})
            </option>
          `).join('');
      }

      const asm = ctx.latest_assessment;
      const sessions = ctx.recent_sessions || [];

      contextBody.innerHTML = `
        <div class="context-item">
          <div class="flex-between">
            <strong>${esc(ctx.client.full_name)}</strong>
            ${statusBadge('client', ctx.client.status)}
          </div>
          <div class="text-xs text-muted mt-2 font-mono">
            ${esc(ctx.client.client_code)} • Total ${esc(ctx.client.total_sessions || 0)} sesi • Terakhir: ${esc(formatDateId(ctx.client.last_session_at))}
          </div>
        </div>

        <div class="context-item">
          <div class="flex-between">
            <strong>Assessment Awal Terbaru</strong>
            ${asm ? `<span class="text-xs text-muted">${esc(formatDateId(asm.assessment_date))}</span>` : ''}
          </div>
          ${asm ? `
            <div class="text-sm mt-2"><strong>Keluhan:</strong> ${esc(asm.main_complaint)}</div>
            ${asm.triggers ? `<div class="text-xs text-muted mt-2"><strong>Pemicu:</strong> ${esc(asm.triggers)}</div>` : ''}
            ${asm.therapy_goals ? `<div class="text-xs text-muted mt-2"><strong>Tujuan:</strong> ${esc(asm.therapy_goals)}</div>` : ''}
            ${asm.risk_screening ? `<div class="text-xs mt-2" style="color:var(--color-danger);"><strong>Skrining Risiko:</strong> ${esc(asm.risk_screening)}</div>` : ''}
          ` : '<p class="text-xs text-muted mt-2" style="margin-bottom:0;">Belum ada assessment awal tercatat.</p>'}
        </div>

        <div class="mt-4">
          <strong class="text-sm">3 Sesi RME Terakhir</strong>
          ${sessions.length === 0 ? `
            <div class="context-item text-xs text-muted">Belum ada sesi terapi sebelumnya. Ini akan menjadi Sesi #1.</div>
          ` : sessions.map((s) => `
            <div class="context-item">
              <div class="flex-between">
                <span class="badge badge-primary">Sesi #${esc(s.session_no)}</span>
                <span class="text-xs text-muted">${esc(formatDateId(s.session_date))} ${s.progress_score ? `• Skor ${esc(s.progress_score)}/10` : ''}</span>
              </div>
              <div class="text-xs mt-2"><strong>Keluhan:</strong> ${esc(s.chief_complaint)}</div>
              ${s.intervention ? `<div class="text-xs text-muted mt-2"><strong>Intervensi:</strong> ${esc(s.intervention)}</div>` : ''}
              ${s.homework ? `<div class="text-xs text-muted mt-2"><strong>PR:</strong> ${esc(s.homework)}</div>` : ''}
              ${s.next_focus ? `<div class="text-xs mt-2" style="color:var(--color-primary);"><strong>Fokus Sesi Berikutnya:</strong> ${esc(s.next_focus)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      contextBody.innerHTML = `<div class="context-item text-xs" style="color:var(--color-danger);">Gagal memuat context: ${esc(err.message)}</div>`;
    }
  }

  if (form) {
    form.querySelectorAll('textarea').forEach((ta) => autoResizeTextarea(ta));
    clientAc = mountClientAutocomplete(container.querySelector('#rme-client-ac'), {
      inputName: 'client_id',
      initialClient,
      onSelect: (client) => loadContextReference(client.client_id)
    });
    if (initialClient) {
      loadContextReference(initialClient.client_id, prefillAptId);
    }
  }

  function resetFormToCreate() {
    if (!form) return;
    editingRecord = null;
    clearFieldErrors(form);
    form.reset();
    form.session_date.value = todayInputDate();
    if (clientAc) clientAc.setClient(null);
    const acInput = form.querySelector('[data-ac-input]');
    if (acInput) acInput.disabled = false;
    if (aptWrap) aptWrap.hidden = false;
    formTitle.textContent = 'Catat Sesi Terapi (RME)';
    submitBtn.textContent = 'Simpan Sesi RME';
    cancelEditBtn.hidden = true;
    loadContextReference('');
  }

  function populateFormForEdit(rec) {
    if (!form) return;
    editingRecord = rec;
    clearFieldErrors(form);
    if (clientAc) {
      clientAc.setClient({ client_id: rec.client_id, full_name: rec.client_name, client_code: rec.client_code });
    }
    const acInput = form.querySelector('[data-ac-input]');
    if (acInput) acInput.disabled = true;
    if (aptWrap) aptWrap.hidden = true;
    if (!isTherapist && form.therapist_id) form.therapist_id.value = rec.therapist_id || '';
    form.session_date.value = rec.session_date || todayInputDate();
    form.session_mode.value = rec.session_mode || 'OFFLINE';
    form.chief_complaint.value = rec.chief_complaint || '';
    form.observation.value = rec.observation || '';
    form.intervention.value = rec.intervention || '';
    form.client_response.value = rec.client_response || '';
    form.homework.value = rec.homework || '';
    form.next_focus.value = rec.next_focus || '';
    form.progress_score.value = rec.progress_score || '';
    form.notes.value = rec.notes || '';
    form.querySelectorAll('textarea').forEach((ta) => ta.dispatchEvent(new Event('input')));

    formTitle.textContent = `Edit RME Sesi #${rec.session_no} — ${rec.client_name}`;
    if (nextBadge) {
      nextBadge.textContent = `Mengedit Sesi #${rec.session_no}`;
      nextBadge.hidden = false;
    }
    submitBtn.textContent = 'Perbarui RME';
    cancelEditBtn.hidden = false;
    loadContextReference(rec.client_id);
    container.querySelector('#rme-form-card')?.scrollIntoView({ behavior: 'smooth' });
  }

  if (form) {
    cancelEditBtn.addEventListener('click', resetFormToCreate);
    container.querySelector('#btn-rme-reset')?.addEventListener('click', resetFormToCreate);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      const clientId = clientAc ? clientAc.getValue() : '';
      if (!clientId) {
        toast('Silakan pilih klien terlebih dahulu.', 'warning');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan...';

      const payload = {
        client_id: clientId,
        session_date: form.session_date.value,
        session_mode: form.session_mode.value,
        chief_complaint: form.chief_complaint.value.trim(),
        observation: form.observation.value.trim(),
        intervention: form.intervention.value.trim(),
        client_response: form.client_response.value.trim(),
        homework: form.homework.value.trim(),
        next_focus: form.next_focus.value.trim(),
        progress_score: form.progress_score.value === '' ? '' : Number(form.progress_score.value),
        notes: form.notes.value.trim()
      };
      if (!isTherapist && form.therapist_id) {
        payload.therapist_id = form.therapist_id.value;
      }

      try {
        if (editingRecord) {
          payload.rme_id = editingRecord.rme_id;
          payload.expected_version = editingRecord.version;
          await apiCall('rme.update', payload, { write: true });
          toast('Catatan RME berhasil diperbarui.', 'success');
        } else {
          if (aptSelect && aptSelect.value) {
            payload.appointment_id = aptSelect.value;
          }
          const res = await apiCall('rme.create', payload, { write: true });
          toast(`RME Sesi #${res.data.rme.session_no} berhasil disimpan.`, 'success');
        }
        resetFormToCreate();
        loadRmeList();
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingRecord ? 'Perbarui RME' : 'Simpan Sesi RME';
      }
    });
  }

  async function loadRmeList() {
    listWrap.innerHTML = renderSkeletonTable(5);
    try {
      const res = await apiCall('rme.list', {
        page: listState.page,
        limit: listState.limit,
        q: listState.q,
        filters: {
          therapist_id: listState.therapist_id || undefined,
          session_mode: listState.session_mode || undefined,
          date_from: listState.date_from || undefined,
          date_to: listState.date_to || undefined
        }
      });
      const items = (res.data && res.data.items) || [];
      renderTable(items);
      renderPagination(pagWrap, res.meta, (p) => {
        listState.page = p;
        loadRmeList();
      });
    } catch (err) {
      listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat riwayat RME</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      toast(err.message, 'danger');
    }
  }

  function openRmeViewModal(r) {
    openModal({
      title: `RME Sesi #${r.session_no} — ${r.client_name}`,
      size: 'lg',
      bodyHtml: `
        <div class="flex-between mb-3 text-sm">
          <span><strong>Klien:</strong> ${esc(r.client_name)} <span class="font-mono text-muted">(${esc(r.client_code)})</span></span>
          <span>${esc(formatDateId(r.session_date))} ${statusBadge('mode', r.session_mode)} • Terapis: <strong>${esc(r.therapist_name || '-')}</strong></span>
        </div>
        ${r.progress_score ? `<div class="mb-3"><span class="badge badge-success">Skala Kemajuan: ${esc(r.progress_score)} / 10</span></div>` : ''}
        <div class="context-item"><strong>Keluhan Saat Ini</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.chief_complaint || '-')}</div></div>
        <div class="context-item"><strong>Observasi / Subjektif</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.observation || '-')}</div></div>
        <div class="context-item"><strong>Teknik Intervensi</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.intervention || '-')}</div></div>
        <div class="context-item"><strong>Respons Klien</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.client_response || '-')}</div></div>
        <div class="context-item"><strong>Tugas Rumah (Homework)</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.homework || '-')}</div></div>
        <div class="context-item"><strong>Fokus Sesi Berikutnya</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.next_focus || '-')}</div></div>
        ${r.notes ? `<div class="context-item"><strong>Catatan Tambahan</strong><div class="text-sm mt-2" style="white-space:pre-wrap;">${esc(r.notes)}</div></div>` : ''}
      `,
      footerHtml: '<button type="button" class="btn btn-primary" data-modal-close>Tutup</button>'
    });
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada catatan RME</p></div>';
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Sesi &amp; Tanggal</th>
              <th>Klien</th>
              <th>Terapis</th>
              <th>Mode</th>
              <th>Ringkasan Keluhan</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((r) => `
              <tr>
                <td class="font-mono text-sm">
                  <span class="badge badge-primary">Sesi #${esc(r.session_no)}</span>
                  <div class="text-xs text-muted mt-2">${esc(formatDateId(r.session_date))}</div>
                </td>
                <td>
                  <button type="button" class="link-btn" data-open-cln="${esc(r.client_id)}">${esc(r.client_name || '-')}</button>
                  <div class="text-xs text-muted font-mono">${esc(r.client_code || '')}</div>
                </td>
                <td>${esc(r.therapist_name || '-')}</td>
                <td>
                  ${statusBadge('mode', r.session_mode)}
                  ${r.progress_score ? `<div class="text-xs text-muted mt-2">Skor ${esc(r.progress_score)}/10</div>` : ''}
                </td>
                <td class="text-sm">${esc(String(r.chief_complaint || '').slice(0, 95))}${String(r.chief_complaint || '').length > 95 ? '…' : ''}</td>
                <td>
                  <div class="table-actions">
                    <button type="button" class="btn btn-soft btn-sm" data-view-rme="${esc(r.rme_id)}">Lihat</button>
                    ${canEdit ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-rme="${esc(r.rme_id)}">Edit</button>` : ''}
                    ${canDelete ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-del-rme="${esc(r.rme_id)}">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const byId = Object.fromEntries(items.map((r) => [r.rme_id, r]));
    listWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    listWrap.querySelectorAll('[data-view-rme]').forEach((b) => b.addEventListener('click', () => openRmeViewModal(byId[b.dataset.viewRme])));
    listWrap.querySelectorAll('[data-edit-rme]').forEach((b) => b.addEventListener('click', () => populateFormForEdit(byId[b.dataset.editRme])));
    listWrap.querySelectorAll('[data-del-rme]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delRme];
        const ok = await confirmDialog({
          title: 'Hapus Catatan RME',
          message: `Hapus (soft delete) RME Sesi #${rec.session_no} milik "${rec.client_name}"? Kolom Terakhir Sesi klien akan dihitung ulang otomatis.`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;
        try {
          await apiCall('rme.delete', { rme_id: rec.rme_id, expected_version: rec.version }, { write: true });
          toast('Catatan RME dihapus.', 'success');
          if (editingRecord && editingRecord.rme_id === rec.rme_id) resetFormToCreate();
          loadRmeList();
        } catch (err) {
          toast(err.message, 'danger');
        }
      });
    });
  }

  let debounce = null;
  container.querySelector('#rme-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { listState.q = e.target.value.trim(); listState.page = 1; loadRmeList(); }, 250);
  });
  container.querySelector('#rme-filter-trp')?.addEventListener('change', (e) => { listState.therapist_id = e.target.value; listState.page = 1; loadRmeList(); });
  container.querySelector('#rme-filter-mode').addEventListener('change', (e) => { listState.session_mode = e.target.value; listState.page = 1; loadRmeList(); });
  container.querySelector('#rme-filter-from').addEventListener('change', (e) => { listState.date_from = e.target.value; listState.page = 1; loadRmeList(); });
  container.querySelector('#rme-filter-to').addEventListener('change', (e) => { listState.date_to = e.target.value; listState.page = 1; loadRmeList(); });

  loadRmeList();
}
