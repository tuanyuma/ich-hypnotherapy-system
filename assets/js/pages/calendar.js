/**
 * pages/calendar.js — Kalender Kegiatan Klinik & Jadwal Sesi Terapi:
 * - Banner "Agenda Hari Ini" langsung menjawab hari ini ada kegiatan apa saja
 * - Grid kalender bulanan interaktif dengan teks kegiatan/jadwal di tiap sel tanggal
 * - Panel kanan detail tanggal terpilih (default: Hari Ini) + CRUD Kegiatan Klinik
 * - Terintegrasi penuh dengan SWR cache RAM & L2 CacheService backend.
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
  openModal,
  closeModal,
  confirmDialog,
  clearFieldErrors,
  showFieldErrors,
  setButtonLoading,
  toast
} from '../ui.js';
import {
  storeGet,
  storeSet,
  storeIsFresh,
  storeInvalidate,
  getTherapistsOptionsCached
} from '../store.js';

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];
const DAY_NAMES_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const DAY_NAMES_FULL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const EVENT_CATEGORY_LABELS = {
  KEGIATAN_KLINIK: 'Kegiatan Klinik',
  RAPAT: 'Rapat Tim',
  FOLLOW_UP: 'Follow-up Klien',
  SEMINAR: 'Seminar / Workshop',
  LIBUR: 'Libur / Cuti',
  LAINNYA: 'Agenda Lainnya'
};

function formatFullDateId(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd || '').trim());
  if (!m) return formatDateId(yyyyMmDd);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  const dayName = DAY_NAMES_FULL[dt.getUTCDay()];
  const monName = MONTH_NAMES_ID[Number(m[2]) - 1] || m[2];
  return `${dayName}, ${Number(m[3])} ${monName} ${m[1]}`;
}

function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m - 1) + delta, 1, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES_ID[(m || 1) - 1] || ''} ${y || ''}`.trim();
}

function buildMonthGridCells(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const firstDay = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  const daysInMonth = new Date(Date.UTC(y, m, 0, 12, 0, 0)).getUTCDate();
  // Senin = 0 ... Minggu = 6
  const startOffset = (firstDay.getUTCDay() + 6) % 7;
  const cells = [];

  const prevMonthKey = shiftMonthKey(monthKey, -1);
  const [py, pm] = prevMonthKey.split('-').map(Number);
  const daysInPrev = new Date(Date.UTC(py, pm, 0, 12, 0, 0)).getUTCDate();
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({
      date: `${prevMonthKey}-${String(d).padStart(2, '0')}`,
      day: d,
      inMonth: false
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${monthKey}-${String(d).padStart(2, '0')}`,
      day: d,
      inMonth: true
    });
  }

  const nextMonthKey = shiftMonthKey(monthKey, 1);
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      date: `${nextMonthKey}-${String(nextDay).padStart(2, '0')}`,
      day: nextDay,
      inMonth: false
    });
    nextDay++;
  }

  return cells;
}

export async function renderCalendarPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canAddEvent = can('calendar:add');
  const canEditEvent = can('calendar:edit');
  const canDeleteEvent = can('calendar:delete');
  const canAddAppointment = can('appointments:add');

  const todayStr = todayInputDate();
  let therapistOptions = !isTherapist
    ? ((storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [])
    : [];

  const state = {
    month: todayStr.slice(0, 7),
    selectedDate: todayStr,
    typeFilter: 'ALL', // ALL | APPOINTMENT | EVENT
    therapist_id: ''
  };
  let monthData = null;
  let activeFetchId = 0;

  container.innerHTML = `
    <section class="hero-bento cal-today-banner" id="cal-today-banner">
      <div class="hero-bento-top" style="margin-bottom:0;">
        <div>
          <div class="cal-today-eyebrow">Agenda Hari Ini • ${esc(formatFullDateId(todayStr))}</div>
          <h2 class="hero-greeting" id="cal-today-headline">Memuat agenda hari ini...</h2>
          <p class="hero-sub" id="cal-today-summary">Sinkron otomatis dengan jadwal sesi terapi dan kegiatan internal klinik.</p>
        </div>
        <div class="flex-gap">
          <button type="button" class="btn btn-soft btn-sm" id="btn-cal-jump-today">Hari Ini</button>
          ${canAddAppointment ? '<button type="button" class="btn btn-secondary btn-sm" id="btn-cal-new-apt">+ Jadwal Sesi</button>' : ''}
          ${canAddEvent ? '<button type="button" class="btn btn-primary btn-sm" id="btn-cal-add-event">+ Tambah Kegiatan</button>' : ''}
        </div>
      </div>
    </section>

    <div class="cal-layout">
      <section class="card cal-grid-card">
        <div class="cal-toolbar">
          <div class="cal-month-nav">
            <button type="button" class="icon-btn" id="btn-cal-prev" aria-label="Bulan sebelumnya">←</button>
            <h2 class="cal-month-title" id="cal-month-label">${esc(formatMonthLabel(state.month))}</h2>
            <button type="button" class="icon-btn" id="btn-cal-next" aria-label="Bulan berikutnya">→</button>
          </div>
          <div class="flex-gap">
            <div class="pill-tabs" style="margin-bottom:0;" id="cal-type-tabs">
              <button type="button" class="pill-tab is-active" data-cal-type="ALL">Semua</button>
              <button type="button" class="pill-tab" data-cal-type="APPOINTMENT">Sesi Terapi</button>
              <button type="button" class="pill-tab" data-cal-type="EVENT">Kegiatan Klinik</button>
            </div>
            ${!isTherapist ? `
              <select id="cal-filter-trp" class="select" style="width:auto;min-width:165px;min-height:36px;padding:6px 12px;font-size:0.82rem;" aria-label="Filter terapis">
                <option value="">Semua Terapis</option>
                ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('')}
              </select>
            ` : ''}
          </div>
        </div>

        <div id="cal-grid-wrap">${renderSkeletonTable(6)}</div>

        <div class="cal-legend mt-4">
          <span class="cal-legend-item"><span class="cal-dot cal-dot-apt"></span>Sesi Terapi (dari Jadwal)</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-evt"></span>Kegiatan Klinik</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-hol"></span>Libur / Cuti</span>
        </div>
      </section>

      <aside class="card cal-detail-card" id="cal-detail-panel" aria-live="polite">
        <div class="flex-between mb-3">
          <div>
            <div class="text-xs text-muted" id="cal-sel-eyebrow">Agenda Tanggal Terpilih</div>
            <h3 class="card-title" id="cal-sel-title">${esc(formatFullDateId(state.selectedDate))}</h3>
          </div>
          ${canAddEvent ? '<button type="button" class="btn btn-soft btn-sm" id="btn-cal-add-on-date">+ Kegiatan</button>' : ''}
        </div>
        <div id="cal-sel-body">${renderSkeletonTable(3)}</div>
      </aside>
    </div>
  `;

  const gridWrap = container.querySelector('#cal-grid-wrap');
  const monthLabelEl = container.querySelector('#cal-month-label');
  const todayHeadlineEl = container.querySelector('#cal-today-headline');
  const todaySummaryEl = container.querySelector('#cal-today-summary');
  const selEyebrowEl = container.querySelector('#cal-sel-eyebrow');
  const selTitleEl = container.querySelector('#cal-sel-title');
  const selBodyEl = container.querySelector('#cal-sel-body');

  if (!isTherapist && therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false }).then((opts) => {
      therapistOptions = opts;
      const sel = container.querySelector('#cal-filter-trp');
      if (sel) {
        const prev = sel.value;
        sel.innerHTML = '<option value="">Semua Terapis</option>' +
          opts.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('');
        sel.value = prev;
      }
    }).catch(() => {});
  }

  function getFilteredItems(list) {
    if (!Array.isArray(list)) return [];
    if (state.typeFilter === 'ALL') return list;
    return list.filter((it) => it.item_type === state.typeFilter);
  }

  function itemChipClass(item) {
    if (item.item_type === 'APPOINTMENT') return 'cal-chip-apt';
    if (item.category === 'LIBUR') return 'cal-chip-hol';
    return 'cal-chip-evt';
  }

  function paintTodayBanner(d) {
    const todayList = (d && d.today_items) || [];
    const aptCnt = todayList.filter((x) => x.item_type === 'APPOINTMENT').length;
    const evtCnt = todayList.filter((x) => x.item_type === 'EVENT').length;
    if (todayList.length === 0) {
      todayHeadlineEl.textContent = 'Belum ada jadwal atau kegiatan hari ini';
      todaySummaryEl.textContent = 'Klik "+ Tambah Kegiatan" untuk mencatat agenda klinik atau "+ Jadwal Sesi" untuk menjadwalkan klien.';
    } else {
      todayHeadlineEl.textContent = `Hari ini ada ${todayList.length} agenda (${aptCnt} Sesi Terapi • ${evtCnt} Kegiatan Klinik)`;
      const preview = todayList.slice(0, 3).map((x) => `${formatTimeId(x.start_time)} ${x.title}`).join('  •  ');
      todaySummaryEl.textContent = preview + (todayList.length > 3 ? `  •  +${todayList.length - 3} lainnya` : '');
    }
  }

  function paintSelectedDatePanel() {
    if (!monthData) return;
    const isToday = state.selectedDate === (monthData.today || todayStr);
    selEyebrowEl.textContent = isToday ? 'Hari Ini — Daftar Kegiatan & Jadwal' : 'Agenda Tanggal Terpilih';
    selTitleEl.textContent = formatFullDateId(state.selectedDate);

    const sourceList = state.selectedDate.slice(0, 7) === monthData.month
      ? (monthData.items || [])
      : (isToday ? (monthData.today_items || []) : []);
    const dayItems = getFilteredItems(sourceList).filter((it) => it.date === state.selectedDate);

    if (dayItems.length === 0) {
      selBodyEl.innerHTML = `
        <div class="empty-state" style="padding:26px 10px;">
          <p class="empty-state-title">Tidak ada kegiatan pada tanggal ini</p>
          <p class="empty-state-desc">Tambahkan kegiatan internal klinik atau buat jadwal sesi terapi untuk tanggal ini.</p>
          ${canAddEvent ? '<button type="button" class="btn btn-primary btn-sm" id="btn-empty-add-evt">+ Tambah Kegiatan</button>' : ''}
        </div>
      `;
      selBodyEl.querySelector('#btn-empty-add-evt')?.addEventListener('click', () => openEventModal(null, state.selectedDate));
      return;
    }

    selBodyEl.innerHTML = `
      <div class="cal-agenda-list data-fade-in">
        ${dayItems.map((it) => {
          if (it.item_type === 'APPOINTMENT') {
            return `
              <article class="cal-agenda-card cal-agenda-apt">
                <div class="flex-between">
                  <span class="cal-time-pill">${esc(formatTimeId(it.start_time))} WIB (${esc(it.duration_min)} mnt)</span>
                  <div class="flex-gap">
                    ${statusBadge('appointment', it.status)}
                    ${statusBadge('mode', it.session_mode)}
                  </div>
                </div>
                <div class="cal-agenda-title mt-2">${esc(it.title)}</div>
                <div class="text-xs text-muted mt-2">
                  Terapis: <strong>${esc(it.therapist_name)}</strong>
                  ${it.location ? ` • ${esc(it.location)}` : ''}
                </div>
                ${it.description ? `<div class="text-xs text-muted mt-2">${esc(it.description)}</div>` : ''}
                <div class="flex-gap mt-2">
                  <button type="button" class="btn btn-soft btn-sm" data-cal-open-client="${esc(it.client_id)}">Lihat Klien</button>
                  ${it.wa_link ? `<a href="${esc(it.wa_link)}" target="_blank" rel="noopener noreferrer" class="btn btn-wa btn-sm">Chat WA</a>` : ''}
                </div>
              </article>
            `;
          }

          return `
            <article class="cal-agenda-card ${it.category === 'LIBUR' ? 'cal-agenda-hol' : 'cal-agenda-evt'}">
              <div class="flex-between">
                <span class="cal-time-pill">${esc(formatTimeId(it.start_time))}${it.end_time ? ` – ${esc(formatTimeId(it.end_time))}` : ''} WIB</span>
                <span class="badge ${it.category === 'LIBUR' ? 'badge-warning' : 'badge-primary'}">${esc(EVENT_CATEGORY_LABELS[it.category] || it.category)}</span>
              </div>
              <div class="cal-agenda-title mt-2">${esc(it.title)}</div>
              <div class="text-xs text-muted mt-2">
                <span class="code-chip">${esc(it.event_code)}</span>
                ${it.pic_name ? ` • PIC: <strong>${esc(it.pic_name)}</strong>` : ''}
                ${it.location ? ` • ${esc(it.location)}` : ''}
              </div>
              ${it.description ? `<div class="text-xs mt-2" style="white-space:pre-wrap;">${esc(it.description)}</div>` : ''}
              ${(canEditEvent || canDeleteEvent) ? `
                <div class="flex-gap mt-2">
                  ${canEditEvent ? `<button type="button" class="btn btn-secondary btn-sm" data-cal-edit-evt="${esc(it.event_id)}">Edit</button>` : ''}
                  ${canDeleteEvent ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-cal-del-evt="${esc(it.event_id)}">Hapus</button>` : ''}
                </div>
              ` : ''}
            </article>
          `;
        }).join('')}
      </div>
    `;

    const evtMap = Object.fromEntries(dayItems.filter((x) => x.item_type === 'EVENT').map((x) => [x.event_id, x]));
    selBodyEl.querySelectorAll('[data-cal-open-client]').forEach((b) => {
      b.addEventListener('click', () => navigate(`#/clients/${b.dataset.calOpenClient}`));
    });
    selBodyEl.querySelectorAll('[data-cal-edit-evt]').forEach((b) => {
      b.addEventListener('click', () => openEventModal(evtMap[b.dataset.calEditEvt], state.selectedDate));
    });
    selBodyEl.querySelectorAll('[data-cal-del-evt]').forEach((b) => {
      b.addEventListener('click', async () => {
        const ev = evtMap[b.dataset.calDelEvt];
        if (!ev) return;
        const ok = await confirmDialog({
          title: 'Hapus Kegiatan Kalender',
          message: `Hapus kegiatan "${ev.title}" (${ev.event_code}) pada ${formatDateId(ev.date)}?`,
          confirmLabel: 'Ya, Hapus',
          danger: true
        });
        if (!ok) return;
        setButtonLoading(b, true, 'Menghapus...');
        try {
          await apiCall('calendar.deleteEvent', { event_id: ev.event_id, expected_version: ev.version }, { write: true });
          storeInvalidate('calendar');
          toast('Kegiatan berhasil dihapus.', 'success');
          loadMonth({ force: true, silent: true });
        } catch (err) {
          toast(err.message, 'danger');
          setButtonLoading(b, false);
        }
      });
    });
  }

  function paintCalendarGrid() {
    if (!monthData) return;
    monthLabelEl.textContent = formatMonthLabel(state.month);
    const cells = buildMonthGridCells(state.month);
    const filtered = getFilteredItems(monthData.items || []);
    const byDate = {};
    filtered.forEach((it) => {
      byDate[it.date] = byDate[it.date] || [];
      byDate[it.date].push(it);
    });

    const liveToday = monthData.today || todayStr;
    gridWrap.innerHTML = `
      <div class="cal-weekdays">
        ${DAY_NAMES_SHORT.map((d) => `<div class="cal-weekday">${d}</div>`).join('')}
      </div>
      <div class="cal-days-grid data-fade-in">
        ${cells.map((cell) => {
          const list = byDate[cell.date] || [];
          const isToday = cell.date === liveToday;
          const isSelected = cell.date === state.selectedDate;
          const maxShow = 2;
          const visible = list.slice(0, maxShow);
          const extra = list.length - visible.length;
          return `
            <button type="button"
              class="cal-cell ${cell.inMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}"
              data-cal-date="${esc(cell.date)}">
              <div class="cal-cell-head">
                <span class="cal-day-num">${cell.day}</span>
                ${list.length > 0 ? `<span class="cal-day-count">${list.length}</span>` : ''}
              </div>
              <div class="cal-cell-items">
                ${visible.map((it) => `
                  <span class="cal-chip ${itemChipClass(it)}" title="${esc(formatTimeId(it.start_time) + ' ' + it.title)}">
                    <span class="cal-chip-time">${esc(formatTimeId(it.start_time))}</span>
                    <span class="cal-chip-text">${esc(it.title)}</span>
                  </span>
                `).join('')}
                ${extra > 0 ? `<span class="cal-chip-more">+${extra} lagi</span>` : ''}
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;

    gridWrap.querySelectorAll('[data-cal-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const picked = btn.dataset.calDate;
        state.selectedDate = picked;
        if (picked.slice(0, 7) !== state.month) {
          state.month = picked.slice(0, 7);
          loadMonth();
          return;
        }
        gridWrap.querySelectorAll('.cal-cell.is-selected').forEach((el) => el.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        paintSelectedDatePanel();
      });
    });

    paintTodayBanner(monthData);
    paintSelectedDatePanel();
  }

  function openEventModal(existing = null, defaultDate = '') {
    const isEdit = Boolean(existing);
    const modal = openModal({
      title: isEdit ? `Edit Kegiatan — ${existing.event_code}` : 'Tambah Kegiatan Kalender',
      size: 'md',
      bodyHtml: `
        <form id="cal-event-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field field-span-full">
              <label for="ev-title">Judul Kegiatan / Agenda <span class="req-star">*</span></label>
              <input id="ev-title" name="title" class="input" type="text"
                value="${esc(isEdit ? existing.title : '')}"
                placeholder="mis. Rapat Evaluasi Terapis / Workshop Hipnoterapi" required>
            </div>
            <div class="field">
              <label for="ev-cat">Kategori <span class="req-star">*</span></label>
              <select id="ev-cat" name="category" class="select">
                ${Object.entries(EVENT_CATEGORY_LABELS).map(([k, lbl]) => `
                  <option value="${esc(k)}" ${(isEdit ? existing.category : 'KEGIATAN_KLINIK') === k ? 'selected' : ''}>${esc(lbl)}</option>
                `).join('')}
              </select>
            </div>
            <div class="field">
              <label for="ev-date">Tanggal Kegiatan <span class="req-star">*</span></label>
              <input id="ev-date" name="event_date" class="input" type="date"
                value="${esc(isEdit ? existing.date : (defaultDate || state.selectedDate || todayStr))}" required>
            </div>
            <div class="field">
              <label for="ev-start">Jam Mulai (WIB)</label>
              <input id="ev-start" name="start_time" class="input" type="time"
                value="${esc(isEdit ? formatTimeId(existing.start_time) : '09:00')}">
            </div>
            <div class="field">
              <label for="ev-end">Jam Selesai (Opsional)</label>
              <input id="ev-end" name="end_time" class="input" type="time"
                value="${esc(isEdit && existing.end_time ? formatTimeId(existing.end_time) : '')}">
            </div>
            <div class="field">
              <label for="ev-pic">Penanggung Jawab (PIC)</label>
              <input id="ev-pic" name="pic_name" class="input" type="text"
                value="${esc(isEdit ? existing.pic_name : (actor ? actor.full_name : ''))}" placeholder="Nama staf / tim">
            </div>
            <div class="field">
              <label for="ev-loc">Lokasi / Link</label>
              <input id="ev-loc" name="location" class="input" type="text"
                value="${esc(isEdit ? existing.location : '')}" placeholder="Ruang Klinik / Google Meet">
            </div>
            ${isEdit ? `
              <div class="field field-span-full">
                <label for="ev-status">Status Kegiatan</label>
                <select id="ev-status" name="status" class="select">
                  <option value="TERJADWAL" ${existing.status === 'TERJADWAL' ? 'selected' : ''}>Terjadwal</option>
                  <option value="SELESAI" ${existing.status === 'SELESAI' ? 'selected' : ''}>Selesai</option>
                  <option value="DIBATALKAN" ${existing.status === 'DIBATALKAN' ? 'selected' : ''}>Dibatalkan</option>
                </select>
              </div>
            ` : ''}
            <div class="field field-span-full">
              <label for="ev-desc">Keterangan / Detail Kegiatan</label>
              <textarea id="ev-desc" name="description" class="textarea" rows="3"
                placeholder="Catat detail agenda, peserta, atau persiapan yang diperlukan...">${esc(isEdit ? existing.description : '')}</textarea>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="cal-event-form" class="btn btn-primary" id="btn-save-ev">
          ${isEdit ? 'Simpan Perubahan' : 'Simpan Kegiatan'}
        </button>
      `
    });

    const form = modal.querySelector('#cal-event-form');
    const saveBtn = modal.querySelector('#btn-save-ev');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setButtonLoading(saveBtn, true, 'Menyimpan...');

      const payload = {
        title: form.title.value.trim(),
        category: form.category.value,
        event_date: form.event_date.value,
        start_time: form.start_time.value || '09:00',
        end_time: form.end_time.value || '',
        pic_name: form.pic_name.value.trim(),
        location: form.location.value.trim(),
        description: form.description.value.trim(),
        status: form.status ? form.status.value : 'TERJADWAL'
      };

      try {
        if (isEdit) {
          payload.event_id = existing.event_id;
          payload.expected_version = existing.version;
          await apiCall('calendar.updateEvent', payload, { write: true });
          toast('Kegiatan kalender berhasil diperbarui.', 'success');
        } else {
          await apiCall('calendar.createEvent', payload, { write: true });
          toast('Kegiatan baru berhasil ditambahkan ke kalender.', 'success');
        }
        closeModal();
        storeInvalidate('calendar');
        state.selectedDate = payload.event_date;
        state.month = payload.event_date.slice(0, 7);
        loadMonth({ force: true, silent: true });
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  async function loadMonth({ force = false, silent = false } = {}) {
    const fetchId = ++activeFetchId;
    const key = `calendar:month:${state.month}:${state.therapist_id}`;
    const cached = storeGet(key);

    if (cached && cached.data && !force) {
      monthData = cached.data;
      paintCalendarGrid();
      if (storeIsFresh(key, 30000)) return;
    } else if (!silent) {
      monthLabelEl.textContent = formatMonthLabel(state.month);
      gridWrap.innerHTML = renderSkeletonTable(5);
      selBodyEl.innerHTML = renderSkeletonTable(3);
    }

    try {
      const res = await apiCall('calendar.month', {
        month: state.month,
        therapist_id: state.therapist_id || undefined
      }, cached ? { background: true } : {});
      if (fetchId !== activeFetchId) return;
      const { changed } = storeSet(key, res.data);
      monthData = res.data;
      if (!cached || force || changed) {
        paintCalendarGrid();
      }
    } catch (err) {
      if (fetchId !== activeFetchId) return;
      if (!cached) {
        gridWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat kalender</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      }
      toast(err.message, 'danger');
    }
  }

  container.querySelector('#btn-cal-prev').addEventListener('click', () => {
    state.month = shiftMonthKey(state.month, -1);
    state.selectedDate = state.month + '-01';
    loadMonth();
  });
  container.querySelector('#btn-cal-next').addEventListener('click', () => {
    state.month = shiftMonthKey(state.month, 1);
    state.selectedDate = state.month + '-01';
    loadMonth();
  });
  container.querySelector('#btn-cal-jump-today').addEventListener('click', () => {
    state.month = todayStr.slice(0, 7);
    state.selectedDate = todayStr;
    loadMonth();
  });
  container.querySelector('#btn-cal-add-event')?.addEventListener('click', () => openEventModal(null, state.selectedDate));
  container.querySelector('#btn-cal-add-on-date')?.addEventListener('click', () => openEventModal(null, state.selectedDate));
  container.querySelector('#btn-cal-new-apt')?.addEventListener('click', () => navigate('#/appointments?new=1'));

  container.querySelectorAll('#cal-type-tabs .pill-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('#cal-type-tabs .pill-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      state.typeFilter = tab.dataset.calType;
      paintCalendarGrid();
    });
  });

  container.querySelector('#cal-filter-trp')?.addEventListener('change', (e) => {
    state.therapist_id = e.target.value;
    loadMonth();
  });

  await loadMonth({ force: Boolean(route && route.forceRefresh) });
}
