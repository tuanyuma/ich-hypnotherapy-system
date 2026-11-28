/**
 * pages/settings.js — Pengaturan Klinik Non-Rahasia (sheet SETTINGS):
 * - SWR in-memory cache + background refresh via Top Progress Bar
 * - Inline button spinner saat menyimpan pengaturan.
 */

import { apiCall } from '../api.js';
import { can, setPublicSettings } from '../auth.js';
import { invalidateAiStatusCache } from '../aiAssistant.js';
import {
  esc,
  renderSkeletonTable,
  confirmDialog,
  clearFieldErrors,
  showFieldErrors,
  setButtonLoading,
  toast
} from '../ui.js';
import { storeGet, storeSet, storeIsFresh } from '../store.js';

export async function renderSettingsPage(container, route) {
  const canEdit = can('settings:edit');
  const canManageAi = can('ai:manage');
  const cacheKey = 'settings:get';
  const forceRefresh = Boolean(route && route.forceRefresh);
  const cached = storeGet(cacheKey);
  let aiCfg = null;

  function paintAiCard(cfg) {
    const mount = container.querySelector('#ai-settings-mount');
    if (!mount || !canManageAi) return;
    if (!cfg) {
      mount.innerHTML = `<section class="card">${renderSkeletonTable(3)}</section>`;
      return;
    }

    const badgeHtml = cfg.configured && cfg.enabled
      ? '<span class="badge badge-success">Aktif &amp; Terpasang</span>'
      : cfg.configured
        ? '<span class="badge badge-warning">Dinonaktifkan</span>'
        : '<span class="badge badge-neutral">Belum Dikonfigurasi</span>';

    mount.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Integrasi Asisten AI (Google Gemini)</h2>
            <p class="card-desc">
              Hubungkan Gemini API Key dari
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" class="link-btn">Google AI Studio ↗</a>
              agar staf dapat menggunakan Asisten AI Klinik di pojok kanan bawah.
            </p>
          </div>
          ${badgeHtml}
        </div>

        <form id="ai-config-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field field-span-full">
              <label for="ai-api-key">Gemini API Key (Google AI Studio)</label>
              <div class="input-password-wrap">
                <input id="ai-api-key" name="api_key" type="password" class="input font-mono"
                  autocomplete="off" spellcheck="false"
                  placeholder="${cfg.configured ? 'Tersimpan (' + esc(cfg.masked_key) + ') — isi hanya jika ingin mengganti' : 'Tempel Gemini API Key dari Google AI Studio (AIza...)'}">
                <button type="button" id="btn-toggle-ai-key" class="btn-toggle-pw" aria-pressed="false">Tampil</button>
              </div>
              <span class="field-hint">
                ${cfg.configured
                  ? `API Key aktif saat ini: <strong class="font-mono">${esc(cfg.masked_key)}</strong>. Kunci disimpan aman di Script Properties server (tidak pernah masuk Google Sheets atau browser).`
                  : 'API Key disimpan eksklusif di Google Apps Script Properties. Data pribadi pasien (PII) dan RME mentah tidak pernah dikirim ke server AI.'}
              </span>
            </div>

            <div class="field">
              <label for="ai-model">Model Gemini</label>
              <select id="ai-model" name="model" class="select">
                <option value="gemini-2.5-flash" ${cfg.model === 'gemini-2.5-flash' ? 'selected' : ''}>gemini-2.5-flash (Rekomendasi — Cepat &amp; Cerdas)</option>
                <option value="gemini-2.5-flash-lite" ${cfg.model === 'gemini-2.5-flash-lite' ? 'selected' : ''}>gemini-2.5-flash-lite (Hemat Kuota)</option>
              </select>
            </div>

            <div class="field" style="justify-content:center;">
              <label>Status Asisten AI</label>
              <label class="perm-check" style="margin-top:6px;">
                <input type="checkbox" id="ai-enabled" name="enabled" ${cfg.enabled ? 'checked' : ''}>
                <span>Aktifkan Asisten AI untuk seluruh staf yang memiliki izin</span>
              </label>
            </div>
          </div>

          <div class="flex-between mt-4">
            <div class="flex-gap">
              <button type="button" class="btn btn-soft btn-sm" id="btn-test-ai" ${cfg.configured ? '' : 'disabled'}>Uji Koneksi Gemini</button>
              ${cfg.configured ? '<button type="button" class="btn btn-danger-ghost btn-sm" id="btn-clear-ai-key">Hapus API Key</button>' : ''}
            </div>
            <button type="submit" class="btn btn-primary" id="btn-save-ai">Simpan Pengaturan AI</button>
          </div>
        </form>
      </section>
    `;

    const aiForm = mount.querySelector('#ai-config-form');
    const keyInput = mount.querySelector('#ai-api-key');
    const toggleBtn = mount.querySelector('#btn-toggle-ai-key');
    const saveAiBtn = mount.querySelector('#btn-save-ai');
    const testBtn = mount.querySelector('#btn-test-ai');
    const clearBtn = mount.querySelector('#btn-clear-ai-key');

    toggleBtn?.addEventListener('click', () => {
      const show = keyInput.type === 'password';
      keyInput.type = show ? 'text' : 'password';
      toggleBtn.textContent = show ? 'Sembunyi' : 'Tampil';
      toggleBtn.setAttribute('aria-pressed', String(show));
    });

    aiForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(aiForm);
      setButtonLoading(saveAiBtn, true, 'Menyimpan...');
      try {
        const payload = {
          model: aiForm.model.value,
          enabled: mount.querySelector('#ai-enabled').checked
        };
        const rawKey = keyInput.value.trim();
        if (rawKey) payload.api_key = rawKey;

        const res = await apiCall('ai.configUpdate', payload, { write: true });
        aiCfg = res.data;
        invalidateAiStatusCache();
        paintAiCard(aiCfg);
        toast('Pengaturan Asisten AI berhasil disimpan ke Script Properties.', 'success');
      } catch (err) {
        if (err.fields) showFieldErrors(aiForm, err.fields);
        toast(err.message, 'danger');
      } finally {
        setButtonLoading(saveAiBtn, false);
      }
    });

    testBtn?.addEventListener('click', async () => {
      setButtonLoading(testBtn, true, 'Menguji...');
      try {
        const res = await apiCall('ai.testConnection', {}, { noDedupe: true });
        const d = res.data || {};
        toast(`Koneksi Gemini berhasil! Model ${d.model} merespons dalam ${d.latency_ms} ms.`, 'success', 5000);
      } catch (err) {
        toast(err.message, 'danger', 5500);
      } finally {
        setButtonLoading(testBtn, false);
      }
    });

    clearBtn?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Hapus Gemini API Key',
        message: 'Hapus API Key Gemini dari Script Properties? Asisten AI tidak akan bisa menjawab sampai kunci baru dimasukkan.',
        confirmLabel: 'Ya, Hapus Kunci',
        danger: true
      });
      if (!ok) return;
      setButtonLoading(clearBtn, true, 'Menghapus...');
      try {
        const res = await apiCall('ai.configUpdate', { clear_api_key: true }, { write: true });
        aiCfg = res.data;
        invalidateAiStatusCache();
        paintAiCard(aiCfg);
        toast('Gemini API Key berhasil dihapus dari server.', 'success');
      } catch (err) {
        toast(err.message, 'danger');
        setButtonLoading(clearBtn, false);
      }
    });
  }

  function paintSettings(s) {
    container.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Pengaturan Operasional Klinik</h2>
            <p class="card-desc">
              ${canEdit
                ? 'Ubah identitas klinik, durasi default jadwal, timeout idle, dan template pengingat WhatsApp.'
                : 'Mode Baca-Saja (Admin). Hanya Pemilik (OWNER) yang dapat mengubah pengaturan sistem.'}
            </p>
          </div>
          ${!canEdit ? '<span class="badge badge-neutral">Read-Only</span>' : ''}
        </div>

        <form id="settings-form" novalidate>
          <div class="form-grid form-grid-2">
            <div class="field">
              <label for="set-name">Nama Klinik <span class="req-star">*</span></label>
              <input id="set-name" name="clinic_name" class="input" type="text" value="${esc(s.clinic_name || '')}" ${canEdit ? '' : 'disabled'} required>
            </div>
            <div class="field">
              <label for="set-phone">No. Telepon / WhatsApp Klinik</label>
              <input id="set-phone" name="clinic_phone" class="input" type="text" value="${esc(s.clinic_phone || '')}" ${canEdit ? '' : 'disabled'}>
            </div>
            <div class="field field-span-full">
              <label for="set-addr">Alamat Klinik</label>
              <input id="set-addr" name="clinic_address" class="input" type="text" value="${esc(s.clinic_address || '')}" ${canEdit ? '' : 'disabled'}>
            </div>
            <div class="field">
              <label for="set-dur">Durasi Default Sesi (menit)</label>
              <input id="set-dur" name="default_duration_min" class="input" type="number" min="15" max="240" value="${esc(s.default_duration_min || '60')}" ${canEdit ? '' : 'disabled'}>
              <span class="field-hint">Rentang 15–240 menit.</span>
            </div>
            <div class="field">
              <label for="set-idle">Auto-Logout Idle (menit)</label>
              <input id="set-idle" name="idle_logout_min" class="input" type="number" min="5" max="480" value="${esc(s.idle_logout_min || '60')}" ${canEdit ? '' : 'disabled'}>
              <span class="field-hint">Rentang 5–480 menit demi privasi perangkat bersama.</span>
            </div>
            <div class="field field-span-full">
              <label for="set-wa-tpl">Template Pesan Pengingat WhatsApp</label>
              <textarea id="set-wa-tpl" name="wa_reminder_template" class="textarea" rows="4" ${canEdit ? '' : 'disabled'}>${esc(s.wa_reminder_template || '')}</textarea>
              <span class="field-hint">Placeholder tersedia: <code>{client_name}</code>, <code>{clinic_name}</code>, <code>{therapist_name}</code>, <code>{date}</code>, <code>{time}</code>, <code>{mode}</code>.</span>
            </div>
          </div>

          ${canEdit ? `
            <div class="flex-between mt-4">
              <span class="text-xs text-muted">Pengaturan di atas disimpan di sheet SETTINGS.</span>
              <button type="submit" class="btn btn-primary" id="btn-save-settings">Simpan Pengaturan</button>
            </div>
          ` : ''}
        </form>
      </section>
      ${canManageAi ? '<div id="ai-settings-mount"></div>' : ''}
    `;

    if (canManageAi) {
      paintAiCard(aiCfg);
    }

    const form = container.querySelector('#settings-form');
    const saveBtn = container.querySelector('#btn-save-settings');

    if (canEdit && form && saveBtn) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFieldErrors(form);
        setButtonLoading(saveBtn, true, 'Menyimpan...');

        const settingsPayload = {
          clinic_name: form.clinic_name.value.trim(),
          clinic_phone: form.clinic_phone.value.trim(),
          clinic_address: form.clinic_address.value.trim(),
          default_duration_min: String(form.default_duration_min.value).trim(),
          idle_logout_min: String(form.idle_logout_min.value).trim(),
          wa_reminder_template: form.wa_reminder_template.value.trim()
        };

        try {
          const updated = await apiCall('settings.update', { settings: settingsPayload }, { write: true });
          const next = updated.data.settings || {};
          storeSet(cacheKey, next);
          setPublicSettings({
            clinic_name: next.clinic_name,
            clinic_phone: next.clinic_phone,
            clinic_address: next.clinic_address,
            idle_logout_min: next.idle_logout_min
          });
          const brandEl = document.getElementById('sidebar-clinic-name');
          if (brandEl && next.clinic_name) brandEl.textContent = next.clinic_name;
          toast('Pengaturan klinik berhasil disimpan.', 'success');
        } catch (err) {
          if (err.fields) showFieldErrors(form, err.fields);
          toast(err.message, 'danger');
        } finally {
          setButtonLoading(saveBtn, false);
        }
      });
    }
  }

  if (canManageAi) {
    apiCall('ai.configGet', {}, { background: true })
      .then((res) => {
        aiCfg = res && res.data ? res.data : null;
        paintAiCard(aiCfg);
      })
      .catch(() => {});
  }

  if (cached && cached.data && !forceRefresh) {
    paintSettings(cached.data);
    if (storeIsFresh(cacheKey, 60000)) return;
  } else {
    container.innerHTML = renderSkeletonTable(5);
  }

  try {
    const res = await apiCall('settings.get', {});
    const s = (res.data && res.data.settings) || {};
    const { changed } = storeSet(cacheKey, s);
    if (!cached || forceRefresh || changed) {
      paintSettings(s);
    }
  } catch (err) {
    if (!cached) {
      container.innerHTML = `<div class="card empty-state"><p class="empty-state-title">Gagal memuat pengaturan</p><p class="empty-state-desc">${esc(err.message)}</p></div>`;
    }
    toast(err.message, 'danger');
  }
}
