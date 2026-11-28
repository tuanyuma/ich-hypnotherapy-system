/**
 * aiAssistant.js — Widget Floating Asisten AI Klinik (Google Gemini):
 * - Tombol mengambang minimalis di pojok kanan bawah (khusus staf login berizin ai:use)
 * - Slide-over Chat Drawer responsif dengan Quick Prompts sesuai peran
 * - Riwayat obrolan 100% RAM-only (dibersihkan otomatis saat logout / tutup tab)
 * - Output model dirender XSS-safe dengan tombol Salin 1 klik.
 */

import { apiCall } from './api.js';
import { isAuthenticated, can, getUser } from './auth.js';
import { navigate } from './router.js';
import { esc, setButtonLoading, toast } from './ui.js';

let rootEl = null;
let isOpen = false;
let isSending = false;
let aiStatus = null;
let statusLoadedForUser = '';
let chatMessages = []; // [{ role: 'user'|'model', text: '...' }]

function renderSafeAiMarkdown(rawText) {
  const safe = esc(String(rawText || ''));
  const lines = safe.split(/\r?\n/);
  const out = [];
  let inList = false;

  const formatInline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!inList) {
        out.push('<ul class="ai-md-list">');
        inList = true;
      }
      out.push(`<li>${formatInline(bullet[1])}</li>`);
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      if (line.trim() === '') {
        out.push('<div class="ai-md-gap"></div>');
      } else {
        out.push(`<p class="ai-md-p">${formatInline(line)}</p>`);
      }
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function getQuickPrompts() {
  const list = [
    'Apa saja jadwal sesi dan kegiatan klinik hari ini?',
    'Buatkan draf pesan WA pengingat jadwal terapi yang sopan dan hangat',
    'Jelaskan daftar master paket terapi yang aktif beserta harganya'
  ];
  if (can('rme:view')) {
    list.push('Berikan referensi kerangka teknik relaksasi & deepening umum untuk klien cemas');
  }
  if (can('payments:view') || can('reports:view')) {
    list.push('Ringkas kondisi pemasukan, pengeluaran, dan saldo kas bulan ini');
  }
  return list;
}

function ensureMounted() {
  if (rootEl) return rootEl;
  rootEl = document.createElement('div');
  rootEl.id = 'ai-assistant-root';
  rootEl.innerHTML = `
    <button type="button" id="ai-fab-btn" class="ai-fab no-print" aria-label="Buka Asisten AI Klinik" aria-expanded="false" hidden>
      <span class="ai-fab-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg>
      </span>
      <span class="ai-fab-label">Asisten AI</span>
    </button>

    <div id="ai-drawer-backdrop" class="ai-drawer-backdrop no-print" hidden></div>

    <aside id="ai-drawer" class="ai-drawer no-print" role="dialog" aria-modal="false" aria-label="Asisten AI Klinik ICH" hidden>
      <header class="ai-drawer-head">
        <div class="ai-drawer-brand">
          <span class="ai-head-badge" aria-hidden="true">✦</span>
          <div>
            <h2 class="ai-drawer-title">Asisten AI Klinik</h2>
            <div class="ai-drawer-sub" id="ai-drawer-model-label">Didukung Google Gemini</div>
          </div>
        </div>
        <div class="flex-gap">
          <button type="button" class="icon-btn" id="ai-btn-reset" title="Mulai obrolan baru" aria-label="Reset obrolan">↺</button>
          <button type="button" class="icon-btn" id="ai-btn-close" title="Tutup Asisten AI" aria-label="Tutup">✕</button>
        </div>
      </header>

      <div id="ai-status-notice" class="ai-status-notice" hidden></div>

      <div id="ai-messages" class="ai-messages" aria-live="polite"></div>

      <div id="ai-quick-wrap" class="ai-quick-prompts"></div>

      <form id="ai-composer" class="ai-composer" novalidate>
        <textarea id="ai-input" class="ai-input" rows="1" maxlength="1500"
          placeholder="Tanya agenda hari ini, buat draf WA, atau panduan klinik..."></textarea>
        <button type="submit" id="ai-send-btn" class="btn btn-primary btn-sm ai-send-btn" aria-label="Kirim pertanyaan">
          Kirim
        </button>
      </form>
      <div class="ai-privacy-foot">
        Privasi Klinis Aktif • Data pribadi &amp; RME pasien tidak dikirim ke AI. Tinjau draf sebelum digunakan.
      </div>
    </aside>
  `;
  document.body.appendChild(rootEl);

  const fab = rootEl.querySelector('#ai-fab-btn');
  const backdrop = rootEl.querySelector('#ai-drawer-backdrop');
  const btnClose = rootEl.querySelector('#ai-btn-close');
  const btnReset = rootEl.querySelector('#ai-btn-reset');
  const form = rootEl.querySelector('#ai-composer');
  const input = rootEl.querySelector('#ai-input');

  fab.addEventListener('click', () => setDrawerOpen(!isOpen));
  backdrop.addEventListener('click', () => setDrawerOpen(false));
  btnClose.addEventListener('click', () => setDrawerOpen(false));
  btnReset.addEventListener('click', () => {
    chatMessages = [];
    paintMessages();
    toast('Obrolan Asisten AI telah direset.', 'info');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      setDrawerOpen(false);
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || isSending) return;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text);
  });

  return rootEl;
}

function paintQuickPrompts() {
  if (!rootEl) return;
  const wrap = rootEl.querySelector('#ai-quick-wrap');
  if (!wrap) return;
  if (chatMessages.length > 0 || (aiStatus && !aiStatus.ready)) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const prompts = getQuickPrompts();
  wrap.innerHTML = prompts.map((p) => `
    <button type="button" class="ai-quick-chip" data-ai-prompt="${esc(p)}">${esc(p)}</button>
  `).join('');
  wrap.querySelectorAll('[data-ai-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isSending) return;
      sendMessage(btn.dataset.aiPrompt);
    });
  });
}

function paintStatusBanner() {
  if (!rootEl) return;
  const notice = rootEl.querySelector('#ai-status-notice');
  const modelLabel = rootEl.querySelector('#ai-drawer-model-label');
  const input = rootEl.querySelector('#ai-input');
  const sendBtn = rootEl.querySelector('#ai-send-btn');

  if (!aiStatus) {
    notice.hidden = true;
    return;
  }

  modelLabel.textContent = aiStatus.ready
    ? `Google Gemini • ${aiStatus.model}`
    : 'Google Gemini (Belum Aktif)';

  if (aiStatus.ready) {
    notice.hidden = true;
    input.disabled = false;
    sendBtn.disabled = false;
    return;
  }

  input.disabled = true;
  sendBtn.disabled = true;
  notice.hidden = false;
  if (!aiStatus.configured) {
    notice.innerHTML = aiStatus.can_manage
      ? `
        <div><strong>Gemini API Key belum dipasang.</strong> Ambil API Key dari Google AI Studio lalu simpan di menu Pengaturan.</div>
        <button type="button" class="btn btn-primary btn-sm mt-2" id="ai-goto-settings">Buka Pengaturan AI →</button>
      `
      : '<div><strong>Asisten AI belum dikonfigurasi.</strong> Hubungi Pemilik Klinik (Owner) untuk memasang Gemini API Key.</div>';
    notice.querySelector('#ai-goto-settings')?.addEventListener('click', () => {
      setDrawerOpen(false);
      navigate('#/settings');
    });
  } else {
    notice.innerHTML = '<div><strong>Asisten AI sedang dinonaktifkan</strong> oleh Pemilik Klinik di menu Pengaturan.</div>';
  }
}

function paintMessages() {
  if (!rootEl) return;
  const listEl = rootEl.querySelector('#ai-messages');
  if (!listEl) return;

  if (chatMessages.length === 0) {
    const user = getUser();
    const firstName = user && user.full_name ? user.full_name.split(' ')[0] : 'Staf';
    listEl.innerHTML = `
      <div class="ai-welcome">
        <div class="ai-welcome-icon" aria-hidden="true">✦</div>
        <h3>Halo, ${esc(firstName)}!</h3>
        <p>Saya siap membantu merangkum jadwal &amp; kegiatan hari ini, menyusun draf pesan WhatsApp, atau menjawab info paket &amp; operasional klinik.</p>
      </div>
    `;
  } else {
    listEl.innerHTML = chatMessages.map((m, idx) => {
      if (m.role === 'user') {
        return `
          <div class="ai-msg ai-msg-user">
            <div class="ai-bubble ai-bubble-user">${esc(m.text).replace(/\n/g, '<br>')}</div>
          </div>
        `;
      }
      if (m.role === 'loading') {
        return `
          <div class="ai-msg ai-msg-bot">
            <div class="ai-bubble ai-bubble-bot">
              <div class="ai-typing-dots" aria-label="Asisten AI sedang mengetik">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        `;
      }
      return `
        <div class="ai-msg ai-msg-bot">
          <div class="ai-bubble ai-bubble-bot ${m.isError ? 'is-error' : ''}">
            <div class="ai-md-body">${renderSafeAiMarkdown(m.text)}</div>
            ${!m.isError ? `
              <div class="ai-bubble-actions">
                <button type="button" class="ai-copy-btn" data-ai-copy="${idx}">Salin teks</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-ai-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const msg = chatMessages[Number(btn.dataset.aiCopy)];
        if (!msg || !msg.text) return;
        try {
          await navigator.clipboard.writeText(msg.text);
          btn.textContent = 'Tersalin ✓';
          setTimeout(() => { btn.textContent = 'Salin teks'; }, 1800);
        } catch (_) {
          toast('Gagal menyalin otomatis. Silakan blok teks secara manual.', 'warning');
        }
      });
    });
  }

  paintQuickPrompts();
  listEl.scrollTop = listEl.scrollHeight;
}

async function refreshAiStatus(force = false) {
  const user = getUser();
  const uid = user ? user.user_id : '';
  if (!uid || (!force && statusLoadedForUser === uid && aiStatus)) {
    paintStatusBanner();
    paintQuickPrompts();
    return;
  }
  try {
    const res = await apiCall('ai.status', {}, { background: true });
    aiStatus = res && res.data ? res.data : null;
    statusLoadedForUser = uid;
  } catch (_) {
    aiStatus = null;
  }
  paintStatusBanner();
  paintQuickPrompts();
}

async function sendMessage(text) {
  if (!rootEl || isSending) return;
  const sendBtn = rootEl.querySelector('#ai-send-btn');

  // Riwayat valid sebelumnya (maks 8 giliran)
  const historyToSend = chatMessages
    .filter((m) => (m.role === 'user' || m.role === 'model') && !m.isError)
    .slice(-8)
    .map((m) => ({ role: m.role, text: m.text }));

  chatMessages.push({ role: 'user', text });
  chatMessages.push({ role: 'loading', text: '' });
  isSending = true;
  setButtonLoading(sendBtn, true, '...');
  paintMessages();

  try {
    const res = await apiCall('ai.chat', {
      message: text,
      history: historyToSend
    }, { hideTopLoader: true, noDedupe: true, timeoutMs: 45000 });

    chatMessages.pop(); // hapus indikator loading
    const reply = (res && res.data && res.data.reply) || 'Maaf, tidak ada jawaban dari AI.';
    chatMessages.push({ role: 'model', text: reply });
  } catch (err) {
    chatMessages.pop();
    chatMessages.push({
      role: 'model',
      text: (err && err.message) || 'Gagal menghubungi Asisten AI. Silakan coba lagi.',
      isError: true
    });
  } finally {
    isSending = false;
    setButtonLoading(sendBtn, false);
    paintMessages();
    const input = rootEl.querySelector('#ai-input');
    if (input && !input.disabled) input.focus();
  }
}

function setDrawerOpen(nextOpen) {
  ensureMounted();
  isOpen = Boolean(nextOpen);
  const fab = rootEl.querySelector('#ai-fab-btn');
  const backdrop = rootEl.querySelector('#ai-drawer-backdrop');
  const drawer = rootEl.querySelector('#ai-drawer');

  fab.setAttribute('aria-expanded', String(isOpen));
  backdrop.hidden = !isOpen;
  drawer.hidden = !isOpen;
  drawer.classList.toggle('is-open', isOpen);

  if (isOpen) {
    paintMessages();
    refreshAiStatus(false);
    const input = rootEl.querySelector('#ai-input');
    if (input && !input.disabled) {
      setTimeout(() => input.focus(), 80);
    }
  }
}

export function syncAiAssistantVisibility() {
  const allowed = isAuthenticated() && can('ai:use') && window.location.hash !== '#/login';
  if (!allowed) {
    if (rootEl) {
      setDrawerOpen(false);
      const fab = rootEl.querySelector('#ai-fab-btn');
      if (fab) fab.hidden = true;
    }
    return;
  }

  ensureMounted();
  const fab = rootEl.querySelector('#ai-fab-btn');
  if (fab) fab.hidden = false;
}

export function invalidateAiStatusCache() {
  aiStatus = null;
  statusLoadedForUser = '';
  if (isOpen) refreshAiStatus(true);
}

export function resetAiAssistantState() {
  chatMessages = [];
  aiStatus = null;
  statusLoadedForUser = '';
  isSending = false;
  if (rootEl) {
    setDrawerOpen(false);
    const fab = rootEl.querySelector('#ai-fab-btn');
    if (fab) fab.hidden = true;
  }
}
