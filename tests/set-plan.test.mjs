// Set plans (core/set): the style's set rules as data, plan validation by SETS.md, and planning with a fake text
// model (no network, no key).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { lakePlan } from './set-fixtures.mjs';
import { parseFragments } from '../core/style/fragments.js';
import { checkOrder } from '../core/style/card-order.js';
import { expandStaging, kindKey, loadSetRules, stagingRow, windowSkeleton } from '../core/set/rules.js';
import { normalizePlan, registryOf, validateCollection, validatePlan } from '../core/set/plan.js';
import { parseAnswer, planCollection, planFromAnswer, planSet, setPrompt } from '../core/set/planner.js';

const { rules, style } = loadSetRules('scapes');
const SETS = fs.readFileSync(path.join(ROOT, 'styles/scapes/SETS.md'), 'utf8');

/** @param {any} plan @param {object} [ctx] */
const errorsOf = (plan, ctx) => validatePlan(plan, ctx).errors;
/** @param {string[]} errors @param {RegExp} re */
const has = (errors, re) => assert.ok(errors.some(e => re.test(e)), `нет ошибки ${re}:\n${errors.join('\n')}`);

// ---------- the rules ----------

test('SETS.md: каждый фрагмент раздела «Для промпта (англ.)» помечен, правила набора называют существующие', () => {
  const section = SETS.slice(SETS.search(/^## \d+\. Для промпта \(англ\.\)/m));
  const spans = section.split('\n## ')[0].split('\n').filter(l => l.startsWith('- ') && l.includes('`'));
  assert.ok(spans.length >= 6);
  for (const l of spans) assert.match(l, /<!-- fragment: set\.[a-z-]+ -->`/, l);
  const ids = new Set(parseFragments(SETS, 'SETS.md').map(f => f.id));
  for (const id of Object.values(rules.prompt.fragments)) assert.ok(ids.has(id), id);
});

test('правила набора: каждая заготовка постановки собирается стилем и узнаётся своей строкой', () => {
  /** @type {Record<string, Record<string, unknown>>} */
  const fill = {
    scene: { characters: 1, time: 'day', sky_top: true }, 'full-frame': { surface: 'wood', material: 'wood' },
    wall: { category: 2, wall: 'stripes', pattern: 'stripes_straight', stripes: 'vertical', material: 'metal' },
    native: { medium: 'sky', time: 'day', sky_top: true, material: 'metal' }, field: { pattern: 'rays', material: 'metal' },
    environment: { setting: 'outdoor', material: 'wood' },
    'floor-or-furniture': { wall: 'stripes', floor: 'wood', pattern: 'stripes_straight', stripes: 'vertical', material: 'wood' },
    'surface-patch': { surface: 'grass', pattern: 'rings', material: 'wood' }, 'smooth-floor': { pattern: 'plain_gradient', material: 'wood' },
  };
  for (const row of rules.stagings) {
    const { staging, error } = expandStaging({ preset: row.id, ...fill[row.id] }, rules);
    assert.equal(error, undefined);
    /** @type {any} */
    const order = { id: 'x', style: 'scapes', title: 'X', place: 'lake', environment: 'a lake', staging };
    if (row.id === 'scene') order.scene = { theme: 't', time: 'at noon', action: 'fish', item: 'rod', joke: 'j', reactor: 'the Man', jokeObject: 'boot', crop: 'waist', characters: [{ name: 'man', costume: 'A hat.' }] };
    else Object.assign(order, { subject: 'a red thing.', object: 'thing' });
    assert.deepEqual(checkOrder(order, style), [], row.id);
    assert.equal(stagingRow(order, rules, style), row.id);
  }
  for (const ref of style.references) assert.notEqual(stagingRow(/** @type {any} */ ({ staging: ref.staging }), rules, style), 'other', `эталон №${ref.ref}`);
});

test('правила набора: окна дают звёзды, рамки и места сцен эталона', () => {
  const sk = (/** @type {string} */ w, /** @type {number} */ n) => windowSkeleton(rules, w, n).map(s => `${s.stars}${s.frame[0]}${s.scene ? '*' : ''}`).join(' ');
  assert.equal(sk('large', 3), '1s 1s 2s 2s 3s 3s 4s 4g* 5g* 5g*');
  assert.equal(sk('small-gold-characters', 1), '1s 1s 1s 1s 1s 1s 1s 2s 3s 5g*');
  assert.equal(sk('small-gold-items', 0), '1s 1s 1s 1s 1s 1s 2s 5g 5g 5g');
  assert.equal(sk('grand', 10), Array(10).fill('5c*').join(' '));
  assert.throws(() => windowSkeleton(rules, 'large', 1), /допускает сцен/);
  assert.equal(kindKey('A Fishing Rods'), kindKey('fishing rod'));
});

// ---------- validation ----------

test('план: верный план набора проходит; заготовки раскрываются, id выдаются', () => {
  const { errors, warnings, plan } = validatePlan(lakePlan());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(plan.slots[0].order.staging.category, 1);
  assert.match(plan.slots[0].order.id, /^lake-fishing-1-bobber$/);
});

test('план: окно — звёзды, хвост сцен, золото', () => {
  const p = lakePlan();
  p.slots[0].stars = 2;
  has(errorsOf(p), /звёзды окна large — ровно 1 1 2 2 3 3 4 4 5 5/);
  const q = lakePlan();
  [q.slots[7], q.slots[8]] = [q.slots[8], q.slots[7]];
  has(errorsOf(q), /только в хвосте окна/);
  const g = lakePlan();
  g.slots[9].frame = 'silver';
  has(errorsOf(g), /слот 10.*золото стоит ровно на сценах/);
  const s = lakePlan();
  s.window.layout = 'small-all-one';
  has(errorsOf(s), /сцен с персонажами в окне small-all-one должно быть 0/);
});

test('план: категории, повтор вида, фоны и соседи, подписи', () => {
  const p = lakePlan();
  p.slots[1].order.staging = { preset: 'field', pattern: 'spiral', material: 'glossy plastic' };
  has(errorsOf(p), /нет категории 2/);
  const k = lakePlan();
  k.slots[4].kind = 'Fishing Bobbers';
  has(errorsOf(k), /вид предмета «fishing bobber» повторяется/);
  const n = lakePlan();
  n.slots[4].order.staging.pattern = 'rays';
  n.slots[4].hue = 'sky blue';
  n.slots[4].order.palette = 'a brown object on sky blue';
  [n.slots[1], n.slots[4]] = [n.slots[4], n.slots[1]];
  n.slots[1].stars = 1; n.slots[4].stars = 3;
  has(errorsOf(n), /соседние слоты 1 и 2: абстрактные фоны совпадают/);
  const a = lakePlan();
  for (const i of [3, 5, 7]) a.slots[i].order = { ...a.slots[0].order, title: `Card ${i}`, staging: { ...a.slots[0].order.staging, pattern: 'checker' } };
  for (const i of [3, 5, 7]) { a.slots[i].hue = `hue ${i}`; a.slots[i].kind = `kind ${i}`; }
  const ae = errorsOf(a);
  has(ae, /абстрактный фон .* у 8 карточек, а в большом окне нужно 3–5/);
  has(ae, /нет категории 4/);
  const c = lakePlan();
  c.slots[1].order.title = 'Red And White Bobber';
  c.slots[4].order.title = 'BOBBER';
  const ce = errorsOf(c);
  has(ce, /подпись — 1–2 слова, а в ней 4/);
  has(ce, /подпись «bobber» повторяется/);
});

test('план: реестр коллекции — вид и подпись другого набора, название набора', () => {
  const other = lakePlan();
  other.title = 'Camping';
  other.slots[0].kind = 'tackle box';
  const registry = registryOf(normalizePlan(other).plan);
  const errors = errorsOf(lakePlan(), { registry, titles: ['Lake Fishing'] });
  has(errors, /слот 2.*вид «tackle box» уже есть в наборе «Camping»/);
  has(errors, /подпись «Rowboat» уже есть в наборе «Camping»/);
  has(errors, /набор «Lake Fishing» в коллекции уже есть/);
  has(errors, /слот 9.*вид «bait bucket» уже есть/);
});

test('план: варианты — одна раскладка, не больше 5 общих видов, общие в другой постановке', () => {
  const a = { ...lakePlan(), variant: { n: 1, group: 'lake' } };
  const b = { ...lakePlan(), variant: { n: 2, group: 'lake' } };
  const errors = errorsOf(b, { variants: [a] });
  has(errors, /вариант 1: общих видов предметов \d+/);
  has(errors, /общий вид «fishing bobber» в той же постановке \(field\)/);
  const c = { ...lakePlan(), variant: { n: 2, group: 'lake' }, window: { layout: 'large' } };
  c.slots[7].order.staging = { ...c.slots[8].order.staging };
  has(errorsOf(c, { variants: [a] }), /раскладка окна у вариантов одна/);
});

test('план: просьба человека переводит ошибки правил набора в предупреждения, ошибки заказа остаются', () => {
  const p = lakePlan();
  p.slots[1].order.staging = { preset: 'field', pattern: 'spiral', material: 'glossy plastic' };
  p.slots[2].order.staging.surface = 'lava';
  p.humanRequest = 'без категории 2';
  const r = validatePlan(p);
  assert.ok(r.errors.length && r.errors.every(e => /staging\.surface/.test(e)), r.errors.join('\n'));
  assert.ok(r.warnings.some(w => /по просьбе человека.*нет категории 2/.test(w)));
});

test('план: пожелания набора ложатся в заказ каждой карточки; без них или запретом — предупреждение', () => {
  const p = lakePlan();
  p.wishes = 'летнее утро, без лиц у рыб';
  const missing = validatePlan(p);
  assert.ok(missing.warnings.some(w => /пожелания набора .*не перенесены.*слотов 1, 2, 3, 4, 5, 6, 7, 8, 9, 10/.test(w)), missing.warnings.join('\n'));
  p.slots.forEach((/** @type {any} */ s) => { s.wishes = 'Early summer morning, warm low sun.'; });
  p.slots[0].wishes = '';
  p.slots[1].order.promptExtra = 'A brass ring at the top.';
  p.slots[2].wishes = 'The fish has no face.';
  const r = validatePlan(p);
  assert.deepEqual(r.errors, []);
  assert.ok(!r.warnings.some(w => /не перенесены/.test(w)), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => /слот 3.*запрет, а не описание/.test(w)), r.warnings.join('\n'));
  assert.equal(r.plan.slots[0].order.promptExtra, undefined);
  assert.equal(r.plan.slots[1].order.promptExtra, 'A brass ring at the top. Early summer morning, warm low sun.');
  assert.equal(normalizePlan(r.plan).plan.slots[1].order.promptExtra, r.plan.slots[1].order.promptExtra, 'второй раз не добавляется');
  assert.equal(validatePlan(lakePlan()).warnings.filter(w => /пожелани/.test(w)).length, 0, 'без пожеланий — без предупреждений');
});

test('план: что прочтёт модель картинок — день у предметов, золотой час редко, контрастный фон, без тонкой фактуры', () => {
  const p = lakePlan();
  p.slots[3].order.staging.time = 'golden';
  p.slots[4].order.palette = 'a dark green object on olive';
  p.slots[4].hue = 'olive';
  p.slots[0].order.subject = 'a bee with a fuzzy striped body and a woven wire mesh veil.';
  p.slots[6].order.subject = 'a chrome thermos.';
  const e = errorsOf(p);
  has(e, /слот 4.*время суток «golden» у карточки без персонажей.*time: "day"/);
  has(e, /золотой час у 3 карточек \(слоты 4, 9, 10\)/);
  has(e, /слот 5.*фон «olive» почти того же цвета, что герой \(«dark green»\)/);
  has(e, /слот 1.*«fuzzy» в subject.*a round, smooth body/);
  has(e, /слот 1.*«mesh» в subject/);
  has(e, /слот 7.*«chrome».*painted toy metal/);
  // lighter or darker is enough (COLOUR.md 7); an achromatic hero passes
  p.slots[4].order.palette = 'a dark green object on lime';
  p.slots[4].hue = 'lime';
  p.slots[1].order.palette = 'a white object on pink';
  assert.ok(!errorsOf(p).some(x => /почти того же цвета/.test(x)));
  // the person's word: the set rules only warn
  p.humanRequest = 'неоновая вывеска ночью';
  const r = validatePlan(p);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some(w => /по просьбе человека.*время суток «golden»/.test(w)), r.warnings.join('\n'));
});

test('план: гранд-набор — 10 сцен в одном месте, кристальные рамки, подписи в одно слово', () => {
  const s = lakePlan().slots[8];
  const grand = {
    style: 'scapes', title: 'Lake Party', theme: 'party', angle: 'one evening at the lake', grand: true, place: 'small wooden dock on a calm lake', window: { layout: 'grand' },
    slots: Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(s), stars: 5, frame: 'crystal', kind: `moment ${i}`, props: [`thing ${i}`], order: { ...structuredClone(s.order), title: `Moment${i}` } })),
  };
  // from day to night, as the reference grand set (Summer Party): golden hour is rare (SETS.md 9.22)
  grand.slots.forEach((/** @type {any} */ g, /** @type {number} */ i) => { g.order.staging.time = i < 3 ? 'day' : i < 7 ? 'dusk' : 'night'; });
  assert.deepEqual(errorsOf(grand), []);
  grand.slots[3].order.place = 'a garden';
  grand.slots[4].order.title = 'Two Words';
  grand.slots[5].frame = 'gold';
  const e = errorsOf(grand);
  has(e, /слот 4.*место у всех сцен одно/);
  has(e, /слот 5.*подпись — 1 слово/);
  has(e, /слот 6.*кристальные/);
});

test('коллекция: гранд последним, рост сцен к финалу', () => {
  const sets = Array.from({ length: 16 }, (_, i) => {
    const p = lakePlan();
    p.title = `Set ${i + 1}`; p.number = i + 1;
    p.slots.forEach((s, j) => { s.kind = `${s.kind} ${i}`; s.order.title = `C${i}x${j}`; if (s.props) s.props = s.props.map(x => `${x} ${i}`); });
    return p;
  });
  const v = validateCollection(sets);
  has(v.errors, /сцен с персонажами в последних 5 обычных наборах \(10\) должно быть больше, чем в первых 5 \(10\)/);
  assert.ok(v.sets.every(s => !s.errors.length), JSON.stringify(v.sets.find(s => s.errors.length)));
  assert.ok(!v.errors.some(e => /гранд-набор — последний/.test(e)));
});

// ---------- planning with a fake text model ----------

/** A plan as the model would answer it (the fixture's cards in the answer format). */
function answerOf(/** @type {any} */ plan) {
  return JSON.stringify({
    title: plan.title, angle: plan.angle,
    cards: plan.slots.map((/** @type {any} */ s, /** @type {number} */ i) => ({ slot: i + 1, kind: s.kind, caption: s.order.title, hue: s.hue, props: s.props, ...Object.fromEntries(Object.entries(s.order).filter(([k]) => !['title', 'style'].includes(k))) })),
  });
}

test('planSet: запрос из фрагментов SETS.md; ошибки плана уходят модели на исправление; расход считается', async () => {
  const good = lakePlan();
  const bad = lakePlan();
  bad.slots[1].order.staging = { preset: 'field', pattern: 'spiral', material: 'glossy plastic' };
  /** @type {any[][]} */
  const seen = [];
  const answers = [answerOf(bad), '```json\n' + answerOf(good) + '\n```'];
  const model = async (/** @type {any[]} */ messages) => { seen.push(structuredClone(messages)); return { text: /** @type {string} */ (answers.shift()), cost: 0.001 }; };
  const r = await planSet({ style: 'scapes', theme: 'Рыбалка на озере', wishes: 'без лодок с мотором', scenes: 2, model, limits: { repairs: 2, maxSpendUsd: 1 } });
  assert.equal(r.calls, 2);
  assert.equal(r.spent, 0.002);
  assert.deepEqual(r.plans[0].errors, []);
  assert.equal(r.plans[0].rounds, 2);
  assert.equal(r.plans[0].plan.window.layout, 'large');
  const prompt = seen[0][1].content;
  assert.match(prompt, /Plan a set of 10 collectible cards on the theme "Рыбалка на озере"/);
  assert.match(prompt, /Assign each non-character card a staging category/);
  assert.match(prompt, /Write 2 short scenes for the end of the set/);
  assert.match(prompt, /Card caption in English/);
  assert.match(prompt, /без лодок с мотором\nCarry them into the cards/);
  assert.equal(planFromAnswer({ cards: [{ slot: 1, wishes: 'Early morning.' }, { slot: 2, wishes: '' }] }, { style: 'scapes', theme: 't', layout: 'large', scenes: 2 }).slots.slice(0, 3).map(s => s.wishes).join('|'), 'Early morning.||');
  assert.doesNotMatch(prompt, /\[(set theme|registry|N|language)\]/);
  assert.match(seen[1].at(-1).content, /нет категории 2/);
});

test('planSet: варианты видят виды друг друга; потолок расходов и неизвестная цена останавливают', async () => {
  /** @type {string[]} */
  const prompts = [];
  const model = async (/** @type {any[]} */ m) => { prompts.push(m[1].content); return { text: answerOf(lakePlan()), cost: 0.01 }; };
  const r = await planSet({ style: 'scapes', theme: 'Lake', scenes: 2, variants: 2, model, limits: { repairs: 0, maxSpendUsd: 1 } });
  assert.equal(r.plans.length, 2);
  assert.match(prompts[1], /This is variant 2 of the set; the other variants already use these item kinds with these stagings: .*fishing bobber — field/);
  has(r.plans[1].errors, /общих видов предметов/);
  await assert.rejects(planSet({ style: 'scapes', theme: 'Lake', scenes: 2, variants: 3, model, limits: { repairs: 0, maxSpendUsd: 0.015 } }), /потолке \$0.015/);
  await assert.rejects(planSet({ style: 'scapes', theme: 'Lake', scenes: 2, model: async () => ({ text: '{}', cost: null }), limits: { repairs: 0, maxSpendUsd: 1 } }), /не сообщила цену/);
  assert.throws(() => parseAnswer('no json here'), /не JSON/);
  assert.ok(setPrompt({ style: 'scapes', theme: 'x', layout: 'grand', grand: true, scenes: 10, registry: [], variants: [], n: 1 }).at(-1)?.content.includes('Write 10 moments of one celebration'));
});

test('planCollection: тема делится на 16 наборов, окна и сцены — по месту в коллекции', async () => {
  const themes = Array.from({ length: 16 }, (_, i) => ({ title: `Theme ${i + 1}`, kind: 'place', angle: `angle ${i + 1}`, examples: [] }));
  /** @type {string[]} */
  const prompts = [];
  const model = async (/** @type {any[]} */ m) => {
    prompts.push(m[1].content);
    if (prompts.length === 1) return { text: JSON.stringify({ sets: themes }), cost: 0.001 };
    return { text: answerOf(lakePlan()), cost: 0.001 };
  };
  const r = await planCollection({ style: 'scapes', theme: 'Summer', only: [10, 13], model, limits: { repairs: 0, maxSpendUsd: 1 } });
  assert.match(prompts[0], /Split the collection theme "Summer" into 16 set themes/);
  assert.equal(r.plans.length, 2);
  assert.deepEqual(r.plans.map(p => [p.plan.number, p.plan.window.layout, p.plan.slots.filter(s => s.frame === 'gold').length]), [[10, 'large', 2], [13, 'large', 3]]);
  has(r.plans[1].errors, /уже есть в наборе/);
  assert.match(prompts[2], /within the collection "Summer"/);
});

test('ccf.mjs: команды наборов и коллекций — справка и отказ от неверной строки до работы', async () => {
  const { spawnSync } = await import('node:child_process');
  const ccf = (/** @type {string[]} */ ...a) => spawnSync(process.execPath, [path.join(ROOT, 'ccf.mjs'), ...a], { cwd: ROOT, encoding: 'utf8' });
  for (const c of [['set', 'plan'], ['set', 'check'], ['set', 'make'], ['set', 'sheet'], ['collection', 'plan'], ['collection', 'make']]) {
    assert.equal(ccf(...c, '--help').status, 0, c.join(' '));
    assert.equal(ccf(...c, '--no-such-option').status, 2, c.join(' '));
  }
  assert.equal(ccf('set', 'plan', '--theme', 'x').status, 2, 'без --out, --save или --json');
  assert.equal(ccf('set', 'make', '--collection', 'c').status, 2, 'без плана и без --set');
  assert.equal(ccf('set', 'make', '--collection', 'c', '--set', 's', '--slots', 'a').status, 2);
});
