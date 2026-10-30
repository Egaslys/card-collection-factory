// editor/server.mjs: who may call the API, what files it serves, how paths become URLs; core/settings.js: the
// writer of settings/local.json the editor's settings screen uses. The server runs on a free port without the
// discovery file; it only reads collections/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { pageUrl, startEditor, withUrls } from '../editor/server.mjs';
import { callEditor, hereOrInEditor } from '../editor/remote.js';
import { COLLECTIONS_DIR } from '../core/store/layout.js';
import { readLocalSettings, saveLocalSettings } from '../core/settings.js';

/** A raw request (fetch cannot set Host). @returns {Promise<{status: number, body: string}>} */
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('редактор: API только с токеном запуска, чужой Host отвергается, файлы — только внутри своих папок', async t => {
  const ed = await startEditor({ port: 0, quiet: true, discovery: false });
  t.after(() => ed.close());
  const op = (name, headers = {}) => request(ed.port, { method: 'POST', path: `/api/op/${name}`, headers: { 'content-type': 'application/json', ...headers }, body: '{}' });

  assert.equal((await op('health')).status, 403, 'без токена');
  const ok = await op('health', { 'x-ccf-token': ed.token });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).result.ok, true);
  assert.equal((await op('noSuchOp', { 'x-ccf-token': ed.token })).status, 404);
  const missing = await op('getCollection', { 'x-ccf-token': ed.token });
  assert.equal(missing.status, 400);
  assert.match(JSON.parse(missing.body).error, /collectionId/);

  assert.equal((await request(ed.port, { headers: { host: 'evil.example' } })).status, 421, 'чужой Host (подмена DNS)');
  const page = await request(ed.port);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes(ed.token), 'страница получает токен');
  assert.equal((await request(ed.port, { path: '/files/..%2F..%2Fsettings%2Fdefaults.json' })).status, 404, 'выход из collections/');
  assert.equal((await request(ed.port, { path: '/web/..%2F..%2Fpackage.json' })).status, 404, 'выход из editor/web/');
  assert.equal((await request(ed.port, { path: '/core/image/adjust.js' })).status, 200, 'общий код обработки');
  assert.equal((await request(ed.port, { path: '/core/settings.js' })).status, 404, 'остальной core не отдаётся');
});

test('редактор: пути картинок в ответах получают адреса, адрес страницы ведёт в коллекцию и набор', () => {
  const img = path.join(COLLECTIONS_DIR, 'c 1', 'cards', 'x', 'card.png');
  const out = /** @type {any} */ (withUrls({ image: img, other: '/etc/passwd.png', list: [{ cover: img }], n: 1 }));
  assert.match(out.imageUrl, /^\/files\/c%201\/cards\/x\/card\.png\?v=\d+$/);
  assert.equal(out.otherUrl, undefined, 'вне collections/ адреса нет');
  assert.match(out.list[0].coverUrl, /^\/files\//);
  assert.equal(pageUrl('http://h:1'), 'http://h:1/');
  assert.equal(pageUrl('http://h:1', 'col/set'), 'http://h:1/#/c/col/s/set');
});

test('настройки: запись в local.json — только отличия от defaults.json, неизвестный ключ отвергается', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'settings/defaults.json'), path.join(dir, 'defaults.json'));
  const s = saveLocalSettings({ provider: { use: 'codex-cli' }, card: { attempts: 3 } }, { dir });
  assert.equal(s.provider.use, 'codex-cli');
  assert.deepEqual(readLocalSettings({ dir }), { provider: { use: 'codex-cli' } }, 'значение по умолчанию не записано');
  saveLocalSettings({ provider: { use: 'openrouter' } }, { dir });
  assert.deepEqual(readLocalSettings({ dir }), {}, 'возврат к умолчанию убирает ключ');
  assert.throws(() => saveLocalSettings({ nope: 1 }, { dir }), /неизвестный ключ/);
  assert.deepEqual(readLocalSettings({ dir }), {}, 'отвергнутая запись файл не меняет');
});

test('ccf.mjs editor: справка, неизвестный ключ и --stop с другими ключами отклоняются до работы', () => {
  const ccf = (/** @type {string[]} */ ...args) => spawnSync(process.execPath, [path.join(ROOT, 'ccf.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ccf('editor', '--help').status, 0);
  assert.match(ccf('--help').stdout, /editor \[--open/);
  assert.equal(ccf('editor', '--no-such-option').status, 2);
  assert.equal(ccf('editor', '--stop', '--open', 'c').status, 2);
  assert.equal(ccf('editor', '--port', 'x').status, 2);
});

test('агент через редактор: операция-задача дожидается конца, журнал идёт строками, остановка отменяет задачу', async t => {
  const calls = [];
  let polls = 0;
  let cancelled = false;
  const job = (/** @type {string} */ status, /** @type {string[]} */ lines, extra = {}) => ({ id: 'j1', title: 'проба', status, log: lines.map((text, i) => ({ at: `t${i}`, text })), ...extra });
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url} ${req.headers['x-ccf-token']}`);
    const send = (/** @type {number} */ code, /** @type {any} */ body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/api/op/quick') return send(200, { result: { ok: 1 } });
    if (req.url === '/api/op/bad') return send(400, { error: 'Не хватает поля «x».' });
    if (req.url === '/api/op/long') return send(200, { job: job('running', ['начало']) });
    if (req.url === '/api/jobs/j1/cancel') { cancelled = true; return send(200, {}); }
    if (req.url?.startsWith('/api/jobs/j1/wait')) {
      polls++;
      if (cancelled) return send(200, job('cancelled', ['начало', 'шаг', 'Остановка']));
      return send(200, polls < 2 ? job('running', ['начало', 'шаг']) : job('done', ['начало', 'шаг', 'готово'], { result: { spent: 0 } }));
    }
    send(404, { error: 'нет' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)));
  t.after(() => server.close());
  const ed = { url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`, token: 'tok' };

  assert.deepEqual(await callEditor(ed, 'quick'), { ok: 1 });
  await assert.rejects(callEditor(ed, 'bad'), /Не хватает поля «x»/);
  const lines = [];
  assert.deepEqual(await callEditor(ed, 'long', {}, { onLog: l => lines.push(l) }), { spent: 0 });
  assert.deepEqual(lines, ['начало', 'шаг', 'готово'], 'каждая строка журнала — один раз');
  assert.ok(calls.every(c => c.endsWith(' tok')), 'каждый запрос с токеном запуска');

  polls = 0;
  const ac = new AbortController();
  const run = callEditor(ed, 'long', {}, { signal: ac.signal });
  ac.abort();
  await assert.rejects(run, /не завершилась \(cancelled\)/);
  assert.ok(cancelled, 'задача в редакторе отменена');
});

test('агент через редактор: с ключом здесь или без нужды в ключе операция идёт здесь', async () => {
  const fail = () => { throw new Error('не должно идти в редактор'); };
  assert.equal(await hereOrInEditor({ needsKey: false, envVar: 'CCF_TEST_NO_KEY', op: 'x', args: fail, here: async () => 'здесь' }), 'здесь');
  process.env.CCF_TEST_HERE_KEY = 'k';
  try {
    assert.equal(await hereOrInEditor({ needsKey: true, envVar: 'CCF_TEST_HERE_KEY', op: 'x', args: fail, here: async () => 'здесь' }), 'здесь');
  } finally {
    delete process.env.CCF_TEST_HERE_KEY;
  }
});
