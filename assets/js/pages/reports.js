/**
 * pages/reports.js — Laporan Rekapitulasi Operasional & Keuangan Klinik:
 * - Filter rentang tanggal (Dari Tanggal s/d Sampai Tanggal) & Terapis
 * - Rekap KPI klien, sesi RME, paket, arus kas, kinerja per terapis, & sumber informasi
 * - Cetak / Simpan PDF (window.print) & Unduh CSV (UTF-8 BOM untuk Excel).
 */

import { apiCall } from '../api.js';
import { can, getUser } from '../auth.js';
import {
  esc,
  SOURCE_CHANNEL_LABELS,
  formatRupiah,
  formatDateId,
  todayInputDate,
  statusBadge,
  renderSkeletonReport,
  setButtonLoading,
  toast
} from '../ui.js';
import { storeGet, storeSet, storeIsFresh, getTherapistsOptionsCached } from '../store.js';

function downloadCsvFile(filename, rows) {
  const csvBody = rows.map((row) => row.map((cell) => {
    const val = String(cell === undefined || cell === null ? '' : cell).replace(/"/g, '""');
    return `"${val}"`;
  }).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function renderReportsPage(container, route) {
  const actor = getUser();
  const isTherapist = actor && actor.role === 'THERAPIST';
  const canExport = can('reports:export');

  const today = todayInputDate();
  const monthStart = today.slice(0, 8) + '01';
  const state = { date_from: monthStart, date_to: today, therapist_id: '' };
  let therapistOptions = !isTherapist
    ? ((storeGet('therapists:options:all') && storeGet('therapists:options:all').data) || [])
    : [];
  let lastReportData = null;

  container.innerHTML = `
    <section class="card no-print">
      <div class="card-header">
        <div>
          <h2 class="card-title">Filter Periode Laporan</h2>
          <p class="card-desc">Pilih rentang tanggal dan terapis untuk membuat laporan operasional &amp; keuangan klinik.</p>
        </div>
        ${canExport ? `
          <div class="flex-gap">
            <button type="button" class="btn btn-soft btn-sm" id="btn-export-csv">⬇ Unduh CSV (Excel)</button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-print-report">🖨 Cetak / Simpan PDF</button>
          </div>
        ` : ''}
      </div>

      <form id="report-filter-form" class="filter-bar" style="margin-bottom:0;">
        <input type="date" id="rep-from" class="input" value="${esc(state.date_from)}" aria-label="Dari tanggal" required>
        <input type="date" id="rep-to" class="input" value="${esc(state.date_to)}" aria-label="Sampai tanggal" required>
        ${!isTherapist ? `
          <select id="rep-trp" class="select" aria-label="Filter terapis">
            <option value="">Semua Terapis</option>
            ${therapistOptions.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('')}
          </select>
        ` : ''}
        <button type="submit" class="btn btn-primary" id="btn-generate-report">Buat Laporan</button>
      </form>
    </section>

    <div id="report-output">${renderSkeletonReport()}</div>
  `;

  const outputWrap = container.querySelector('#report-output');
  const filterForm = container.querySelector('#report-filter-form');
  const genBtn = container.querySelector('#btn-generate-report');

  if (!isTherapist && therapistOptions.length === 0) {
    getTherapistsOptionsCached({ activeOnly: false }).then((opts) => {
      therapistOptions = opts;
      const sel = container.querySelector('#rep-trp');
      if (sel) {
        sel.innerHTML = '<option value="">Semua Terapis</option>' + opts.map((t) => `<option value="${esc(t.therapist_id)}">${esc(t.full_name)}</option>`).join('');
      }
    }).catch(() => {});
  }

  function paintReport(d) {
    lastReportData = d;
    const kpi = d.kpi || {};
    const apt = d.appointments || {};
    const srcMap = d.source_breakdown || {};
    const thList = d.therapist_breakdown || [];
    const payList = d.payments_detail || [];

    outputWrap.innerHTML = `
      <section class="hero-bento">
        <div class="hero-bento-top">
          <div>
            <h2 class="hero-greeting">Laporan Klinik ICH HYPNOTHERAPY</h2>
            <p class="hero-sub">Periode: <strong>${esc(formatDateId(d.period.date_from))}</strong> s/d <strong>${esc(formatDateId(d.period.date_to))}</strong></p>
          </div>
          <div class="hero-date-pill">Total Klien Aktif: <strong>${esc(kpi.total_active_clients || 0)}</strong></div>
        </div>

        <div class="kpi-grid">
          <article class="kpi-card">
            <div class="kpi-label">Klien Baru (Periode)</div>
            <div class="kpi-value">${esc(kpi.new_clients || 0)}</div>
            <div class="kpi-sub">Assessment: ${esc(kpi.total_assessments || 0)}</div>
          </article>
          <article class="kpi-card">
            <div class="kpi-label">Sesi RME Tercatat</div>
            <div class="kpi-value">${esc(kpi.total_rme_sessions || 0)}</div>
            <div class="kpi-sub">Paket baru: ${esc(kpi.packages_sold || 0)}</div>
          </article>
          <article class="kpi-card">
            <div class="kpi-label">Total Pemasukan</div>
            <div class="kpi-value" style="color:var(--color-success);font-size:1.35rem;">${esc(formatRupiah(kpi.total_income || 0))}</div>
            <div class="kpi-sub">Pengeluaran: ${esc(formatRupiah(kpi.total_expense || 0))}</div>
          </article>
          <article class="kpi-card">
            <div class="kpi-label">Kas Bersih Periode</div>
            <div class="kpi-value" style="font-size:1.35rem;">${esc(formatRupiah(kpi.net_balance || 0))}</div>
            <div class="kpi-sub">Komisi belum cair: ${esc(formatRupiah(kpi.commission_unpaid || 0))}</div>
          </article>
        </div>
      </section>

      <div class="bento-subgrid-2">
        <section class="card">
          <h3 class="card-title mb-3">Ringkasan Jadwal Periode</h3>
          <div class="form-grid form-grid-2 text-sm">
            <div>Total Jadwal: <strong>${esc(apt.total || 0)}</strong></div>
            <div>Completed (Selesai): <strong>${esc(apt.completed || 0)}</strong></div>
            <div>Scheduled / Confirmed: <strong>${esc((apt.scheduled || 0) + (apt.confirmed || 0))}</strong></div>
            <div>Cancelled / No Show: <strong>${esc((apt.cancelled || 0) + (apt.no_show || 0))}</strong></div>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title mb-3">Sumber Informasi Klien Baru</h3>
          ${Object.keys(srcMap).length === 0
            ? '<p class="text-xs text-muted" style="margin:0;">Belum ada pendaftaran klien baru pada rentang tanggal ini.</p>'
            : Object.entries(srcMap).map(([k, count]) => `
                <div class="flex-between text-sm" style="padding:4px 0;border-bottom:1px solid var(--color-border);">
                  <span>${esc(SOURCE_CHANNEL_LABELS[k] || k)}</span>
                  <strong>${esc(count)} klien</strong>
                </div>
              `).join('')}
        </section>
      </div>

      <section class="card">
        <h3 class="card-title mb-3">Rekap Kinerja &amp; Komisi per Terapis</h3>
        ${thList.length === 0 ? '<p class="text-sm text-muted">Belum ada data terapis.</p>' : `
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama Terapis</th>
                  <th>Sesi RME</th>
                  <th>Jadwal Selesai</th>
                  <th>Omzet Terkait</th>
                  <th>Total Komisi</th>
                  <th>Belum Cair</th>
                </tr>
              </thead>
              <tbody>
                ${thList.map((t) => `
                  <tr>
                    <td><span class="code-chip">${esc(t.code)}</span></td>
                    <td><strong>${esc(t.full_name)}</strong></td>
                    <td><span class="session-chip">${esc(t.rme_sessions)} Sesi</span></td>
                    <td>${esc(t.completed_appointments)}</td>
                    <td class="font-mono">${esc(formatRupiah(t.revenue_generated))}</td>
                    <td class="font-mono"><strong>${esc(formatRupiah(t.commission_total))}</strong></td>
                    <td class="font-mono" style="color:var(--color-warning);">${esc(formatRupiah(t.commission_unpaid))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </section>

      <section class="card">
        <h3 class="card-title mb-3">Rincian Transaksi Kas Periode (${esc(payList.length)} transaksi)</h3>
        ${payList.length === 0 ? '<p class="text-sm text-muted">Tidak ada transaksi kas pada periode ini.</p>' : `
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tanggal</th>
                  <th>Tipe</th>
                  <th>Kategori</th>
                  <th>Klien / Terapis</th>
                  <th>Metode</th>
                  <th>Nominal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${payList.map((p) => `
                  <tr>
                    <td><span class="code-chip">${esc(p.payment_code)}</span></td>
                    <td class="font-mono text-xs">${esc(formatDateId(p.payment_date))}</td>
                    <td>${statusBadge('payment_type', p.payment_type)}</td>
                    <td class="text-xs">${esc(p.category)}</td>
                    <td class="text-xs">${esc(p.client_name || p.therapist_name || p.description || '-')}</td>
                    <td class="text-xs font-mono">${esc(p.payment_method)}</td>
                    <td class="font-mono text-sm"><strong>${esc(formatRupiah(p.amount))}</strong></td>
                    <td>${statusBadge('payment', p.status)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </section>
    `;
  }

  async function loadReport(force = false, showBtnSpin = false) {
    const key = `reports:summary:${state.date_from}:${state.date_to}:${state.therapist_id}`;
    const cached = storeGet(key);

    if (cached && cached.data && !force) {
      paintReport(cached.data);
      if (storeIsFresh(key, 30000)) return;
    }

    if (showBtnSpin) setButtonLoading(genBtn, true, 'Menyusun...');
    try {
      const res = await apiCall('reports.summary', {
        date_from: state.date_from,
        date_to: state.date_to,
        therapist_id: state.therapist_id || undefined
      });
      storeSet(key, res.data);
      paintReport(res.data);
      if (showBtnSpin) toast('Laporan berhasil diperbarui.', 'success');
    } catch (err) {
      outputWrap.innerHTML = `<div class="card empty-state"><p class="empty-state-title">Gagal membuat laporan</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
      toast(err.message, 'danger');
    } finally {
      if (showBtnSpin) setButtonLoading(genBtn, false);
    }
  }

  filterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.date_from = container.querySelector('#rep-from').value;
    state.date_to = container.querySelector('#rep-to').value;
    const trpEl = container.querySelector('#rep-trp');
    state.therapist_id = trpEl ? trpEl.value : '';
    loadReport(true, true);
  });

  container.querySelector('#btn-print-report')?.addEventListener('click', () => {
    window.print();
  });

  container.querySelector('#btn-export-csv')?.addEventListener('click', () => {
    if (!lastReportData) {
      toast('Tunggu laporan selesai dimuat terlebih dahulu.', 'warning');
      return;
    }
    const d = lastReportData;
    const rows = [
      ['LAPORAN KLINIK ICH HYPNOTHERAPY'],
      ['Periode', `${d.period.date_from} s/d ${d.period.date_to}`],
      [],
      ['RINGKASAN KPI', 'NILAI'],
      ['Klien Baru', d.kpi.new_clients],
      ['Total Assessment', d.kpi.total_assessments],
      ['Total Sesi RME', d.kpi.total_rme_sessions],
      ['Paket Terjual', d.kpi.packages_sold],
      ['Total Pemasukan (Rp)', d.kpi.total_income],
      ['Total Pengeluaran (Rp)', d.kpi.total_expense],
      ['Saldo Kas Bersih (Rp)', d.kpi.net_balance],
      ['Komisi Belum Cair (Rp)', d.kpi.commission_unpaid],
      ['Komisi Sudah Cair (Rp)', d.kpi.commission_paid],
      [],
      ['REKAP TERAPIS'],
      ['Kode', 'Nama Terapis', 'Sesi RME', 'Jadwal Selesai', 'Omzet (Rp)', 'Total Komisi (Rp)', 'Komisi Belum Cair (Rp)'],
      ...(d.therapist_breakdown || []).map((t) => [
        t.code, t.full_name, t.rme_sessions, t.completed_appointments, t.revenue_generated, t.commission_total, t.commission_unpaid
      ]),
      [],
      ['RINCIAN TRANSAKSI KAS'],
      ['ID Transaksi', 'Tanggal', 'Tipe', 'Kategori', 'Klien', 'Terapis', 'Metode', 'Nominal (Rp)', 'Status', 'Keterangan'],
      ...(d.payments_detail || []).map((p) => [
        p.payment_code, p.payment_date, p.payment_type, p.category, p.client_name, p.therapist_name, p.payment_method, p.amount, p.status, p.description
      ])
    ];
    downloadCsvFile(`Laporan-ICH-${d.period.date_from}-sd-${d.period.date_to}.csv`, rows);
    toast('Berkas CSV laporan berhasil diunduh.', 'success');
  });

  await loadReport(Boolean(route && route.forceRefresh), false);
}
