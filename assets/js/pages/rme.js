/**
 * pages/rme.js — Rekam Medis Elektronik / Sesi Terapi (F8):
 * - Tampilan utama fokus langsung ke Tabel Riwayat RME / Sesi Terapi (list-first)
 * - Tombol "+ Catat Sesi RME" & aksi "Edit" membuka Modal XL 2-kolom (GSAP smooth):
 *   Kiri: Form pencatatan sesi lengkap | Kanan: Panel Context Reference otomatis
 * - SWR in-memory cache + Top Progress Bar + inline spinner + Optimistic Delete dengan rollback.
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import { navigate } from '../router.js';
import {
  esc,
  formatDateId,
  formatTimeId,
  todayInputDate,
  statusBadge,
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

export async function renderRmePage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAdd = can('rme:add');
  const canEdit = can('rme:edit');
  const canDelete = can('rme:delete');

  let therapistOptions = !isTherapist
    ? ((storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [])
    : [];

  const listState = {
    page: 1,
    limit: 10,
    q: '',
    therapist_id: '',
    session_mode: '',
    date_from: '',
    date_to: '',
    sort: { field: 'rme_code', dir: 'desc' }
  };
  let activeFetchId = 0;

  function buildCacheKey() {
    return `rme:list:p${listState.page}:l${listState.limit}:q=${listState.q}:t=${listState.therapist_id}:m=${listState.session_mode}:f=${listState.date_from}:to=${listState.date_to}:sf=${listState.sort.field}:${listState.sort.dir}`;
  }

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Riwayat RME / Sesi Terapi</h2>
          <p class="card-desc">Seluruh catatan sesi terapi dalam kewenangan Anda. Klik Catat Sesi RME untuk mencatat sesi baru lengkap dengan Context Reference otomatis.</p>
        </div>
        ${canAdd ? '<button type="button" class="btn btn-primary" id="btn-add-rme">+ Catat Sesi RME</button>' : ''}
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

  const listWrap = container.querySelector('#rme-list-wrap');
  const pagWrap = container.querySelector('#rme-pagination');
  const addBtn = container.querySelector('#btn-add-rme');

  // Isi opsi terapis untuk filter di latar belakang bila belum ada di RAM
  if (!isTherapist && therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false })
      .then((opts) => {
        therapistOptions = opts;
        const filterSelect = container.querySelector('#rme-filter-trp');
        if (filterSelect) {
          const prevF = filterSelect.value;
          filterSelect.innerHTML = '<option value="">Semua Terapis</option>' +
            opts.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('');
          filterSelect.value = prevF;
        }
      })
      .catch(() => {});
  }

  async function openRmeFormModal(existing = null, prefillClient = null, prefillAptId = '', triggerBtn = null) {
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
      title: isEdit ? `Edit RME Sesi #${existing.session_no} — ${existing.client_name}` : 'Catat Sesi Terapi (RME)',
      size: 'xl',
      bodyHtml: `
        <div class="rme-modal-split">
          <form id="rme-form" novalidate>
            ${isEdit ? `
              <div class="context-item flex-between mb-3 text-sm">
                <div><strong>ID Sesi:</strong> <span class="code-chip">${esc(existing.rme_code || existing.rme_id)}</span></div>
                <div><strong>ID Klien:</strong> <span class="code-chip">${esc(existing.client_code)}</span> • <span class="session-chip">Sesi ke-${esc(existing.session_no)}</span></div>
              </div>
            ` : `
              <div class="flex-between mb-3">
                <span class="text-xs text-muted">Nomor sesi bertambah otomatis tanpa batas saat disimpan di server.</span>
                <span id="rme-next-session-badge" class="session-chip" hidden></span>
              </div>
            `}

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

              <div class="field" id="rme-apt-wrap" ${isEdit ? 'hidden' : ''}>
                <label for="rme-apt">Tautkan Jadwal Aktif (Opsional)</label>
                <select id="rme-apt" name="appointment_id" class="select">
                  <option value="">-- Tidak ditautkan ke jadwal --</option>
                </select>
                <span class="field-hint">Bila dipilih, status jadwal otomatis menjadi Completed.</span>
              </div>

              <div class="field" id="rme-pkg-wrap" ${isEdit ? 'hidden' : ''}>
                <label for="rme-pkg">Potong Kuota Paket Aktif (Opsional)</label>
                <select id="rme-pkg" name="client_package_id" class="select">
                  <option value="">-- Sesi Reguler / Tanpa Paket --</option>
                </select>
                <span class="field-hint">Bila dipilih, sisa sesi paket klien otomatis berkurang 1.</span>
              </div>

              <div class="field">
                <label for="rme-date">Tanggal Sesi <span class="req-star">*</span></label>
                <input id="rme-date" name="session_date" class="input" type="date"
                  value="${esc(isEdit ? (existing.session_date || todayInputDate()) : todayInputDate())}" required>
              </div>

              <div class="field">
                <label for="rme-mode">Jenis Sesi <span class="req-star">*</span></label>
                <select id="rme-mode" name="session_mode" class="select">
                  <option value="OFFLINE" ${(!isEdit || existing.session_mode === 'OFFLINE') ? 'selected' : ''}>Offline (Tatap Muka)</option>
                  <option value="ONLINE" ${isEdit && existing.session_mode === 'ONLINE' ? 'selected' : ''}>Online (Video Call)</option>
                </select>
              </div>

              <div class="field field-span-full">
                <label for="rme-complaint">Keluhan Saat Ini <span class="req-star">*</span></label>
                <textarea id="rme-complaint" name="chief_complaint" class="textarea textarea-clinical"
                  placeholder="Tuliskan keluhan, kondisi emosional, atau perkembangan sejak sesi sebelumnya..." required>${esc(isEdit ? existing.chief_complaint : '')}</textarea>
              </div>

              <div class="field field-span-full">
                <label for="rme-obs">Observasi / Subjektif</label>
                <textarea id="rme-obs" name="observation" class="textarea"
                  placeholder="Ekspresi, bahasa tubuh, respons awal, tingkat relaksasi...">${esc(isEdit ? existing.observation : '')}</textarea>
              </div>

              <div class="field field-span-full">
                <label for="rme-int">Teknik Intervensi Hipnoterapi</label>
                <textarea id="rme-int" name="intervention" class="textarea"
                  placeholder="Induksi, deepening, teknik terapi (regresi, parts therapy, anchoring, reframing, dll.)...">${esc(isEdit ? existing.intervention : '')}</textarea>
              </div>

              <div class="field">
                <label for="rme-resp">Respons Klien</label>
                <textarea id="rme-resp" name="client_response" class="textarea"
                  placeholder="Respons selama dan sesudah sesi...">${esc(isEdit ? existing.client_response : '')}</textarea>
              </div>

              <div class="field">
                <label for="rme-hw">Tugas Rumah (Homework)</label>
                <textarea id="rme-hw" name="homework" class="textarea"
                  placeholder="Latihan self-hypnosis, jurnal, atau afirmasi...">${esc(isEdit ? existing.homework : '')}</textarea>
              </div>

              <div class="field">
                <label for="rme-next">Fokus Sesi Berikutnya</label>
                <textarea id="rme-next" name="next_focus" class="textarea"
                  placeholder="Agenda atau area yang perlu dilanjutkan di sesi mendatang...">${esc(isEdit ? existing.next_focus : '')}</textarea>
              </div>

              <div class="field">
                <label for="rme-score">Skala Kemajuan (1–10)</label>
                <input id="rme-score" name="progress_score" class="input" type="number" min="1" max="10"
                  value="${esc(isEdit && existing.progress_score ? existing.progress_score : '')}"
                  placeholder="1 (awal) s.d. 10 (sangat baik)">
                <label for="rme-notes" class="mt-2">Catatan Tambahan</label>
                <textarea id="rme-notes" name="notes" class="textarea" rows="2">${esc(isEdit ? existing.notes : '')}</textarea>
              </div>
            </div>

            <p class="text-xs text-muted mt-4" style="margin-bottom:0;">
              Catatan klinis dilindungi server &amp; tidak dicatat mentah ke Audit Log.
            </p>
          </form>

          <aside class="context-panel" id="rme-context-panel" aria-live="polite">
            <div class="flex-between">
              <h3 class="card-title">Panel Context Reference</h3>
              <span class="badge badge-primary">Otomatis</span>
            </div>
            <p class="card-desc mt-2">Pilih klien di sebelah kiri untuk menampilkan ringkasan Assessment awal dan 3 sesi RME terakhir secara otomatis.</p>
            <div id="rme-context-body" class="mt-4">
              <div class="empty-state" style="padding:20px 10px;">
                <p class="empty-state-desc" style="margin:0;">Belum ada klien dipilih.</p>
              </div>
            </div>
          </aside>
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="rme-form" class="btn btn-primary" id="btn-rme-submit">
          ${isEdit ? 'Perbarui RME' : 'Simpan Sesi RME'}
        </button>
      `
    });

    const form = modal.querySelector('#rme-form');
    const nextBadge = modal.querySelector('#rme-next-session-badge');
    const submitBtn = modal.querySelector('#btn-rme-submit');
    const contextBody = modal.querySelector('#rme-context-body');
    const aptSelect = modal.querySelector('#rme-apt');
    const pkgSelect = modal.querySelector('#rme-pkg');

    async function loadContextReference(clientId, selectedAptId = '') {
      if (!contextBody) return;
      if (!clientId) {
        if (nextBadge && !isEdit) nextBadge.hidden = true;
        if (aptSelect) aptSelect.innerHTML = '<option value="">-- Tidak ditautkan ke jadwal --</option>';
        if (pkgSelect) pkgSelect.innerHTML = '<option value="">-- Sesi Reguler / Tanpa Paket --</option>';
        contextBody.innerHTML = '<div class="empty-state" style="padding:20px 10px;"><p class="empty-state-desc" style="margin:0;">Belum ada klien dipilih.</p></div>';
        return;
      }

      contextBody.innerHTML = '<div class="skeleton" style="height:120px;width:100%;"></div>';
      try {
        const res = await apiCall('rme.context', { client_id: clientId });
        const ctx = res.data;

        if (nextBadge && !isEdit) {
          nextBadge.textContent = `Sesi ke-${ctx.next_session_no}`;
          nextBadge.hidden = false;
        }

        if (!isTherapist && form && form.therapist_id && !form.therapist_id.value && ctx.client.primary_therapist_id) {
          form.therapist_id.value = ctx.client.primary_therapist_id;
        }

        if (aptSelect && !isEdit) {
          const openApts = ctx.open_appointments || [];
          aptSelect.innerHTML = '<option value="">-- Tidak ditautkan ke jadwal --</option>' +
            openApts.map((a) => `
              <option value="${esc(a.appointment_id)}" ${selectedAptId === a.appointment_id ? 'selected' : ''}>
                ${esc(formatDateId(a.scheduled_date))} ${esc(formatTimeId(a.start_time))} WIB (${esc(a.session_mode)})
              </option>
            `).join('');
        }

        const activePkgs = ctx.active_packages || [];
        if (pkgSelect && !isEdit) {
          pkgSelect.innerHTML = '<option value="">-- Sesi Reguler / Tanpa Paket --</option>' +
            activePkgs.map((cp, idx) => `
              <option value="${esc(cp.client_package_id)}" ${idx === 0 ? 'selected' : ''}>
                ${esc(cp.package_name)} — Sisa ${esc(cp.remaining_sessions)}/${esc(cp.total_sessions)} sesi (s/d ${esc(formatDateId(cp.expiry_date))})
              </option>
            `).join('');
        }

        const asm = ctx.latest_assessment;
        const sessions = ctx.recent_sessions || [];

        contextBody.innerHTML = `
          <div class="context-item">
            <div class="flex-between">
              <div><strong>${esc(ctx.client.full_name)}</strong> <span class="code-chip">${esc(ctx.client.client_code)}</span></div>
              ${statusBadge('client', ctx.client.status)}
            </div>
            <div class="text-xs text-muted mt-2">
              Total <strong>${esc(ctx.client.total_sessions || 0)}</strong> sesi • Terakhir: <strong>${esc(formatDateId(ctx.client.last_session_at))}</strong>
            </div>
            ${activePkgs.length > 0 ? `
              <div class="mt-2">
                ${activePkgs.map((cp) => `
                  <span class="quota-chip">Paket ${esc(cp.package_name)}: Sisa ${esc(cp.remaining_sessions)} dari ${esc(cp.total_sessions)} Sesi</span>
                `).join(' ')}
              </div>
            ` : ''}
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
                  <span class="session-chip">Sesi ke-${esc(s.session_no)}</span>
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

    form.querySelectorAll('textarea').forEach((ta) => autoResizeTextarea(ta));

    const clientAc = mountClientAutocomplete(modal.querySelector('#rme-client-ac'), {
      inputName: 'client_id',
      initialClient: isEdit
        ? { client_id: existing.client_id, full_name: existing.client_name, client_code: existing.client_code }
        : prefillClient,
      onSelect: (client) => loadContextReference(client.client_id)
    });

    if (isEdit) {
      const acInput = modal.querySelector('[data-ac-input]');
      if (acInput) acInput.disabled = true;
      loadContextReference(existing.client_id);
    } else if (prefillClient) {
      loadContextReference(prefillClient.client_id, prefillAptId);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      const clientId = clientAc ? clientAc.getValue() : '';
      if (!clientId) {
        toast('Silakan pilih klien terlebih dahulu.', 'warning');
        return;
      }

      setButtonLoading(submitBtn, true, 'Menyimpan...');

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
        if (isEdit) {
          payload.rme_id = existing.rme_id;
          payload.expected_version = existing.version;
          await apiCall('rme.update', payload, { write: true });
          toast('Catatan RME berhasil diperbarui.', 'success');
        } else {
          if (aptSelect && aptSelect.value) {
            payload.appointment_id = aptSelect.value;
          }
          if (pkgSelect && pkgSelect.value) {
            payload.client_package_id = pkgSelect.value;
          }
          const res = await apiCall('rme.create', payload, { write: true });
          toast(`RME Sesi ke-${res.data.rme.session_no} berhasil disimpan.`, 'success');
        }
        closeModal();
        storeInvalidate('rme');
        storeInvalidate('clients');
        storeInvalidate('packages');
        storeInvalidate('appointments');
        storeInvalidate('dashboard');
        loadRmeList({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });
  }

  async function loadRmeList({ force = false, silent = false } = {}) {
    const fetchId = ++activeFetchId;
    const key = buildCacheKey();
    const cached = storeGet(key);

    if (cached && Array.isArray(cached.data) && !force) {
      renderTable(cached.data);
      renderPagination(pagWrap, cached.meta, (p) => {
        listState.page = p;
        loadRmeList();
      });
      if (storeIsFresh(key, 30000)) return;
    } else if (!silent) {
      listWrap.innerHTML = renderSkeletonTable(5);
    }

    try {
      const res = await apiCall('rme.list', {
        page: listState.page,
        limit: listState.limit,
        q: listState.q,
        sort: listState.sort,
        filters: {
          therapist_id: listState.therapist_id || undefined,
          session_mode: listState.session_mode || undefined,
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
          loadRmeList();
        });
      }
    } catch (err) {
      if (fetchId !== activeFetchId) return;
      if (!cached) {
        listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat riwayat RME</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  function openRmeViewModal(r) {
    openModal({
      title: `RME Sesi ke-${r.session_no} — ${r.client_name}`,
      size: 'lg',
      bodyHtml: `
        <div class="context-item flex-between mb-3 text-sm">
          <div>
            <strong>ID Sesi:</strong> <span class="code-chip">${esc(r.rme_code || r.rme_id)}</span>
            <span style="margin-left:8px;"><strong>Klien:</strong> ${esc(r.client_name)} <span class="code-chip">${esc(r.client_code)}</span></span>
            <span style="margin-left:6px;" class="session-chip">Sesi ke-${esc(r.session_no)}</span>
          </div>
          <div>${esc(formatDateId(r.session_date))} ${statusBadge('mode', r.session_mode)} • Terapis: <strong>${esc(r.therapist_name || '-')}</strong></div>
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
      listWrap.innerHTML = `
        <div class="empty-state">
          <p class="empty-state-title">Belum ada catatan RME</p>
          <p class="empty-state-desc">Klik tombol Catat Sesi RME untuk mulai mendokumentasikan sesi terapi klien.</p>
          ${canAdd ? '<button type="button" class="btn btn-primary btn-sm" id="btn-empty-add-rme">+ Catat Sesi RME</button>' : ''}
        </div>
      `;
      listWrap.querySelector('#btn-empty-add-rme')?.addEventListener('click', (e) => {
        openRmeFormModal(null, null, '', e.currentTarget);
      });
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              ${sortableTh('ID Sesi', 'rme_code', listState.sort)}
              <th>Klien</th>
              <th>Sesi ke-</th>
              ${sortableTh('Tanggal', 'session_date', listState.sort)}
              <th>Terapis</th>
              <th>Mode</th>
              <th>Ringkasan Keluhan</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((r) => `
              <tr data-row-id="${esc(r.rme_id)}">
                <td><span class="code-chip">${esc(r.rme_code || r.rme_id)}</span></td>
                <td>
                  <button type="button" class="link-btn" data-open-cln="${esc(r.client_id)}">${esc(r.client_name || '-')}</button>
                  <div class="mt-2"><span class="code-chip">${esc(r.client_code || '')}</span></div>
                </td>
                <td><span class="session-chip">Sesi ke-${esc(r.session_no)}</span></td>
                <td class="font-mono text-sm"><strong>${esc(formatDateId(r.session_date))}</strong></td>
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

    bindSortableHeaders(listWrap, listState.sort, () => {
      listState.page = 1;
      loadRmeList();
    });

    const byId = Object.fromEntries(items.map((r) => [r.rme_id, r]));
    listWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    listWrap.querySelectorAll('[data-view-rme]').forEach((b) => b.addEventListener('click', () => openRmeViewModal(byId[b.dataset.viewRme])));
    listWrap.querySelectorAll('[data-edit-rme]').forEach((b) => b.addEventListener('click', () => openRmeFormModal(byId[b.dataset.editRme], null, '', b)));
    listWrap.querySelectorAll('[data-del-rme]').forEach((b) => {
      b.addEventListener('click', async () => {
        const rec = byId[b.dataset.delRme];
        if (!rec) return;
        const ok = await confirmDialog({
          title: 'Hapus Catatan RME',
          message: `Hapus (soft delete) RME Sesi #${rec.session_no} milik "${rec.client_name}"? Kolom Terakhir Sesi klien akan dihitung ulang otomatis.`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;

        const rowEl = b.closest('tr');
        setButtonLoading(b, true, 'Menghapus...');
        markRowDeleting(rowEl, true);

        const deleteReq = apiCall('rme.delete', {
          rme_id: rec.rme_id,
          expected_version: rec.version
        }, { write: true });

        await animateRowRemove(rowEl);
        if (rowEl && rowEl.parentElement) rowEl.remove();

        storeUpdateListItems('rme', (arr) => arr.filter((item) => item.rme_id !== rec.rme_id));
        const tbody = listWrap.querySelector('tbody');
        if (tbody && tbody.children.length === 0) renderTable([]);

        try {
          await deleteReq;
          storeInvalidate('rme');
          storeInvalidate('clients');
          storeInvalidate('dashboard');
          toast(`Catatan RME Sesi #${rec.session_no} berhasil dihapus.`, 'success');
          loadRmeList({ force: true, silent: true });
        } catch (err) {
          storeInvalidate('rme');
          toast(err.message, 'danger');
          loadRmeList({ force: true, silent: true });
        }
      });
    });
  }

  addBtn?.addEventListener('click', () => openRmeFormModal(null, null, '', addBtn));

  let debounce = null;
  container.querySelector('#rme-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { listState.q = e.target.value.trim(); listState.page = 1; loadRmeList(); }, 250);
  });
  container.querySelector('#rme-filter-trp')?.addEventListener('change', (e) => { listState.therapist_id = e.target.value; listState.page = 1; loadRmeList(); });
  container.querySelector('#rme-filter-mode').addEventListener('change', (e) => { listState.session_mode = e.target.value; listState.page = 1; loadRmeList(); });
  container.querySelector('#rme-filter-from').addEventListener('change', (e) => { listState.date_from = e.target.value; listState.page = 1; loadRmeList(); });
  container.querySelector('#rme-filter-to').addEventListener('change', (e) => { listState.date_to = e.target.value; listState.page = 1; loadRmeList(); });

  await loadRmeList({ force: Boolean(route && route.forceRefresh) });

  // Auto-buka modal bila datang dari Dashboard (?new=1), Detail Klien (?client_id=...), atau Jadwal (+ RME)
  const prefillClientId = route && route.query ? route.query.client_id : '';
  const prefillAptId = route && route.query ? (route.query.appointment_id || '') : '';
  const wantNew = Boolean(route && route.query && (route.query.new === '1' || prefillClientId));
  if (wantNew && canAdd) {
    let prefillClient = null;
    if (prefillClientId) {
      try {
        const cRes = await apiCall('clients.get', { client_id: prefillClientId });
        prefillClient = cRes.data && cRes.data.client;
      } catch (_) {
        prefillClient = null;
      }
    }
    openRmeFormModal(null, prefillClient, prefillAptId, addBtn);
  }
}
