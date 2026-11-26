/**
 * pages/settings.js — Pengaturan Klinik Non-Rahasia (sheet SETTINGS):
 * - SWR in-memory cache + background refresh via Top Progress Bar
 * - Inline button spinner saat menyimpan pengaturan.
 */

import { apiCall } from '../api.js';
import { can, setPublicSettings } from '../auth.js';
import {
  esc,
  renderSkeletonTable,
  clearFieldErrors,
  showFieldErrors,
  setButtonLoading,
  toast
} from '../ui.js';
import { storeGet, storeSet, storeIsFresh } from '../store.js';

export async function renderSettingsPage(container, route) {
  const canEdit = can('settings:edit');
  const cacheKey = 'settings:get';
  const forceRefresh = Boolean(route && route.forceRefresh);
  const cached = storeGet(cacheKey);

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
              <span class="text-xs text-muted">Kunci rahasia/API pihak ketiga tidak pernah disimpan di sini (wajib Script Properties).</span>
              <button type="submit" class="btn btn-primary" id="btn-save-settings">Simpan Pengaturan</button>
            </div>
          ` : ''}
        </form>
      </section>
    `;

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
