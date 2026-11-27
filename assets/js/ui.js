/**
 * ui.js — Komponen UI reusable & XSS-safe: Top Progress Bar global,
 * Center Auth Loader (khusus Login/Logout), inline button spinner (gaya Bootstrap 5.3),
 * toast, modal GSAP smooth, dialog konfirmasi, pagination, skeleton, dan autocomplete klien.
 */

import { apiCall } from './api.js';
import { animateModalOpen, animateModalClose } from './motion.js';

export function esc(val) {
  return String(val === undefined || val === null ? '' : val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatRupiah(amount) {
  const num = Number(amount || 0);
  if (isNaN(num)) return 'Rp 0';
  return 'Rp ' + Math.round(num).toLocaleString('id-ID');
}

export function formatDateId(dateStr) {
  const s = String(dateStr || '').trim();
  if (!s) return '-';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const mIdx = parseInt(match[2], 10) - 1;
  return `${parseInt(match[3], 10)} ${months[mIdx] || match[2]} ${match[1]}`;
}

export function formatDateTimeId(isoStr) {
  const s = String(isoStr || '').trim();
  if (!s) return '-';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s);
  if (!match) return formatDateId(s);
  return `${formatDateId(match[1])}, ${match[2]} WIB`;
}

export function formatTimeId(timeStr) {
  const s = String(timeStr || '').trim();
  if (!s) return '-';
  const m1899 = /(?:1899-12-3[01]|1900-01-01)[T\s](\d{2}:\d{2})/.exec(s);
  if (m1899) return m1899[1];
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return s;
}

export function todayInputDate() {
  const now = new Date();
  const wib = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${wib.getFullYear()}-${pad(wib.getMonth() + 1)}-${pad(wib.getDate())}`;
}

export const SOURCE_CHANNEL_LABELS = Object.freeze({
  GOOGLE_SEARCH: 'Google Search',
  GOOGLE_MAPS: 'Google Maps',
  WEBSITE: 'Website',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  WHATSAPP: 'WhatsApp',
  FRIEND_FAMILY: 'Teman / Keluarga',
  DOCTOR_PSYCHOLOGIST: 'Dokter / Psikolog',
  OTHER: 'Lainnya'
});

export function statusBadge(type, value) {
  const maps = {
    user: {
      ACTIVE: ['badge-success', 'Aktif'],
      INACTIVE: ['badge-neutral', 'Nonaktif'],
      SUSPENDED: ['badge-danger', 'Dibekukan']
    },
    therapist: {
      ACTIVE: ['badge-success', 'Aktif'],
      FROZEN: ['badge-warning', 'Dibekukan'],
      INACTIVE: ['badge-neutral', 'Tidak Aktif']
    },
    client: {
      BARU_DAFTAR: ['badge-info', 'Baru Daftar'],
      DALAM_PROSES: ['badge-warning', 'Dalam Proses'],
      SELESAI: ['badge-success', 'Selesai']
    },
    appointment: {
      SCHEDULED: ['badge-info', 'Scheduled'],
      CONFIRMED: ['badge-primary', 'Confirmed'],
      COMPLETED: ['badge-success', 'Completed'],
      CANCELLED: ['badge-danger', 'Cancelled'],
      NO_SHOW: ['badge-neutral', 'No Show']
    },
    mode: {
      ONLINE: ['badge-info', 'Online'],
      OFFLINE: ['badge-primary', 'Offline'],
      BOTH: ['badge-success', 'Online & Offline']
    },
    package: {
      ACTIVE: ['badge-success', 'Aktif'],
      INACTIVE: ['badge-neutral', 'Nonaktif']
    },
    client_package: {
      ACTIVE: ['badge-success', 'Aktif'],
      COMPLETED: ['badge-primary', 'Selesai (Habis)'],
      EXPIRED: ['badge-warning', 'Kedaluwarsa'],
      CANCELLED: ['badge-danger', 'Dibatalkan']
    },
    payment_type: {
      INCOME: ['badge-success', 'Pemasukan'],
      EXPENSE: ['badge-danger', 'Pengeluaran']
    },
    payment: {
      LUNAS: ['badge-success', 'Lunas'],
      DP: ['badge-warning', 'DP / Cicilan'],
      BATAL: ['badge-danger', 'Batal']
    },
    commission: {
      UNPAID: ['badge-warning', 'Belum Dibayar'],
      PAID: ['badge-success', 'Sudah Dibayar'],
      VOID: ['badge-neutral', 'Batal / Void']
    }
  };
  const entry = (maps[type] && maps[type][value]) || ['badge-neutral', value || '-'];
  return `<span class="badge ${entry[0]}">${esc(entry[1])}</span>`;
}

// ============================================================================
// Top Progress Bar Global (di puncak aplikasi, di bawah address bar browser)
// ============================================================================

let topPendingCount = 0;
let topProgressVal = 0;
let topTrickleTimer = null;
let topHideTimer = null;

export const topProgress = {
  start() {
    topPendingCount++;
    const bar = document.getElementById('top-progress-bar');
    const fill = document.getElementById('top-progress-fill');
    if (!bar || !fill) return;

    clearTimeout(topHideTimer);
    if (topPendingCount === 1) {
      topProgressVal = 14;
      bar.classList.add('is-active');
      bar.setAttribute('aria-hidden', 'false');
      fill.style.width = topProgressVal + '%';

      clearInterval(topTrickleTimer);
      topTrickleTimer = setInterval(() => {
        if (topProgressVal < 86) {
          const step = topProgressVal < 45 ? 9 : topProgressVal < 70 ? 4 : 1.5;
          topProgressVal = Math.min(86, topProgressVal + step);
          fill.style.width = topProgressVal + '%';
        }
      }, 220);
    }
  },
  done() {
    topPendingCount = Math.max(0, topPendingCount - 1);
    if (topPendingCount > 0) return;

    clearInterval(topTrickleTimer);
    topTrickleTimer = null;

    const bar = document.getElementById('top-progress-bar');
    const fill = document.getElementById('top-progress-fill');
    if (!bar || !fill) return;

    topProgressVal = 100;
    fill.style.width = '100%';
    clearTimeout(topHideTimer);
    topHideTimer = setTimeout(() => {
      bar.classList.remove('is-active');
      bar.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (topPendingCount === 0) fill.style.width = '0%';
      }, 220);
    }, 180);
  }
};

// ============================================================================
// Center Full-Screen Loader (KHUSUS Login & Logout)
// ============================================================================

export const authLoader = {
  show(message = 'Memproses autentikasi...') {
    const el = document.getElementById('center-auth-loader');
    const txt = document.getElementById('center-auth-loader-text');
    if (!el) return;
    if (txt) txt.textContent = message;
    el.hidden = false;
  },
  hide() {
    const el = document.getElementById('center-auth-loader');
    if (!el) return;
    el.hidden = true;
  }
};

// ============================================================================
// Inline Button Loading Spinner (untuk semua tombol & modal CRUD)
// ============================================================================

export function setButtonLoading(btn, isLoading, loadingLabel = 'Memproses...') {
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.origHtml) {
      btn.dataset.origHtml = btn.innerHTML;
    }
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${esc(loadingLabel)}</span>`;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    if (btn.dataset.origHtml) {
      btn.innerHTML = btn.dataset.origHtml;
      delete btn.dataset.origHtml;
    }
  }
}

export function markRowDeleting(rowEl, isDeleting) {
  if (!rowEl) return;
  rowEl.classList.toggle('is-deleting', Boolean(isDeleting));
  rowEl.querySelectorAll('button').forEach((b) => { b.disabled = Boolean(isDeleting); });
}

// ============================================================================
// Toast Notifications
// ============================================================================

export function toast(message, type = 'info', durationMs = 3600) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = String(message || '');
  root.appendChild(item);
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 220);
  }, durationMs);
}

// ============================================================================
// Modal & Confirmation Dialog (Smooth GSAP Entrance/Exit)
// ============================================================================

let activeModalCleanup = null;
let lastFocusedEl = null;

export function closeModal(immediate = false) {
  const root = document.getElementById('modal-root');
  if (!root || root.hidden) return;
  if (activeModalCleanup) {
    activeModalCleanup();
    activeModalCleanup = null;
  }

  const finalize = () => {
    root.innerHTML = '';
    root.hidden = true;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
      lastFocusedEl = null;
    }
  };

  if (immediate) {
    finalize();
  } else {
    animateModalClose(root, finalize);
  }
}

export function openModal({ title, bodyHtml, footerHtml = '', size = 'md', closable = true }) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  if (activeModalCleanup) {
    activeModalCleanup();
    activeModalCleanup = null;
  }
  lastFocusedEl = document.activeElement;

  const sizeClass = size === 'xl' ? 'modal-xl' : size === 'lg' ? 'modal-lg' : '';
  root.innerHTML = `
    <div class="modal-panel ${sizeClass}">
      <div class="modal-header">
        <h2 class="modal-title">${esc(title)}</h2>
        ${closable ? '<button type="button" class="icon-btn" data-modal-close aria-label="Tutup dialog">✕</button>' : ''}
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    </div>
  `;
  root.hidden = false;
  animateModalOpen(root);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && closable) {
      closeModal();
    }
  };
  const onBackdrop = (e) => {
    if (e.target === root && closable) {
      closeModal();
    }
  };

  root.querySelectorAll('[data-modal-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal());
  });
  document.addEventListener('keydown', onKeyDown);
  root.addEventListener('click', onBackdrop);

  activeModalCleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('click', onBackdrop);
  };

  const firstInput = root.querySelector('input, select, textarea, button');
  if (firstInput) firstInput.focus();
  return root;
}

export function confirmDialog({
  title = 'Konfirmasi',
  message = 'Apakah Anda yakin?',
  confirmLabel = 'Ya, Lanjutkan',
  danger = false,
  requireText = ''
}) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      bodyHtml: `
        <p class="text-sm" style="margin:0 0 12px;">${esc(message)}</p>
        ${requireText ? `
          <div class="field">
            <label for="confirm-phrase-input">Ketik <strong>${esc(requireText)}</strong> untuk konfirmasi:</label>
            <input id="confirm-phrase-input" class="input" type="text" autocomplete="off" placeholder="${esc(requireText)}">
          </div>
        ` : ''}
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-confirm-cancel>Batal</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok ${requireText ? 'disabled' : ''}>${esc(confirmLabel)}</button>
      `
    });

    const btnOk = modal.querySelector('[data-confirm-ok]');
    const btnCancel = modal.querySelector('[data-confirm-cancel]');
    const phraseInput = modal.querySelector('#confirm-phrase-input');

    if (phraseInput) {
      phraseInput.addEventListener('input', () => {
        btnOk.disabled = phraseInput.value.trim() !== requireText;
      });
    }

    btnCancel.addEventListener('click', () => {
      closeModal();
      resolve(false);
    });
    btnOk.addEventListener('click', () => {
      closeModal(true);
      resolve(true);
    });
  });
}

// ============================================================================
// Form Field Errors, Skeletons, Pagination & Client Autocomplete
// ============================================================================

export function clearFieldErrors(formEl) {
  if (!formEl) return;
  formEl.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  formEl.querySelectorAll('[data-dynamic-error="1"]').forEach((el) => el.remove());
}

export function showFieldErrors(formEl, fields) {
  if (!formEl || !fields) return;
  Object.entries(fields).forEach(([name, msg]) => {
    if (!msg) return;
    const input = formEl.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) return;
    input.classList.add('is-invalid');
    const err = document.createElement('div');
    err.className = 'field-error';
    err.setAttribute('data-dynamic-error', '1');
    err.textContent = msg;
    const fieldWrap = input.closest('.field') || input.parentElement;
    if (fieldWrap) fieldWrap.appendChild(err);
  });
}

export function autoResizeTextarea(textarea) {
  if (!textarea) return;
  const adjust = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(textarea.scrollHeight, 120) + 'px';
  };
  textarea.addEventListener('input', adjust);
  adjust();
}

export function renderSkeletonCards(count = 4) {
  let html = '<div class="kpi-grid" aria-busy="true" aria-label="Memuat ringkasan...">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="kpi-card skel-card">
        <div class="kpi-head">
          <div class="skeleton skel-circle" style="width:36px;height:36px;border-radius:11px;"></div>
          <div class="skeleton skel-line" style="height:12px;width:54%;"></div>
        </div>
        <div class="skeleton skel-line" style="height:28px;width:44%;margin-bottom:10px;"></div>
        <div class="skeleton skel-line" style="height:10px;width:68%;"></div>
      </div>
    `;
  }
  return html + '</div>';
}

export function renderSkeletonTable(rows = 6) {
  let rowHtml = '';
  const widths = [
    ['86px', '58%', '44%', '74px', '104px'],
    ['82px', '66%', '52%', '84px', '104px'],
    ['90px', '48%', '38%', '68px', '104px'],
    ['84px', '62%', '46%', '78px', '104px']
  ];
  for (let i = 0; i < rows; i++) {
    const w = widths[i % widths.length];
    rowHtml += `
      <div class="skel-table-row">
        <div class="skeleton skel-chip" style="width:${w[0]};"></div>
        <div class="skel-col-stack">
          <div class="skeleton skel-line" style="height:13px;width:${w[1]};"></div>
          <div class="skeleton skel-line" style="height:10px;width:${w[2]};margin-top:6px;"></div>
        </div>
        <div class="skeleton skel-line skel-hide-sm" style="height:12px;width:96px;"></div>
        <div class="skeleton skel-pill" style="width:${w[3]};"></div>
        <div class="skel-actions-group">
          <div class="skeleton skel-btn" style="width:52px;"></div>
          <div class="skeleton skel-btn" style="width:52px;"></div>
        </div>
      </div>
    `;
  }
  return `
    <div class="skel-table-wrap" aria-busy="true" aria-label="Memuat data tabel...">
      <div class="skel-table-head">
        <div class="skeleton skel-line" style="height:10px;width:68px;"></div>
        <div class="skeleton skel-line" style="height:10px;width:110px;"></div>
        <div class="skeleton skel-line skel-hide-sm" style="height:10px;width:78px;"></div>
        <div class="skeleton skel-line" style="height:10px;width:58px;"></div>
        <div class="skeleton skel-line" style="height:10px;width:64px;margin-left:auto;"></div>
      </div>
      ${rowHtml}
    </div>
  `;
}

export function renderSkeletonDashboard() {
  return `
    <div aria-busy="true" aria-label="Memuat Dashboard...">
      <section class="hero-bento">
        <div class="hero-bento-top">
          <div style="flex:1;min-width:200px;">
            <div class="skeleton skel-line" style="height:24px;width:230px;margin-bottom:10px;"></div>
            <div class="skeleton skel-line" style="height:13px;width:320px;max-width:90%;"></div>
          </div>
          <div class="skeleton skel-pill" style="height:34px;width:140px;"></div>
        </div>
        ${renderSkeletonCards(4)}
      </section>

      <div class="dashboard-split">
        <div>
          <section class="card">
            <div class="flex-between mb-3">
              <div>
                <div class="skeleton skel-line" style="height:18px;width:150px;margin-bottom:8px;"></div>
                <div class="skeleton skel-line" style="height:11px;width:240px;"></div>
              </div>
              <div class="skeleton skel-btn" style="width:96px;height:32px;"></div>
            </div>
            <div class="flex-gap mb-3">
              <div class="skeleton skel-pill" style="width:82px;height:32px;"></div>
              <div class="skeleton skel-pill" style="width:92px;height:32px;"></div>
              <div class="skeleton skel-pill" style="width:92px;height:32px;"></div>
              <div class="skeleton skel-pill" style="width:78px;height:32px;"></div>
            </div>
            ${renderSkeletonTable(5)}
          </section>
          <div class="bento-subgrid-2">
            <section class="card">
              <div class="skeleton skel-line" style="height:16px;width:120px;margin-bottom:16px;"></div>
              <div class="flex-gap">
                <div class="skeleton skel-circle" style="width:110px;height:110px;"></div>
                <div style="flex:1;">
                  <div class="skeleton skel-line" style="height:12px;width:85%;margin-bottom:12px;"></div>
                  <div class="skeleton skel-line" style="height:12px;width:72%;margin-bottom:12px;"></div>
                  <div class="skeleton skel-line" style="height:12px;width:65%;"></div>
                </div>
              </div>
            </section>
            <section class="card">
              <div class="skeleton skel-line" style="height:16px;width:140px;margin-bottom:16px;"></div>
              <div class="skeleton skel-line" style="height:54px;width:100%;border-radius:14px;margin-bottom:10px;"></div>
              <div class="skeleton skel-line" style="height:54px;width:100%;border-radius:14px;"></div>
            </section>
          </div>
        </div>
        <aside>
          <section class="card">
            <div class="skeleton skel-line" style="height:16px;width:110px;margin-bottom:14px;"></div>
            <div class="skeleton skel-line" style="height:56px;width:100%;border-radius:14px;margin-bottom:10px;"></div>
            <div class="skeleton skel-line" style="height:56px;width:100%;border-radius:14px;margin-bottom:10px;"></div>
            <div class="skeleton skel-line" style="height:56px;width:100%;border-radius:14px;margin-bottom:10px;"></div>
            <div class="skeleton skel-line" style="height:56px;width:100%;border-radius:14px;"></div>
          </section>
        </aside>
      </div>
    </div>
  `;
}

export function renderSkeletonDetail() {
  return `
    <div aria-busy="true" aria-label="Memuat profil klien...">
      <div class="flex-between mb-3">
        <div class="skeleton skel-btn" style="width:168px;height:36px;"></div>
        <div class="flex-gap">
          <div class="skeleton skel-btn" style="width:84px;height:34px;"></div>
          <div class="skeleton skel-btn" style="width:92px;height:34px;"></div>
          <div class="skeleton skel-btn" style="width:92px;height:34px;"></div>
        </div>
      </div>
      <section class="card">
        <div class="flex-between mb-3">
          <div>
            <div class="skeleton skel-line" style="height:22px;width:210px;margin-bottom:8px;"></div>
            <div class="skeleton skel-line" style="height:12px;width:260px;"></div>
          </div>
          <div class="skeleton skel-pill" style="width:96px;height:28px;"></div>
        </div>
        <div class="form-grid form-grid-3 mt-4">
          <div class="skeleton skel-line" style="height:44px;width:100%;border-radius:10px;"></div>
          <div class="skeleton skel-line" style="height:44px;width:100%;border-radius:10px;"></div>
          <div class="skeleton skel-line" style="height:44px;width:100%;border-radius:10px;"></div>
          <div class="skeleton skel-line" style="height:44px;width:100%;border-radius:10px;"></div>
          <div class="skeleton skel-line" style="height:44px;width:100%;border-radius:10px;"></div>
          <div class="skeleton skel-line" style="height:44px;width:100%;border-radius:10px;"></div>
        </div>
      </section>
      <section class="card">
        <div class="flex-gap mb-3">
          <div class="skeleton skel-pill" style="width:92px;height:32px;"></div>
          <div class="skeleton skel-pill" style="width:110px;height:32px;"></div>
          <div class="skeleton skel-pill" style="width:120px;height:32px;"></div>
        </div>
        ${renderSkeletonTable(4)}
      </section>
    </div>
  `;
}

export function renderSkeletonReport() {
  return `
    <div aria-busy="true" aria-label="Menyusun laporan...">
      <section class="hero-bento">
        <div class="hero-bento-top">
          <div>
            <div class="skeleton skel-line" style="height:22px;width:260px;margin-bottom:8px;"></div>
            <div class="skeleton skel-line" style="height:12px;width:190px;"></div>
          </div>
          <div class="skeleton skel-pill" style="height:34px;width:155px;"></div>
        </div>
        ${renderSkeletonCards(4)}
      </section>
      <section class="card">
        <div class="skeleton skel-line" style="height:18px;width:210px;margin-bottom:14px;"></div>
        ${renderSkeletonTable(5)}
      </section>
    </div>
  `;
}

function buildPageSequence(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('...');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

export function renderPagination(container, meta, onPageChange) {
  if (!container || !meta) return;
  const page = Number(meta.page || 1);
  const limit = Number(meta.limit || 10);
  const totalPages = Math.max(Number(meta.total_pages || 1), 1);
  const total = Number(meta.total || 0);

  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const fromIdx = (page - 1) * limit + 1;
  const toIdx = Math.min(page * limit, total);
  const seq = buildPageSequence(page, totalPages);

  container.innerHTML = `
    <div class="pagination-bar">
      <span>Menampilkan <strong>${fromIdx}–${toIdx}</strong> dari <strong>${total}</strong> data (Maks. ${limit}/halaman)</span>
      <div class="pagination-controls" role="navigation" aria-label="Navigasi halaman">
        <button type="button" class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Sebelumnya</button>
        ${seq.map((item) => item === '...'
          ? '<span class="page-ellipsis" aria-hidden="true">…</span>'
          : `<button type="button" class="btn-page ${item === page ? 'is-active' : ''}" data-page="${item}" ${item === page ? 'aria-current="page"' : ''}>${item}</button>`
        ).join('')}
        <button type="button" class="btn btn-secondary btn-sm" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Berikutnya →</button>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.page);
      if (target >= 1 && target <= totalPages && target !== page) {
        onPageChange(target);
      }
    });
  });
}

/**
 * Header kolom tabel yang dapat diklik untuk sorting server-side (ID & Tanggal/Waktu).
 */
export function sortableTh(label, field, currentSort) {
  const active = currentSort && currentSort.field === field;
  const dir = active ? String(currentSort.dir || 'desc').toLowerCase() : '';
  const indicator = active ? (dir === 'asc' ? '↑' : '↓') : '⇅';
  return `
    <th class="th-sortable">
      <button type="button" class="th-sort-btn ${active ? 'is-active' : ''}" data-sort-field="${esc(field)}" title="Urutkan berdasarkan ${esc(label)}">
        <span>${esc(label)}</span>
        <span class="th-sort-icon" aria-hidden="true">${indicator}</span>
      </button>
    </th>
  `;
}

export function bindSortableHeaders(container, sortState, onSortChange) {
  if (!container || !sortState) return;
  container.querySelectorAll('[data-sort-field]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const clickedField = btn.dataset.sortField;
      if (sortState.field === clickedField) {
        sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc';
      } else {
        sortState.field = clickedField;
        sortState.dir = 'desc';
      }
      onSortChange();
    });
  });
}

/**
 * Searchable autocomplete klien (dipakai di Assessment, Jadwal, dan RME).
 */
export function mountClientAutocomplete(container, { inputName = 'client_id', placeholder = 'Ketik nama, kode, atau nomor WA klien...', initialClient = null, onSelect = () => {} } = {}) {
  container.innerHTML = `
    <div class="autocomplete-wrap">
      <input type="hidden" name="${esc(inputName)}" value="${esc(initialClient ? initialClient.client_id : '')}">
      <input type="text" class="input" data-ac-input autocomplete="off"
        placeholder="${esc(placeholder)}"
        value="${esc(initialClient ? `${initialClient.full_name} (${initialClient.client_code})` : '')}">
      <div class="autocomplete-menu" data-ac-menu hidden></div>
    </div>
  `;

  const hiddenEl = container.querySelector(`input[name="${CSS.escape(inputName)}"]`);
  const textEl = container.querySelector('[data-ac-input]');
  const menuEl = container.querySelector('[data-ac-menu]');
  let debounceTimer = null;

  async function search(q) {
    menuEl.hidden = false;
    menuEl.innerHTML = '<div class="autocomplete-item"><span class="autocomplete-item-sub"><span class="btn-spinner btn-spinner-dark" style="margin-right:6px;"></span>Mencari klien...</span></div>';
    try {
      const res = await apiCall('clients.search', { q, limit: 15 });
      const items = (res.data && res.data.items) || [];
      if (items.length === 0) {
        menuEl.innerHTML = '<div class="autocomplete-item"><span class="autocomplete-item-sub">Klien tidak ditemukan.</span></div>';
        return;
      }
      menuEl.innerHTML = items.map((c) => `
        <button type="button" class="autocomplete-item" data-cid="${esc(c.client_id)}">
          <span class="autocomplete-item-title">${esc(c.full_name)} <span class="text-muted font-mono">(${esc(c.client_code)})</span></span>
          <span class="autocomplete-item-sub">WA: ${esc(c.wa_normalized || c.phone_raw || '-')} • Status: ${esc(c.status)}</span>
        </button>
      `).join('');

      menuEl.querySelectorAll('[data-cid]').forEach((btn, idx) => {
        btn.addEventListener('click', () => {
          const picked = items[idx];
          hiddenEl.value = picked.client_id;
          textEl.value = `${picked.full_name} (${picked.client_code})`;
          menuEl.hidden = true;
          onSelect(picked);
        });
      });
    } catch (err) {
      menuEl.innerHTML = `<div class="autocomplete-item"><span class="autocomplete-item-sub">${esc(err.message)}</span></div>`;
    }
  }

  textEl.addEventListener('focus', () => {
    search(textEl.value.trim());
  });
  textEl.addEventListener('input', () => {
    hiddenEl.value = '';
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(textEl.value.trim()), 250);
  });
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      menuEl.hidden = true;
    }
  });

  return {
    setClient(client) {
      if (!client) {
        hiddenEl.value = '';
        textEl.value = '';
        return;
      }
      hiddenEl.value = client.client_id;
      textEl.value = `${client.full_name} (${client.client_code})`;
    },
    getValue() {
      return hiddenEl.value;
    }
  };
}
