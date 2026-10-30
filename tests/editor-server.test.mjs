// editor/server.mjs: who may call the API, what files it serves, how paths become URLs; core/settings.js: the
// writer of settings/local.json the editor's settings screen uses. The server runs on a free port without the
// discovery file; it only reads collections/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { pageUrl, startEditor, withUrls } from '../editor/server.mjs';
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
