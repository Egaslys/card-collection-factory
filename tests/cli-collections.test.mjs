// The collection, export and plan-saving commands of ccf.mjs (core/store/cli.js, core/set/cli.js) run as a child
// process over a temporary store (CCF_COLLECTIONS_DIR); no network, no paid call.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { lakePlan } from './set-fixtures.mjs';
import { tempStore, writeCard } from './store-helpers.mjs';

function setup(t) {
  const { root, store } = tempStore(t);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-cli-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'ccf.mjs'), ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, CCF_COLLECTIONS_DIR: root } });
  const json = (...args) => { const r = run(...args, '--json'); assert.equal(r.status, 0, r.stderr + r.stdout); return JSON.parse(r.stdout); };
  return { root, store, work, run, json };
}

test('ccf.mjs: новые команды — справка, неизвестный ключ и пропущенное обязательное отклоняются до работы', t => {
  const { run } = setup(t);
  for (const c of [['collection', 'list'], ['collection', 'create'], ['collection', 'show', 'x'], ['collection', 'check'], ['set', 'save', 'p.json'], ['export']]) {
    assert.equal(run(...c, '--help').status, 0, c.join(' '));
    const bad = run(...c, '--no-such-option');
    assert.equal(bad.status, 2, c.join(' '));
    assert.match(bad.stderr, /Unknown option '--no-such-option'/);
  }
  assert.equal(run('collection', 'create').status, 2, 'без --title');
  assert.equal(run('collection', 'show').status, 2, 'без ID');
  assert.equal(run('collection', 'check').status, 2, 'без --collection');
  assert.equal(run('set', 'save', 'p.json').status, 2, 'без --collection');
  assert.equal(run('export').status, 2, 'без --collection');
  assert.equal(run('export', '--collection', 'c', '--set', 'a,,b').status, 2, 'пустой id в списке');
});

test('collection create / list / show: создание, список и сводка с пулом', async t => {
  const { run, json, store } = setup(t);
  assert.match(run('collection', 'list').stdout, /Коллекций пока нет/);
  const made = json('collection', 'create', '--title', 'Озёра', '--description', 'про озёра');
  assert.equal(made.title, 'Озёра');
  assert.match(run('collection', 'create', '--title', 'Лес').stdout, /Коллекция создана: /);
  const list = json('collection', 'list');
  assert.deepEqual(list.map(c => c.title), ['Озёра', 'Лес']);
  assert.equal(list[0].description, 'про озёра');
  writeCard(store, made.id, 'bobber', { title: 'Bobber' });
  const shown = json('collection', 'show', made.id);
  assert.equal(shown.id, made.id);
  assert.deepEqual(shown.sets, []);
  assert.deepEqual(shown.pool.map(c => [c.id, c.title, c.status]), [['bobber', 'Bobber', 'made']]);
  assert.match(run('collection', 'show', made.id).stdout, /Пул|Карточки вне наборов/);
  const missing = run('collection', 'show', 'net-takoj');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Ошибка: /);
});

test('set save: план сохраняется набором без карточек, плохой план отклоняется; collection check видит сохранённые планы', async t => {
  const { run, json, work, store } = setup(t);
  const col = json('collection', 'create', '--title', 'Озёра').id;
  const file = path.join(work, 'lake.json');
  fs.writeFileSync(file, JSON.stringify(lakePlan()));
  const saved = json('set', 'save', file, '--collection', col);
  assert.equal(saved.title, 'Lake Fishing');
  const { sets, pool } = await store.getCollection(col);
  assert.equal(sets.length, 1);
  assert.ok(sets[0].plan);
  assert.equal(sets[0].slots.filter(Boolean).length, 0, 'карточек нет');
  assert.equal(pool.length, 0);
  const shown = json('collection', 'show', col);
  assert.equal(shown.sets[0].hasPlan, true);

  // the same plan again: a repeated title and item kinds in the collection are errors
  const again = run('set', 'save', file, '--collection', col);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /не прошёл проверку/);
  assert.equal((await store.getCollection(col)).sets.length, 1, 'отклонённый план не сохранён');

  const bad = lakePlan(); bad.slots.length = 3;
  const badFile = path.join(work, 'bad.json');
  fs.writeFileSync(badFile, JSON.stringify(bad));
  assert.equal(run('set', 'save', badFile, '--collection', col).status, 1);

  // the whole-collection check: one set of 16 is incomplete, --partial allows it
  const whole = run('collection', 'check', '--collection', col, '--json');
  assert.equal(whole.status, 1);
  assert.ok(JSON.parse(whole.stdout).errors.some(e => /16|наборов/.test(e)), whole.stdout);
  const partial = json('collection', 'check', '--collection', col, '--partial');
  assert.equal(partial.plans, 1);
  assert.deepEqual(partial.errors.filter(e => /16/.test(e)), []);
});

test('export: папка и ZIP, выбор наборов и карточек, пропуск карточек без картинки', async t => {
  const { run, json, store } = setup(t);
  const col = (await store.createCollection({ title: 'Озёра' })).id;
  const set = await store.createSet(col, { title: 'Рыбалка', brief: { theme: 't', wishes: '' }, window: { kind: 'small', template: 'blue' } });
  writeCard(store, col, 'a', { title: 'Alpha' });
  writeCard(store, col, 'b', { title: 'Beta', image: false });
  writeCard(store, col, 'loose', { title: 'Loose' });
  await store.moveCard(col, 'a', { setId: set.id, slot: 0 });
  await store.moveCard(col, 'b', { setId: set.id, slot: 1 });

  const folder = json('export', '--collection', col);
  assert.equal(folder.files, 2, 'без выбора — наборы и хранилище');
  assert.deepEqual(folder.skipped.map(s => s.id), ['b']);
  assert.ok(fs.statSync(folder.path).isDirectory());
  assert.ok(fs.existsSync(path.join(folder.path, 'Озёра', 'Хранилище', 'Loose.png')));
  assert.equal(json('export', '--collection', col, '--set', set.id).files, 1, 'только набор');
  assert.equal(json('export', '--collection', col, '--set', set.id, '--pool').files, 2, 'набор и хранилище');

  const zip = json('export', '--collection', col, '--set', set.id, '--card', 'loose', '--zip');
  assert.equal(zip.files, 2);
  assert.ok(zip.path.endsWith('.zip') && fs.statSync(zip.path).isFile());
  assert.match(run('export', '--collection', col, '--card', 'loose').stdout, /Выгружено файлов: 1/);

  const none = run('export', '--collection', col, '--card', 'nope');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /нет/);
});
