// Making a set from its plan (core/set/make.js) with the real card loop, a store over a temporary folder and a fake
// image provider (no network, no key); the sheet of the set. Needs the installed packages (sharp).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { lakePlan } from './set-fixtures.mjs';
import { tempStore } from './store-helpers.mjs';

const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp/package.json'));
const skip = !hasSharp && 'пакеты не установлены (node tools/setup.mjs): нет node_modules/sharp';

const SETTINGS = /** @type {any} */ ({ card: { attempts: 3, maxSpendUsd: 0.2, tuneProcessing: false }, processing: {}, set: { parallel: 3, maxSpendUsd: 2 } });
const reference = () => fs.readFileSync(path.join(ROOT, 'styles/scapes/references/card-003.png'));

/** A fake provider answering with one image and price; counts the calls and the most at the same time. */
function fakeProvider(/** @type {Buffer} */ bytes, /** @type {number} */ cost) {
  const p = { calls: 0, running: 0, most: 0, model: 'google/gemini-nano-banana-2.1',
    generate: async () => { p.calls++; p.running++; p.most = Math.max(p.most, p.running); await new Promise(r => setTimeout(r, 5)); p.running--; return { bytes, mime: 'image/png', cost }; } };
  return p;
}

test('makeSet: план проверяется и сохраняется набором, 10 карточек делаются параллельно и встают в свои слоты', { skip }, async t => {
  const { makeSet } = await import('../core/set/make.js');
  const { setSheet } = await import('../core/set/sheet.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const provider = fakeProvider(reference(), 0.01);
  const r = await makeSet({ collection, plan: lakePlan(), settings: SETTINGS, provider, store, limits: { attempts: 1 } });
  assert.equal(r.slots.length, 10);
  assert.ok(r.slots.every(s => s.result === 'made' && s.card && s.image), JSON.stringify(r.slots.filter(s => s.result !== 'made')));
  assert.ok(provider.most > 1 && provider.most <= 3, `одновременно ${provider.most}`);
  const set = await store.getSet(collection, r.set);
  assert.deepEqual(set.slots, r.slots.map(s => s.card));
  assert.equal(set.window.kind, 'large');
  assert.equal(/** @type {any} */ (set.plan).window.layout, 'large');
  assert.equal(set.brief.theme, 'Рыбалка на озере');
  assert.ok(Math.abs(r.spent - provider.calls * 0.01) < 1e-9);

  // a second run keeps the made cards; the same plan again is refused by the collection's registry
  const again = await makeSet({ collection, set: r.set, settings: SETTINGS, provider, store });
  assert.ok(again.slots.every(s => s.result === 'kept'));
  await assert.rejects(makeSet({ collection, plan: lakePlan(), settings: SETTINGS, provider, store }), /не прошёл проверку[\s\S]*уже есть в наборе/);

  const out = path.join(path.dirname(store.cardDir(collection, 'x')), 'sheet.png');
  const sheet = await setSheet({ collection, set: r.set, out, store });
  assert.deepEqual(sheet.missing, []);
  const { default: sharp } = await import('sharp');
  const meta = await sharp(out).metadata();
  assert.ok(meta.width > 5 * 430 && meta.height > 2 * 480);
});

test('makeSet: потолок расходов набора общий для карточек; остаток не тратится', { skip }, async t => {
  const { makeSet } = await import('../core/set/make.js');
  const { default: sharp } = await import('sharp');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  // a flat grey image fails the style's checks: every card spends its attempts
  const grey = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();
  const provider = fakeProvider(grey, 0.04);
  const r = await makeSet({ collection, plan: lakePlan(), settings: SETTINGS, provider, store, limits: { parallel: 1, maxSpendUsd: 0.25 } });
  assert.ok(r.spent <= 0.25 + 1e-9, `потрачено ${r.spent}`);
  assert.deepEqual(r.slots.map(s => s.result), ['made', 'made', ...Array(8).fill('skipped')]);
  assert.equal(r.slots[0].blocking && r.slots[0].blocking > 0, true);
});

/** A fake card loop: answers at once, records the calls (no images, no checks). */
function fakeMakeCard(/** @type {any[]} */ calls) {
  return /** @type {any} */ (async (/** @type {any} */ o) => {
    calls.push(o);
    await new Promise(r => setTimeout(r, 2));
    return { id: `card-${o.place.slot + 1}`, spent: 0, attempts: [], chosenCheck: { blocking: 0 }, image: null, stop: 'passed' };
  });
}

test('makeSet: сигнал отмены — новые карточки не начинаются, начатые доделываются; события хода работы', async t => {
  const { makeSet } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const ac = new AbortController();
  /** @type {any[]} */
  const events = [];
  /** @type {any[]} */
  const calls = [];
  const progress = (/** @type {string} */ text, /** @type {any} */ e) => { if (e) events.push(e); if (e?.status === 'start' && e.slot === 2) ac.abort(); };
  const r = await makeSet({ collection, plan: lakePlan(), settings: SETTINGS, provider: /** @type {any} */ ({ model: 'm', free: true, generate: async () => { throw new Error('не должен вызываться'); } }), store, makeCard: fakeMakeCard(calls), signal: ac.signal, limits: { parallel: 2 }, progress });
  assert.deepEqual(r.slots.map(s => s.result), ['made', 'made', ...Array(8).fill('cancelled')]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal, ac.signal, 'сигнал передан циклу карточки');
  assert.deepEqual(calls.map(c => c.place.slot), [0, 1]);
  assert.deepEqual(events.filter(e => e.slot === 1).map(e => e.status), ['start', 'made']);
  assert.deepEqual(Object.keys(events[0]).sort(), ['cardId', 'set', 'slot', 'spent', 'status', 'title']);
  assert.ok(events.filter(e => e.status === 'cancelled').length === 8);
});

test('planSetInto и planCollectionInto: план от модели сохраняется наборами коллекции, ход работы — событиями', async t => {
  const { planSetInto, planCollectionInto } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const settings = /** @type {any} */ ({ ...SETTINGS, set: { ...SETTINGS.set, plan: { repairs: 0, maxSpendUsd: 1 } } });
  const plan = lakePlan();
  const answer = JSON.stringify({ title: plan.title, angle: plan.angle, cards: plan.slots.map((/** @type {any} */ s, /** @type {number} */ i) => ({ slot: i + 1, kind: s.kind, caption: s.order.title, hue: s.hue, props: s.props, ...Object.fromEntries(Object.entries(s.order).filter(([k]) => !['title', 'style'].includes(k))) })) });
  const collection = (await store.createCollection({ title: 'Лето', description: 'Summer' })).id;
  /** @type {any[]} */
  const events = [];
  const r = await planSetInto({ collection, theme: 'Рыбалка на озере', scenes: 2, settings, store, model: async () => ({ text: answer, cost: 0.002 }), progress: (_, e) => { if (e) events.push(e); } });
  assert.deepEqual(r.plans[0].errors, []);
  const set = await store.getSet(collection, /** @type {string} */ (r.plans[0].set));
  assert.equal(/** @type {any} */ (set.plan).title, 'Lake Fishing');
  assert.deepEqual(set.slots, Array(10).fill(null));
  assert.deepEqual(events.map(e => e.status), ['planning', 'planned']);
  // the same plan again clashes with the saved set: not saved, errors returned
  const again = await planSetInto({ collection, theme: 'Рыбалка', scenes: 2, settings, store, model: async () => ({ text: answer, cost: 0.002 }) });
  assert.ok(!again.plans[0].set && again.plans[0].errors.some(e => /уже есть в наборе/.test(e)));

  const themes = Array.from({ length: 16 }, (_, i) => ({ title: `Theme ${i + 1}`, kind: 'place', angle: `angle ${i + 1}`, examples: [] }));
  let n = 0;
  const model = async () => ({ text: n++ ? answer : JSON.stringify({ sets: themes }), cost: 0.001 });
  const c = await planCollectionInto({ title: 'Новая', theme: 'Summer', only: [10], settings, store, model });
  assert.notEqual(c.collection, collection);
  assert.equal(c.sets.length, 1);
  assert.equal(c.sets[0].number, 10);
  const saved = await store.getSet(c.collection, /** @type {string} */ (c.sets[0].set));
  assert.equal(saved.number, 10);
  assert.equal((await store.getCollection(c.collection)).collection.description, 'Summer');
});
