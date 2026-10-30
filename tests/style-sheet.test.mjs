// core/style: the character sheet order (kind "character-sheet"): an anchor portrait of one character,
// assembled from the bible's fragments (CHARACTERS.md char.sheet + the character's full description).
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { slotsOf } from '../core/style/fragments.js';
import { loadStyle } from '../core/style/style.js';
import { checkOrder, orderOutput, validateOrder } from '../core/style/card-order.js';
import { buildPrompt } from '../core/style/prompt.js';

const style = loadStyle(path.join(ROOT, 'styles/scapes'));
const KIND = 'character-sheet';
const sheet = (/** @type {string} */ character, extra = {}) => ({ kind: KIND, id: `anchor-${character}`, style: 'scapes', character, ...extra });

test('лист персонажа: каждый фрагмент и пункт правил вида есть в библии', () => {
  const rules = style.assembly.kinds?.[KIND];
  assert.ok(rules, 'нет вида character-sheet в prompt-assembly.json');
  for (const section of rules.sections) {
    for (const part of section.parts) {
      if (!part.fragment) continue;
      const f = style.fragments.get(part.fragment);
      assert.ok(f, `нет фрагмента ${part.fragment}`);
      for (const it of part.items || []) assert.ok(f.items?.some(x => x.label === it.label), `${part.fragment}: нет пункта [${it.label}]`);
      for (const s of slotsOf(f.text).filter(s => !s.options)) assert.ok(style.assembly.slots[s.inner.toLowerCase()] !== undefined, `${part.fragment}: слот ${s.raw}`);
    }
  }
});

for (const name of Object.keys(style.assembly.cast)) {
  test(`лист персонажа ${name}: полное описание, рамка листа, опорные кадры персонажа`, async () => {
    const order = sheet(name);
    assert.deepEqual(await validateOrder(order), []);
    const r = await buildPrompt(order);
    const ids = r.fragments.map(f => f.id);
    for (const id of ['char.sheet', style.assembly.cast[name].fragment, 'colour.palette', 'render.style']) assert.ok(ids.includes(id), `нет фрагмента ${id}`);
    assert.ok(!ids.some(id => /^(base\.cat|bg\.|comp\.|char\.scene-frame)/.test(id)), `фрагменты карточки в листе: ${ids.join(', ')}`);
    assert.ok(r.prompt.includes(style.fragments.get(style.assembly.cast[name].fragment).text), 'описание персонажа не слово в слово');
    assert.ok(!/[{}[\]]/.test(r.prompt), 'в запросе остался незаполненный слот');
    assert.deepEqual(r.references.map(x => x.ref), style.assembly.cast[name].anchor_frames);
    for (const ref of r.references) assert.ok(style.references.find(c => c.ref === ref.ref).cast.includes(name), `на №${ref.ref} нет персонажа`);
    assert.match(r.prompt, /Reference images: Images 1–2 show the /);
  });
}

test('лист персонажа: костюм дописывается после описания', async () => {
  const r = await buildPrompt(sheet('man', { costume: 'Costume: a blue polo shirt and blue jeans.' }));
  assert.match(r.prompt, /Keep this exact design\. Costume: a blue polo shirt and blue jeans\./);
  assert.match(r.prompt, /Character reference sheet of the Man, alone/);
});

test('лист персонажа: ошибки заказа', () => {
  const has = (errors, re) => assert.ok(errors.some(e => re.test(e)), `нет ошибки ${re}: ${JSON.stringify(errors)}`);
  has(checkOrder(sheet('dog'), style), /character = "dog" — нет такого персонажа/);
  has(checkOrder({ ...sheet('pig'), kind: 'poster' }, style), /kind = "poster" — нет такого вида заказа/);
  has(checkOrder(sheet('pig', { staging: { category: 5 } }), style), /неизвестное поле заказа «staging» для вида character-sheet/);
  has(checkOrder(sheet('pig', { costume: '' }), style), /costume должно быть непустой строкой/);
  assert.deepEqual(checkOrder(sheet('pig', { references: [109] }), style), []);
});

test('что делать с картинкой: карточку режут и проверяют, лист персонажа — нет', () => {
  assert.deepEqual(orderOutput({ id: 'x', style: 'scapes', staging: {} }, style), { crop: true, checks: true, visual: [] });
  const out = orderOutput(sheet('pig'), style);
  assert.equal(out.crop, false);
  assert.equal(out.checks, false);
  assert.ok(out.visual.length > 0 && out.visual.every(v => v.doc === 'CHARACTERS.md'));
});
