import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSourceLang, TARGET_LANGS, translationLangOf } from '../public/shared/lang.js';
import { Config } from './config.js';
import { Store } from './store.js';
import { buildChatMessages, listModels, splitThink, streamChat } from './translate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_TEXT_LENGTH = 20_000;
const REASONING_EFFORTS = ['', 'low', 'medium', 'high', 'max'];

const config = new Config(path.join(ROOT, 'config.json'));
await config.load();
const store = new Store(path.resolve(ROOT, config.dataFile));
await store.load();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'リクエストが大きすぎます');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON の形式が正しくありません');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function publicSettings(settings) {
  const { apiKey, ...rest } = settings;
  return { ...rest, apiKeySet: Boolean(apiKey) };
}

function sessionMessages(sessionId) {
  return store.data.messages.filter((m) => m.sessionId === sessionId);
}

function sessionSummary(session) {
  const messages = sessionMessages(session.id);
  const last = messages.at(-1);
  return { ...session, messageCount: messages.length, preview: last?.original.slice(0, 120) ?? '' };
}

function findSession(id) {
  const session = store.data.sessions.find((s) => s.id === id);
  if (!session) throw new HttpError(404, 'セッションが見つかりません');
  return session;
}

function findMessage(id) {
  const message = store.data.messages.find((m) => m.id === id);
  if (!message) throw new HttpError(404, 'メッセージが見つかりません');
  return message;
}

function parseSessionFields(body, { partial }) {
  const fields = {};
  if (body.title !== undefined || !partial) {
    if (typeof (body.title ?? '') !== 'string') throw new HttpError(400, 'タイトルが不正です');
    fields.title = (body.title ?? '').trim().slice(0, 100);
  }
  if (body.targetLang !== undefined || !partial) {
    if (!TARGET_LANGS.includes(body.targetLang)) throw new HttpError(400, '翻訳先の言語が不正です');
    fields.targetLang = body.targetLang;
  }
  if (body.notes !== undefined || !partial) {
    if (typeof (body.notes ?? '') !== 'string') throw new HttpError(400, '用語メモが不正です');
    fields.notes = (body.notes ?? '').slice(0, 10_000);
  }
  return fields;
}

function parseSourceLang(value, session) {
  if (value === undefined || value === null) return undefined;
  if (value !== 'ja' && value !== session.targetLang) throw new HttpError(400, '原文の言語が不正です');
  return value;
}

// Streams the translation as NDJSON and saves it when done. Keeps translating even if the client disconnects.
async function runTranslation(res, session, message) {
  const write = (event) => {
    if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });

  const settings = config.settings;
  const messages = sessionMessages(session.id);
  const done = messages.slice(0, messages.indexOf(message)).filter((m) => m.status === 'done');
  const history = settings.contextMessages > 0 ? done.slice(-settings.contextMessages) : [];

  message.status = 'pending';
  message.translation = '';
  message.reasoning = '';
  message.error = null;
  message.updatedAt = session.updatedAt = now();
  await store.save();
  write({ type: 'message', message });

  try {
    // Send only the appended reasoning but the whole translation, since a closing </think> can move the split point
    let reasoningField = '';
    let content = '';
    let sentReasoning = '';
    for await (const event of streamChat(settings, buildChatMessages({ session, history, message }))) {
      if (event.type === 'reasoning') reasoningField += event.text;
      else content += event.text;
      const { reasoning, text } = splitThink(content);
      const fullReasoning = reasoningField + reasoning;
      const reasoningAppend = fullReasoning.slice(sentReasoning.length);
      sentReasoning = fullReasoning;
      message.translation = text;
      write({ type: 'delta', reasoningAppend, translation: text });
    }
    message.reasoning = sentReasoning.trim();
    if (!message.translation) throw new Error('翻訳結果が空でした');
    message.status = 'done';
  } catch (err) {
    console.error('翻訳に失敗しました:', err);
    message.status = 'error';
    message.error = err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message;
  }

  message.updatedAt = session.updatedAt = now();
  await store.save();
  write({ type: 'done', message });
  res.end();
}

const routes = [];
function route(method, pattern, handler) {
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
  routes.push({ method, regex, handler });
}

route('GET', '/api/settings', (req, res) => {
  sendJson(res, 200, publicSettings(config.settings));
});

route('PUT', '/api/settings', async (req, res) => {
  const body = await readJson(req);
  const settings = config.settings;
  if (body.baseUrl !== undefined) {
    if (typeof body.baseUrl !== 'string' || !/^https?:\/\/.+/.test(body.baseUrl.trim())) {
      throw new HttpError(400, 'API の URL は http:// か https:// で始めてください');
    }
    settings.baseUrl = body.baseUrl.trim();
  }
  if (body.apiKey !== undefined) settings.apiKey = String(body.apiKey).trim();
  if (body.model !== undefined) settings.model = String(body.model).trim();
  if (body.temperature !== undefined) {
    const t = Number(body.temperature);
    if (!(t >= 0 && t <= 2)) throw new HttpError(400, 'temperature は 0〜2 で指定してください');
    settings.temperature = t;
  }
  if (body.enableThinking !== undefined) settings.enableThinking = Boolean(body.enableThinking);
  if (body.reasoningEffort !== undefined) {
    if (!REASONING_EFFORTS.includes(body.reasoningEffort)) throw new HttpError(400, 'effort の値が不正です');
    settings.reasoningEffort = body.reasoningEffort;
  }
  if (body.contextMessages !== undefined) {
    const n = Number(body.contextMessages);
    if (!Number.isInteger(n) || n < 0 || n > 500) throw new HttpError(400, '参照する件数は 0〜500 の整数で指定してください');
    settings.contextMessages = n;
  }
  await config.saveSettings();
  sendJson(res, 200, publicSettings(settings));
});

// Takes the URL and key so the connection can be tested before saving. An empty key falls back to the saved one.
route('POST', '/api/llm/models', async (req, res) => {
  const body = await readJson(req);
  const baseUrl = String(body.baseUrl ?? config.settings.baseUrl).trim();
  const apiKey = body.apiKey ? String(body.apiKey) : config.settings.apiKey;
  try {
    sendJson(res, 200, { models: await listModels({ baseUrl, apiKey }) });
  } catch (err) {
    throw new HttpError(502, err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message);
  }
});

route('GET', '/api/sessions', (req, res) => {
  const sessions = store.data.sessions
    .map(sessionSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sendJson(res, 200, { sessions });
});

route('POST', '/api/sessions', async (req, res) => {
  const fields = parseSessionFields(await readJson(req), { partial: false });
  const session = { id: randomUUID(), ...fields, createdAt: now(), updatedAt: now() };
  store.data.sessions.push(session);
  await store.save();
  sendJson(res, 201, sessionSummary(session));
});

route('PATCH', '/api/sessions/:id', async (req, res, { id }) => {
  const session = findSession(id);
  Object.assign(session, parseSessionFields(await readJson(req), { partial: true }), { updatedAt: now() });
  await store.save();
  sendJson(res, 200, sessionSummary(session));
});

route('DELETE', '/api/sessions/:id', async (req, res, { id }) => {
  findSession(id);
  store.data.sessions = store.data.sessions.filter((s) => s.id !== id);
  store.data.messages = store.data.messages.filter((m) => m.sessionId !== id);
  await store.save();
  res.writeHead(204).end();
});

route('GET', '/api/sessions/:id/messages', (req, res, { id }) => {
  const session = findSession(id);
  sendJson(res, 200, { session: sessionSummary(session), messages: sessionMessages(id) });
});

route('POST', '/api/sessions/:id/messages', async (req, res, { id }) => {
  const session = findSession(id);
  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, 'テキストが空です');
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(400, `テキストは ${MAX_TEXT_LENGTH} 文字以内にしてください`);

  const sourceLang = parseSourceLang(body.sourceLang, session) ?? detectSourceLang(text, session.targetLang);
  const message = {
    id: randomUUID(),
    sessionId: session.id,
    sourceLang,
    targetLang: translationLangOf(sourceLang, session.targetLang),
    original: text,
    translation: '',
    status: 'pending',
    error: null,
    createdAt: now(),
    updatedAt: now(),
  };
  store.data.messages.push(message);
  if (!session.title) session.title = text.replace(/\s+/g, ' ').slice(0, 30);
  await runTranslation(res, session, message);
});

// Passing sourceLang retranslates in the other direction when language detection was wrong.
route('POST', '/api/messages/:id/retranslate', async (req, res, { id }) => {
  const message = findMessage(id);
  const session = findSession(message.sessionId);
  if (message.status === 'pending') throw new HttpError(409, 'このメッセージは翻訳中です');
  const sourceLang = parseSourceLang((await readJson(req)).sourceLang, session);
  if (sourceLang) {
    message.sourceLang = sourceLang;
    message.targetLang = translationLangOf(sourceLang, session.targetLang);
  }
  await runTranslation(res, session, message);
});

route('DELETE', '/api/messages/:id', async (req, res, { id }) => {
  const message = findMessage(id);
  store.data.messages = store.data.messages.filter((m) => m.id !== id);
  const session = store.data.sessions.find((s) => s.id === message.sessionId);
  if (session) session.updatedAt = now();
  await store.save();
  res.writeHead(204).end();
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not Found');
  let body;
  try {
    body = await readFile(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new HttpError(404, 'Not Found');
    throw err;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        const match = r.method === req.method && r.regex.exec(pathname);
        if (match) return await r.handler(req, res, match.groups ?? {});
      }
      throw new HttpError(404, 'API が見つかりません');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method Not Allowed');
    await serveStatic(res, pathname);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, err.status ?? 500, { error: err instanceof HttpError ? err.message : 'サーバーエラーが発生しました' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Simple Translator: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
});
