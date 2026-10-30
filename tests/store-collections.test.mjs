// core/store: collections, sets, the card pool, moves and deletion, over a temporary folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { slugify } from '../core/store/index.js';
import { tempStore, writeCard } from './store-helpers.mjs';
import { ROOT } from './root.mjs';

test('хранилище: id читаемые и уникальные — из названия, кириллица в латиницу, повтор получает -2', async t => {
  const { store, root } = tempStore(t);
  assert.equal(slugify('Летняя рыбалка!', 'x'), 'letnyaya-rybalka');
  assert.equal(slugify('Ёжик и щука', 'x'), 'ezhik-i-shchuka');
  assert.equal(slugify('???', 'card'), 'card');
  assert.ok(slugify('очень '.repeat(20), 'x').length <= 40);
  const a = await store.createCollection({ title: 'Лето' });
  const b = await store.createCollection({ title: 'Лето' });
  assert.deepEqual([a.id, b.id], ['leto', 'leto-2']);
  assert.equal(a.style, 'scapes');
  assert.deepEqual(a.fields, {});
  assert.ok(fs.existsSync(path.join(root, 'leto', 'collection.json')));
  assert.equal(store.newCardId('leto', 'Поплавок'), 'poplavok');
  assert.equal(store.newCardId('leto', 'Поплавок'), 'poplavok-2', 'id занят сразу: папка создана');
  assert.ok(fs.existsSync(store.cardDir('leto', 'poplavok')));
  assert.equal(store.cardDir('leto', 'poplavok'), path.join(root, 'leto', 'cards', 'poplavok'));
  assert.throws(() => store.cardDir('leto', '../x'), /Недопустимый id/);
  await assert.rejects(store.getCollection('nope'), /Коллекции «nope» нет/);
  await assert.rejects(store.createCollection({ title: '  ' }), /Нужно название/);
});

test('хранилище: коллекция — список, правка, порядок наборов; чужие папки без collection.json не коллекции', async t => {
  const { store, root } = tempStore(t);
  fs.mkdirSync(path.join(root, 'old-layout', 'sets'), { recursive: true });
  const col = await store.createCollection({ title: 'Рыбалка', description: 'Летний сезон', fields: { season: 'лето' } });
  const s1 = await store.createSet(col.id, { title: 'Озеро', brief: { theme: 'озеро', wishes: 'без лодок' } });
  const s2 = await store.createSet(col.id, { title: 'Море', window: { kind: 'small', template: 'crimson' } });
  assert.equal(s1.number, 1);
  assert.equal(s2.number, 2);
  assert.deepEqual(s1.slots, Array(10).fill(null));
  assert.equal(s1.variantGroup, s1.id);
  assert.deepEqual(s1.brief, { theme: 'озеро', wishes: 'без лодок', variants: 1 });
  assert.deepEqual(s1.window, { kind: 'large', template: 'blue' });
  writeCard(store, col.id, 'poplavok', { title: 'Поплавок' });
  await store.setSlots(col.id, s2.id, ['poplavok', ...Array(9).fill(null)]);

  const list = await store.listCollections();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], {
    id: col.id, title: 'Рыбалка', description: 'Летний сезон', setCount: 2, cardCount: 1,
    cover: path.join(store.cardDir(col.id, 'poplavok'), 'card.png'),
  });

  const next = await store.updateCollection(col.id, { description: 'Осень', sets: [s2.id, s1.id] });
  assert.equal(next.description, 'Осень');
  assert.deepEqual((await store.getCollection(col.id)).sets.map(s => s.id), [s2.id, s1.id]);
  await assert.rejects(store.updateCollection(col.id, { sets: [s1.id] }), /Порядок наборов/);
  await assert.rejects(store.updateCollection(col.id, { id: 'x' }), /менять нельзя/);
  await assert.rejects(store.createSet(col.id, { title: 'X', window: { kind: 'huge' } }), /Вид окна «huge»/);
  await assert.rejects(store.createSet(col.id, { title: 'X', window: { template: 'green' } }), /Шаблон окна «green»/);
  // the kinds and templates come from the style's windows.json: the grand window has its own one colour
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/windows/windows.json'), 'utf8'));
  const grand = await store.createSet(col.id, { title: 'Праздник', window: { kind: 'grand' } });
  assert.deepEqual(grand.window, { kind: 'grand', template: Object.keys(g.families.grand.templates)[0] });
  await assert.rejects(store.createSet(col.id, { title: 'X', window: { kind: 'grand', template: 'blue' } }), /Шаблон окна «blue» у окна grand/);
  assert.deepEqual((await store.updateSet(col.id, grand.id, { window: { kind: 'large' } })).window, { kind: 'large', template: Object.keys(g.templates)[0] }, 'другое окно — его первый цвет');
});

test('хранилище: набор хранит plan и чужие ключи; правка сливает brief и window, ключи не из правки остаются', async t => {
  const { store } = tempStore(t);
  const col = await store.createCollection({ title: 'C' });
  const plan = { cards: [{ slot: 1, subject: 'bobber' }] };
  const set = await store.createSet(col.id, { title: 'S', plan, number: 5, variantGroup: 'g1', note: 'x' });
  assert.deepEqual(set.plan, plan);
  assert.equal(set.note, 'x');
  assert.equal(set.number, 5);
  const v2 = await store.createSet(col.id, { title: 'S', variantGroup: 'g1', number: 5 });
  assert.equal(v2.id, 's-2');
  assert.equal(v2.variantGroup, 'g1');
  const up = await store.updateSet(col.id, set.id, { brief: { wishes: 'ярче' }, window: { template: 'orange' }, extra: 1 });
  assert.deepEqual(up.plan, plan);
  assert.equal(up.note, 'x');
  assert.equal(up.extra, 1);
  assert.deepEqual(up.brief, { theme: '', wishes: 'ярче', variants: 1 });
  assert.deepEqual(up.window, { kind: 'large', template: 'orange' });
  const replaced = await store.updateSet(col.id, set.id, { plan: { cards: [] } });
  assert.deepEqual(replaced.plan, { cards: [] });
  await assert.rejects(store.updateSet(col.id, set.id, { id: 'y' }), /задаёт хранилище/);
  await assert.rejects(store.updateSet(col.id, set.id, { brief: { variants: 0 } }), /Число вариантов/);
  await assert.rejects(store.getSet(col.id, 'nope'), /Набора «nope»/);
});

test('хранилище: карточка стоит не больше чем в одном слоте; перенос, обмен местами, возврат в хранилище', async t => {
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'C' })).id;
  const a = (await store.createSet(c, { title: 'A' })).id;
  const b = (await store.createSet(c, { title: 'B' })).id;
  for (const k of ['k1', 'k2', 'k3']) writeCard(store, c, k);
  const slots = (...ids) => [...ids, ...Array(10 - ids.length).fill(null)];

  await store.setSlots(c, a, slots('k1', 'k2'));
  await store.setSlots(c, b, slots(null, 'k1'));
  assert.deepEqual((await store.getSet(c, a)).slots, slots(null, 'k2'), 'k1 ушла из A, когда её поставили в B');
  assert.deepEqual((await store.getSet(c, b)).slots, slots(null, 'k1'));
  await assert.rejects(store.setSlots(c, a, slots('k2', 'k2')), /дважды/);
  await assert.rejects(store.setSlots(c, a, slots('zz')), /Карточки «zz»/);
  await assert.rejects(store.setSlots(c, a, ['k2']), /массив из 10/);

  // into an occupied slot: the cards swap places
  let moved = await store.moveCard(c, 'k1', { setId: a, slot: 1 });
  assert.deepEqual([moved.setId, moved.slot], [a, 1]);
  assert.deepEqual((await store.getSet(c, a)).slots, slots(null, 'k1'));
  assert.deepEqual((await store.getSet(c, b)).slots, slots(null, 'k2'));
  // within one set
  await store.moveCard(c, 'k1', { setId: a, slot: 9 });
  assert.deepEqual((await store.getSet(c, a)).slots, [...Array(9).fill(null), 'k1']);
  // from the pool into an occupied slot: the card there goes to the pool
  moved = await store.moveCard(c, 'k3', { setId: b, slot: 1 });
  assert.deepEqual((await store.getSet(c, b)).slots, slots(null, 'k3'));
  assert.deepEqual((await store.listCards(c, { pool: true })).map(x => x.id), ['k2']);
  // back to the pool
  moved = await store.moveCard(c, 'k1', { pool: true });
  assert.equal(moved.setId, null);
  assert.deepEqual((await store.getCollection(c)).pool.map(x => x.id).sort(), ['k1', 'k2']);
  await assert.rejects(store.moveCard(c, 'k1', { setId: a, slot: 10 }), /Слот — целое от 0 до 9/);
  await assert.rejects(store.moveCard(c, 'zz', { pool: true }), /Карточки «zz»/);

  const all = (await store.listCards(c)).flatMap(x => (x.setId ? [`${x.id}@${x.setId}:${x.slot}`] : []));
  assert.deepEqual(all, [`k3@${b}:1`]);
});

test('хранилище: сводка карточки — название, картинка, статус, проверки, стоимость', async t => {
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'C' })).id;
  const check = { maskStatus: 'proposal', blocking: 1, warns: 2, fails: [{}, {}, {}] };
  writeCard(store, c, 'made', { title: 'Поплавок', costs: [0.04, null, 0.05], chosen: 3, check });
  writeCard(store, c, 'failed', { image: false });
  store.newCardId(c, 'empty');
  fs.writeFileSync(path.join(store.cardDir(c, 'failed'), '..', 'broken'), '');
  fs.mkdirSync(store.cardDir(c, 'broken-json'));
  fs.writeFileSync(path.join(store.cardDir(c, 'broken-json'), 'card.json'), '{');
  const byId = Object.fromEntries((await store.listCards(c)).map(x => [x.id, x]));
  assert.deepEqual(Object.keys(byId).sort(), ['broken-json', 'empty', 'failed', 'made']);
  const m = byId.made;
  assert.equal(m.title, 'Поплавок');
  assert.equal(m.status, 'made');
  assert.equal(m.image, path.join(store.cardDir(c, 'made'), 'card.png'));
  assert.deepEqual(m.checks, { blocking: 1, warns: 2, needsEyes: 2, maskStatus: 'proposal' });
  assert.deepEqual([m.attempts, m.cost, m.costUnknown], [3, 0.09, 1]);
  assert.ok(m.updatedAt);
  assert.deepEqual([byId.failed.status, byId.failed.image], ['failed', null]);
  assert.deepEqual([byId.empty.status, byId.empty.attempts, byId.empty.title], ['new', 0, 'empty']);
  assert.match(byId['broken-json'].error, /card\.json не читается/);
});

test('хранилище: удаление — через корзину и только внутри папки коллекций; карточки удалённого набора остаются', async t => {
  const { store, root, trashed } = tempStore(t);
  const c = (await store.createCollection({ title: 'C' })).id;
  const s = (await store.createSet(c, { title: 'S' })).id;
  writeCard(store, c, 'k1');
  writeCard(store, c, 'k2');
  await store.setSlots(c, s, ['k1', 'k2', ...Array(8).fill(null)]);
  await store.deleteCard(c, 'k2');
  assert.deepEqual((await store.getSet(c, s)).slots.slice(0, 2), ['k1', null]);
  await store.deleteSet(c, s);
  const after = await store.getCollection(c);
  assert.deepEqual(after.collection.sets, []);
  assert.deepEqual(after.pool.map(x => x.id), ['k1']);
  await store.deleteCollection(c);
  assert.deepEqual((await store.listCollections()), []);
  assert.equal(trashed.length, 3);
  assert.ok(trashed.every(p => fs.realpathSync(root) === p.slice(0, fs.realpathSync(root).length)));
  await assert.rejects(store.deleteCollection(c), /Коллекции/);
});

test('хранилище: запись атомарна — во время работы не остаётся временных файлов', async t => {
  const { store, root } = tempStore(t);
  const c = (await store.createCollection({ title: 'C' })).id;
  const s = (await store.createSet(c, { title: 'S' })).id;
  for (let i = 0; i < 20; i++) await store.updateSet(c, s, { title: `S${i}` });
  const files = fs.readdirSync(root, { recursive: true }).map(String);
  assert.ok(!files.some(f => f.endsWith('.tmp')), files.join(', '));
});

test('хранилище: openFolder зовёт файловый менеджер своей ОС и не ищет несуществующую папку', async t => {
  for (const [platform, command] of [['darwin', 'open'], ['win32', 'explorer'], ['linux', 'xdg-open']]) {
    const calls = [];
    const spawn = (cmd, args) => {
      calls.push([cmd, ...args]);
      const handlers = {};
      queueMicrotask(() => handlers.spawn?.());
      return { once: (ev, fn) => { handlers[ev] = fn; }, unref() {} };
    };
    const { store, root } = tempStore(t, { spawn, platform });
    await store.openFolder(root);
    assert.deepEqual(calls, [[command, path.resolve(root)]], platform);
    await assert.rejects(store.openFolder(path.join(root, 'nope')), /Нет такой папки/);
  }
});

test('хранилище: расходы по видам — картинки и взгляд из карточек, текст из журнала; коллекция и фабрика целиком', async t => {
  const { store, root } = tempStore(t);
  const a = await store.createCollection({ title: 'А' });
  const b = await store.createCollection({ title: 'Б' });
  writeCard(store, a.id, 'x', { costs: [0.04, null] });
  const file = path.join(store.cardDir(a.id, 'x'), 'card.json');
  const card = JSON.parse(fs.readFileSync(file, 'utf8'));
  card.attempts[0].hero = { cost: 0.001 };
  card.attempts[0].look = { cost: 0.002 };
  card.attempts[0].fix = { cost: 0.003 };
  card.attempts.push({ n: 3, model: 'codex-cli', cost: 0, look: { cost: 0.002 } });
  fs.writeFileSync(file, JSON.stringify(card));
  writeCard(store, b.id, 'y', { costs: [0.05] });
  await store.recordSpend(a.id, { kind: 'text', what: 'plan', model: 't', usd: 0.01 });
  await store.recordSpend(null, { kind: 'text', what: 'text-help', model: 't', usd: 0.002 });
  await store.recordSpend(b.id, { kind: 'text', what: 'plan', model: 't', usd: null });
  await assert.rejects(store.recordSpend('nope', { kind: 'text', what: 'plan', model: 't', usd: 1 }), /Коллекции «nope» нет/);
  await assert.rejects(store.recordSpend(null, { kind: 'coffee', what: 'x', model: 't', usd: 1 }), /неизвестен/);
  const x = (await store.listCards(a.id))[0];
  assert.deepEqual([x.spend, x.model], [{ images: 0.04, vision: 0.005, text: 0.003 }, 'm']);
  assert.deepEqual(await store.spend({ collectionId: a.id }), { images: 0.04, vision: 0.005, text: 0.013, total: 0.058, unknown: 1 });
  assert.deepEqual(await store.spend({ collectionId: b.id }), { images: 0.05, vision: 0, text: 0, total: 0.05, unknown: 1 });
  assert.deepEqual(await store.spend(), { images: 0.09, vision: 0.005, text: 0.015, total: 0.11, unknown: 2 });
  assert.equal(fs.readFileSync(path.join(root, 'spend.jsonl'), 'utf8').trim().split('\n').length, 3);
  assert.deepEqual((await store.listCollections()).map(c => c.id), [a.id, b.id], 'журнал не коллекция');
});
