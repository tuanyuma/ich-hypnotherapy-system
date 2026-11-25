/**
 * ui.js — Komponen UI reusable & XSS-safe: escape HTML, toast, modal,
 * dialog konfirmasi, pagination, skeleton loader, autocomplete klien,
 * badge status, dan formatter lokal Indonesia.
 */

import { apiCall } from './api.js';

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
    }
  };
  const entry = (maps[type] && maps[type][value]) || ['badge-neutral', value || '-'];
  return `<span class="badge ${entry[0]}">${esc(entry[1])}</span>`;
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
    item.remove();
  }, durationMs);
}

// ============================================================================
// Modal & Confirmation Dialog
// ============================================================================

let activeModalCleanup = null;
let lastFocusedEl = null;

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (activeModalCleanup) {
    activeModalCleanup();
    activeModalCleanup = null;
  }
  root.innerHTML = '';
  root.hidden = true;
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
    lastFocusedEl.focus();
    lastFocusedEl = null;
  }
}

export function openModal({ title, bodyHtml, footerHtml = '', size = 'md', closable = true }) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  lastFocusedEl = document.activeElement;

  const sizeClass = size === 'lg' ? 'modal-lg' : '';
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
      closeModal();
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
  formEl.querySelectorAll('.field-error').forEach((el) => el.remove());
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
  let html = '<div class="kpi-grid">';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="kpi-card">
        <div class="skeleton" style="height:14px;width:60%;margin-bottom:12px;"></div>
        <div class="skeleton" style="height:30px;width:45%;"></div>
      </div>
    `;
  }
  return html + '</div>';
}

export function renderSkeletonTable(rows = 5) {
  let html = '<div class="card">';
  for (let i = 0; i < rows; i++) {
    html += `<div class="skeleton" style="height:38px;width:100%;margin-bottom:10px;"></div>`;
  }
  return html + '</div>';
}

export function renderPagination(container, meta, onPageChange) {
  if (!container || !meta) return;
  const page = Number(meta.page || 1);
  const totalPages = Number(meta.total_pages || 1);
  const total = Number(meta.total || 0);

  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="pagination-bar">
      <span>Menampilkan halaman <strong>${page}</strong> dari <strong>${totalPages}</strong> (Total ${total} data)</span>
      <div class="pagination-controls">
        <button type="button" class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Sebelumnya</button>
        <button type="button" class="btn btn-secondary btn-sm" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Berikutnya →</button>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.page);
      if (target >= 1 && target <= totalPages) {
        onPageChange(target);
      }
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
    menuEl.innerHTML = '<div class="autocomplete-item"><span class="autocomplete-item-sub">Mencari klien...</span></div>';
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
