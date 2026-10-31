// The places of a set window (core/set/places.js): what each place shows (the person's, the plan's, the window
// kind's), setting a place, and one card for an empty place — a planned set by its plan, a set gathered by hand by a
// fake text model's order — with the real card loop and a fake image provider (no network, no key). The collection
// cover chosen in the store. Making cards needs the installed packages (sharp).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { lakePlan } from './set-fixtures.mjs';
import { tempStore, writeCard } from './store-helpers.mjs';

const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp/package.json'));
const skip = !hasSharp && 'пакеты не установлены (node tools/setup.mjs): нет node_modules/sharp';

const SETTINGS = /** @type {any} */ ({
  card: { attempts: 1, maxSpendUsd: 0.2, tuneProcessing: false }, processing: {},
  set: { parallel: 2, maxSpendUsd: 2, cards: { maxCount: 10 }, plan: { repairs: 1, maxSpendUsd: 1 } },
  provider: { preset: 'openrouter', openrouter: { textModel: 'text-model' } },
});
const reference = () => fs.readFileSync(path.join(ROOT, 'styles/scapes/references/card-003.png'));
/** A fake image provider: one picture and price per call, counted. */
const fakeProvider = () => {
  const p = { calls: 0, model: 'google/gemini-nano-banana-2.1', generate: async () => { p.calls++; return { bytes: reference(), mime: 'image/png', cost: 0.01 }; } };
  return p;
};
/** One card of the lake plan as the text model answers loose cards. @param {number} i */
const looseAnswer = i => {
  const s = /** @type {any} */ (lakePlan().slots[i]);
  return JSON.stringify({ cards: [{ slot: 1, kind: s.kind, caption: s.order.title, hue: s.hue, props: s.props, ...Object.fromEntries(Object.entries(s.order).filter(([k]) => !['title', 'style'].includes(k))) }] });
};

test('placesOf: окно без плана — по виду окна; своё место поверх плана; чего вид окна не показывает — не берётся', async () => {
  const { placesOf, placeChoices } = await import('../core/set/places.js');
  const large = placesOf({ window: { kind: 'large' } }, 'scapes');
  assert.deepEqual(large.map(p => p.stars), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual(large.map(p => p.frame), [...Array(8).fill('silver'), 'gold', 'gold']);
  assert.deepEqual(large.map(p => p.scene), [...Array(8).fill(false), true, true]);
  assert.deepEqual(placeChoices('scapes', 'large'), { stars: true, frames: ['silver', 'gold'] });
  assert.deepEqual(placeChoices('scapes', 'grand'), { stars: false, frames: ['crystal'] });
  const grand = placesOf({ window: { kind: 'grand' }, places: [{ stars: 2, frame: 'gold' }] }, 'scapes');
  assert.ok(grand.every(p => p.stars === 5 && p.frame === 'crystal' && p.scene), 'гранд: 5 звёзд, кристалл, сцены');
  const plan = lakePlan();
  const own = placesOf({ window: { kind: 'large' }, plan, places: [{ stars: 4, frame: 'gold' }, null, { stars: 3, frame: 'crystal' }] }, 'scapes');
  assert.deepEqual(own[0], { stars: 4, frame: 'gold', scene: true }, 'своё место, золото большого окна — сцена');
  assert.deepEqual(own[1], { stars: plan.slots[1].stars, frame: plan.slots[1].frame, scene: false }, 'место плана');
  assert.equal(own[2].frame, plan.slots[2].frame, 'кристалл в большом окне не показывается: берётся план');
  assert.equal(placesOf({ window: { kind: 'small' } }, 'scapes').every(p => p.stars === 1 && p.frame === 'silver' && !p.scene), true);
});

test('setPlace: звёзды и рамка одного места в set.json places; чего окно не умеет — отказ', async t => {
  const { setPlace, placesOf } = await import('../core/set/places.js');
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'Лето' })).id;
  const set = await store.createSet(c, { title: 'Руками' });
  const after = /** @type {any} */ (await setPlace({ collection: c, set: set.id, slot: 3, stars: 5, frame: 'gold', store }));
  assert.deepEqual(after.places[3], { stars: 5, frame: 'gold' });
  assert.deepEqual(after.places.filter((/** @type {any} */ p) => p).length, 1, 'остальные места не записаны');
  assert.deepEqual(placesOf(after, 'scapes')[3], { stars: 5, frame: 'gold', scene: true });
  const stars = /** @type {any} */ (await setPlace({ collection: c, set: set.id, slot: 3, stars: 2, store }));
  assert.deepEqual(stars.places[3], { stars: 2, frame: 'gold' }, 'рамка осталась');
  await assert.rejects(setPlace({ collection: c, set: set.id, slot: 0, frame: 'crystal', store }), /Рамка «crystal» в этом окне не бывает/);
  await assert.rejects(setPlace({ collection: c, set: set.id, slot: 0, stars: 6, store }), /от 1 до 5/);
  await assert.rejects(setPlace({ collection: c, set: set.id, slot: 10, stars: 1, store }), /Место — целое от 1 до 10/);
  await store.updateSet(c, set.id, { window: { kind: 'grand' } });
  await assert.rejects(setPlace({ collection: c, set: set.id, slot: 0, stars: 3, store }), /звёзды мест заданы окном/);
});

test('fillPlace: набор руками — текстовая модель пишет одну карточку по теме набора, она встаёт в пустое место', { skip }, async t => {
  const { fillPlace } = await import('../core/set/places.js');
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'Лето' })).id;
  const set = await store.createSet(c, { title: 'Руками', brief: { theme: 'Рыбалка на озере', wishes: 'утро' } });
  /** @type {any[][]} */
  const asked = [];
  const provider = fakeProvider();
  const r = await fillPlace({ collection: c, set: set.id, slot: 2, settings: SETTINGS, provider, store, model: async m => { asked.push(m); return { text: looseAnswer(0), cost: 0.001 }; } });
  assert.deepEqual(r.errors, []);
  assert.ok(r.card, 'карточка сделана');
  assert.match(asked[0][1].content, /Рыбалка на озере/, 'тема набора — в запросе');
  assert.match(asked[0][1].content, /1 of them are item cards without characters, then 0 scenes/);
  const after = await store.getSet(c, set.id);
  assert.equal(after.slots[2], r.card);
  assert.equal(provider.calls, 1);
  const pool = (await store.getCollection(c)).pool;
  assert.equal(pool.length, 0, 'в хранилище карточка не осталась');
  await assert.rejects(fillPlace({ collection: c, set: set.id, slot: 2, settings: SETTINGS, provider, store, model: async () => ({ text: looseAnswer(1), cost: 0.001 }) }), /Место 3 занято/);
  // what the person wants on the card leads the request, within the set's theme
  const about = await fillPlace({ collection: c, set: set.id, slot: 3, about: 'марсианская картошка', settings: SETTINGS, provider, store, model: async m => { asked.push(m); return { text: looseAnswer(1), cost: 0.001 }; } });
  assert.deepEqual(about.errors, []);
  assert.match(asked.at(-1)?.[1].content, /on the theme "марсианская картошка \(Рыбалка на озере\)"/);
  // a gold place of the large window is a scene: the model is asked for one scene with characters
  const scene = await fillPlace({ collection: c, set: set.id, slot: 9, settings: SETTINGS, provider, store, model: async m => { asked.push(m); return { text: looseAnswer(8), cost: 0.001 }; } });
  assert.deepEqual(scene.errors, []);
  assert.match(asked.at(-1)?.[1].content, /0 of them are item cards without characters, then 1 scenes/);
  assert.equal((await store.getSet(c, set.id)).slots[9], scene.card);
});

test('fillPlace: у набора с планом пустое место делается по заказу плана для этого слота', { skip }, async t => {
  const { fillPlace } = await import('../core/set/places.js');
  const { saveSetPlan } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'Лето' })).id;
  const { set } = await saveSetPlan({ collection: c, plan: lakePlan(), store, keepVersions: 3 });
  const provider = fakeProvider();
  const r = await fillPlace({ collection: c, set: set.id, slot: 4, settings: SETTINGS, provider, store, model: async () => { throw new Error('текстовая модель не нужна'); } });
  assert.deepEqual(r.errors, []);
  const after = await store.getSet(c, set.id);
  assert.equal(after.slots[4], r.card);
  assert.equal(after.slots.filter(Boolean).length, 1, 'сделано только это место');
  const made = (await store.listCards(c, { setId: set.id }))[0];
  assert.equal(made.title, lakePlan().slots[4].order.title);
  // the person moved that card to place 6: place 5 gets the order left without a place of its own — place 6's
  await store.moveCard(c, made.id, { setId: set.id, slot: 5 });
  const again = await fillPlace({ collection: c, set: set.id, slot: 4, settings: SETTINGS, provider, store });
  assert.deepEqual(again.errors, []);
  const now = await store.getSet(c, set.id);
  assert.equal(now.slots[5], made.id);
  assert.equal((await store.listCards(c, { setId: set.id })).find(x => x.id === now.slots[4])?.title, lakePlan().slots[5].order.title);
});

test('planFor: пустому месту — заказ своего слота, если по нему ещё нет карточки; иначе первый несделанный', async () => {
  const { planFor } = await import('../core/set/places.js');
  const { normalizePlan } = await import('../core/set/plan.js');
  const plan = lakePlan();
  const ids = normalizePlan(plan).plan.slots.map((/** @type {any} */ x) => x.order.id);
  const orderIds = new Map(ids.map((id, j) => [`card-${j}`, id]));
  // places 0 and 2 empty; place 1 holds the card of plan slot 0, place 3 an outside card
  const slots = [null, 'card-0', null, 'own', ...ids.slice(4).map((_, k) => `card-${k + 4}`)];
  assert.deepEqual(planFor({ slots, plan }, orderIds).slice(0, 4), [1, null, 2, null]);
  assert.deepEqual(planFor({ slots: Array(10).fill(null) }, orderIds), Array(10).fill(null), 'набор без плана');
  const full = ids.map((_, j) => `card-${j}`);
  full[3] = null;
  assert.equal(planFor({ slots: full, plan }, orderIds)[3], 3);
});

test('обложка коллекции: выбранная карточка, иначе первая; чужая карточка — отказ', async t => {
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'Лето' })).id;
  writeCard(store, c, 'a');
  writeCard(store, c, 'b');
  const cover = async () => (await store.listCollections())[0].cover;
  assert.equal(await cover(), store.cardDir(c, 'a') + path.sep + 'card.png');
  await store.updateCollection(c, { cover: 'b' });
  assert.equal(await cover(), store.cardDir(c, 'b') + path.sep + 'card.png');
  assert.equal((await store.getCollection(c)).collection.cover, 'b');
  await assert.rejects(store.updateCollection(c, { cover: 'nope' }), /Обложка — карточка этой коллекции/);
  await store.deleteCard(c, 'b');
  assert.equal(await cover(), store.cardDir(c, 'a') + path.sep + 'card.png', 'карточки обложки нет — первая');
  await store.updateCollection(c, { cover: null });
  assert.equal((await store.getCollection(c)).collection.cover, null);
});
