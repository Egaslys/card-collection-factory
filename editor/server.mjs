#!/usr/bin/env node
// ============================================================================
//  card-collection-factory — the editor's local server
// ----------------------------------------------------------------------------
//  node editor/server.mjs [--port N] [--open COLLECTION[/SET]] [--no-browser]
//
//  Serves the editor's page (editor/web/), the design system, the style's window templates and the card images of
//  collections/, and exposes the core operations as a JSON API (server/ops.js) with live events of the store.
//  Listens on 127.0.0.1 only. Every API call carries the token of this run (the page gets it in its HTML, a local
//  agent reads it from .ccf/editor.json, which exists while the editor runs), so other pages in the browser
//  cannot call it.
// ============================================================================
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cli } from '../tools/cli-args.mjs';
import { loadSettings, ROOT } from '../core/settings.js';
import { COLLECTIONS_DIR } from '../core/store/layout.js';
import { createJobs } from './server/jobs.js';
import { initKey, keyStatus } from './server/key.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DISCOVERY_FILE = path.join(ROOT, '.ccf', 'editor.json');
const HOST = '127.0.0.1';
/** The largest request body: an image a person imports into a card comes as base64. */
const BODY_LIMIT = 40 * 1024 * 1024;
const KEEPALIVE_MS = 25000;
/** The longest a /wait request holds the connection (below the usual HTTP client timeouts). */
const WAIT_MS = 60000;

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
/** Operations after which every open page is told the key status (it shows on every screen). */
const KEY_OPS = new Set(['setKey', 'clearKey', 'saveSettings']);

/**
 * Static roots: URL prefix → folder. Only these folders are served, and only files inside them.
 * @type {[string, string][]}
 */
const STATIC = [
  ['/web/', path.join(HERE, 'web')],
  ['/design-system/', path.join(HERE, 'design-system')],
];
/** Single files the page imports from core (the processing shared with Node, so the preview equals the card). */
const SHARED_FILES = { '/core/image/adjust.js': path.join(ROOT, 'core', 'image', 'adjust.js') };

/** @param {string} base @param {string} rel @returns {string|null} */
function inside(base, rel) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const p = path.resolve(base, '.' + path.sep + decoded);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(text);
}

/** @param {http.ServerResponse} res @param {string} file @param {{immutable?: boolean}} [o] */
function sendFile(res, file, { immutable = false } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': MIME['.txt'] }); res.end('Нет такого файла'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': immutable ? 'private, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

/** @param {http.IncomingMessage} req @returns {Promise<any>} */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error('Слишком большой запрос.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { reject(new Error('Тело запроса — не JSON.')); }
    });
    req.on('error', reject);
  });
}

/**
 * The URL of a file under collections/ for the page, with its modification time so a changed card is fetched again.
 * @param {string} p
 */
export function fileUrl(p) {
  const rel = path.relative(COLLECTIONS_DIR, p);
  let v = 0;
  try { v = Math.round(fs.statSync(p).mtimeMs); } catch { /* the file may be gone; the URL still names it */ }
  return '/files/' + rel.split(path.sep).map(encodeURIComponent).join('/') + `?v=${v}`;
}

/**
 * Adds `<key>Url` next to every string field that is an image file inside collections/ (card summaries carry
 * absolute paths; the page needs URLs).
 * @param {unknown} v
 * @returns {unknown}
 */
export function withUrls(v) {
  if (Array.isArray(v)) return v.map(withUrls);
  if (!v || typeof v !== 'object') return v;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = withUrls(x);
    if (typeof x === 'string' && x.startsWith(COLLECTIONS_DIR + path.sep) && IMAGE_EXT.has(path.extname(x).toLowerCase())) out[k + 'Url'] = fileUrl(x);
  }
  return out;
}

/** @param {string} url */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* no browser: the URL is printed */ }
}

/** The page address of a collection or a set: `collection` or `collection/set`. @param {string} base @param {string} [where] */
export function pageUrl(base, where) {
  if (!where) return base + '/';
  const [c, s] = where.split('/');
  return `${base}/#/c/${encodeURIComponent(c)}${s ? `/s/${encodeURIComponent(s)}` : ''}`;
}

/**
 * A running editor of this project, from its discovery file, or null.
 * @returns {Promise<{url: string, token: string, port: number, pid: number}|null>}
 */
export async function runningEditor() {
  let d;
  try { d = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8')); } catch { return null; }
  try { process.kill(d.pid, 0); } catch { return null; }
  try {
    const r = await fetch(`${d.url}/api/op/health`, { method: 'POST', headers: { 'x-ccf-token': d.token, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
    return r.ok ? d : null;
  } catch { return null; }
}

/**
 * Starts the editor. Resolves when it listens.
 * @param {{port?: number, quiet?: boolean, discovery?: boolean}} [o]  port 0 = any free port; discovery: write .ccf/editor.json
 * @returns {Promise<{url: string, port: number, token: string, close: () => Promise<void>}>}
 */
export async function startEditor({ port, quiet = false, discovery = true } = {}) {
  const settings = /** @type {any} */ (loadSettings());
  initKey(settings.provider.openrouter.keyEnvVar);
  const { OPS } = await import('./server/ops.js');
  const store = await import('../core/store/index.js');
  const token = crypto.randomBytes(24).toString('hex');

  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();
  /** @param {object} event */
  const broadcast = event => {
    const data = `data: ${JSON.stringify(withUrls(event))}\n\n`;
    for (const c of clients) c.write(data);
  };
  const jobs = createJobs(broadcast);
  // a store event { type: collection|set|card, … } goes to the page as { type: 'store', entity, … }
  const stopWatch = store.watch(e => broadcast({ ...e, type: 'store', entity: e.type }));
  const keepalive = setInterval(() => { for (const c of clients) c.write(': keepalive\n\n'); }, KEEPALIVE_MS);

  const index = fs.readFileSync(path.join(HERE, 'web', 'index.html'), 'utf8');
  let actualPort = 0;

  /** @param {http.IncomingMessage} req */
  const hostOk = req => {
    const h = String(req.headers.host ?? '');
    return h === `${HOST}:${actualPort}` || h === `localhost:${actualPort}`;
  };

  /** @param {http.IncomingMessage} req @param {URL} url */
  const tokenOk = (req, url) => req.headers['x-ccf-token'] === token || url.searchParams.get('token') === token;

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async function handle(req, res) {
    if (!hostOk(req)) { res.writeHead(421); res.end(); return; }
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      if (!tokenOk(req, url)) { sendJson(res, 403, { error: 'Нет доступа: обновите страницу редактора.' }); return; }
      if (p === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'hello', key: keyStatus(), jobs: jobs.list() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/ops' && req.method === 'GET') { sendJson(res, 200, Object.entries(OPS).map(([name, o]) => ({ name, job: !!o.job }))); return; }
      if (p === '/api/jobs' && req.method === 'GET') { sendJson(res, 200, withUrls(jobs.list())); return; }
      const jm = p.match(/^\/api\/jobs\/([\w-]+)\/(wait|cancel)$/);
      if (jm) {
        try {
          if (jm[2] === 'cancel' && req.method === 'POST') { sendJson(res, 200, withUrls(jobs.cancel(jm[1]))); return; }
          if (jm[2] === 'wait' && req.method === 'GET') {
            // waits at most `timeout` ms (default and cap WAIT_MS) and returns the job as it is then: a caller loops
            const w = jobs.wait(jm[1]);
            if (!w) { sendJson(res, 404, { error: 'Такой задачи нет: возможно, редактор перезапускали.' }); return; }
            const ms = Math.min(WAIT_MS, Math.max(0, Number(url.searchParams.get('timeout') ?? WAIT_MS) || 0));
            /** @type {NodeJS.Timeout|undefined} */
            let timer;
            await Promise.race([w, new Promise(r => { timer = setTimeout(r, ms); })]);
            clearTimeout(timer);
            sendJson(res, 200, withUrls(jobs.get(jm[1])));
            return;
          }
        } catch (/** @type {any} */ e) { sendJson(res, 400, { error: String(e?.message ?? e) }); return; }
      }
      const om = p.match(/^\/api\/op\/(\w+)$/);
      if (om && req.method === 'POST') {
        const op = Object.hasOwn(OPS, om[1]) ? OPS[om[1]] : null;
        if (!op) { sendJson(res, 404, { error: `Нет операции «${om[1]}».` }); return; }
        let args;
        try { args = await readBody(req); } catch (/** @type {any} */ e) { sendJson(res, 400, { error: e.message }); return; }
        if (op.job) {
          const job = jobs.start({
            op: om[1], title: op.title?.(args) ?? om[1], scope: op.scope?.(args) ?? {}, cancellable: !!op.cancellable, spentOf: op.spentOf,
            run: ctx => op.run(args, ctx),
          });
          sendJson(res, 202, { job: withUrls(job) });
          return;
        }
        try {
          const result = await op.run(args, { progress: () => {}, signal: new AbortController().signal });
          sendJson(res, 200, { result: withUrls(result ?? null) });
          if (KEY_OPS.has(om[1])) broadcast({ type: 'key', key: keyStatus() });
        } catch (/** @type {any} */ e) {
          sendJson(res, 400, { error: String(e?.message ?? e) });
        }
        return;
      }
      sendJson(res, 404, { error: 'Нет такого адреса API.' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(index.replace('%CCF_TOKEN%', token));
      return;
    }
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (Object.hasOwn(SHARED_FILES, p)) { sendFile(res, SHARED_FILES[/** @type {keyof typeof SHARED_FILES} */ (p)]); return; }
    if (p.startsWith('/files/')) {
      const file = inside(COLLECTIONS_DIR, p.slice('/files/'.length));
      if (!file || !IMAGE_EXT.has(path.extname(file).toLowerCase())) { res.writeHead(404); res.end(); return; }
      sendFile(res, file, { immutable: url.searchParams.has('v') });
      return;
    }
    const sm = p.match(/^\/styles\/([\w-]+)\/windows\/(.+)$/);
    if (sm) {
      const file = inside(path.join(ROOT, 'styles', sm[1], 'windows'), sm[2]);
      if (!file) { res.writeHead(404); res.end(); return; }
      sendFile(res, file);
      return;
    }
    for (const [prefix, dir] of STATIC) {
      if (!p.startsWith(prefix)) continue;
      const file = inside(dir, p.slice(prefix.length));
      if (!file) break;
      sendFile(res, file);
      return;
    }
    res.writeHead(404, { 'content-type': MIME['.txt'] });
    res.end('Нет такой страницы');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { if (!res.headersSent) sendJson(res, 500, { error: String(e?.message ?? e) }); else res.end(); });
  });

  const want = port ?? settings.editor.port;
  actualPort = await new Promise((resolve, reject) => {
    const tryListen = (/** @type {number} */ p) => {
      server.once('error', (/** @type {any} */ e) => {
        if (e.code === 'EADDRINUSE' && p !== 0) tryListen(0);
        else reject(e);
      });
      server.listen(p, HOST, () => resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port));
    };
    tryListen(want);
  });
  const url = `http://${HOST}:${actualPort}`;

  if (discovery) {
    fs.mkdirSync(path.dirname(DISCOVERY_FILE), { recursive: true });
    fs.writeFileSync(DISCOVERY_FILE, JSON.stringify({ url, port: actualPort, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  }
  if (!quiet && actualPort !== want) console.log(`Порт ${want} занят — редактор открыт на порту ${actualPort}.`);

  const removeDiscovery = () => {
    if (!discovery) return;
    try {
      const d = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
      if (d.pid === process.pid && d.port === actualPort) fs.rmSync(DISCOVERY_FILE);
    } catch { /* already gone */ }
  };

  return {
    url, port: actualPort, token,
    close: async () => {
      clearInterval(keepalive);
      stopWatch();
      for (const c of clients) c.end();
      removeDiscovery();
      await new Promise(r => server.close(() => r(undefined)));
    },
  };
}

// ---------- run as a script ----------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = await cli({
    name: 'editor/server.mjs',
    usage: ['editor/server.mjs [--port N] [--open COLLECTION[/SET]] [--no-browser]'],
    about: `Starts the factory's editor on this computer (127.0.0.1) and opens it in the browser. If the editor is
already running, opens the running one. Stop it with Ctrl+C. The port is settings editor.port; when it is taken,
a free one is used.`,
    options: {
      port: { type: 'string', value: 'N', help: 'port to listen on (default: settings editor.port)' },
      open: { type: 'string', value: 'COLLECTION[/SET]', help: 'open this collection or set' },
      'no-browser': { type: 'boolean', help: 'do not open the browser' },
    },
    check: (/** @type {any} */ v) => v.port !== undefined && !(Number.isInteger(+v.port) && +v.port >= 0 && +v.port < 65536) ? '--port must be a port number' : null,
  }, process.argv.slice(2));
  const settings = /** @type {any} */ (loadSettings());
  const browser = !values['no-browser'] && settings.editor.openBrowser;
  const running = await runningEditor();
  if (running) {
    const target = pageUrl(running.url, /** @type {string|undefined} */ (values.open));
    console.log(`Редактор уже запущен: ${target}`);
    if (browser) openBrowser(target);
  } else {
    const ed = await startEditor({ port: values.port !== undefined ? +values.port : undefined });
    const target = pageUrl(ed.url, /** @type {string|undefined} */ (values.open));
    const key = keyStatus();
    console.log(`Редактор открыт: ${target}`);
    console.log(key.source === 'none' ? 'Ключа OpenRouter нет: его можно ввести в настройках редактора (временный) или положить в .env (постоянный).' : `Ключ: ${key.source === 'permanent' ? 'постоянный (.env или окружение)' : 'временный'}.`);
    console.log('Остановить — Ctrl+C.');
    if (browser) openBrowser(target);
    const stop = async () => { await ed.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
