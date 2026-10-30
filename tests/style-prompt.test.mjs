// core/style: fragments marked in the bible, the assembly rules (styles/scapes/prompt-assembly.json),
// card orders and their validator, prompt assembly and reference picking.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { PILOT_ORDERS } from './style-pilot-orders.mjs';
import { fillSlots, findOption, parseFragments, slotsOf } from '../core/style/fragments.js';
import { loadStyle } from '../core/style/style.js';
import { checkOrder, validateOrder } from '../core/style/card-order.js';
import { buildPrompt, OrderError } from '../core/style/prompt.js';
import { pickReferences } from '../core/style/references.js';

const STYLE_DIR = path.join(ROOT, 'styles/scapes');
const style = loadStyle(STYLE_DIR);
/** @param {string} id */
const frag = id => {
  const f = style.fragments.get(id);
  assert.ok(f, `нет фрагмента ${id}`);
  return f;
};
const clone = o => structuredClone(o);
const pilot = id => clone(PILOT_ORDERS.find(o => o.id === id));

test('фрагменты: метка в строке, метка перед блоком и цитатой, пункты с условиями', () => {
  const md = [
    '- A: <!-- fragment: t.a -->`one [object]`; <!-- fragment: t.b -->`two {x | y}`',
    '',
    '<!-- fragment: t.c -->',
    '```',
    'Line one',
    'continues here.',
    '```',
    '<!-- fragment: t.d -->',
    '> [flat] Quote one',
    '> two.',
    '<!-- fragment: t.e -->',
    '```',
    'Base line.',
    '[resting] Shadow line.',
    '```',
  ].join('\n');
  const fs_ = Object.fromEntries(parseFragments(md, 'X.md').map(f => [f.id, f]));
  assert.equal(fs_['t.a'].text, 'one [object]');
  assert.equal(fs_['t.b'].text, 'two {x | y}');
  assert.equal(fs_['t.c'].text, 'Line one continues here.');
  assert.equal(fs_['t.d'].text, 'Quote one two.');
  assert.equal(fs_['t.d'].label, 'flat');
  assert.deepEqual(fs_['t.e'].items?.map(i => i.label), [null, 'resting']);
  assert.throws(() => parseFragments('<!-- fragment: z -->\nplain text', 'Y.md'), /Y\.md:1/);
});

test('фрагменты: слоты и варианты заполняются, пустой вариант вырезается вместе со скобками', () => {
  const t = 'a single [object] in front of a backdrop ([rays / concentric rings]) in one hue, {Who} smiles';
  assert.deepEqual(slotsOf(t).map(s => s.options), [null, ['rays', 'concentric rings'], null]);
  assert.deepEqual(findOption(slotsOf(t), 'concentric').map(f => f.option), ['concentric rings']);
  const named = k => ({ object: 'bobber', who: 'the Man' })[k];
  assert.equal(fillSlots(t, { named, chosen: new Map([[1, 'rays']]) }).text, 'a single bobber in front of a backdrop (rays) in one hue, The Man smiles');
  assert.equal(fillSlots(t, { named, chosen: new Map(), dropUnfilled: true }).text, 'a single bobber in front of a backdrop in one hue, The Man smiles');
  assert.equal(fillSlots(t, { named: () => undefined, chosen: new Map() }).missing.length, 3);
});

test('библия: каждый фрагмент разделов «Для промпта (англ.)» помечен', () => {
  for (const doc of style.assembly.documents) {
    const text = fs.readFileSync(path.join(STYLE_DIR, doc), 'utf8');
    const start = text.search(/^## (\d+\. )?Для промпта \(англ\.\)/m);
    assert.ok(start >= 0, `${doc}: нет раздела «Для промпта (англ.)»`);
    const rest = text.slice(start + 3);
    const section = rest.slice(0, rest.search(/^## /m));
    const lines = section.split('\n');
    let expected = 0;
    let inFence = false;
    let inQuote = false;
    for (const l of lines) {
      if (/^\s*```/.test(l)) { if (!inFence) expected++; inFence = !inFence; continue; }
      if (inFence) continue;
      const q = /^\s*>/.test(l);
      if (q && !inQuote) expected++;
      inQuote = q;
      if (/^\s*- /.test(l)) expected += (l.match(/`[^`]+`/g) || []).length;
    }
    const marked = [...style.fragments.values()].filter(f => f.file === doc).length;
    assert.equal(marked, expected, `${doc}: фрагментов ${expected}, помечено ${marked}`);
  }
});

test('правила сборки: каждый фрагмент, пункт и вариант из prompt-assembly.json есть в библии', () => {
  for (const section of style.assembly.sections) {
    for (const part of section.parts) {
      if (!part.fragment) continue;
      const f = frag(part.fragment);
      for (const it of part.items || []) assert.ok(f.items?.some(x => x.label === it.label), `${part.fragment}: нет пункта [${it.label}]`);
      const slots = slotsOf(f.text);
      for (const pick of part.pick || []) {
        for (const option of Object.values(pick.map || {})) {
          assert.equal(findOption(slots, option).length, 1, `${part.fragment}: вариант «${option}» должен находиться ровно один раз`);
        }
      }
      for (const s of slots.filter(s => !s.options)) assert.ok(style.assembly.slots[s.inner.toLowerCase()] !== undefined, `${part.fragment}: слот ${s.raw} не описан в slots`);
    }
  }
  for (const c of Object.values(style.assembly.cast)) frag(c.fragment);
  assert.ok(style.assembly.fields.material.values_from && frag(style.assembly.fields.material.values_from).items?.length);
});

test('словарь постановки совпадает с check-card.mjs --help и со спецификацией эталона', () => {
  const r = spawnSync(process.execPath, [path.join(STYLE_DIR, 'checks/check-card.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const help = r.stdout.split('\n');
  /** @param {string} field */
  const helpValues = field => {
    const i = help.findIndex(l => new RegExp(`^  ${field}\\s`).test(l));
    assert.ok(i >= 0, `в --help нет поля ${field}`);
    let text = help[i].replace(new RegExp(`^  ${field}\\s+`), '');
    for (let j = i + 1; j < help.length && /^\s{6,}\S/.test(help[j]); j++) text += ' ' + help[j].trim();
    return text.replace(/\([^)]*\)/g, '').split('|').map(s => s.trim());
  };
  const fields = style.assembly.fields;
  for (const f of ['backdrop', 'pattern', 'placement', 'support', 'camera', 'time']) assert.deepEqual(fields[f].values, helpValues(f), f);
  assert.deepEqual(fields.characters.values, helpValues('characters').map(Number));
  assert.ok(help.some(l => /^  category\s+1–5/.test(l)));
  assert.deepEqual(fields.category.values, [1, 2, 3, 4, 5]);
  for (const card of style.references) {
    for (const f of ['category', 'backdrop', 'pattern', 'placement', 'support', 'camera', 'characters', 'time', 'sky_top']) {
      const v = card.staging[f];
      if (v === 'unsure') continue; // the spec's "could not tell" mark, not a value an order can ask for
      assert.ok(fields[f].values?.includes(v), `эталон №${card.ref}: ${f} = ${v} нет в словаре`);
    }
  }
});

test('запреты постановки не срабатывают ни на одной эталонной карточке', () => {
  for (const card of style.references) {
    const order = { staging: card.staging };
    for (const f of style.assembly.forbid) {
      const hit = Object.entries(f.when).every(([k, vals]) => vals.includes(order.staging[k]));
      assert.ok(!hit, `эталон №${card.ref}: ${f.message}`);
    }
  }
});

// What each pilot card's prompt must contain: the bible fragments (by id) and the order's words.
const PILOT_EXPECT = {
  'c1-bobber': {
    fragments: ['base.frameless', 'base.clean-surfaces', 'base.cat1-field', 'bg.abstract', 'bg.rays', 'bg.floating', 'comp.field', 'comp.floating', 'comp.volume-boxy', 'colour.palette', 'colour.shadows-light', 'colour.hero-backdrop', 'colour.gradient', 'render.style', 'render.style[floating]', 'render.materials[glossy plastic]'],
    text: ['Staging: a single fishing bobber floating in mid-air', 'patterned backdrop (rays) in one hue', 'Here: a red-and-white object on sky blue.'],
  },
  'c2-tackle-box': {
    fragments: ['base.cat2', 'bg.plain-gradient', 'bg.smooth-floor', 'comp.field', 'comp.standing', 'comp.volume-boxy', 'comp.brand-mark', 'colour.hero-backdrop', 'colour.gradient', 'render.style[resting]', 'render.materials[glossy plastic]'],
    text: ['Staging: a single tackle box standing on a smooth plain floor strip', 'one small brand mark: a simple house silhouette', 'lit like it: a sticker with a white die-cut border. No text.'],
  },
  'c3-catch-bucket': {
    fragments: ['base.cat3', 'bg.abstract', 'bg.stripes', 'bg.surface-patch', 'comp.field', 'comp.standing', 'comp.volume-boxy', 'render.style[resting]', 'render.materials[metal]', 'render.materials[wood]'],
    text: ['a small patch of real wooden planks with visible texture', 'a few broad straight stripes, vertical:', 'a band of real wooden boards with clearly visible texture', 'its far edge follows the material (a straight edge)'],
  },
  'c4-rowboat': {
    fragments: ['base.cat4', 'bg.setting', 'comp.setting', 'comp.volume-boxy', 'colour.day-sky', 'render.style[resting]', 'render.style[scene]', 'render.materials[wood]'],
    text: ['set in a real lake shore, ground or horizon visible', 'Setting: a real place (a calm lake shore with reeds, the far shore with rounded pine trees)', 'its height follows the camera (eye level: at half to three quarters of the frame height)'],
  },
  'c5-gone-fishing': {
    fragments: ['char.scene-frame', 'char.man', 'char.pig', 'bg.setting', 'colour.palette', 'colour.shadows-light', 'render.style', 'render.style[low sun or stage spots]', 'render.style[scene]'],
    text: ['A simple everyday lake fishing scene with the Man and the Pig (two of the cast), set in a small wooden dock on a calm lake', ', at sunset. The Man and the Pig sit on the dock fishing with rods.', 'the Man looks straight at the boot', 'cut at the waist by the bottom edge', 'Images 1–2 show the Man and the Pig'],
  },
};

for (const order of PILOT_ORDERS) {
  test(`пилот ${order.id}: запрос собран из фрагментов библии`, async () => {
    assert.deepEqual(await validateOrder(order), []);
    const r = await buildPrompt(order);
    const ids = r.fragments.map(f => f.id);
    for (const id of PILOT_EXPECT[order.id].fragments) assert.ok(ids.includes(id), `нет фрагмента ${id}`);
    for (const t of PILOT_EXPECT[order.id].text) assert.ok(r.prompt.includes(t), `нет текста: ${t}`);
    // Every whole bible fragment that is used without slots appears word for word
    // (but for the capital first letter and the final full stop the assembly adds).
    for (const { id } of r.fragments) {
      const f = style.fragments.get(id);
      if (f && !f.items && !slotsOf(f.text).length) assert.ok(r.prompt.includes(f.text.slice(1).replace(/\.$/, '')), `${id} не слово в слово`);
    }
    assert.ok(!/[{}[\]]/.test(r.prompt.replace(/\(around #[0-9A-F]+\)/g, '')), 'в запросе остался незаполненный слот');
    assert.equal(r.references.length, style.assembly.references.count);
    for (const ref of r.references) assert.ok(fs.existsSync(ref.path), ref.path);
    // Section order follows PROMPTS.md: format first, rendering after colour.
    const names = r.sections.map(s => s.name);
    assert.equal(names[0], 'format');
    assert.ok(names.indexOf('colour') < names.indexOf('rendering'));
  });
}

test('золотая сцена: каркас и полные описания персонажей с «Do not redesign …»', async () => {
  const r = await buildPrompt(pilot('c5-gone-fishing'));
  for (const id of ['char.man', 'char.pig']) assert.ok(r.prompt.includes(frag(id).text), `${id} не полностью`);
  assert.match(r.prompt, /Do not redesign him\. Costume: a khaki fishing vest/);
  assert.match(r.prompt, /Do not redesign it\. Here it wears only a small straw hat\./);
  assert.ok(r.prompt.indexOf('A simple everyday') < r.prompt.indexOf('The Man: a heavy-set'));
  assert.ok(!r.fragments.some(f => f.id.startsWith('comp.') || f.id.startsWith('base.cat')), 'у сцены нет фрагментов кадра предмета');
  const sheep = pilot('c5-gone-fishing');
  sheep.staging.characters = 1;
  sheep.scene.characters = [{ name: 'sheep' }];
  sheep.scene.reactor = 'the Sheep';
  const r2 = await buildPrompt(sheep);
  assert.ok(r2.prompt.includes(frag('char.sheep').text));
  assert.match(r2.prompt, /with the Sheep \(one of the cast\)/);
});

test('эталоны: подбираются по постановке, исключённые не берутся, заказ может их задать', () => {
  const exclude = new Set(style.assembly.references.exclude);
  for (const card of style.references) {
    const order = { ...pilot('c1-bobber'), staging: { ...card.staging } };
    for (const r of pickReferences(order, style)) assert.ok(!exclude.has(r.ref), `взят исключённый №${r.ref}`);
  }
  const scene = pickReferences(pilot('c5-gone-fishing'), style);
  for (const r of scene) assert.deepEqual([...r.cast].sort(), ['man', 'pig']);
  const bobber = pickReferences(pilot('c1-bobber'), style);
  for (const r of bobber) assert.equal(r.staging.placement, 'floating_field');
  const forced = pilot('c1-bobber');
  forced.references = [17, 75];
  assert.deepEqual(pickReferences(forced, style).map(r => r.ref), [17, 75]);
});

test('promptExtra дописывается, promptOverride заменяет запрос', async () => {
  const extra = pilot('c1-bobber');
  extra.promptExtra = 'Make the antenna slightly longer.';
  const r = await buildPrompt(extra);
  assert.ok(r.prompt.endsWith('Make the antenna slightly longer.'));
  const over = pilot('c1-bobber');
  over.promptOverride = 'A red bobber, nothing else.';
  const r2 = await buildPrompt(over);
  assert.equal(r2.prompt, 'A red bobber, nothing else.');
  assert.deepEqual(r2.fragments, []);
  assert.equal(r2.references.length, style.assembly.references.count);
});

/** Errors of an order changed by `edit`. @param {string} id @param {(o: any) => void} edit */
const errorsOf = (id, edit) => {
  const o = pilot(id);
  edit(o);
  return checkOrder(o, style);
};

test('валидатор: понятные ошибки на неверные и недостающие значения', async () => {
  const has = (errors, re) => assert.ok(errors.some(e => re.test(e)), `нет ошибки ${re}: ${JSON.stringify(errors)}`);
  has(errorsOf('c1-bobber', o => { o.staging.pattern = 'zigzag'; }), /staging\.pattern = "zigzag" — нет такого значения/);
  has(errorsOf('c1-bobber', o => { delete o.staging.camera; }), /нет поля staging\.camera/);
  has(errorsOf('c1-bobber', o => { o.staging.colour = 'red'; }), /неизвестное поле постановки staging\.colour/);
  has(errorsOf('c1-bobber', o => { o.staging.material = 'velvet'; }), /staging\.material = "velvet"/);
  has(errorsOf('c3-catch-bucket', o => { delete o.staging.stripes; }), /нужно поле staging\.stripes/);
  has(errorsOf('c1-bobber', o => { o.staging.pattern = 'plain_gradient'; }), /ровном градиенте/);
  has(errorsOf('c1-bobber', o => { delete o.object; }), /слот \[object\] — нужно поле object/);
  has(errorsOf('c1-bobber', o => { delete o.subject; }), /нет поля subject/);
  has(errorsOf('c1-bobber', o => { o.extra = 1; }), /неизвестное поле заказа «extra»/);
  has(errorsOf('c1-bobber', o => { o.references = [999]; }), /нет эталонной карточки №999/);
  has(errorsOf('c4-rowboat', o => { delete o.environment; }), /слот \{environment\} — нужно поле environment/);
  has(errorsOf('c5-gone-fishing', o => { delete o.scene; }), /нужно поле scene/);
  has(errorsOf('c5-gone-fishing', o => { o.scene.characters.pop(); }), /staging\.characters = 2, а в scene\.characters их 1/);
  has(errorsOf('c5-gone-fishing', o => { o.scene.characters[0].name = 'dog'; }), /name = "dog" — нет такого персонажа/);
  has(errorsOf('c5-gone-fishing', o => { delete o.scene.joke; }), /слот \{twist\} — нужно поле scene\.joke/);
  has(errorsOf('c5-gone-fishing', o => { o.scene.crop = 'ankles'; }), /не найден среди вариантов|не выбран вариант/);
  has(errorsOf('c2-tackle-box', o => { o.staging.placement = 'wall_mounted'; o.staging.backdrop = 'wall'; o.staging.support = 'wall_fixed'; o.staging.wall = 'curtain'; }), /bg\.on-wall.*не выбран вариант/);
  has(errorsOf('c3-catch-bucket', o => { o.staging.support = 'furniture'; delete o.staging.surface; }), /нет фрагмента раздела «staging»/);
  assert.deepEqual(errorsOf('c3-catch-bucket', o => { o.staging.support = 'furniture'; delete o.staging.surface; o.promptExtra = 'The bucket stands on a small wooden table.'; }), []);
  await assert.rejects(buildPrompt({ ...pilot('c1-bobber'), staging: { ...pilot('c1-bobber').staging, time: 'noon' } }), err => err instanceof OrderError && /time = "noon"/.test(err.errors.join('\n')));
});
