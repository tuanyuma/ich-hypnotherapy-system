/**
 * pages/dashboard.js — Dashboard Ringkasan ICH HYPNOTHERAPY (F2):
 * KPI aktual, ringkasan status klien, quick actions sesuai role,
 * dan daftar 10–15 jadwal terdekat + tombol pengingat WhatsApp manual.
 */

import { apiCall } from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';
import { esc, formatDateId, statusBadge, renderSkeletonCards, renderSkeletonTable, toast } from '../ui.js';

export async function renderDashboardPage(container) {
  container.innerHTML = renderSkeletonCards(4) + renderSkeletonTable(5);

  try {
    const res = await apiCall('dashboard.summary', { upcoming_limit: 15 });
    const d = res.data;
    const kpi = d.kpi || {};
    const statusMap = d.client_status_summary || {};
    const upcoming = d.upcoming_appointments || [];
    const qa = d.quick_actions || {};
    const user = getUser();

    const totalForBar = Math.max(Number(kpi.total_clients || 0), 1);
    const pct = (n) => Math.round((Number(n || 0) / totalForBar) * 100);

    container.innerHTML = `
      <div class="quick-actions-bar" aria-label="Aksi cepat">
        ${qa.can_add_client ? '<button type="button" class="btn btn-primary" data-qa="client">+ Klien Baru</button>' : ''}
        ${qa.can_add_appointment ? '<button type="button" class="btn btn-soft" data-qa="appointment">+ Jadwal Baru</button>' : ''}
        ${qa.can_add_rme ? '<button type="button" class="btn btn-secondary" data-qa="rme">+ Sesi Terapi Baru</button>' : ''}
      </div>

      <section class="kpi-grid" aria-label="Ringkasan KPI">
        <article class="kpi-card">
          <div class="kpi-label">Total Klien</div>
          <div class="kpi-value">${esc(kpi.total_clients || 0)}</div>
          <div class="kpi-sub">${user && user.role === 'THERAPIST' ? 'Dalam kewenangan Anda' : 'Seluruh klien aktif'}</div>
        </article>
        <article class="kpi-card">
          <div class="kpi-label">Klien Baru Bulan Ini</div>
          <div class="kpi-value">${esc(kpi.new_clients_this_month || 0)}</div>
          <div class="kpi-sub">Pendaftaran bulan berjalan</div>
        </article>
        <article class="kpi-card">
          <div class="kpi-label">Sesi Hari Ini</div>
          <div class="kpi-value">${esc(kpi.today_sessions || 0)}</div>
          <div class="kpi-sub">${esc(formatDateId(d.as_of_date))}</div>
        </article>
        <article class="kpi-card">
          <div class="kpi-label">Total Sesi Terapi</div>
          <div class="kpi-value">${esc(kpi.total_sessions || 0)}</div>
          <div class="kpi-sub">Akumulasi RME tercatat</div>
        </article>
      </section>

      <div class="dashboard-split">
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Jadwal Terdekat (${upcoming.length})</h2>
              <p class="card-desc">Maksimal 15 jadwal aktif mulai hari ini beserta pengingat WhatsApp manual.</p>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-all-appointments">Lihat Semua →</button>
          </div>

          ${upcoming.length === 0 ? `
            <div class="empty-state">
              <p class="empty-state-title">Belum ada jadwal terdekat</p>
              <p class="empty-state-desc">Jadwal dengan status Scheduled atau Confirmed mulai hari ini akan tampil di sini.</p>
              ${qa.can_add_appointment ? '<button type="button" class="btn btn-soft" data-qa="appointment">+ Buat Jadwal Baru</button>' : ''}
            </div>
          ` : `
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Tanggal &amp; Jam</th>
                    <th>Klien</th>
                    <th>Terapis</th>
                    <th>Sesi</th>
                    <th>Status</th>
                    <th>Pengingat</th>
                  </tr>
                </thead>
                <tbody>
                  ${upcoming.map((ap) => `
                    <tr>
                      <td class="font-mono">
                        <div><strong>${esc(formatDateId(ap.scheduled_date))}</strong></div>
                        <div class="text-xs text-muted">${esc(ap.start_time)} WIB (${esc(ap.duration_min)} mnt)</div>
                      </td>
                      <td>
                        <button type="button" class="link-btn" data-open-client="${esc(ap.client_id)}">${esc(ap.client_name || '-')}</button>
                        <div class="text-xs text-muted font-mono">${esc(ap.client_code || '')}</div>
                      </td>
                      <td>${esc(ap.therapist_name || '-')}</td>
                      <td>${statusBadge('mode', ap.session_mode)}</td>
                      <td>${statusBadge('appointment', ap.status)}</td>
                      <td>
                        ${ap.wa_link ? `
                          <button type="button" class="btn btn-wa btn-sm"
                            data-wa-apt="${esc(ap.appointment_id)}"
                            data-wa-url="${esc(ap.wa_link)}">
                            WA ${ap.wa_reminded_at ? '✓' : ''}
                          </button>
                        ` : '<span class="text-xs text-muted">-</span>'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </section>

        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Status Klien</h2>
              <p class="card-desc">Distribusi tahapan klien saat ini.</p>
            </div>
          </div>

          <div class="status-summary-list">
            <div>
              <div class="status-row-head">
                <span>Baru Daftar</span>
                <strong>${esc(statusMap.BARU_DAFTAR || 0)} (${pct(statusMap.BARU_DAFTAR)}%)</strong>
              </div>
              <div class="status-bar-track">
                <div class="status-bar-fill" style="width:${pct(statusMap.BARU_DAFTAR)}%;background:var(--color-info);"></div>
              </div>
            </div>

            <div>
              <div class="status-row-head">
                <span>Dalam Proses</span>
                <strong>${esc(statusMap.DALAM_PROSES || 0)} (${pct(statusMap.DALAM_PROSES)}%)</strong>
              </div>
              <div class="status-bar-track">
                <div class="status-bar-fill" style="width:${pct(statusMap.DALAM_PROSES)}%;background:var(--color-warning);"></div>
              </div>
            </div>

            <div>
              <div class="status-row-head">
                <span>Selesai</span>
                <strong>${esc(statusMap.SELESAI || 0)} (${pct(statusMap.SELESAI)}%)</strong>
              </div>
              <div class="status-bar-track">
                <div class="status-bar-fill" style="width:${pct(statusMap.SELESAI)}%;background:var(--color-success);"></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;

    // Quick Action navigation
    container.querySelectorAll('[data-qa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.qa;
        if (target === 'client') navigate('#/clients?new=1');
        if (target === 'appointment') navigate('#/appointments?new=1');
        if (target === 'rme') navigate('#/rme?new=1');
      });
    });

    const allAptBtn = container.querySelector('#btn-all-appointments');
    if (allAptBtn) {
      allAptBtn.addEventListener('click', () => navigate('#/appointments'));
    }

    container.querySelectorAll('[data-open-client]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(`#/clients/${btn.dataset.openClient}`));
    });

    // Tombol WA manual: buka tab wa.me + tandai wa_reminded_at di server
    container.querySelectorAll('[data-wa-apt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.waUrl;
        const aptId = btn.dataset.waApt;
        window.open(url, '_blank', 'noopener,noreferrer');
        apiCall('appointments.markReminded', { appointment_id: aptId }, { write: true })
          .then(() => {
            btn.textContent = 'WA ✓';
          })
          .catch(() => {
            // Non-blocking bila gagal mencatat timestamp reminder
          });
      });
    });
  } catch (err) {
    container.innerHTML = `
      <div class="card empty-state">
        <p class="empty-state-title">Gagal memuat Dashboard</p>
        <p class="empty-state-desc">${esc(err.message)}</p>
        <button type="button" class="btn btn-primary" id="btn-retry-dash">Coba Lagi</button>
      </div>
    `;
    toast(err.message, 'danger');
    const retry = container.querySelector('#btn-retry-dash');
    if (retry) retry.addEventListener('click', () => renderDashboardPage(container));
  }
}
