// editor/server.mjs: who may call the API, what files it serves, how paths become URLs; core/settings.js: the
// writer of settings/local.json the editor's settings screen uses. The server runs on a free port without the
// discovery file; it only reads collections/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { pageUrl, startEditor, withUrls } from '../editor/server.mjs';
import { callEditor, hereOrInEditor } from '../editor/remote.js';
import { COLLECTIONS_DIR } from '../core/store/layout.js';
import { loadSettings, readLocalSettings, saveLocalSettings } from '../core/settings.js';

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
  assert.deepEqual(Object.keys(JSON.parse(ok.body).result.key).sort(), ['envVar', 'source'], 'о ключе — только его статус, ни одного его символа');
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
  saveLocalSettings({ provider: { use: 'api' } }, { dir });
  assert.deepEqual(readLocalSettings({ dir }), {}, 'возврат к умолчанию убирает ключ');
  // a local.json of the shape before the API presets: read in today's shape, the old keys gone when written again
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ provider: { use: 'openrouter' }, vision: { model: 'a/vision', timeoutMs: 5 }, set: { plan: { model: 'a/text' } } }));
  const old = loadSettings({ dir });
  assert.deepEqual([old.provider.use, old.provider.preset, old.provider.openrouter.visionModel, old.provider.openrouter.textModel, old.vision.timeoutMs], ['api', 'openrouter', 'a/vision', 'a/text', 5]);
  assert.ok(!('model' in old.vision) && !('model' in old.set.plan));
  saveLocalSettings({ provider: { preset: 'google' } }, { dir });
  assert.deepEqual(readLocalSettings({ dir }), { provider: { preset: 'google', openrouter: { visionModel: 'a/vision', textModel: 'a/text' } }, vision: { timeoutMs: 5 } });
  fs.writeFileSync(path.join(dir, 'local.json'), '{}');
  assert.throws(() => saveLocalSettings({ nope: 1 }, { dir }), /неизвестный ключ/);
  assert.deepEqual(readLocalSettings({ dir }), {}, 'отвергнутая запись файл не меняет');
});

test('настройки: число — только число; пустое поле редактора (reset) возвращает значение по умолчанию', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'settings/defaults.json'), path.join(dir, 'defaults.json'));
  const defaults = loadSettings({ dir });
  saveLocalSettings({ set: { maxSpendUsd: 5 }, card: { attempts: 7 } }, { dir });
  assert.deepEqual(readLocalSettings({ dir }), { set: { maxSpendUsd: 5 }, card: { attempts: 7 } });
  // what an emptied field used to send (Number('') = 0 passes as a number, but '' and null do not)
  for (const bad of ['', null, '2', NaN])
    assert.throws(() => saveLocalSettings({ set: { maxSpendUsd: bad } }, { dir }), /«set\.maxSpendUsd» должно быть числом/);
  assert.deepEqual(readLocalSettings({ dir }), { set: { maxSpendUsd: 5 }, card: { attempts: 7 } }, 'отвергнутая запись файл не меняет');
  const s = saveLocalSettings({ card: { attempts: 4 } }, { dir, reset: ['set.maxSpendUsd'] });
  assert.equal(s.set.maxSpendUsd, defaults.set.maxSpendUsd);
  assert.deepEqual(readLocalSettings({ dir }), { card: { attempts: 4 } });
  assert.throws(() => saveLocalSettings({}, { dir, reset: ['set.nope'] }), /неизвестный ключ «set\.nope»/);
  // a hand-written local.json with a string where a number belongs is refused when read, with the key named
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ card: { attempts: '3' } }));
  assert.throws(() => loadSettings({ dir }), /«card\.attempts» должно быть числом/);
});

test('ccf.mjs editor: справка, неизвестный ключ и --stop с другими ключами отклоняются до работы', () => {
  const ccf = (/** @type {string[]} */ ...args) => spawnSync(process.execPath, [path.join(ROOT, 'ccf.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ccf('editor', '--help').status, 0);
  assert.match(ccf('--help').stdout, /editor \[--open/);
  assert.equal(ccf('editor', '--no-such-option').status, 2);
  assert.equal(ccf('editor', '--stop', '--open', 'c').status, 2);
  assert.equal(ccf('editor', '--port', 'x').status, 2);
});

test('редактор без терминала: подсказывает --stop, а SIGHUP (закрытый терминал) останавливает его и убирает файл обнаружения', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-editor-hup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const discovery = path.join(dir, 'editor.json');
  const env = { ...process.env, CCF_EDITOR_FILE: discovery, CCF_COLLECTIONS_DIR: path.join(dir, 'collections') };
  const child = spawn(process.execPath, [path.join(ROOT, 'editor', 'server.mjs'), '--no-browser', '--port', '0'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let out = '';
  child.stdout.on('data', c => { out += c; });
  const exited = new Promise(r => child.on('exit', (code, signal) => r({ code, signal })));
  for (let i = 0; i < 100 && !(fs.existsSync(discovery) && out.includes('Остановить')); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(fs.existsSync(discovery), 'редактор запустился');
  assert.match(out, /Редактор работает в фоне\. Остановить: node ccf\.mjs editor --stop/);
  child.kill('SIGHUP');
  assert.deepEqual(await exited, { code: 0, signal: null }, 'выход своим кодом, а не гибель от сигнала');
  assert.equal(fs.existsSync(discovery), false);
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
  // without a key here and without an editor: an operation that can do without the key runs here, the others stop
  assert.equal(await hereOrInEditor({ needsKey: true, optional: true, envVar: 'CCF_TEST_NO_KEY', op: 'x', args: fail, here: async () => 'здесь' }), 'здесь');
  await assert.rejects(hereOrInEditor({ needsKey: true, envVar: 'CCF_TEST_NO_KEY', op: 'x', args: fail, here: async () => 'здесь' }), /Нет ключа CCF_TEST_NO_KEY/);
});

test('ключ редактора: временный — только в памяти редактора, не в окружении процесса (его унаследовал бы Codex)', async () => {
  const { setTemporaryKey, clearTemporaryKey, currentKey, keyStatus } = await import('../editor/server/key.js');
  const v = 'CCF_TEST_TEMPORARY_KEY';
  delete process.env[v];
  setTemporaryKey('tmp-secret-1', v);
  assert.equal(currentKey(v), 'tmp-secret-1');
  assert.equal(keyStatus(v).source, 'temporary');
  assert.equal(process.env[v], undefined, 'временного ключа нет в process.env');
  assert.ok(!Object.values(process.env).includes('tmp-secret-1'));
  clearTemporaryKey(v);
  assert.equal(currentKey(v), null);
  assert.equal(keyStatus(v).source, 'none');
});

test('задачи: строка карточки помнит номер попытки в этом запуске (не номер версии), пока карточка рисуется; строка журнала называет карточку', async () => {
  const { createJobs } = await import('../editor/server/jobs.js');
  const jobs = createJobs(() => {});
  /** @type {(text: string, o?: any) => void} */
  let progress = () => {};
  /** @type {() => void} */
  let finish = () => {};
  const job = jobs.start({ op: 'makeSet', title: 'Набор', run: ctx => { progress = ctx.progress; return new Promise(r => { finish = () => r(null); }); } });
  await new Promise(r => setImmediate(r));
  const say = { k: 'attempt', stage: 'generate', n: 2, done: 1, of: 3 };
  progress('попытка 2', { set: 's', slot: 1, title: 'Dust Mask', status: 'start', spent: 0.04, say });
  assert.deepEqual(job.items?.[0].attempt, { stage: 'generate', k: 2, of: 3 });
  assert.deepEqual(job.log.at(-1)?.say, { ...say, title: 'Dust Mask' });
  progress('готово', { set: 's', slot: 1, title: 'Dust Mask', status: 'made', spent: 0.08 });
  assert.equal(job.items?.[0].attempt, undefined);
  // a regenerate: the card's 4th version is this run's first attempt of 1, not «4 of 1»
  progress('попытка 4', { set: 's', slot: 2, title: 'Storm Tent', status: 'start', say: { k: 'attempt', stage: 'generate', n: 4, done: 0, of: 1 } });
  assert.deepEqual(job.items?.[1].attempt, { stage: 'generate', k: 1, of: 1 });
  finish();
});
