// Making a set from its plan (core/set/make.js) with the real card loop, a store over a temporary folder and a fake
// image provider (no network, no key); the sheet of the set. Needs the installed packages (sharp).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { lakePlan, tagged, withReview } from './set-fixtures.mjs';
import { tempStore } from './store-helpers.mjs';

const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp/package.json'));
const skip = !hasSharp && 'пакеты не установлены (node tools/setup.mjs): нет node_modules/sharp';

const SETTINGS = /** @type {any} */ ({ card: { attempts: 3, maxSpendUsd: 0.2, tuneProcessing: false }, processing: {}, set: { parallel: 3, maxSpendUsd: 2, cards: { maxCount: 10 } }, provider: { preset: 'openrouter', openrouter: { textModel: 'text-model' } } });
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

test('makeSet: потолок набора меньше, чем parallel × потолок карточки — карточки ждут освободившийся бюджет, а не идут с нулём', async t => {
  const { makeSet } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  /** @type {number[]} */
  const caps = [];
  let running = 0, most = 0;
  // free images, a paid look (as Codex with a key): each card spends 0.01 of its cap
  const makeCard = /** @type {any} */ (async (/** @type {any} */ o) => {
    caps.push(o.limits.maxSpendUsd);
    most = Math.max(most, ++running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    return { id: `card-${o.place.slot + 1}`, spent: 0.01, attempts: [{ cost: 0 }], chosenCheck: { blocking: 0 }, image: 'x.png', stop: 'passed' };
  });
  const provider = /** @type {any} */ ({ model: 'codex-cli', free: true, generate: async () => { throw new Error('не должен вызываться'); } });
  const r = await makeSet({ collection, plan: lakePlan(), settings: SETTINGS, provider, store, makeCard, limits: { parallel: 4, maxSpendUsd: 0.5 } });
  assert.deepEqual(r.slots.map(s => s.result), Array(10).fill('made'));
  assert.ok(caps.every(c => c > 0), `потолки карточек: ${caps.join(', ')}`);
  assert.ok(most <= 3, `одновременно ${most}: бюджета хватает на 2,5 карточки`);
  assert.ok(Math.abs(r.spent - 0.1) < 1e-9);
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
  const r = await planSetInto({ collection, theme: 'Рыбалка на озере', scenes: 2, settings, store, model: withReview(async () => ({ text: answer, cost: 0.002 })), progress: (_, e) => { if (e) events.push(e); } });
  assert.deepEqual(r.plans[0].errors, []);
  const set = await store.getSet(collection, /** @type {string} */ (r.plans[0].set));
  assert.equal(/** @type {any} */ (set.plan).title, 'Lake Fishing');
  assert.deepEqual(set.slots, Array(10).fill(null));
  assert.deepEqual(events.map(e => e.status), ['planning', 'planned']);
  // the same plan again clashes with the saved set: not saved, errors returned
  const again = await planSetInto({ collection, theme: 'Рыбалка', scenes: 2, settings, store, model: withReview(async () => ({ text: answer, cost: 0.002 })) });
  assert.ok(!again.plans[0].set && again.plans[0].errors.some(e => /уже есть в наборе/.test(e)));
  assert.equal((await store.spend({ collectionId: collection })).text, 0.004, 'оба плана записаны в расходы коллекции');

  const themes = Array.from({ length: 16 }, (_, i) => ({ title: `Theme ${i + 1}`, kind: 'place', angle: `angle ${i + 1}`, examples: [] }));
  let n = 0;
  const model = withReview(async () => ({ text: n++ ? answer : JSON.stringify({ sets: themes }), cost: 0.001 }));
  const c = await planCollectionInto({ title: 'Новая', theme: 'Summer', only: [10], settings, store, model });
  assert.notEqual(c.collection, collection);
  assert.equal(c.sets.length, 1);
  assert.equal(c.sets[0].number, 10);
  const saved = await store.getSet(c.collection, /** @type {string} */ (c.sets[0].set));
  assert.equal(saved.number, 10);
  assert.equal((await store.getCollection(c.collection)).collection.description, 'Summer');
  assert.equal((await store.spend({ collectionId: c.collection })).text, 0.002, 'план коллекции — в её расходах');
});

/** A plan as the model answers it. @param {any} plan */
const answerOf = plan => JSON.stringify({ title: plan.title, angle: plan.angle, cards: plan.slots.map((/** @type {any} */ s, /** @type {number} */ i) => ({ slot: i + 1, kind: s.kind, caption: s.order.title, hue: s.hue, props: s.props, ...Object.fromEntries(Object.entries(s.order).filter(([k]) => !['title', 'style'].includes(k))) })) });
const SPLIT = JSON.stringify({ sets: Array.from({ length: 16 }, (_, i) => ({ title: `Theme ${i + 1}`, kind: 'place', angle: `angle ${i + 1}`, examples: [] })) });
const PLAN_SETTINGS = /** @type {any} */ ({ ...SETTINGS, set: { ...SETTINGS.set, plan: { repairs: 1, maxSpendUsd: 1 } } });

test('планирование без разбираемого плана не падает: готовое до него сохранено, расход записан', async t => {
  const { planSetInto, planCollectionInto } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  // a set of 3 variants whose first variant never parses: no TypeError, the next variants are planned and saved
  let n = 0;
  const answers = ['not a plan', 'still not', answerOf(tagged('Beta')), answerOf(tagged('Gamma'))];
  const r = await planSetInto({ collection, theme: 'Lake', scenes: 2, variants: 3, settings: PLAN_SETTINGS, store, model: withReview(async () => ({ text: answers[n++], cost: 0.05 })) });
  assert.deepEqual(r.plans.map(p => [p.plan?.title ?? null, !!p.set]), [[null, false], ['Lake Beta', true], ['Lake Gamma', true]]);
  assert.match(r.plans[0].errors[0], /не JSON/);
  assert.ok(Math.abs((await store.spend({ collectionId: collection })).text - 0.2) < 1e-9, 'все 4 оплаченных вызова в расходах');
  // a collection where one set never parses: the sets before it are saved, the spend recorded
  const c = (await store.createCollection({ title: 'Осень' })).id;
  let m = 0;
  const seq = [SPLIT, answerOf(tagged('Delta')), 'nope', 'nope'];
  const col = await planCollectionInto({ collection: c, theme: 'Autumn', only: [10, 12], settings: PLAN_SETTINGS, store, model: withReview(async () => ({ text: seq[m++], cost: 0.01 })) });
  assert.deepEqual(col.sets.map(s => [s.number ?? null, !!s.set]), [[10, true], [null, false]]);
  assert.equal((await store.getCollection(c)).sets.length, 1);
  assert.ok(Math.abs((await store.spend({ collectionId: c })).text - 0.04) < 1e-9);
});

test('потолок планирования и «Остановить»: готовые планы сохранены, потраченное записано', async t => {
  const { planSetInto, planCollectionInto } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  // the cap: two paid calls of $0.10 reach the $0.20 of set.plan; the third variant is refused
  let n = 0;
  const variants = [answerOf(tagged('Alpha')), answerOf(tagged('Beta')), answerOf(tagged('Gamma'))];
  const capped = await planSetInto({ collection, theme: 'Lake', scenes: 2, variants: 3, maxSpendUsd: 0.2, settings: PLAN_SETTINGS, store, model: withReview(async () => ({ text: variants[n++], cost: 0.1 })) });
  assert.match(String(capped.stopped), /Планирование остановлено: потрачено \$0\.2000 при потолке \$0\.2/);
  assert.deepEqual(capped.plans.map(p => !!p.set), [true, true]);
  assert.ok(Math.abs((await store.spend({ collectionId: collection })).text - 0.2) < 1e-9);
  // a collection over its cap: the cap counts the whole run, the sets before it stay
  const c = (await store.createCollection({ title: 'Осень' })).id;
  let m = 0;
  const seq = [SPLIT, answerOf(tagged('Delta')), answerOf(tagged('Eps'))];
  const col = await planCollectionInto({ collection: c, theme: 'Autumn', only: [10, 12], maxSpendUsd: 0.2, settings: PLAN_SETTINGS, store, model: withReview(async () => ({ text: seq[m++], cost: 0.1 })) });
  assert.match(String(col.stopped), /при потолке \$0\.2/);
  assert.deepEqual(col.sets.map(s => s.number), [10]);
  assert.ok(Math.abs((await store.spend({ collectionId: c })).text - 0.2) < 1e-9);
  // the signal: stopped after the first variant, no further call
  const ac = new AbortController();
  let calls = 0;
  const stopped = await planSetInto({ collection, theme: 'Lake 2', scenes: 2, variants: 3, settings: PLAN_SETTINGS, store, signal: ac.signal,
    model: async () => { calls++; ac.abort(); return { text: answerOf(tagged('Zeta')), cost: 0.01 }; } });
  assert.equal(calls, 1);
  assert.match(String(stopped.stopped), /остановлено по просьбе/);
  assert.equal(stopped.plans.filter(p => p.set).length, 1);
});

/** A fake card loop that spends the whole cap it is given; records the set of each call. @param {string[]} seen */
const spendingMakeCard = seen => /** @type {any} */ (async (/** @type {any} */ o) => {
  seen.push(o.place.setId);
  return { id: `${o.place.setId}-${o.place.slot}`, spent: o.limits.maxSpendUsd, attempts: [{ cost: 0.05 }], chosenCheck: { blocking: 0 }, image: 'x.png', stop: 'passed' };
});

test('buildSet: потолок набора держится для каждого варианта, а весь запуск — не больше показанной суммы', async t => {
  const { buildSet } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const settings = /** @type {any} */ ({ ...PLAN_SETTINGS, set: { ...PLAN_SETTINGS.set, maxSpendUsd: 0.3 } });
  const provider = /** @type {any} */ ({ model: 'm', generate: async () => { throw new Error('не должен вызываться'); } });
  const model = () => { let n = 0; const a = ['Alpha', 'Beta', 'Gamma'].map(x => answerOf(tagged(x))); return withReview(async () => ({ text: a[n++ % 3], cost: 0.01 })); };
  /** @type {string[]} */
  const seen = [];
  const r = await buildSet({ collection, theme: 'Lake', scenes: 2, variants: 3, settings, provider, store, model: model(), makeCard: spendingMakeCard(seen) });
  assert.equal(r.sets.length, 3);
  assert.equal(r.maxSpendUsd, 0.9, 'по умолчанию: потолок набора × наборы');
  for (const s of r.sets) assert.ok(s.spent <= 0.3 + 1e-9 && s.spent > 0, `вариант потратил ${s.spent}`);
  assert.ok(r.spent - 0.03 <= 0.9 + 1e-9);
  // an explicit cap of the run holds across the variants: the third finds nothing left
  const again = (await store.createCollection({ title: 'Осень' })).id;
  const capped = await buildSet({ collection: again, theme: 'Lake', scenes: 2, variants: 3, maxSpendUsd: 0.5, settings, provider, store, model: model(), makeCard: spendingMakeCard([]) });
  assert.ok(capped.sets.reduce((x, s) => x + s.spent, 0) <= 0.5 + 1e-9);
  assert.equal(capped.skipped.length, 1);
  assert.match(capped.warnings.join('\n'), /исчерпан общий потолок расходов запуска/);
});

test('buildCollection: в коллекции с наборами планируются только недостающие места, их номера сохраняются, старые наборы не трогаются', async t => {
  const { buildCollection, missingPlaces } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  // 14 places taken (one of them by two variants), 10 and 12 free
  const taken = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16];
  for (const number of taken) await store.createSet(collection, { title: `Old ${number}`, number });
  await store.createSet(collection, { title: 'Old 3 v2', number: 3 });
  assert.deepEqual(missingPlaces((await store.getCollection(collection)).sets, 16), [10, 12]);
  /** @type {string[]} */
  const prompts = [];
  const seq = [SPLIT, answerOf(tagged('Alpha')), answerOf(tagged('Beta'))];
  const model = withReview(async (/** @type {any[]} */ m) => { prompts.push(m.at(-1).content); return { text: /** @type {string} */ (seq[prompts.length - 1]), cost: 0.01 }; });
  /** @type {string[]} */
  const seen = [];
  const provider = /** @type {any} */ ({ model: 'm', generate: async () => { throw new Error('не должен вызываться'); } });
  const r = await buildCollection({ collection, theme: 'Summer', settings: PLAN_SETTINGS, provider, store, model, makeCard: spendingMakeCard(seen) });
  assert.equal(prompts.length, 3, 'разбиение темы и два набора');
  assert.deepEqual(r.plan.sets.map(s => s.number), [10, 12]);
  const sets = (await store.getCollection(collection)).sets;
  assert.equal(sets.length, 17);
  const fresh = r.plan.sets.map(s => /** @type {string} */ (s.set));
  assert.deepEqual(fresh.map(id => sets.find(s => s.id === id)?.number), [10, 12]);
  assert.deepEqual([...new Set(seen)].sort(), [...fresh].sort(), 'карточки — только новых наборов');
  assert.deepEqual(r.made.skipped, []);
  assert.equal(r.maxSpendUsd, 4, 'два набора × $2');
  // every place taken: nothing to plan, no paid call
  prompts.length = 0;
  await assert.rejects(buildCollection({ collection, theme: 'Summer', settings: PLAN_SETTINGS, provider, store, model, makeCard: spendingMakeCard([]) }), /уже все 16 наборов/);
  assert.equal(prompts.length, 0);
});

test('buildCollection, mode variants: ещё по варианту каждого места — тот же номер и группа, ничего не заменено', async t => {
  const { buildCollection, saveSetPlan } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const a = (await saveSetPlan({ collection, plan: { ...tagged('Alpha'), number: 10 }, store })).set;
  const b = (await saveSetPlan({ collection, plan: { ...tagged('Beta'), number: 12 }, store })).set;
  /** @type {string[]} */
  const prompts = [];
  const seq = [answerOf(tagged('Gamma')), answerOf(tagged('Delta'))];
  const model = withReview(async (/** @type {any[]} */ m) => { prompts.push(m.at(-1).content); return { text: /** @type {string} */ (seq[prompts.length - 1]), cost: 0.01 }; });
  /** @type {string[]} */
  const seen = [];
  const provider = /** @type {any} */ ({ model: 'm', generate: async () => { throw new Error('не должен вызываться'); } });
  const r = await buildCollection({ collection, theme: 'Summer', mode: 'variants', only: [10, 12], settings: PLAN_SETTINGS, provider, store, model, makeCard: spendingMakeCard(seen) });
  assert.equal(prompts.length, 2, 'темы делить не нужно: у обоих мест уже есть набор');
  assert.match(prompts[0], /This is variant 2 of the set/);
  assert.match(prompts[0], /theme "Рыбалка на озере"/, 'тема варианта — тема набора этого места');
  assert.deepEqual(r.plan.sets.map(s => [s.number, !!s.set]), [[10, true], [12, true]]);
  const sets = (await store.getCollection(collection)).sets;
  const fresh = r.plan.sets.map(s => /** @type {any} */ (sets.find(x => x.id === s.set)));
  assert.deepEqual(fresh.map(s => [s.number, s.variantGroup]), [[10, a.variantGroup], [12, b.variantGroup]]);
  assert.equal(/** @type {any} */ ((await store.getSet(collection, a.id)).plan).title, 'Lake Alpha', 'старый набор цел');
  assert.deepEqual([...new Set(seen)].sort(), fresh.map(s => s.id).sort(), 'карточки — только новых вариантов');
  await assert.rejects(buildCollection({ collection, theme: 'Summer', mode: /** @type {any} */ ('all'), settings: PLAN_SETTINGS, provider, store, model, makeCard: spendingMakeCard([]) }), /missing.*variants/);
});

test('saveSetPlan с set: прежний план уходит в planVersions, хранится не больше keepVersions', async t => {
  const { saveSetPlan } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const set = (await saveSetPlan({ collection, plan: tagged('One'), store })).set.id;
  for (const tag of ['Two', 'Three', 'Four']) await saveSetPlan({ collection, plan: tagged(tag), set, store, keepVersions: 2 });
  const saved = /** @type {any} */ (await store.getSet(collection, set));
  assert.equal(saved.plan.title, 'Lake Four');
  assert.deepEqual(saved.planVersions.map((/** @type {any} */ v) => v.plan.title), ['Lake Three', 'Lake Two']);
  assert.ok(saved.planVersions.every((/** @type {any} */ v) => typeof v.at === 'string'));
});

test('ключ не принят или кончились деньги: новые карточки не начинаются, готовое сохранено, одно понятное сообщение', async t => {
  const { buildSet, planSetInto } = await import('../core/set/make.js');
  const { makeCardsInto } = await import('../core/set/cards.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const keyProblem = { kind: 'billing', message: 'С ключом проблема: на счёте сервиса кончились деньги. Пополните счёт или замените ключ и запустите снова.' };
  let calls = 0;
  // the first card stops on the key; nothing else starts, in this set or the next variant
  const makeCard = /** @type {any} */ (async (/** @type {any} */ o) => {
    calls++;
    const id = o.place ? `${o.place.setId}-${o.place.slot}` : `pool-${calls}`;
    return calls === 1
      ? { id, spent: 0.04, attempts: [{ cost: 0.04 }], chosenCheck: null, image: null, stop: 'key', keyProblem }
      : { id, spent: 0.04, attempts: [{ cost: 0.04 }], chosenCheck: { blocking: 0 }, image: 'x.png', stop: 'passed' };
  });
  let n = 0;
  const answers = [answerOf(tagged('Alpha')), answerOf(tagged('Beta'))];
  const provider = /** @type {any} */ ({ model: 'm', generate: async () => { throw new Error('не должен вызываться'); } });
  const settings = /** @type {any} */ ({ ...PLAN_SETTINGS, set: { ...PLAN_SETTINGS.set, parallel: 1 } });
  const r = await buildSet({ collection, theme: 'Lake', scenes: 2, variants: 2, settings, provider, store, makeCard, model: withReview(async () => ({ text: answers[n++], cost: 0.01 })) });
  assert.equal(calls, 1);
  assert.equal(r.warnings[0], `${keyProblem.message} Готовое сохранено.`);
  assert.equal(r.keyProblem?.kind, 'billing');
  assert.deepEqual(r.sets[0].slots.slice(1).map(s => s.result), Array(9).fill('cancelled'));
  assert.equal(r.sets.length, 1, 'второй вариант не начат');
  assert.equal(r.skipped.length, 1);
  assert.equal((await store.getCollection(collection)).sets.length, 2, 'оба плана сохранены');
  // the text model refuses the key: planning stops with the same kind of message, the spend before it recorded
  const billing = Object.assign(new Error('HTTP 402: insufficient credits'), { kind: 'billing' });
  let m = 0;
  const p = await planSetInto({ collection, theme: 'Lake 2', scenes: 2, variants: 2, settings, store,
    model: withReview(async () => { if (m++) throw billing; return { text: answerOf(tagged('Gamma')), cost: 0.01 }; }) });
  assert.match(String(p.stopped), /^С ключом проблема: на счёте сервиса кончились деньги/);
  assert.equal(p.keyProblem?.kind, 'billing');
  assert.equal(p.plans.filter(x => x.set).length, 1);
  await assert.rejects(buildSet({ collection, theme: 'Lake 3', scenes: 2, settings, provider, store, makeCard, model: async () => { throw billing; } }), /^Error: С ключом проблема/);
  // loose cards: the same stop
  calls = 0;
  const loose = await makeCardsInto({ collection, theme: 'Рыбалка', count: 3, settings, store, makeCard, provider, model: async () => ({ text: looseAnswer(3, 0), cost: 0.001 }) });
  assert.deepEqual(loose.cards.map(c => c.result), ['made', 'cancelled', 'cancelled']);
  assert.equal(loose.warnings[0], `${keyProblem.message} Готовое сохранено.`);
});

// ---------- loose cards into the pool (core/set/cards.js) ----------

/** The lake plan's cards as a loose-card answer: the first `items` item cards and the scenes. */
function looseAnswer(/** @type {number} */ items, /** @type {number} */ scenes) {
  const plan = lakePlan();
  const pick = [...plan.slots.slice(0, items), ...plan.slots.slice(8, 8 + scenes)];
  return JSON.stringify({ cards: pick.map((/** @type {any} */ s, /** @type {number} */ i) => ({ slot: i + 1, kind: s.kind, caption: s.order.title, hue: s.hue, props: s.props, ...Object.fromEntries(Object.entries(s.order).filter(([k]) => !['title', 'style'].includes(k))) })) });
}

test('planCards: запрос без окна из фрагментов SETS.md; число карточек и сцен проверяется, ошибки уходят модели', async () => {
  const { planCards, validateCards, cardsFromAnswer } = await import('../core/set/cards.js');
  /** @type {any[][]} */
  const seen = [];
  const answers = [looseAnswer(3, 0), looseAnswer(4, 1)];
  const model = async (/** @type {any[]} */ m) => { seen.push(structuredClone(m)); return { text: /** @type {string} */ (answers.shift()), cost: 0.001 }; };
  const r = await planCards({ style: 'scapes', theme: 'Рыбалка', wishes: 'утро', count: 5, scenes: 1, model, limits: { repairs: 1, maxSpendUsd: 1, maxCount: 10 } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.calls, 2);
  assert.equal(r.spent, 0.002);
  assert.equal(r.cards.length, 5);
  assert.equal(r.cards[0].order.id, 'fishing-bobber', 'id карточки — из английского имени предмета');
  assert.equal(r.cards[0].order.staging.backdrop, 'field', 'заготовка постановки раскрыта');
  const prompt = seen[0][1].content;
  assert.match(prompt, /Plan 5 loose collectible cards on the theme "Рыбалка"/);
  assert.match(prompt, /4 of them are item cards without characters, then 1 scenes/);
  assert.match(prompt, /Assign each non-character card a staging category/);
  assert.match(prompt, /Write 1 short scenes/);
  assert.match(prompt, /утро\nCarry them into the cards/);
  assert.doesNotMatch(prompt, /\[(set theme|registry|N|language)\]|\{(count|theme|items|scenes)\}/);
  assert.match(seen[1].at(-1).content, /нужно ровно 5 карточек, а их 3/);
  assert.ok(r.warnings.some(w => /пожелания набора/.test(w)), 'пожелания без wishes у карточек — предупреждение');
  // the same kind twice and a category the staging does not give are errors, a missing category only a warning
  const two = JSON.parse(looseAnswer(2, 0)).cards;
  const twice = validateCards(cardsFromAnswer({ cards: [...two, two[0]] }, { style: 'scapes' }), { style: 'scapes', count: 3, scenes: 0 });
  assert.ok(twice.errors.some(e => /вид предмета «fishing bobber» повторяется/.test(e)), twice.errors.join('\n'));
  const lake = JSON.parse(looseAnswer(8, 0)).cards;
  const mix = validateCards(cardsFromAnswer({ cards: [0, 1, 4, 5].map(i => lake[i]) }, { style: 'scapes' }), { style: 'scapes', count: 4, scenes: 0 });
  assert.deepEqual(mix.errors, []);
  assert.ok(mix.warnings.some(w => /нет категори/.test(w)), mix.warnings.join('\n'));
  await assert.rejects(planCards({ style: 'scapes', theme: 't', count: 2, scenes: 3, model, limits: { repairs: 0, maxSpendUsd: 1, maxCount: 10 } }), /Сцен с персонажами/);
  await assert.rejects(planCards({ style: 'scapes', theme: 't', count: 11, model, limits: { repairs: 0, maxSpendUsd: 1, maxCount: 10 } }), /от 1 до 10 за один запуск/);
  await assert.rejects(planCards({ style: 'scapes', theme: 't', count: 2, model: async () => ({ text: '{}', cost: null }), limits: { repairs: 0, maxSpendUsd: 1, maxCount: 10 } }), /не сообщила цену/);
});

test('makeCardsInto: план от модели, карточки — в хранилище коллекции, расход плана записан как текст', async t => {
  const { makeCardsInto } = await import('../core/set/cards.js');
  const { store } = tempStore(t);
  const settings = /** @type {any} */ ({ ...SETTINGS, set: { ...SETTINGS.set, plan: { repairs: 0, maxSpendUsd: 1 } } });
  const collection = (await store.createCollection({ title: 'Лето', description: 'Summer' })).id;
  /** @type {any[]} */
  const calls = [];
  const make = /** @type {any} */ (async (/** @type {any} */ o) => { calls.push(o); return { id: o.order.id, spent: 0, attempts: [], chosenCheck: { blocking: 0 }, image: null, stop: 'passed' }; });
  let prompt = '';
  const r = await makeCardsInto({
    collection, theme: 'Рыбалка', count: 2, settings, store, makeCard: make, provider: /** @type {any} */ ({ model: 'codex-cli', free: true }),
    model: async (/** @type {any[]} */ m) => { prompt = m[1].content; return { text: looseAnswer(2, 0), cost: 0.003 }; },
  });
  assert.deepEqual(r.plan.errors, []);
  assert.match(prompt, /within the collection "Summer"/);
  assert.deepEqual(r.cards.map(c => c.result), ['made', 'made']);
  assert.ok(calls.every(c => c.collection === collection && c.place === undefined), 'в хранилище, не в набор');
  assert.equal(r.planSpent, 0.003);
  assert.equal((await store.spend({ collectionId: collection })).text, 0.003);
  // a plan with errors makes nothing
  const bad = await makeCardsInto({ collection, theme: 'Рыбалка', count: 3, settings, store, makeCard: make, provider: /** @type {any} */ ({ model: 'codex-cli', free: true }), model: async () => ({ text: looseAnswer(2, 0), cost: 0.001 }) });
  assert.ok(bad.plan.errors.length && !bad.cards.length);
  assert.equal(calls.length, 2);
});

test('saveSetPlan с set: план существующего набора заменяется, с ошибками — отказ и старый план цел', { skip }, async t => {
  const { saveSetPlan } = await import('../core/set/make.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const first = await saveSetPlan({ collection, plan: lakePlan(), store });
  const next = lakePlan();
  next.angle = 'a new angle: from the shore to the dock';
  const r = await saveSetPlan({ collection, plan: next, set: first.set.id, store });
  assert.equal(r.set.id, first.set.id);
  assert.equal((await store.getCollection(collection)).sets.length, 1, 'нового набора нет');
  assert.equal(/** @type {any} */ ((await store.getSet(collection, first.set.id)).plan).angle, next.angle);
  const broken = lakePlan();
  broken.slots.pop();
  await assert.rejects(saveSetPlan({ collection, plan: broken, set: first.set.id, store }), /не прошёл проверку/);
  assert.equal(/** @type {any} */ ((await store.getSet(collection, first.set.id)).plan).angle, next.angle);
});

test('card prompt: заказ из плана набора (постановка-пресет, без id) принимается; set save знает --set', { skip }, async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const ccf = (/** @type {string[]} */ ...a) => spawnSync(process.execPath, [path.join(ROOT, 'ccf.mjs'), ...a], { cwd: ROOT, encoding: 'utf8' });
  const order = lakePlan().slots[0].order;
  assert.equal(order.id, undefined);
  assert.equal(order.staging.preset, 'field');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-prompt-'));
  try {
    const file = path.join(dir, 'order.json');
    fs.writeFileSync(file, JSON.stringify(order));
    const r = ccf('card', 'prompt', file, '--json');
    assert.equal(r.status, 0, r.stderr);
    const expanded = (await import('../core/set/plan.js')).normalizePlan(lakePlan()).plan.slots[0].order;
    const { buildPrompt } = await import('../core/style/prompt.js');
    assert.equal(JSON.parse(r.stdout).prompt, (await buildPrompt(expanded)).prompt);
    fs.writeFileSync(file, JSON.stringify({ ...order, staging: { preset: 'no-such' } }));
    assert.notEqual(ccf('card', 'prompt', file).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(ccf('set', 'save', '--help').stdout, /--set SET_ID/);
});

test('оплаченный, но бесполезный ответ текстовой модели (ошибка с ценой) записан в расход: план набора и «Создать карточки»', async t => {
  const { planSetInto } = await import('../core/set/make.js');
  const { makeCardsInto } = await import('../core/set/cards.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  const paid = Object.assign(new Error('Провайдер ответил без текста.'), { cost: 0.03 });
  let n = 0;
  const r = await planSetInto({ collection, theme: 'Lake', scenes: 2, variants: 2, settings: PLAN_SETTINGS, store,
    model: withReview(async () => { if (n++) throw paid; return { text: answerOf(tagged('Alpha')), cost: 0.01 }; }) });
  assert.match(String(r.stopped), /без текста/);
  assert.equal(r.plans.filter(p => p.set).length, 1);
  assert.ok(Math.abs((await store.spend({ collectionId: collection })).text - 0.04) < 1e-9, 'и удачный вызов, и оплаченная ошибка');
  const other = (await store.createCollection({ title: 'Осень' })).id;
  let m = 0;
  const settings = /** @type {any} */ ({ ...PLAN_SETTINGS, set: { ...PLAN_SETTINGS.set, plan: { ...PLAN_SETTINGS.set.plan, repairs: 1 } } });
  await assert.rejects(makeCardsInto({ collection: other, theme: 'Рыбалка', count: 3, settings, store, provider: /** @type {any} */ ({ model: 'codex-cli', free: true }),
    model: async () => { if (m++) throw paid; return { text: '{"cards": []}', cost: 0.002 }; } }), /без текста/);
  assert.ok(Math.abs((await store.spend({ collectionId: other })).text - 0.032) < 1e-9);
});

test('шаги цикла карточки идут в ход работы набора и свободных карточек: попытка и её стадия у строки карточки', async t => {
  const { makeSet } = await import('../core/set/make.js');
  const { makeCardsInto } = await import('../core/set/cards.js');
  const { store } = tempStore(t);
  const collection = (await store.createCollection({ title: 'Лето' })).id;
  // a card loop that fails once and makes it on the second attempt
  const makeCard = /** @type {any} */ (async (/** @type {any} */ o) => {
    o.onProgress?.({ stage: 'generate', n: 1, done: 0, of: 3, spent: 0 });
    o.onProgress?.({ stage: 'generate', n: 2, done: 1, of: 3, spent: 0.04 });
    return { id: o.place ? `c-${o.place.slot}` : 'loose', spent: 0.08, attempts: [{ cost: 0.04 }, { cost: 0.04 }], chosenCheck: { blocking: 0 }, image: 'x.png', stop: 'passed' };
  });
  const provider = /** @type {any} */ ({ model: 'm', free: true, generate: async () => { throw new Error('не должен вызываться'); } });
  /** @type {any[]} */
  const events = [];
  await makeSet({ collection, plan: lakePlan(), settings: SETTINGS, provider, store, makeCard, only: [1], limits: { parallel: 1 }, progress: (_, e) => { if (e) events.push(e); } });
  const second = events.find(e => e.attempt?.n === 2);
  assert.deepEqual({ slot: second.slot, status: second.status, spent: second.spent, attempt: second.attempt }, { slot: 1, status: 'start', spent: 0.04, attempt: { stage: 'generate', n: 2, done: 1, of: 3 } });
  assert.equal(typeof second.title, 'string');
  /** @type {any[]} */
  const loose = [];
  await makeCardsInto({ collection, theme: 'Рыбалка', count: 1, settings: PLAN_SETTINGS, store, makeCard, provider, model: async () => ({ text: looseAnswer(1, 0), cost: 0.001 }), progress: (_, e) => { if (e) loose.push(e); } });
  assert.ok(loose.some(e => e.attempt?.n === 2 && e.status === 'start' && e.title), JSON.stringify(loose));
});
