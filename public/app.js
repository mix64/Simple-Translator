import { LANGS, detectSourceLang } from './shared/lang.js';

const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
};

function icon(name, size = 18, cls = '') {
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isTouch = matchMedia('(pointer: coarse)').matches;

const el = {
  sidebar: $('#sidebar'),
  sessionList: $('#session-list'),
  modelLabel: $('#model-label'),
  title: $('#session-title'),
  pair: $('#session-pair'),
  editBtn: $('#edit-session-btn'),
  welcome: $('#welcome'),
  thread: $('#thread'),
  messages: $('#messages'),
  composerWrap: $('#composer-wrap'),
  composer: $('#composer'),
  input: $('#input'),
  dirChip: $('#dir-chip'),
  sendBtn: $('#send-btn'),
  sessionDialog: $('#session-dialog'),
  sessionForm: $('#session-form'),
  settingsDialog: $('#settings-dialog'),
  settingsForm: $('#settings-form'),
  connectionStatus: $('#connection-status'),
  confirmDialog: $('#confirm-dialog'),
  toasts: $('#toasts'),
};

const state = {
  settings: null,
  sessions: [],
  sessionsKey: '',
  activeId: null,
  messages: [],
  loadedUpdatedAt: null,
  views: new Map(), // messageId -> 'original' | 'translation'
  reasoningPref: new Map(), // messageId -> open/closed state chosen by the user
  streams: 0,
  dirMode: 'auto', // 'auto' | 'ja' | 'foreign'
  editingSessionId: null,
  apiKeyDirty: false,
};

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `通信に失敗しました (HTTP ${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// Reads NDJSON from the server and applies each update to the message
async function streamTranslation(path, body) {
  state.streams++;
  let current = null;
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `通信に失敗しました (HTTP ${res.status})`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === 'message') {
          current = { ...event.message };
          upsertMessage(current, { scroll: true });
        } else if (event.type === 'delta' && current) {
          current.reasoning = (current.reasoning ?? '') + event.reasoningAppend;
          current.translation = event.translation;
          patchMessage(current.id, { reasoning: current.reasoning, translation: current.translation });
        } else if (event.type === 'done') {
          current = { ...event.message };
          upsertMessage(current);
          if (current.status === 'error') toast(`翻訳に失敗しました: ${current.error}`, 'error');
        }
      }
    }
    return current;
  } catch (err) {
    err.messageCreated = Boolean(current);
    throw err;
  } finally {
    state.streams--;
    if (state.streams === 0) poll();
  }
}

// ---------- Display helpers ----------

function toast(text, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = text;
  el.toasts.append(node);
  setTimeout(() => node.remove(), type === 'error' ? 6000 : 2200);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(iso) {
  const d = new Date(iso);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return isSameDay(d, new Date()) ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function formatRelative(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (isSameDay(d, today)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, yesterday)) return '昨日';
  return d.getFullYear() === today.getFullYear()
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand below
    }
  }
  // For contexts without the Clipboard API, such as plain http on a non-localhost host
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function confirmDialog({ title, ok = '削除' }) {
  $('#confirm-title').textContent = title;
  $('#confirm-ok').textContent = ok;
  el.confirmDialog.returnValue = '';
  el.confirmDialog.showModal();
  return new Promise((resolve) => {
    el.confirmDialog.addEventListener('close', () => resolve(el.confirmDialog.returnValue === 'ok'), { once: true });
  });
}

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

// ---------- Sessions ----------

const activeSession = () => state.sessions.find((s) => s.id === state.activeId) ?? null;

function hashSessionId() {
  return location.hash.match(/^#\/s\/([\w-]+)$/)?.[1] ?? null;
}

async function loadSessions() {
  const { sessions } = await api('/api/sessions');
  const key = JSON.stringify(sessions);
  if (key === state.sessionsKey) return false;
  state.sessions = sessions;
  state.sessionsKey = key;
  renderSidebar();
  renderShell();
  return true;
}

async function selectSession(id) {
  if (id && !state.sessions.some((s) => s.id === id)) id = null;
  if (id !== state.activeId) {
    state.activeId = id;
    state.messages = [];
    state.loadedUpdatedAt = null;
    state.views.clear();
    state.reasoningPref.clear();
    state.dirMode = 'auto';
    renderMessages();
  }
  renderSidebar();
  renderShell();
  closeSidebar();
  if (!id) return;
  storage('lastSessionId', id);
  await reloadMessages({ forceBottom: true });
  if (!isTouch) el.input.focus();
}

async function reloadMessages({ forceBottom = false } = {}) {
  const id = state.activeId;
  const pinned = forceBottom || isNearBottom();
  const data = await api(`/api/sessions/${id}/messages`);
  if (state.activeId !== id) return;
  state.messages = data.messages;
  state.loadedUpdatedAt = data.session.updatedAt;
  renderMessages();
  if (pinned) scrollToBottom();
}

// Periodic check to pick up posts and edits made on other devices
async function poll() {
  if (document.hidden) return;
  try {
    await loadSessions();
  } catch {
    return;
  }
  if (state.activeId && !activeSession()) {
    history.replaceState(null, '', location.pathname);
    await selectSession(null);
    return;
  }
  const session = activeSession();
  if (session && state.streams === 0 && session.updatedAt !== state.loadedUpdatedAt) {
    await reloadMessages().catch(() => {});
  }
}

// ---------- Rendering: sidebar and header ----------

function renderSidebar() {
  el.sessionList.innerHTML = state.sessions
    .map(
      (s) => `
      <button type="button" class="session-item${s.id === state.activeId ? ' active' : ''}" data-action="select-session" data-session-id="${s.id}">
        <span class="session-row">
          <span class="session-title">${esc(s.title || '新しいセッション')}</span>
          <span class="session-time">${formatRelative(s.updatedAt)}</span>
        </span>
        <span class="session-row">
          <span class="lang-badge lang-${s.targetLang}">${LANGS[s.targetLang].short}</span>
          <span class="session-preview">${esc(s.preview)}</span>
        </span>
      </button>`,
    )
    .join('');
}

function renderShell() {
  const session = activeSession();
  el.welcome.hidden = Boolean(session);
  el.thread.hidden = !session;
  el.composerWrap.hidden = !session;
  el.editBtn.hidden = !session;
  el.title.textContent = session ? session.title || '新しいセッション' : 'Simple Translator';
  const glossaryCount = session?.notes?.split('\n').filter((line) => line.trim()).length ?? 0;
  el.pair.innerHTML = session
    ? `${LANGS.ja.name} ${icon('swap', 13)} ${esc(LANGS[session.targetLang].name)}${glossaryCount ? ` ・ 用語メモ ${glossaryCount} 件` : ''}`
    : '';
  document.title = session ? `${session.title || '新しいセッション'} - Simple Translator` : 'Simple Translator';
  updateComposer();
}

function renderModelLabel() {
  const s = state.settings;
  if (!s) return;
  el.modelLabel.textContent = s.model || 'モデル自動選択';
}

// ---------- Rendering: messages ----------

function foreignLangOf(m) {
  return m.sourceLang === 'ja' ? m.targetLang : m.sourceLang;
}

function viewOf(m) {
  return state.views.get(m.id) ?? (m.status === 'error' ? 'original' : 'translation');
}

function isReasoningLive(m) {
  return m.status === 'pending' && !m.translation;
}

function isReasoningOpen(m) {
  return state.reasoningPref.get(m.id) ?? isReasoningLive(m);
}

// While this key stays the same during streaming, only the text nodes are updated
function renderKey(m) {
  return [m.status, viewOf(m), isReasoningOpen(m), Boolean(m.reasoning), Boolean(m.translation)].join('|');
}

function reasoningHtml(m) {
  if (!m.reasoning) return '';
  const live = isReasoningLive(m);
  const open = isReasoningOpen(m);
  const label = live ? '<span class="pulse">思考中…</span>' : '思考プロセス';
  return `
    <div class="reasoning${open ? ' open' : ''}${live ? ' live' : ''}">
      <button type="button" class="reasoning-toggle" data-action="toggle-reasoning" aria-expanded="${open}">
        ${icon('chevron', 14, 'chev')}${label}
      </button>
      <div class="reasoning-text">${esc(m.reasoning)}</div>
    </div>`;
}

function bodyHtml(m, view) {
  const errorBox =
    m.status === 'error'
      ? `<div class="bubble-error">${icon('alert', 16)}<span>翻訳に失敗しました: ${esc(m.error)}</span></div>`
      : '';
  if (view === 'original') {
    return `<div class="bubble-text">${esc(m.original)}</div>${errorBox}`;
  }
  if (m.status === 'error') return errorBox;
  if (m.status === 'pending' && !m.translation) {
    return `${reasoningHtml(m)}${m.reasoning ? '' : '<div class="typing"><span></span><span></span><span></span></div>'}`;
  }
  const caret = m.status === 'pending' ? ' caret' : '';
  return `${reasoningHtml(m)}<div class="bubble-text translation${caret}">${esc(m.translation)}</div>`;
}

function messageHtml(m) {
  const mine = m.sourceLang === 'ja';
  const view = viewOf(m);
  const shownLang = view === 'original' ? m.sourceLang : m.targetLang;
  const pending = m.status === 'pending';
  const seg = ['ja', foreignLangOf(m)]
    .map(
      (lang) =>
        `<button type="button" class="seg-btn${lang === shownLang ? ' active' : ''}" data-action="view" data-lang="${lang}" aria-pressed="${lang === shownLang}">${LANGS[lang].short}</button>`,
    )
    .join('');
  const copyDisabled = view === 'translation' && !m.translation;
  return `
    <article class="msg${mine ? ' mine' : ''}" data-id="${m.id}" data-key="${renderKey(m)}">
      <div class="bubble">
        <div class="bubble-head">
          <div class="seg" role="group" aria-label="表示する言語">${seg}</div>
          <span class="bubble-kind">${view === 'original' ? '原文' : '訳文'}</span>
        </div>
        ${bodyHtml(m, view)}
        <div class="bubble-foot">
          <time class="bubble-time" datetime="${m.createdAt}">${formatTime(m.createdAt)}</time>
          ${pending ? '' : `
          <button type="button" class="mini-btn secondary" data-action="retranslate" title="再翻訳">${icon('refresh', 14)}</button>
          <button type="button" class="mini-btn secondary" data-action="flip" title="言語判定を反転して再翻訳">${icon('swap', 14)}</button>
          <button type="button" class="mini-btn secondary" data-action="delete-message" title="削除">${icon('trash', 14)}</button>`}
          <button type="button" class="mini-btn" data-action="copy" ${copyDisabled ? 'disabled' : ''}>${icon('copy', 14)}<span>コピー</span></button>
        </div>
      </div>
    </article>`;
}

function renderMessages() {
  el.messages.innerHTML = state.messages.map(messageHtml).join('');
  scrollLiveReasoning();
}

function scrollLiveReasoning() {
  for (const m of state.messages) {
    if (!isReasoningLive(m)) continue;
    const box = el.messages.querySelector(`[data-id="${m.id}"] .reasoning-text`);
    if (box) box.scrollTop = box.scrollHeight;
  }
}

function updateMessageElement(m) {
  const node = el.messages.querySelector(`[data-id="${m.id}"]`);
  if (!node) return;
  const pinned = isNearBottom();
  if (node.dataset.key === renderKey(m)) {
    const reasoning = node.querySelector('.reasoning-text');
    if (reasoning) reasoning.textContent = m.reasoning;
    const translation = node.querySelector('.bubble-text.translation');
    if (translation) translation.textContent = m.translation;
  } else {
    node.outerHTML = messageHtml(m);
  }
  scrollLiveReasoning();
  if (pinned) scrollToBottom();
}

function upsertMessage(message, { scroll = false } = {}) {
  if (message.sessionId !== state.activeId) return;
  const existing = state.messages.find((m) => m.id === message.id);
  if (existing) {
    Object.assign(existing, message);
    updateMessageElement(existing);
  } else {
    state.messages.push({ ...message });
    renderMessages();
  }
  if (scroll) scrollToBottom();
}

function patchMessage(id, patch) {
  const m = state.messages.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, patch);
  updateMessageElement(m);
}

function isNearBottom() {
  const t = el.thread;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 80;
}

function scrollToBottom() {
  el.thread.scrollTop = el.thread.scrollHeight;
}

// ---------- Composer ----------

function composerSourceLang(session) {
  if (state.dirMode === 'ja') return 'ja';
  if (state.dirMode === 'foreign') return session.targetLang;
  const text = el.input.value.trim();
  return text ? detectSourceLang(text, session.targetLang) : null;
}

function updateComposer() {
  const session = activeSession();
  if (!session) return;
  const src = composerSourceLang(session);
  const fixed = state.dirMode !== 'auto';
  el.dirChip.classList.toggle('fixed', fixed);
  if (src) {
    const tgt = src === 'ja' ? session.targetLang : 'ja';
    el.dirChip.innerHTML = `<span class="mode">${fixed ? '固定' : '自動'}</span>${esc(LANGS[src].name)} → ${esc(LANGS[tgt].name)}`;
  } else {
    el.dirChip.innerHTML = `<span class="mode">自動</span>${esc(LANGS.ja.name)} ${icon('swap', 13)} ${esc(LANGS[session.targetLang].name)}`;
  }
  el.sendBtn.disabled = !el.input.value.trim();
}

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = `${el.input.scrollHeight}px`;
}

async function send() {
  const session = activeSession();
  const text = el.input.value.trim();
  if (!session || !text) return;
  const sourceLang = state.dirMode === 'auto' ? undefined : composerSourceLang(session);
  el.input.value = '';
  state.dirMode = 'auto';
  autosize();
  updateComposer();
  try {
    await streamTranslation(`/api/sessions/${session.id}/messages`, { text, sourceLang });
  } catch (err) {
    toast(err.message, 'error');
    if (!err.messageCreated && !el.input.value) {
      el.input.value = text;
      autosize();
      updateComposer();
    }
  }
}

// ---------- Sidebar (mobile) ----------

function openSidebar() {
  el.sidebar.classList.add('open');
}

function closeSidebar() {
  el.sidebar.classList.remove('open');
}

// ---------- Dialogs ----------

function openSessionDialog(session = null) {
  state.editingSessionId = session?.id ?? null;
  const form = el.sessionForm;
  $('#session-dialog-title').textContent = session ? 'セッションを編集' : '新しいセッション';
  $('#session-submit').textContent = session ? '保存' : '作成';
  $('#delete-session-btn').hidden = !session;
  form.title.value = session?.title ?? '';
  form.notes.value = session?.notes ?? '';
  form.targetLang.value = session?.targetLang ?? storage('lastTargetLang') ?? 'en';
  el.sessionDialog.showModal();
  if (!isTouch) form.title.focus();
}

async function submitSessionForm(event) {
  event.preventDefault();
  const form = el.sessionForm;
  const body = { title: form.title.value, targetLang: form.targetLang.value, notes: form.notes.value };
  try {
    if (state.editingSessionId) {
      await api(`/api/sessions/${state.editingSessionId}`, { method: 'PATCH', body });
      el.sessionDialog.close();
      await loadSessions();
      await reloadMessages();
      toast('セッションを更新しました');
    } else {
      const session = await api('/api/sessions', { method: 'POST', body });
      storage('lastTargetLang', body.targetLang);
      el.sessionDialog.close();
      await loadSessions();
      location.hash = `#/s/${session.id}`;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteSession() {
  const session = state.sessions.find((s) => s.id === state.editingSessionId);
  if (!session) return;
  const ok = await confirmDialog({ title: `「${session.title || '新しいセッション'}」を削除しますか？` });
  if (!ok) return;
  try {
    await api(`/api/sessions/${session.id}`, { method: 'DELETE' });
    el.sessionDialog.close();
    await loadSessions();
    const next = state.sessions[0]?.id;
    if (next) location.hash = `#/s/${next}`;
    else {
      history.replaceState(null, '', location.pathname);
      await selectSession(null);
    }
    toast('セッションを削除しました');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openSettings() {
  try {
    state.settings = await api('/api/settings');
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const s = state.settings;
  const form = el.settingsForm;
  form.baseUrl.value = s.baseUrl;
  form.apiKey.value = '';
  form.apiKey.placeholder = s.apiKeySet ? '設定済み（変更するときだけ入力）' : '未設定';
  form.model.value = s.model;
  form.temperature.value = s.temperature;
  form.contextMessages.value = s.contextMessages;
  form.enableThinking.checked = s.enableThinking;
  form.reasoningEffort.value = s.reasoningEffort;
  form.reasoningEffort.disabled = !s.enableThinking;
  state.apiKeyDirty = false;
  setConnectionStatus('', '');
  el.settingsDialog.showModal();
}

function setConnectionStatus(text, type) {
  el.connectionStatus.textContent = text;
  el.connectionStatus.className = `connection-status ${type}`;
}

async function testConnection() {
  const form = el.settingsForm;
  setConnectionStatus('接続しています…', 'loading');
  try {
    const { models } = await api('/api/llm/models', {
      method: 'POST',
      body: { baseUrl: form.baseUrl.value, apiKey: state.apiKeyDirty ? form.apiKey.value : undefined },
    });
    $('#model-options').innerHTML = models.map((id) => `<option value="${esc(id)}"></option>`).join('');
    if (!form.model.value && models.length === 1) form.model.value = models[0];
    setConnectionStatus(
      models.length ? `接続できました: ${models.join(', ')}` : '接続できましたが、モデルがありません',
      models.length ? 'ok' : 'error',
    );
  } catch (err) {
    setConnectionStatus(err.message, 'error');
  }
}

async function submitSettings(event) {
  event.preventDefault();
  const form = el.settingsForm;
  const body = {
    baseUrl: form.baseUrl.value,
    model: form.model.value,
    temperature: Number(form.temperature.value),
    contextMessages: Number(form.contextMessages.value),
    enableThinking: form.enableThinking.checked,
    reasoningEffort: form.reasoningEffort.value,
  };
  if (state.apiKeyDirty) body.apiKey = form.apiKey.value;
  try {
    state.settings = await api('/api/settings', { method: 'PUT', body });
    renderModelLabel();
    el.settingsDialog.close();
    toast('設定を保存しました');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Message actions ----------

const messageOf = (node) => state.messages.find((m) => m.id === node.closest('[data-id]')?.dataset.id);

async function retranslate(m, body) {
  state.views.delete(m.id);
  state.reasoningPref.delete(m.id);
  try {
    await streamTranslation(`/api/messages/${m.id}/retranslate`, body);
  } catch (err) {
    toast(err.message, 'error');
  }
}

const actions = {
  'new-session': () => openSessionDialog(),
  'edit-session': () => openSessionDialog(activeSession()),
  'delete-session': deleteSession,
  'open-settings': openSettings,
  'test-connection': testConnection,
  'close-dialog': (btn) => btn.closest('dialog').close(),
  'open-sidebar': openSidebar,
  'close-sidebar': closeSidebar,
  'select-session': (btn) => {
    location.hash = `#/s/${btn.dataset.sessionId}`;
    closeSidebar();
  },
  'cycle-dir': () => {
    state.dirMode = { auto: 'ja', ja: 'foreign', foreign: 'auto' }[state.dirMode];
    updateComposer();
    el.input.focus();
  },
  view: (btn) => {
    const m = messageOf(btn);
    if (!m) return;
    state.views.set(m.id, btn.dataset.lang === m.sourceLang ? 'original' : 'translation');
    updateMessageElement(m);
  },
  'toggle-reasoning': (btn) => {
    const m = messageOf(btn);
    if (!m) return;
    state.reasoningPref.set(m.id, !isReasoningOpen(m));
    updateMessageElement(m);
  },
  copy: async (btn) => {
    const m = messageOf(btn);
    if (!m) return;
    const text = viewOf(m) === 'original' ? m.original : m.translation;
    if (!text) return;
    if (await copyText(text)) {
      btn.classList.add('copied');
      btn.innerHTML = `${icon('check', 14)}<span>コピーしました</span>`;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `${icon('copy', 14)}<span>コピー</span>`;
      }, 1500);
    } else {
      toast('コピーできませんでした', 'error');
    }
  },
  retranslate: (btn) => {
    const m = messageOf(btn);
    if (m) retranslate(m, {});
  },
  flip: (btn) => {
    const m = messageOf(btn);
    const session = activeSession();
    if (m && session) retranslate(m, { sourceLang: m.sourceLang === 'ja' ? session.targetLang : 'ja' });
  },
  'delete-message': async (btn) => {
    const m = messageOf(btn);
    if (!m) return;
    const ok = await confirmDialog({ title: 'メッセージを削除しますか？' });
    if (!ok) return;
    try {
      await api(`/api/messages/${m.id}`, { method: 'DELETE' });
      state.messages = state.messages.filter((x) => x.id !== m.id);
      renderMessages();
      poll();
    } catch (err) {
      toast(err.message, 'error');
    }
  },
};

// ---------- Events ----------

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  actions[btn.dataset.action]?.(btn, event);
});

el.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  send();
});

el.input.addEventListener('input', () => {
  autosize();
  updateComposer();
});

el.input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  if (isTouch) return;
  event.preventDefault();
  send();
});

el.sessionForm.addEventListener('submit', submitSessionForm);
el.settingsForm.addEventListener('submit', submitSettings);
el.settingsForm.apiKey.addEventListener('input', () => {
  state.apiKeyDirty = true;
});
el.settingsForm.enableThinking.addEventListener('change', () => {
  el.settingsForm.reasoningEffort.disabled = !el.settingsForm.enableThinking.checked;
});

for (const dialog of [el.sessionDialog, el.settingsDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

window.addEventListener('hashchange', () => selectSession(hashSessionId()));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});
setInterval(poll, 4000);

// ---------- Startup ----------

for (const node of document.querySelectorAll('[data-icon]')) {
  node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon));
}

async function init() {
  try {
    const [settings] = await Promise.all([api('/api/settings'), loadSessions()]);
    state.settings = settings;
    renderModelLabel();
  } catch (err) {
    toast(err.message, 'error');
  }
  let id = hashSessionId();
  if (!state.sessions.some((s) => s.id === id)) {
    const last = storage('lastSessionId');
    id = state.sessions.some((s) => s.id === last) ? last : state.sessions[0]?.id ?? null;
    if (id) history.replaceState(null, '', `#/s/${id}`);
  }
  await selectSession(id);
}

init();
