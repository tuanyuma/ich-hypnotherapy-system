/**
 * pages/appointments.js — Jadwal / Appointment (F7):
 * CRUD jadwal, deteksi bentrok waktu terapis, soft cancel dengan alasan,
 * jenis sesi Online/Offline, 5 status, tombol pengingat WhatsApp manual (wa.me),
 * search, filter, dan pagination.
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
  openModal,
  closeModal,
  clearFieldErrors,
  showFieldErrors,
  toast
} from '../ui.js';

export async function renderAppointmentsPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  let therapistOptions = [];
  if (!isTherapist) {
    try {
      const optRes = await apiCall('therapists.options', { active_only: false });
      therapistOptions = (optRes.data && optRes.data.items) || [];
    } catch (_) {
      therapistOptions = [];
    }
  }

  const state = { page: 1, limit: 20, q: '', therapist_id: '', status: '', session_mode: '', date_from: '', date_to: '' };

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Daftar Jadwal / Appointment</h2>
          <p class="card-desc">Penjadwalan sesi Online &amp; Offline dengan deteksi bentrok otomatis dan pengingat WhatsApp manual.</p>
        </div>
        ${can('appointments:add') ? '<button type="button" class="btn btn-primary" id="btn-add-apt">+ Jadwal Baru</button>' : ''}
      </div>

      <div class="filter-bar">
        <input type="search" id="apt-search" class="input" placeholder="Cari klien, kode, WA, terapis, lokasi...">
        ${!isTherapist ? `
          <select id="apt-filter-trp" class="select" aria-label="Filter terapis">
            <option value="">Semua Terapis</option>
            ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('')}
          </select>
        ` : ''}
        <select id="apt-filter-status" class="select" aria-label="Filter status">
          <option value="">Semua Status</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="NO_SHOW">No Show</option>
        </select>
        <select id="apt-filter-mode" class="select" aria-label="Filter jenis sesi">
          <option value="">Online &amp; Offline</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
        </select>
        <input type="date" id="apt-filter-from" class="input" aria-label="Dari tanggal" title="Dari tanggal">
        <input type="date" id="apt-filter-to" class="input" aria-label="Sampai tanggal" title="Sampai tanggal">
      </div>

      <div id="apt-list-wrap">${renderSkeletonTable(5)}</div>
      <div id="apt-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#apt-list-wrap');
  const pagWrap = container.querySelector('#apt-pagination');

  async function loadAppointments() {
    listWrap.innerHTML = renderSkeletonTable(5);
    try {
      const res = await apiCall('appointments.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        filters: {
          therapist_id: state.therapist_id || undefined,
          status: state.status || undefined,
          session_mode: state.session_mode || undefined,
          date_from: state.date_from || undefined,
          date_to: state.date_to || undefined
        }
      });
      const items = (res.data && res.data.items) || [];
      renderTable(items);
      renderPagination(pagWrap, res.meta, (p) => {
        state.page = p;
        loadAppointments();
      });
    } catch (err) {
      listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat jadwal</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      toast(err.message, 'danger');
    }
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada jadwal sesuai filter</p></div>';
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Tanggal &amp; Jam</th>
              <th>Klien</th>
              <th>Terapis</th>
              <th>Jenis &amp; Lokasi</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((a) => {
              const isOpen = a.status === 'SCHEDULED' || a.status === 'CONFIRMED';
              return `
                <tr>
                  <td class="font-mono text-sm">
                    <div><strong>${esc(formatDateId(a.scheduled_date))}</strong></div>
                    <div class="text-xs text-muted">${esc(a.start_time)} WIB (${esc(a.duration_min)} mnt)</div>
                  </td>
                  <td>
                    <button type="button" class="link-btn" data-open-cln="${esc(a.client_id)}">${esc(a.client_name || '-')}</button>
                    <div class="text-xs text-muted font-mono">${esc(a.client_code || '')}</div>
                  </td>
                  <td>${esc(a.therapist_name || '-')}</td>
                  <td>
                    ${statusBadge('mode', a.session_mode)}
                    ${a.location_or_link ? `<div class="text-xs text-muted mt-2">${esc(a.location_or_link)}</div>` : ''}
                  </td>
                  <td>
                    ${statusBadge('appointment', a.status)}
                    ${a.cancel_reason ? `<div class="text-xs text-muted mt-2">Alasan: ${esc(a.cancel_reason)}</div>` : ''}
                  </td>
                  <td>
                    <div class="table-actions">
                      ${a.wa_link && isOpen ? `
                        <button type="button" class="btn btn-wa btn-sm"
                          data-wa-apt="${esc(a.appointment_id)}" data-wa-url="${esc(a.wa_link)}">
                          WA ${a.wa_reminded_at ? '✓' : ''}
                        </button>
                      ` : ''}
                      ${isOpen && can('rme:add') ? `
                        <button type="button" class="btn btn-soft btn-sm" data-to-rme="${esc(a.appointment_id)}" data-cid="${esc(a.client_id)}">+ RME</button>
                      ` : ''}
                      ${can('appointments:edit') ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-apt="${esc(a.appointment_id)}">Edit</button>` : ''}
                      ${isOpen && can('appointments:delete') ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-cancel-apt="${esc(a.appointment_id)}">Batalkan</button>` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    const byId = Object.fromEntries(items.map((a) => [a.appointment_id, a]));
    listWrap.querySelectorAll('[data-open-cln]').forEach((b) => b.addEventListener('click', () => navigate(`#/clients/${b.dataset.openCln}`)));
    listWrap.querySelectorAll('[data-to-rme]').forEach((b) => b.addEventListener('click', () => navigate(`#/rme?client_id=${b.dataset.cid}&appointment_id=${b.dataset.toRme}`)));
    listWrap.querySelectorAll('[data-edit-apt]').forEach((b) => b.addEventListener('click', () => openAppointmentFormModal(byId[b.dataset.editApt], null)));
    listWrap.querySelectorAll('[data-cancel-apt]').forEach((b) => b.addEventListener('click', () => openCancelAppointmentModal(byId[b.dataset.cancelApt])));
    listWrap.querySelectorAll('[data-wa-apt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.open(btn.dataset.waUrl, '_blank', 'noopener,noreferrer');
        apiCall('appointments.markReminded', { appointment_id: btn.dataset.waApt }, { write: true })
          .then(() => { btn.textContent = 'WA ✓'; })
          .catch(() => {});
      });
    });
  }

  async function openAppointmentFormModal(existing = null, prefillClient = null) {
    const isEdit = Boolean(existing);
    const activeTherapists = therapistOptions.filter((t) => t.status === 'ACTIVE' || (existing && t.therapist_id === existing.therapist_id));

    const modal = openModal({
      title: isEdit ? `Edit Jadwal — ${existing.client_name}` : 'Buat Jadwal / Appointment Baru',
      size: 'lg',
      bodyHtml: `
        <form id="apt-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field field-span-full">
              <label>Klien <span class="req-star">*</span></label>
              <div id="apt-client-ac"></div>
            </div>
            ${!isTherapist ? `
              <div class="field">
                <label for="ap-trp">Terapis <span class="req-star">*</span></label>
                <select id="ap-trp" name="therapist_id" class="select" required>
                  <option value="">-- Pilih Terapis --</option>
                  ${activeTherapists.map((t) => `
                    <option value="${esc(t.therapist_id)}" ${(existing && existing.therapist_id === t.therapist_id) || (prefillClient && prefillClient.primary_therapist_id === t.therapist_id) ? 'selected' : ''}>
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
              <label for="ap-mode">Jenis Sesi <span class="req-star">*</span></label>
              <select id="ap-mode" name="session_mode" class="select">
                <option value="OFFLINE" ${(!existing || existing.session_mode === 'OFFLINE') ? 'selected' : ''}>Offline (Tatap Muka)</option>
                <option value="ONLINE" ${existing && existing.session_mode === 'ONLINE' ? 'selected' : ''}>Online (Video Call)</option>
              </select>
            </div>
            <div class="field">
              <label for="ap-date">Tanggal Sesi <span class="req-star">*</span></label>
              <input id="ap-date" name="scheduled_date" class="input" type="date" value="${esc(existing ? existing.scheduled_date : todayInputDate())}" required>
            </div>
            <div class="field">
              <label for="ap-time">Jam Mulai (WIB) <span class="req-star">*</span></label>
              <input id="ap-time" name="start_time" class="input" type="time" value="${esc(existing ? existing.start_time : '10:00')}" required>
            </div>
            <div class="field">
              <label for="ap-dur">Durasi (menit)</label>
              <input id="ap-dur" name="duration_min" class="input" type="number" min="15" max="300" step="15" value="${esc(existing ? existing.duration_min : 60)}">
            </div>
            <div class="field">
              <label for="ap-status">Status Jadwal</label>
              <select id="ap-status" name="status" class="select">
                <option value="SCHEDULED" ${(!existing || existing.status === 'SCHEDULED') ? 'selected' : ''}>Scheduled</option>
                <option value="CONFIRMED" ${existing && existing.status === 'CONFIRMED' ? 'selected' : ''}>Confirmed</option>
                ${isEdit ? `
                  <option value="COMPLETED" ${existing.status === 'COMPLETED' ? 'selected' : ''}>Completed</option>
                  <option value="NO_SHOW" ${existing.status === 'NO_SHOW' ? 'selected' : ''}>No Show</option>
                ` : ''}
              </select>
            </div>
            <div class="field field-span-full">
              <label for="ap-loc">Lokasi / Link Meeting</label>
              <input id="ap-loc" name="location_or_link" class="input" type="text"
                value="${esc(existing ? existing.location_or_link : '')}" placeholder="Ruang Terapi 1 atau tautan Zoom / Google Meet">
            </div>
            <div class="field field-span-full">
              <label for="ap-notes">Catatan Jadwal</label>
              <textarea id="ap-notes" name="notes" class="textarea" rows="2">${esc(existing ? existing.notes : '')}</textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="apt-form" class="btn btn-primary" id="btn-save-apt">${isEdit ? 'Simpan Perubahan' : 'Buat Jadwal'}</button>
      `
    });

    const form = modal.querySelector('#apt-form');
    const saveBtn = modal.querySelector('#btn-save-apt');
    const ac = mountClientAutocomplete(modal.querySelector('#apt-client-ac'), {
      inputName: 'client_id',
      initialClient: existing
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

      saveBtn.disabled = true;
      saveBtn.textContent = 'Menyimpan...';
      const payload = {
        client_id: clientId,
        scheduled_date: form.scheduled_date.value,
        start_time: form.start_time.value,
        duration_min: Number(form.duration_min.value || 60),
        session_mode: form.session_mode.value,
        status: form.status.value,
        location_or_link: form.location_or_link.value.trim(),
        notes: form.notes.value.trim()
      };
      if (!isTherapist && form.therapist_id) {
        payload.therapist_id = form.therapist_id.value;
      }

      try {
        if (isEdit) {
          payload.appointment_id = existing.appointment_id;
          payload.expected_version = existing.version;
          await apiCall('appointments.update', payload, { write: true });
          toast('Jadwal berhasil diperbarui.', 'success');
        } else {
          await apiCall('appointments.create', payload, { write: true });
          toast('Jadwal baru berhasil dibuat.', 'success');
        }
        closeModal();
        loadAppointments();
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Simpan Perubahan' : 'Buat Jadwal';
      }
    });
  }

  function openCancelAppointmentModal(apt) {
    const modal = openModal({
      title: 'Batalkan Jadwal (Soft Cancel)',
      bodyHtml: `
        <p class="text-sm" style="margin:0 0 12px;">
          Batalkan jadwal <strong>${esc(apt.client_name)}</strong> pada <strong>${esc(formatDateId(apt.scheduled_date))} ${esc(apt.start_time)} WIB</strong>?
          Riwayat jadwal tetap tersimpan dan slot waktu terapis akan terbuka kembali.
        </p>
        <form id="cancel-apt-form" novalidate>
          <div class="field">
            <label for="cancel-reason">Alasan Pembatalan <span class="req-star">*</span></label>
            <textarea id="cancel-reason" name="cancel_reason" class="textarea" rows="3"
              placeholder="Contoh: Klien berhalangan hadir dan meminta reschedule." required></textarea>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Kembali</button>
        <button type="submit" form="cancel-apt-form" class="btn btn-danger" id="btn-confirm-cancel">Ya, Batalkan Jadwal</button>
      `
    });

    const form = modal.querySelector('#cancel-apt-form');
    const btn = modal.querySelector('#btn-confirm-cancel');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      btn.disabled = true;
      btn.textContent = 'Membatalkan...';
      try {
        await apiCall('appointments.cancel', {
          appointment_id: apt.appointment_id,
          expected_version: apt.version,
          cancel_reason: form.cancel_reason.value.trim()
        }, { write: true });
        closeModal();
        toast('Jadwal dibatalkan dan slot terapis telah dibuka kembali.', 'success');
        loadAppointments();
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Ya, Batalkan Jadwal';
      }
    });
  }

  container.querySelector('#btn-add-apt')?.addEventListener('click', () => openAppointmentFormModal(null, null));

  let debounce = null;
  container.querySelector('#apt-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadAppointments(); }, 250);
  });
  container.querySelector('#apt-filter-trp')?.addEventListener('change', (e) => { state.therapist_id = e.target.value; state.page = 1; loadAppointments(); });
  container.querySelector('#apt-filter-status').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; loadAppointments(); });
  container.querySelector('#apt-filter-mode').addEventListener('change', (e) => { state.session_mode = e.target.value; state.page = 1; loadAppointments(); });
  container.querySelector('#apt-filter-from').addEventListener('change', (e) => { state.date_from = e.target.value; state.page = 1; loadAppointments(); });
  container.querySelector('#apt-filter-to').addEventListener('change', (e) => { state.date_to = e.target.value; state.page = 1; loadAppointments(); });

  await loadAppointments();

  if (route && route.query && route.query.new === '1' && can('appointments:add')) {
    let prefill = null;
    if (route.query.client_id) {
      try {
        const cRes = await apiCall('clients.get', { client_id: route.query.client_id });
        prefill = cRes.data && cRes.data.client;
      } catch (_) {}
    }
    openAppointmentFormModal(null, prefill);
  }
}
