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
import { matches } from '../core/style/assembly.js';
import { loadStyle } from '../core/style/style.js';
import { checkOrder, unseenStaging, validateOrder } from '../core/style/card-order.js';
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
    text: ['Staging: a single fishing bobber floating freely in mid-air', 'patterned backdrop (rays) in one hue', 'Here: a red-and-white object on sky blue.'],
  },
  'c2-tackle-box': {
    fragments: ['base.cat2', 'bg.plain-gradient', 'bg.smooth-floor', 'comp.field', 'comp.standing', 'comp.volume-boxy', 'comp.brand-mark', 'colour.hero-backdrop', 'colour.gradient', 'render.style[resting]', 'render.materials[glossy plastic]'],
    text: ['Staging: a single tackle box standing on a smooth plain floor strip', 'one small brand mark: a simple house silhouette', 'lit like it: a sticker with a white die-cut border. The mark is a pure picture symbol.'],
  },
  'c3-catch-bucket': {
    fragments: ['base.cat3', 'bg.abstract', 'bg.stripes', 'bg.surface-patch', 'comp.field', 'comp.standing', 'comp.volume-boxy', 'render.style[resting]', 'render.materials[metal]', 'render.materials[wood]'],
    text: ['a small patch of real wooden boards with visible texture', 'a few broad straight stripes, vertical:', 'a band of real wooden boards with clearly visible texture', 'its far edge follows the material (a straight edge)'],
  },
  'c4-rowboat': {
    fragments: ['base.cat4', 'bg.setting', 'comp.setting', 'comp.volume-boxy', 'colour.day-sky', 'render.style[resting]', 'render.style[scene]', 'render.materials[wood]'],
    text: ['set in a real lake shore, ground or horizon visible', 'Setting: a real place (a calm lake shore with reeds, the far shore with rounded pine trees)', 'its height follows the camera (eye level: at half to three quarters of the frame height)'],
  },
  'c5-gone-fishing': {
    fragments: ['char.scene-frame', 'char.man', 'char.pig', 'bg.setting', 'colour.palette', 'colour.shadows-light', 'render.style', 'render.style[low sun or stage spots]', 'render.style[scene]'],
    text: ['A simple everyday lake fishing scene with the Man and the Pig (two of the cast), set in a small wooden dock on a calm lake', ', at sunset. The Man and the Pig sit on the dock fishing with rods.', 'the Man looks straight at the boot', 'cut at the waist by the bottom edge', 'Image 1 is the canonical look of the Man', 'Image 2 is the canonical look of the Pig', 'Images 3–4 are style references'],
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
    assert.equal(r.references.length, style.assembly.references.count + (order.staging.category === 5 ? order.scene.characters.length : 0));
    for (const ref of r.references) assert.ok(fs.existsSync(ref.path), ref.path);
    // Section order follows PROMPTS.md: format first, rendering after colour.
    const names = r.sections.map(s => s.name);
    assert.equal(names[0], 'format');
    assert.ok(names.indexOf('colour') < names.indexOf('rendering'));
  });
}

test('золотая сцена: каркас и полные описания персонажей с «Keep this exact design»', async () => {
  const r = await buildPrompt(pilot('c5-gone-fishing'));
  for (const id of ['char.man', 'char.pig']) assert.ok(r.prompt.includes(frag(id).text), `${id} не полностью`);
  assert.match(r.prompt, /Keep this exact design\. Costume: a khaki fishing vest/);
  assert.match(r.prompt, /Keep this exact design\. Here it wears only a small straw hat\./);
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
  // an evening scene gets evening cards (the time weight), together showing its characters; never the day-light beach #100
  const scene = pickReferences(pilot('c5-gone-fishing'), style);
  for (const r of scene) assert.equal(r.staging.time, 'golden', `№${r.ref}`);
  assert.deepEqual([...new Set(scene.flatMap(r => r.cast))].sort(), ['man', 'pig']);
  assert.ok(!scene.some(r => r.ref === 100));
  const bobber = pickReferences(pilot('c1-bobber'), style);
  for (const r of bobber) assert.equal(r.staging.placement, 'floating_field');
  const forced = pilot('c1-bobber');
  forced.references = [17, 75];
  assert.deepEqual(pickReferences(forced, style).map(r => r.ref), [17, 75]);
});

test('опорные портреты: файл на каждого персонажа, сцена прикладывает их первыми, предмет и лист — нет', async () => {
  const rules = style.assembly.references.anchors;
  for (const name of Object.keys(style.assembly.cast)) {
    const file = path.join(style.dir, rules.dir, rules.file.replace('{name}', name));
    assert.ok(fs.existsSync(file), `нет опорного портрета ${file}`);
    const png = fs.readFileSync(file);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${name}: не PNG`);
    assert.equal(png.readUInt32BE(16) * 3, png.readUInt32BE(20) * 2, `${name}: не 2:3`);
  }
  const scene = await buildPrompt(pilot('c5-gone-fishing'));
  assert.deepEqual(scene.references.map(r => r.anchor), ['man', 'pig', undefined, undefined]);
  assert.deepEqual(scene.references.map(r => path.basename(r.path)).slice(0, 2), ['man.png', 'pig.png']);
  assert.ok(scene.references.slice(2).every(r => r.ref), 'после портретов — эталонные карточки');
  assert.match(scene.prompt, /Reference images: Image 1 is the canonical look of the Man: copy its design exactly/);
  assert.ok(scene.prompt.indexOf('Image 1 is') < scene.prompt.indexOf('Image 2 is') && scene.prompt.indexOf('Image 2 is') < scene.prompt.indexOf('Images 3–4'));
  // One character: one anchor, the style cards are numbered from 2.
  const one = pilot('c5-gone-fishing');
  one.staging.characters = 1;
  one.scene.characters = [{ name: 'sheep' }];
  one.scene.reactor = 'the Sheep';
  const r1 = await buildPrompt(one);
  assert.deepEqual(r1.references.map(r => r.anchor), ['sheep', undefined, undefined]);
  assert.match(r1.prompt, /Image 1 is the canonical look of the Sheep.*Images 2–3 are style references/);
  // Never more images than the provider takes (Codex: 5), whatever `count` says.
  const wide = structuredClone(style);
  wide.assembly.references.count = 9;
  assert.equal(pickReferences(pilot('c5-gone-fishing'), wide).length, rules.max_images - 2);
  // An object card and a character sheet get no anchors.
  assert.ok((await buildPrompt(pilot('c1-bobber'))).references.every(r => r.ref && !r.anchor));
  assert.ok((await buildPrompt({ kind: 'character-sheet', id: 'a', style: 'scapes', character: 'pig' })).references.every(r => !r.anchor));
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
  has(errorsOf('c2-tackle-box', o => { o.staging.placement = 'wall_mounted'; o.staging.backdrop = 'wall'; o.staging.support = 'wall_fixed'; o.staging.wall = 'curtain'; o.staging.pattern = 'other'; }), /bg\.on-wall.*не выбран вариант/);
  has(errorsOf('c3-catch-bucket', o => { o.staging.support = 'furniture'; delete o.staging.surface; }), /нужно поле staging\.furniture/);
  has(errorsOf('c3-catch-bucket', o => { o.staging.placement = 'other'; o.staging.support = 'other'; delete o.staging.surface; o.humanRequest = 'lean it on a post'; }), /нет фрагмента раздела «staging»/);
  assert.deepEqual(errorsOf('c3-catch-bucket', o => { o.staging.placement = 'other'; o.staging.support = 'other'; delete o.staging.surface; o.humanRequest = 'lean it on a post'; o.promptExtra = 'The bucket leans against a post.'; }), []);
  await assert.rejects(buildPrompt({ ...pilot('c1-bobber'), staging: { ...pilot('c1-bobber').staging, time: 'noon' } }), err => err instanceof OrderError && /time = "noon"/.test(err.errors.join('\n')));
});

const SPEC_FIELDS = ['category', 'backdrop', 'pattern', 'placement', 'support', 'camera', 'characters', 'time', 'sky_top'];
/** A rule condition checked on the spec fields only (prompt-only fields count as matching). */
const matchesSpec = (cond, st) => !cond || (Array.isArray(cond) ? cond.some(c => matchesSpec(c, st))
  : Object.entries(cond).every(([k, v]) => k === 'not' || !SPEC_FIELDS.includes(k) || v.includes(st[k])));
const sectionRule = name => style.assembly.sections.find(s => s.name === name);

test('у каждой постановки эталона есть фрагмент постановки, у каждого узора поля — фрагмент узора', () => {
  // The spec keeps the first markup's category for these two; BACKGROUNDS.md «Категория как следствие
  // постановки» moves both to category 4 (#31 a structure against the sky, #49 a setting), which has fragments.
  const SPEC_CATEGORY_DIFFERS = [31, 49];
  for (const card of style.references) {
    const st = card.staging;
    if (SPEC_CATEGORY_DIFFERS.includes(card.ref) || [st.placement, st.support].some(v => v === 'other' || v === 'unsure')) continue;
    assert.ok(sectionRule('staging').parts.some(p => matchesSpec(p.when, st)), `эталон №${card.ref}: нет фрагмента постановки`);
  }
  const graphic = style.assembly.fields.pattern.values.filter(p => !['plain_gradient', 'brick', 'other', 'n/a'].includes(p));
  for (const pattern of graphic) {
    const st = { backdrop: 'field', pattern, placement: 'floating_field' };
    const ids = sectionRule('backdrop').parts.filter(p => p.fragment && matchesSpec(p.when, st)).map(p => p.fragment);
    assert.ok(ids.some(id => id !== 'bg.abstract' && id !== 'bg.floating'), `узор ${pattern}: нет фрагмента`);
  }
});

// New stagings: each order is a pilot order with its staging changed; the prompt must hold the named
// fragments and texts and have no unfilled slot.
const NEW_STAGINGS = [
  { name: 'висит на волнистых полосах (№50)', from: 'c1-bobber', staging: { pattern: 'stripes_wavy' },
    fragments: ['base.cat1-field', 'bg.wavy-stripes'], text: ['patterned backdrop (wavy stripes) in one hue'] },
  { name: 'висит на спирали (№78)', from: 'c1-bobber', staging: { pattern: 'spiral' }, fragments: ['bg.spiral'], text: ['(spiral)'] },
  { name: 'висит на шахматке (№137)', from: 'c1-bobber', staging: { pattern: 'checker' }, fragments: ['bg.checker'], text: ['(checker)'] },
  { name: 'стоит на ромбах (№121)', from: 'c2-tackle-box', staging: { pattern: 'rhombi' }, fragments: ['base.cat2', 'bg.rhombi', 'bg.smooth-floor'], text: [] },
  { name: 'подвешен на поле (№102)', from: 'c1-bobber', staging: { placement: 'hung_from_above', support: 'other', pattern: 'plain_gradient' },
    fragments: ['base.cat1-hung', 'colour.gradient'], absent: ['bg.floating', 'comp.floating'], text: ['Staging: a single fishing bobber hanging from above on its own mount'] },
  { name: 'на столе у стены (№34)', from: 'c2-tackle-box', staging: { category: 3, backdrop: 'wall', support: 'furniture', furniture: 'table' },
    fragments: ['base.cat3-furniture', 'bg.plain-gradient'], text: ['standing on a table with visible material texture'] },
  { name: 'растёт из песка на спирали (№95)', from: 'c3-catch-bucket', staging: { placement: 'embedded', pattern: 'spiral', stripes: undefined, surface: 'sand' },
    fragments: ['base.cat3', 'bg.spiral', 'bg.surface-patch'], text: ['a small patch of real sand', 'a band of real sand'] },
  { name: 'кусок поверхности перед стеной с ромбами (№35)', from: 'c3-catch-bucket', staging: { backdrop: 'wall', pattern: 'rhombi', stripes: undefined, surface: 'tiles' },
    fragments: ['base.cat3', 'bg.rhombi', 'bg.surface-patch'], text: [] },
  { name: 'окно на кирпичной стене (№46)', from: 'c2-tackle-box', staging: { backdrop: 'wall', pattern: 'brick', placement: 'wall_mounted', support: 'wall_fixed', wall: 'brick' },
    fragments: ['bg.on-wall', 'bg.brick'], text: ['The wall is brick.'] },
  { name: 'на полу у ровной стены (№25)', from: 'c3-catch-bucket', staging: { backdrop: 'wall', pattern: 'plain_gradient', stripes: undefined, support: 'ground', surface: undefined, wall: 'plain', floor: 'wood' },
    fragments: ['bg.wall'], text: ['a plain wall painted in one colour', 'a floor of wooden boards'] },
  { name: 'без задника на песке (№96)', from: 'c4-rowboat', staging: { backdrop: 'none', placement: 'lying_top_down', support: 'fills_frame', camera: 'high', setting: undefined, surface: 'sand', sky_top: false },
    fragments: ['bg.no-backdrop'], text: ['(smooth sand)'] },
  { name: 'без задника у причала (№60)', from: 'c4-rowboat', staging: { backdrop: 'none', placement: 'lying_top_down', support: 'fills_frame', camera: 'high', setting: undefined, surface: 'deck', sky_top: false },
    fragments: ['bg.no-backdrop'], text: ['(a wooden deck or pier edge against water)'] },
  { name: 'обстановка, камера снизу (№68)', from: 'c4-rowboat', staging: { camera: 'low' },
    fragments: ['bg.setting', 'comp.low-camera'], text: ['low camera: low, at about four fifths of the frame height'] },
  { name: 'обстановка в золотой час (№122)', from: 'c4-rowboat', staging: { time: 'golden', sky_top: false },
    fragments: ['colour.golden', 'render.style[low sun or stage spots]'], absent: ['colour.day-sky'], text: ['Golden hour: the low sun sits behind or beside the scene'] },
  { name: 'сумерки — свой фрагмент цвета', from: 'c4-rowboat', staging: { time: 'dusk', sky_top: false },
    fragments: ['colour.dusk'], absent: ['colour.night', 'colour.golden', 'colour.day-sky'], text: ['Dusk: a blue-violet sky'] },
];

for (const c of NEW_STAGINGS) {
  test(`новая постановка: ${c.name}`, async () => {
    const order = pilot(c.from);
    for (const [k, v] of Object.entries(c.staging)) { if (v === undefined) delete order.staging[k]; else order.staging[k] = v; }
    assert.deepEqual(await validateOrder(order), []);
    const r = await buildPrompt(order);
    const ids = r.fragments.map(f => f.id);
    for (const id of c.fragments) assert.ok(ids.includes(id), `нет фрагмента ${id}: ${ids.join(', ')}`);
    for (const id of c.absent || []) assert.ok(!ids.includes(id), `лишний фрагмент ${id}`);
    for (const t of c.text) assert.ok(r.prompt.includes(t), `нет текста: ${t}`);
    assert.ok(!/[{}[\]]/.test(r.prompt.replace(/\(around #[0-9A-F]+( to #[0-9A-F]+)?\)/g, '')), 'в запросе остался незаполненный слот');
  });
}

// Every reference card's staging with every value of the prompt-only fields it requires: the prompt says each of
// «Backdrop:», «Placement:», «Setting:», «Staging:», «Wall:» at most once (two backdrops contradict each other: the
// set trial got a plank wall and a plain studio gradient in one prompt and the model drew the gradient).
test('ни одна постановка эталона не получает два противоречащих раздела (два «Backdrop:» и т. п.)', async () => {
  const PROMPT_ONLY = ['stripes', 'surface', 'medium', 'setting', 'wall', 'floor', 'furniture'];
  const fields = style.assembly.fields;
  let assembled = 0;
  for (const card of style.references) {
    const st = card.staging;
    if (['category', 'placement', 'support', 'time'].some(k => ['other', 'unsure'].includes(st[k]))) continue;
    const base = pilot(st.characters > 0 ? 'c5-gone-fishing' : 'c4-rowboat');
    base.staging = { ...Object.fromEntries(SPEC_FIELDS.map(k => [k, st[k]])), ...(st.characters > 0 ? {} : { material: 'wood' }) };
    if (st.characters > 0) base.scene.characters = base.scene.characters.slice(0, st.characters);
    if (st.pattern === 'motif_repeat') base.motif = 'fish';
    let orders = [base];
    for (const k of PROMPT_ONLY) {
      if (!(fields[k].required_when || []).some(c => matches(c, base, style))) continue;
      orders = orders.flatMap(o => fields[k].values.map(v => ({ ...o, staging: { ...o.staging, [k]: v } })));
    }
    for (const order of orders) {
      if (checkOrder(order, style).length) continue; // e.g. a wall the fragment has no words for, a forbidden pair
      const { prompt } = await buildPrompt(order);
      assembled++;
      const heads = [...prompt.matchAll(/(?:^|\n|\. )(Backdrop|Placement|Setting|Staging|Wall):/g)].map(m => m[1]);
      const twice = heads.filter((h, i) => heads.indexOf(h) !== i);
      assert.deepEqual(twice, [], `эталон №${card.ref}, ${PROMPT_ONLY.filter(k => order.staging[k]).map(k => `${k} ${order.staging[k]}`).join(', ')}: дважды ${twice.join(', ')}`);
    }
  }
  assert.ok(assembled > 400, `собрано только ${assembled} запросов`);
});

test('стена из досок, кирпича, обоев, занавеса или штукатурки с узором plain_gradient — ошибка заказа', () => {
  const onFloor = o => { Object.assign(o.staging, { category: 3, backdrop: 'wall', pattern: 'plain_gradient', support: 'ground', wall: 'planks', floor: 'stage' }); delete o.staging.brand; delete o.staging.brand_finish; };
  assert.ok(errorsOf('c2-tackle-box', onFloor).some(e => /не ровный градиент/.test(e)));
  assert.deepEqual(errorsOf('c2-tackle-box', o => { onFloor(o); o.staging.wall = 'plain'; }), []);
  assert.deepEqual(errorsOf('c2-tackle-box', o => { onFloor(o); o.staging.pattern = 'other'; }), []);
});

test('стены названы одними словами в «Стене» и «Предмете на стене»', () => {
  const opts = id => slotsOf(frag(id).text).find(s => s.options?.includes('brick')).options;
  const wall = opts('bg.wall'), onWall = opts('bg.on-wall');
  for (const shared of ['wallpaper with vertical stripes', 'brick', 'a plain wall painted in one colour']) {
    assert.ok(wall.includes(shared) && onWall.includes(shared), shared);
  }
  assert.ok(wall.some(o => o.startsWith('vertical wooden planks')) && onWall.some(o => o.startsWith('vertical wooden planks')));
  assert.ok(!onWall.includes('curtain'), 'занавес — не стена, на которой висит предмет');
});

test('кусок поверхности: варианты в BASE_RULES и BACKGROUNDS — те же слова в том же порядке', () => {
  const opts = id => slotsOf(frag(id).text).find(s => s.options?.includes('sand')).options;
  assert.deepEqual(opts('base.cat3'), opts('bg.surface-patch'));
});

test('постановки, которой нет в эталоне, агент сам не выбирает: нужна просьба человека (humanRequest)', () => {
  const unseen = /нет ни на одной эталонной карточке.*humanRequest/;
  const has = (errors, re) => assert.ok(errors.some(e => re.test(e)), `нет ошибки ${re}: ${JSON.stringify(errors)}`);
  // floating on rhombi and hung from above on a patterned field: never in the references
  has(errorsOf('c1-bobber', o => { o.staging.pattern = 'rhombi'; }), unseen);
  has(errorsOf('c1-bobber', o => { o.staging.placement = 'hung_from_above'; o.staging.support = 'other'; }), unseen);
  assert.deepEqual(errorsOf('c1-bobber', o => { o.staging.pattern = 'rhombi'; o.humanRequest = 'Хочу поплавок на ромбах.'; }), []);
  has(errorsOf('c1-bobber', o => { o.staging.pattern = 'rhombi'; o.humanRequest = ''; }), /humanRequest должно быть непустой строкой/);
  // the author allowed a hero on a plain-coloured wall although no reference shows it
  assert.deepEqual(errorsOf('c2-tackle-box', o => { Object.assign(o.staging, { backdrop: 'wall', placement: 'wall_mounted', support: 'wall_fixed', wall: 'plain' }); }), []);
  // the pattern over a surface patch may be any (BACKGROUNDS); a floor in front of a field or a wall is one staging
  assert.deepEqual(errorsOf('c3-catch-bucket', o => { o.staging.pattern = 'motif_repeat'; delete o.staging.stripes; o.motif = 'fish'; }), []);
  assert.deepEqual(errorsOf('c2-tackle-box', o => { o.staging.backdrop = 'wall'; o.staging.pattern = 'motif_repeat'; o.motif = 'hooks'; }), []);
  // every reference card's own staging is seen
  for (const card of style.references) {
    const order = { staging: card.staging };
    assert.equal(unseenStaging(order, style), null, `эталон №${card.ref}`);
  }
});
