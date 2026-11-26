/**
 * pages/dashboard.js — Dashboard Ringkasan ICH HYPNOTHERAPY (Soft Clinical Blue Bento):
 * - Hero Greeting personal + 4 Mini-KPI Bento Sub-cards
 * - Bento 2 Kolom:
 *   Kiri: Tabel Jadwal Terdekat (pill filter status/mode + tombol WA) + Donut Status Klien + Ringkasan Pengingat Hari Ini
 *   Kanan: Quick Actions Vertikal (RBAC-aware) + Kartu Ringkasan Akses Modul
 */

import { apiCall } from '../api.js';
import { getUser, can, roleLabel } from '../auth.js';
import { navigate } from '../router.js';
import { esc, formatDateId, statusBadge, renderSkeletonCards, renderSkeletonTable, toast } from '../ui.js';
import { storeGet, storeSet, storeIsFresh, prefetchCoreModules } from '../store.js';
import { animateBentoStagger } from '../motion.js';

function getGreetingWib() {
  const now = new Date();
  const wibHour = (now.getUTCHours() + 7) % 24;
  if (wibHour >= 4 && wibHour < 11) return 'Selamat Pagi';
  if (wibHour >= 11 && wibHour < 15) return 'Selamat Siang';
  if (wibHour >= 15 && wibHour < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}

function buildDonutSvg(baru, proses, selesai) {
  const total = baru + proses + selesai;
  const r = 46;
  const circ = 2 * Math.PI * r;
  if (total === 0) {
    return `
      <svg viewBox="0 0 120 120" width="128" height="128" aria-label="Belum ada data klien">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="#E2ECFB" stroke-width="14"/>
      </svg>
    `;
  }
  const segs = [
    { val: selesai, color: '#16A366' },
    { val: proses, color: '#F59E0B' },
    { val: baru, color: '#2563EB' }
  ];
  let offset = 0;
  const circles = segs.map((s) => {
    const len = (s.val / total) * circ;
    const html = len > 0
      ? `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}" stroke-width="14"
          stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"
          stroke-linecap="butt" transform="rotate(-90 60 60)"/>`
      : '';
    offset += len;
    return html;
  }).join('');

  return `
    <svg viewBox="0 0 120 120" width="128" height="128" role="img" aria-label="Distribusi status klien">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="#EAF0FA" stroke-width="14"/>
      ${circles}
    </svg>
  `;
}

export async function renderDashboardPage(container, route) {
  const cacheKey = 'dashboard:summary';
  const cached = storeGet(cacheKey);
  const forceRefresh = Boolean(route && route.forceRefresh);
  let activeFilter = 'ALL';

  function paintDashboard(d, withAnimation) {
    const kpi = d.kpi || {};
    const statusMap = d.client_status_summary || {};
    const upcoming = d.upcoming_appointments || [];
    const qa = d.quick_actions || {};
    const user = getUser();

    const firstName = user && user.full_name ? user.full_name.split(' ')[0] : 'Staf';
    const baruCount = Number(statusMap.BARU_DAFTAR || 0);
    const prosesCount = Number(statusMap.DALAM_PROSES || 0);
    const selesaiCount = Number(statusMap.SELESAI || 0);
    const totalClients = Number(kpi.total_clients || 0);
    const pct = (n) => (totalClients > 0 ? Math.round((n / totalClients) * 100) : 0);

    const onlineCount = upcoming.filter((a) => a.session_mode === 'ONLINE').length;
    const offlineCount = upcoming.filter((a) => a.session_mode === 'OFFLINE').length;
    const unremindedCount = upcoming.filter((a) => !a.wa_reminded_at).length;

    container.innerHTML = `
      <!-- Hero Greeting Bento + 4 Mini-KPI -->
      <section class="hero-bento" aria-label="Ringkasan hari ini">
        <div class="hero-bento-top">
          <div>
            <h2 class="hero-greeting">${esc(getGreetingWib())}, ${esc(firstName)}</h2>
            <p class="hero-sub">
              ${user && user.role === 'THERAPIST'
                ? 'Berikut ringkasan klien dan jadwal sesi dalam kewenangan Anda hari ini.'
                : 'Berikut ringkasan operasional dan jadwal sesi klinik ICH HYPNOTHERAPY hari ini.'}
            </p>
          </div>
          <div class="hero-date-pill">
            <span>📅</span>
            <span>${esc(formatDateId(d.as_of_date))}</span>
          </div>
        </div>

        <div class="kpi-grid">
          <article class="kpi-card">
            <div class="kpi-head">
              <span class="kpi-icon kpi-icon-blue" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>
              </span>
              <span class="kpi-label">Total Klien</span>
            </div>
            <div class="kpi-value">${esc(totalClients)}</div>
            <div class="kpi-sub">${user && user.role === 'THERAPIST' ? 'Dalam kewenangan Anda' : 'Klien aktif terdaftar'}</div>
          </article>

          <article class="kpi-card">
            <div class="kpi-head">
              <span class="kpi-icon kpi-icon-green" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
              </span>
              <span class="kpi-label">Klien Baru</span>
            </div>
            <div class="kpi-value">${esc(kpi.new_clients_this_month || 0)}</div>
            <div class="kpi-sub">Pendaftaran bulan ini</div>
          </article>

          <article class="kpi-card">
            <div class="kpi-head">
              <span class="kpi-icon kpi-icon-purple" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              </span>
              <span class="kpi-label">Sesi Hari Ini</span>
            </div>
            <div class="kpi-value">${esc(kpi.today_sessions || 0)}</div>
            <div class="kpi-sub">Jadwal aktif hari ini</div>
          </article>

          <article class="kpi-card">
            <div class="kpi-head">
              <span class="kpi-icon kpi-icon-amber" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
              </span>
              <span class="kpi-label">Total Sesi Terapi</span>
            </div>
            <div class="kpi-value">${esc(kpi.total_sessions || 0)}</div>
            <div class="kpi-sub">Akumulasi RME tercatat</div>
          </article>
        </div>
      </section>

      <!-- Bento 2 Kolom -->
      <div class="dashboard-split">
        <div>
          <!-- Tabel Jadwal Terdekat dengan Pill Tabs -->
          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Jadwal Terdekat</h2>
                <p class="card-desc">Maksimal 15 jadwal aktif mulai hari ini lengkap dengan pengingat WhatsApp.</p>
              </div>
              <button type="button" class="btn btn-soft btn-sm" id="btn-all-appointments">Lihat Semua →</button>
            </div>

            <div class="pill-tabs" id="dash-apt-tabs" role="tablist" aria-label="Filter jadwal terdekat">
              <button type="button" class="pill-tab ${activeFilter === 'ALL' ? 'is-active' : ''}" data-filter="ALL">Semua (${upcoming.length})</button>
              <button type="button" class="pill-tab ${activeFilter === 'SCHEDULED' ? 'is-active' : ''}" data-filter="SCHEDULED">Scheduled (${upcoming.filter((a) => a.status === 'SCHEDULED').length})</button>
              <button type="button" class="pill-tab ${activeFilter === 'CONFIRMED' ? 'is-active' : ''}" data-filter="CONFIRMED">Confirmed (${upcoming.filter((a) => a.status === 'CONFIRMED').length})</button>
              <button type="button" class="pill-tab ${activeFilter === 'ONLINE' ? 'is-active' : ''}" data-filter="ONLINE">Online (${onlineCount})</button>
              <button type="button" class="pill-tab ${activeFilter === 'OFFLINE' ? 'is-active' : ''}" data-filter="OFFLINE">Offline (${offlineCount})</button>
            </div>

            <div id="dash-upcoming-table"></div>
          </section>

          <!-- Baris Bawah: Donut Status Klien + Ringkasan Pengingat -->
          <div class="bento-subgrid-2">
            <section class="card">
              <div class="card-header" style="margin-bottom:14px;">
                <div>
                  <h2 class="card-title">Status Klien</h2>
                  <p class="card-desc">Distribusi tahapan layanan saat ini.</p>
                </div>
              </div>
              <div class="donut-wrap">
                <div class="donut-svg-box">
                  ${buildDonutSvg(baruCount, prosesCount, selesaiCount)}
                  <div class="donut-center">
                    <strong>${esc(totalClients)}</strong>
                    <span>Total Klien</span>
                  </div>
                </div>
                <div class="donut-legend">
                  <div class="legend-row">
                    <span class="legend-label"><span class="legend-dot" style="background:#2563EB;"></span>Baru Daftar</span>
                    <strong>${esc(baruCount)} <span class="text-muted text-xs">(${pct(baruCount)}%)</span></strong>
                  </div>
                  <div class="legend-row">
                    <span class="legend-label"><span class="legend-dot" style="background:#F59E0B;"></span>Dalam Proses</span>
                    <strong>${esc(prosesCount)} <span class="text-muted text-xs">(${pct(prosesCount)}%)</span></strong>
                  </div>
                  <div class="legend-row">
                    <span class="legend-label"><span class="legend-dot" style="background:#16A366;"></span>Selesai</span>
                    <strong>${esc(selesaiCount)} <span class="text-muted text-xs">(${pct(selesaiCount)}%)</span></strong>
                  </div>
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-header" style="margin-bottom:14px;">
                <div>
                  <h2 class="card-title">Fokus Operasional</h2>
                  <p class="card-desc">Ringkasan cepat jadwal mendatang.</p>
                </div>
              </div>
              <div class="activity-list">
                <div class="activity-item">
                  <span class="kpi-icon kpi-icon-amber" aria-hidden="true">💬</span>
                  <div class="qa-item-text">
                    <span class="qa-item-title">${esc(unremindedCount)} Jadwal Belum Diingatkan WA</span>
                    <span class="qa-item-sub">Klik tombol WA pada tabel untuk kirim pengingat cepat.</span>
                  </div>
                </div>
                <div class="activity-item">
                  <span class="kpi-icon kpi-icon-blue" aria-hidden="true">💻</span>
                  <div class="qa-item-text">
                    <span class="qa-item-title">${esc(onlineCount)} Online • ${esc(offlineCount)} Offline</span>
                    <span class="qa-item-sub">Komposisi mode sesi dari jadwal terdekat.</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <!-- Kolom Kanan: Quick Actions Vertikal & Ringkasan Akses -->
        <aside>
          <section class="card">
            <div class="card-header" style="margin-bottom:14px;">
              <div>
                <h2 class="card-title">Aksi Cepat</h2>
                <p class="card-desc">Pintasan tugas harian sesuai peran Anda.</p>
              </div>
            </div>
            <div class="qa-stack">
              ${qa.can_add_client ? `
                <button type="button" class="qa-item" data-qa="client">
                  <span class="kpi-icon kpi-icon-blue" aria-hidden="true">＋</span>
                  <span class="qa-item-text">
                    <span class="qa-item-title">Tambah Klien Baru</span>
                    <span class="qa-item-sub">Daftarkan klien dengan cek anti-duplikat WA</span>
                  </span>
                  <span class="qa-chevron" aria-hidden="true">›</span>
                </button>
              ` : ''}
              ${qa.can_add_appointment ? `
                <button type="button" class="qa-item" data-qa="appointment">
                  <span class="kpi-icon kpi-icon-purple" aria-hidden="true">◷</span>
                  <span class="qa-item-text">
                    <span class="qa-item-title">Buat Jadwal Baru</span>
                    <span class="qa-item-sub">Atur sesi Online/Offline dengan cek bentrok</span>
                  </span>
                  <span class="qa-chevron" aria-hidden="true">›</span>
                </button>
              ` : ''}
              ${qa.can_add_rme ? `
                <button type="button" class="qa-item" data-qa="rme">
                  <span class="kpi-icon kpi-icon-green" aria-hidden="true">✚</span>
                  <span class="qa-item-text">
                    <span class="qa-item-title">Catat Sesi Terapi (RME)</span>
                    <span class="qa-item-sub">Lengkap dengan Context Reference otomatis</span>
                  </span>
                  <span class="qa-chevron" aria-hidden="true">›</span>
                </button>
              ` : ''}
              ${can('assessments:add') ? `
                <button type="button" class="qa-item" data-qa="assessment">
                  <span class="kpi-icon kpi-icon-amber" aria-hidden="true">✎</span>
                  <span class="qa-item-text">
                    <span class="qa-item-title">Input Assessment Awal</span>
                    <span class="qa-item-sub">Anamnesis awal &amp; tujuan terapi klien</span>
                  </span>
                  <span class="qa-chevron" aria-hidden="true">›</span>
                </button>
              ` : ''}
              ${can('therapists:view') ? `
                <button type="button" class="qa-item" data-qa="therapists">
                  <span class="kpi-icon kpi-icon-blue" aria-hidden="true">✦</span>
                  <span class="qa-item-text">
                    <span class="qa-item-title">Lihat Data Terapis</span>
                    <span class="qa-item-sub">Profil, spesialisasi, dan tarif sesi</span>
                  </span>
                  <span class="qa-chevron" aria-hidden="true">›</span>
                </button>
              ` : ''}
            </div>
          </section>

          <section class="card" style="background:linear-gradient(145deg, rgba(255,255,255,0.95), rgba(225,237,255,0.85));">
            <div class="flex-between mb-3">
              <strong class="text-sm">Keamanan &amp; Privasi Sesi</strong>
              <span class="badge badge-success">Aktif</span>
            </div>
            <p class="text-xs text-muted" style="margin:0 0 10px;">
              Anda masuk sebagai <strong>${esc(roleLabel(user ? user.role : ''))}</strong>.
              Data klinis dilindungi di server dan sesi berakhir otomatis saat tab ditutup atau tidak aktif.
            </p>
            ${can('audit:view') ? '<button type="button" class="btn btn-secondary btn-sm btn-block" data-qa="audit">Buka Audit Log</button>' : ''}
          </section>
        </aside>
      </div>
    `;

    const tableMount = container.querySelector('#dash-upcoming-table');

    function renderUpcomingTable(filterKey) {
      activeFilter = filterKey;
      let filtered = upcoming;
      if (filterKey === 'SCHEDULED' || filterKey === 'CONFIRMED') {
        filtered = upcoming.filter((a) => a.status === filterKey);
      } else if (filterKey === 'ONLINE' || filterKey === 'OFFLINE') {
        filtered = upcoming.filter((a) => a.session_mode === filterKey);
      }

      if (filtered.length === 0) {
        tableMount.innerHTML = `
          <div class="empty-state" style="padding:28px 12px;">
            <p class="empty-state-title">Tidak ada jadwal pada filter ini</p>
            <p class="empty-state-desc">Jadwal aktif mulai hari ini akan tampil otomatis di sini.</p>
            ${qa.can_add_appointment ? '<button type="button" class="btn btn-soft btn-sm" data-qa="appointment">+ Buat Jadwal Baru</button>' : ''}
          </div>
        `;
        tableMount.querySelector('[data-qa="appointment"]')?.addEventListener('click', () => navigate('#/appointments?new=1'));
        return;
      }

      tableMount.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Klien</th>
                <th>Tanggal &amp; Jam</th>
                <th>Terapis</th>
                <th>Mode &amp; Status</th>
                <th>Pengingat</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map((ap) => {
                const initials = String(ap.client_name || 'K').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
                return `
                  <tr>
                    <td>
                      <div class="flex-gap" style="flex-wrap:nowrap;">
                        <span class="client-initial" aria-hidden="true">${esc(initials)}</span>
                        <div>
                          <button type="button" class="link-btn" data-open-client="${esc(ap.client_id)}">${esc(ap.client_name || '-')}</button>
                          <div class="text-xs text-muted font-mono">${esc(ap.client_code || '')}</div>
                        </div>
                      </div>
                    </td>
                    <td class="font-mono text-xs">
                      <div><strong>${esc(formatDateId(ap.scheduled_date))}</strong></div>
                      <div class="text-muted">${esc(ap.start_time)} WIB (${esc(ap.duration_min)} mnt)</div>
                    </td>
                    <td class="text-sm">${esc(ap.therapist_name || '-')}</td>
                    <td>
                      <div class="flex-gap">
                        ${statusBadge('mode', ap.session_mode)}
                        ${statusBadge('appointment', ap.status)}
                      </div>
                    </td>
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
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      tableMount.querySelectorAll('[data-open-client]').forEach((btn) => {
        btn.addEventListener('click', () => navigate(`#/clients/${btn.dataset.openClient}`));
      });
      tableMount.querySelectorAll('[data-wa-apt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.open(btn.dataset.waUrl, '_blank', 'noopener,noreferrer');
          apiCall('appointments.markReminded', { appointment_id: btn.dataset.waApt }, { write: true })
            .then(() => { btn.textContent = 'WA ✓'; })
            .catch(() => {});
        });
      });
    }

    container.querySelectorAll('#dash-apt-tabs .pill-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('#dash-apt-tabs .pill-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        renderUpcomingTable(tab.dataset.filter);
      });
    });
    renderUpcomingTable(activeFilter);

    container.querySelectorAll('[data-qa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.qa;
        if (target === 'client') navigate('#/clients?new=1');
        if (target === 'appointment') navigate('#/appointments?new=1');
        if (target === 'rme') navigate('#/rme?new=1');
        if (target === 'assessment') navigate('#/assessments?new=1');
        if (target === 'therapists') navigate('#/therapists');
        if (target === 'audit') navigate('#/audit');
      });
    });

    container.querySelector('#btn-all-appointments')?.addEventListener('click', () => navigate('#/appointments'));

    if (withAnimation) {
      animateBentoStagger(container);
    }
  }

  // SWR: Tampilkan instan dari RAM bila tersedia, lalu segarkan diam-diam di latar belakang
  if (cached && cached.data && !forceRefresh) {
    paintDashboard(cached.data, true);
    if (storeIsFresh(cacheKey, 35000)) {
      setTimeout(() => prefetchCoreModules(), 250);
      return;
    }
  } else {
    container.innerHTML = renderSkeletonCards(4) + renderSkeletonTable(5);
  }

  try {
    const res = await apiCall('dashboard.summary', { upcoming_limit: 15 });
    const { changed } = storeSet(cacheKey, res.data);
    if (!cached || forceRefresh || changed) {
      paintDashboard(res.data, !cached);
    }
    // Prefetch modul inti (Terapis, Klien hal. 1, Jadwal hal. 1) di latar belakang
    setTimeout(() => prefetchCoreModules(), 350);
  } catch (err) {
    if (!cached) {
      container.innerHTML = `
        <div class="card empty-state">
          <p class="empty-state-title">Gagal memuat Dashboard</p>
          <p class="empty-state-desc">${esc(err.message)}</p>
          <button type="button" class="btn btn-primary" id="btn-retry-dash">Coba Lagi</button>
        </div>
      `;
      container.querySelector('#btn-retry-dash')?.addEventListener('click', () => renderDashboardPage(container, { forceRefresh: true }));
    }
    toast(err.message, 'danger');
  }
}
