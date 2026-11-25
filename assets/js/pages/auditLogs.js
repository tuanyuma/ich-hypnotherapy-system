/**
 * pages/auditLogs.js — Audit Log Otomatis (F9):
 * Read-only untuk ADMIN; OWNER berhak menjalankan Purge Log Lama
 * dengan konfirmasi eksplisit & alasan (aksi purge tetap tercatat sebagai PURGE_AUDIT).
 */

import { apiCall } from '../api.js';
import { can } from '../auth.js';
import {
  esc,
  formatDateTimeId,
  renderSkeletonTable,
  renderPagination,
  openModal,
  closeModal,
  clearFieldErrors,
  showFieldErrors,
  toast
} from '../ui.js';

const ACTION_BADGE_MAP = {
  LOGIN: 'badge-info',
  LOGIN_FAILED: 'badge-danger',
  LOGOUT: 'badge-neutral',
  CREATE: 'badge-success',
  UPDATE: 'badge-primary',
  DELETE: 'badge-danger',
  CANCEL: 'badge-warning',
  RESET_PASSWORD: 'badge-warning',
  PURGE_AUDIT: 'badge-danger'
};

export async function renderAuditLogsPage(container) {
  const canPurge = can('audit:purge');
  const state = { page: 1, limit: 25, q: '', action_type: '', module: '', date_from: '', date_to: '' };

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Rekam Jejak Aktivitas (Audit Log)</h2>
          <p class="card-desc">Mencatat otomatis aktivitas Login, Logout, Create, Update, Delete/Cancel, dan Reset Password tanpa menyimpan rahasia atau isi keluhan klinis.</p>
        </div>
        ${canPurge ? '<button type="button" class="btn btn-danger btn-sm" id="btn-purge-audit">Bersihkan Log Lama (OWNER)</button>' : '<span class="badge badge-neutral">Read-Only</span>'}
      </div>

      <div class="filter-bar">
        <input type="search" id="aud-search" class="input" placeholder="Cari username, ringkasan, ID entitas, corr_id...">
        <select id="aud-filter-action" class="select" aria-label="Filter aksi">
          <option value="">Semua Aksi</option>
          <option value="LOGIN">LOGIN</option>
          <option value="LOGIN_FAILED">LOGIN_FAILED</option>
          <option value="LOGOUT">LOGOUT</option>
          <option value="CREATE">CREATE</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
          <option value="CANCEL">CANCEL</option>
          <option value="RESET_PASSWORD">RESET_PASSWORD</option>
          <option value="PURGE_AUDIT">PURGE_AUDIT</option>
        </select>
        <select id="aud-filter-module" class="select" aria-label="Filter modul">
          <option value="">Semua Modul</option>
          <option value="AUTH">AUTH</option>
          <option value="USERS">USERS</option>
          <option value="THERAPISTS">THERAPISTS</option>
          <option value="CLIENTS">CLIENTS</option>
          <option value="ASSESSMENTS">ASSESSMENTS</option>
          <option value="APPOINTMENTS">APPOINTMENTS</option>
          <option value="RME_SESSIONS">RME_SESSIONS</option>
          <option value="SETTINGS">SETTINGS</option>
          <option value="AUDIT_LOGS">AUDIT_LOGS</option>
        </select>
        <input type="date" id="aud-filter-from" class="input" aria-label="Dari tanggal" title="Dari tanggal">
        <input type="date" id="aud-filter-to" class="input" aria-label="Sampai tanggal" title="Sampai tanggal">
      </div>

      <div id="aud-list-wrap">${renderSkeletonTable(6)}</div>
      <div id="aud-pagination"></div>
    </section>
  `;

  const listWrap = container.querySelector('#aud-list-wrap');
  const pagWrap = container.querySelector('#aud-pagination');

  async function loadAudit() {
    listWrap.innerHTML = renderSkeletonTable(6);
    try {
      const res = await apiCall('audit.list', {
        page: state.page,
        limit: state.limit,
        q: state.q,
        filters: {
          action_type: state.action_type || undefined,
          module: state.module || undefined,
          date_from: state.date_from || undefined,
          date_to: state.date_to || undefined
        }
      });
      const items = (res.data && res.data.items) || [];
      renderTable(items);
      renderPagination(pagWrap, res.meta, (p) => {
        state.page = p;
        loadAudit();
      });
    } catch (err) {
      listWrap.innerHTML = `<div class="empty-state"><p class="empty-state-title">Gagal memuat Audit Log</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      toast(err.message, 'danger');
    }
  }

  function renderTable(items) {
    if (items.length === 0) {
      listWrap.innerHTML = '<div class="empty-state"><p class="empty-state-title">Belum ada entri Audit Log sesuai filter</p></div>';
      return;
    }

    listWrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Waktu (WIB)</th>
              <th>Pengguna</th>
              <th>Aksi</th>
              <th>Modul &amp; Entitas</th>
              <th>Ringkasan</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((l) => `
              <tr>
                <td class="font-mono text-xs">${esc(formatDateTimeId(l.timestamp))}</td>
                <td class="text-sm">
                  <div class="font-mono"><strong>${esc(l.actor_username || '-')}</strong></div>
                  <div class="text-xs text-muted">${esc(l.actor_role || '-')}</div>
                </td>
                <td><span class="badge ${ACTION_BADGE_MAP[l.action_type] || 'badge-neutral'}">${esc(l.action_type)}</span></td>
                <td class="text-xs">
                  <div><strong>${esc(l.module)}</strong></div>
                  <div class="font-mono text-muted">${esc(l.entity_id || '-')}</div>
                </td>
                <td class="text-sm">
                  <div>${esc(l.summary)}</div>
                  ${l.corr_id ? `<div class="text-xs text-muted font-mono">${esc(l.corr_id)}</div>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function openPurgeModal() {
    const modal = openModal({
      title: 'Bersihkan Audit Log Lama (Khusus OWNER)',
      bodyHtml: `
        <div class="auth-notice" role="alert">
          Tindakan ini menghapus entri Audit Log sebelum tanggal batas yang Anda pilih.
          <strong>Tindakan penghapusan ini sendiri akan tetap tercatat secara permanen sebagai entri PURGE_AUDIT.</strong>
        </div>
        <form id="purge-audit-form" novalidate>
          <div class="field">
            <label for="purge-date">Hapus log sebelum tanggal <span class="req-star">*</span></label>
            <input id="purge-date" name="before_date" type="date" class="input" required>
          </div>
          <div class="field">
            <label for="purge-reason">Alasan penghapusan <span class="req-star">*</span></label>
            <input id="purge-reason" name="reason" type="text" class="input" placeholder="mis. Pembersihan arsip tahunan setelah backup" required>
          </div>
          <div class="field">
            <label for="purge-confirm">Ketik tepat <strong>HAPUS AUDIT LOG</strong> untuk konfirmasi <span class="req-star">*</span></label>
            <input id="purge-confirm" name="confirm_text" type="text" class="input" autocomplete="off" placeholder="HAPUS AUDIT LOG" required>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" data-modal-close>Batal</button>
        <button type="submit" form="purge-audit-form" class="btn btn-danger" id="btn-do-purge">Hapus Log Lama</button>
      `
    });

    const form = modal.querySelector('#purge-audit-form');
    const btn = modal.querySelector('#btn-do-purge');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      btn.disabled = true;
      btn.textContent = 'Memproses...';
      try {
        const res = await apiCall('audit.purge', {
          before_date: form.before_date.value,
          reason: form.reason.value.trim(),
          confirm_text: form.confirm_text.value.trim()
        }, { write: true });
        closeModal();
        toast(`${res.data.deleted_count} entri Audit Log lama dibersihkan dan dicatat sebagai PURGE_AUDIT.`, 'success');
        state.page = 1;
        loadAudit();
      } catch (err) {
        if (err.fields) showFieldErrors(form, err.fields);
        toast(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Hapus Log Lama';
      }
    });
  }

  container.querySelector('#btn-purge-audit')?.addEventListener('click', openPurgeModal);

  let debounce = null;
  container.querySelector('#aud-search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadAudit(); }, 250);
  });
  container.querySelector('#aud-filter-action').addEventListener('change', (e) => { state.action_type = e.target.value; state.page = 1; loadAudit(); });
  container.querySelector('#aud-filter-module').addEventListener('change', (e) => { state.module = e.target.value; state.page = 1; loadAudit(); });
  container.querySelector('#aud-filter-from').addEventListener('change', (e) => { state.date_from = e.target.value; state.page = 1; loadAudit(); });
  container.querySelector('#aud-filter-to').addEventListener('change', (e) => { state.date_to = e.target.value; state.page = 1; loadAudit(); });

  loadAudit();
}
