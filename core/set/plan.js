// The set plan (SetPlan): what a set will be before any card is drawn — its theme and angle, its window, and the
// order of each of its 10 slots — and its validation by the style's set rules (styles/<style>/set-rules.json, from
// SETS.md). The agent writes a plan itself, or the planning model writes it (planner.js); makeSet (make.js) executes
// only a plan without errors. Format and rules: core/set/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { checkOrder } from '../style/card-order.js';
import { matches, stagingValue } from '../style/assembly.js';
import { styleDirOf } from '../style/style.js';
import { windowTemplates } from '../store/layout.js';
import { expandStaging, kindKey, loadSetRules, rowCategories, stagingRow } from './rules.js';

/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */
/** @typedef {import('./rules.js').SetRules} SetRules */

/**
 * One slot of the set window.
 * @typedef {object} SlotPlan
 * @property {number} stars  1–5
 * @property {string} frame  silver | gold | crystal
 * @property {string} kind  the item kind of the hero in English ("fishing rod"); for a scene, its situation
 * @property {string} [facet]  the facet of the theme (SETS.md 3.2)
 * @property {string} [subkind]  the sub-kind of the theme
 * @property {string[]} [props]  scene: the noticeable item kinds of the scene (what it plays with, props in hands,
 *   noticeable background objects); they count in the collection registry (SETS.md 1.5)
 * @property {string} [hue]  the backdrop colour word of an abstract backdrop (SETS.md 3.7: neighbours differ)
 * @property {string} [wishes]  what the set's wishes ask of this card, in English, as what the viewer should see; "" =
 *   nothing in them concerns this card. normalizePlan appends it to the order's promptExtra, so it reaches the prompt
 * @property {CardOrder} order  the card order (core/style); its `title` is the caption; `staging` may be
 *   `{preset, …fields}` (presets: `stagings` of set-rules.json) until normalizePlan expands it
 * @property {string} [cardId]  the made card (makeSet writes it)
 */

/**
 * @typedef {object} SetPlan
 * @property {string} style  style folder name
 * @property {string} title  the set name (SETS.md 1.2: one or two words)
 * @property {string} theme  the theme as asked
 * @property {string} [wishes]  the producer's free wishes
 * @property {string} angle  one line: what the set takes and how it differs from close themes (SETS.md 1.3)
 * @property {string} [themeKind]  place | activity | trip | event | feeling
 * @property {string} [collectionTheme]
 * @property {number} [number]  the place in the collection, 1–16 (16 = the grand set)
 * @property {boolean} [grand]
 * @property {string} [place]  grand set: the one place of all ten scenes (each scene's order.place)
 * @property {{layout: string, template?: string, reason?: string}} window  layout = a key of set-rules.json `windows`
 *   (its family is the store's window kind); template = the window colour (core/store windowTemplates of that kind); reason = why
 *   the agent chose a small layout (SETS.md 4.3: the choice is named with its reason)
 * @property {{n: number, group: string}} [variant]  variant n of the variant group (sets with one group are variants)
 * @property {string} [language]  caption language (default: the rules' captions.language)
 * @property {string} [humanRequest]  the person's words asking to depart from the set rules: the set-rule errors
 *   become warnings (each order's own rules stay: an order carries its own humanRequest)
 * @property {SlotPlan[]} slots  10, window order: 1–5 top row, 6–10 bottom row
 */

/**
 * What other sets of the collection already hold (SETS.md 6.2.6): every hero kind and every noticeable scene prop.
 * @typedef {{kind: string, key: string, role: 'hero'|'prop', set: string, group?: string, caption?: string, row?: string}} RegistryEntry
 */

/** @typedef {{errors: string[], warnings: string[]}} Verdict */

/** @param {SlotPlan} s */
const isScene = s => Number(s.order?.staging?.characters ?? 0) > 0;
/** @param {number} i @param {SlotPlan} s */
const where = (i, s) => `слот ${i + 1}${s?.order?.title ? ` («${s.order.title}»)` : ''}`;
/** @param {string} s */
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card';

/**
 * The plan with presets expanded, the style and a readable id put into every order, and each slot's `wishes` appended to
 * its order's promptExtra (once) (a copy).
 * @param {SetPlan} plan
 * @returns {{plan: SetPlan, errors: string[]}}
 */
export function normalizePlan(plan) {
  const { rules } = loadSetRules(plan.style);
  /** @type {string[]} */
  const errors = [];
  const copy = /** @type {SetPlan} */ (structuredClone(plan));
  (copy.slots || []).forEach((s, i) => {
    if (!s || typeof s !== 'object' || !s.order || typeof s.order !== 'object') return;
    const { staging, error } = expandStaging(/** @type {any} */ (s.order.staging), rules);
    if (error) errors.push(`${where(i, s)}: ${error}`);
    if (staging) s.order.staging = /** @type {any} */ (staging);
    s.order.style ??= plan.style;
    const wish = typeof s.wishes === 'string' ? s.wishes.trim() : '';
    if (wish && !String(s.order.promptExtra ?? '').includes(wish)) s.order.promptExtra = [s.order.promptExtra, wish].filter(Boolean).join(' ');
    s.order.id ??= `${slug(plan.title)}-${i + 1}-${slug(s.order.title ?? s.kind)}`;
  });
  return { plan: copy, errors };
}

/**
 * An order taken from a set plan made ready for the card operations that read an order on its own ("card prompt"):
 * a staging given as a preset is expanded, a missing id is a temporary one (a copy). A finished order comes back equal.
 * @param {Record<string, any>} order
 * @returns {Record<string, any>}
 * @throws {Error} when the preset is unknown
 */
export function readyOrder(order) {
  const { rules } = loadSetRules(order.style);
  const { staging, error } = expandStaging(order.staging, rules);
  if (error) throw new Error(`Заказ «${order.title ?? ''}»: ${error}`);
  return { ...order, ...(staging ? { staging } : {}), id: order.id ?? `preview-${slug(order.title ?? 'card')}` };
}

/**
 * The registry entries of one plan: hero kinds of the cards without characters, props of the scenes.
 * @param {SetPlan} plan
 * @returns {RegistryEntry[]}
 */
export function registryOf(plan) {
  const { rules, style } = loadSetRules(plan.style);
  /** @type {RegistryEntry[]} */
  const out = [];
  for (const s of plan.slots || []) {
    if (!s?.order) continue;
    const base = { set: plan.title, ...(plan.variant ? { group: plan.variant.group } : {}) };
    if (isScene(s)) for (const p of s.props || []) out.push({ kind: p, key: kindKey(p), role: 'prop', row: 'scene', ...base });
    else out.push({ kind: s.kind, key: kindKey(s.kind), role: 'hero', caption: s.order.title, row: stagingRow(s.order, rules, style), ...base });
    if (isScene(s) && s.order.title) out.push({ kind: '', key: '', role: 'prop', caption: s.order.title, ...base });
  }
  return out;
}

/** Words that make a wish a prohibition rather than a description of what is seen. */
const NEGATION = /\b(no|not|non|without|don'?t|never|avoid|nothing)\b/i;

/**
 * Whether the set's wishes reached its cards (VISION.md: the theme and wishes go into each card's description): with
 * wishes, every slot says what they ask of it (`wishes`, "" when nothing), in words of what is seen.
 * @param {SetPlan} plan @returns {string[]}
 */
export function wishWarnings(plan) {
  if (!plan.wishes?.trim()) return [];
  /** @type {string[]} */
  const out = [];
  const missing = plan.slots.map((s, i) => (typeof s.wishes === 'string' ? 0 : i + 1)).filter(Boolean);
  if (missing.length) out.push(`пожелания набора («${plan.wishes.trim()}») не перенесены в карточки: у слот${missing.length > 1 ? 'ов' : 'а'} ${missing.join(', ')} нет поля wishes — что пожелания значат для этой карточки, по-английски, как то, что видно; "" — если к ней они не относятся`);
  plan.slots.forEach((s, i) => {
    if (typeof s.wishes === 'string' && NEGATION.test(s.wishes)) out.push(`${where(i, s)}: wishes «${s.wishes}» — запрет, а не описание: напишите, что должно быть видно (не «no faces», а «small dark round eyes and a round, smooth body»)`);
  });
  return out;
}

/** @type {Map<string, number>} */
const hueDiffMin = new Map();
/** COLOUR.7's least hue difference of the style, read from its checks (set-rules.json orders.contrast names where). */
function hueDiffMinOf(/** @type {string} */ style, /** @type {SetRules['orders']['contrast']} */ c) {
  if (!hueDiffMin.has(style)) {
    const t = JSON.parse(fs.readFileSync(path.join(styleDirOf(style), c.hue_diff_min_from.file), 'utf8'));
    hueDiffMin.set(style, Number(c.hue_diff_min_from.path.reduce((v, k) => v?.[k], t)));
  }
  return /** @type {number} */ (hueDiffMin.get(style));
}

/**
 * The first colour word of a text with its hue and lightness class (orders.contrast); null when there is none or the
 * first is achromatic (an achromatic hero passes COLOUR.md 7 without the hue condition).
 * @param {string} text @param {SetRules['orders']['contrast']} c
 * @returns {{word: string, hue: number, light: number}|null}
 */
function colourOf(text, c) {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const [i, w] of words.entries()) {
    if (c.neutral.includes(w)) return null;
    const e = c.colours[w];
    if (!e) continue;
    const mods = words.slice(Math.max(0, i - 2), i).filter(m => c.lighter.includes(m) || c.darker.includes(m));
    const light = Math.max(-1, Math.min(1, e[1] + mods.filter(m => c.lighter.includes(m)).length - mods.filter(m => c.darker.includes(m)).length));
    return { word: [...mods, w].join(' '), hue: e[0], light };
  }
  return null;
}

/**
 * What the image model will read in one slot's order, by the set rules (SETS.md 9.22–9.24, set-rules.json orders):
 * a card without characters in day light, a backdrop hue unlike the hero's main colour, no fine texture or mirror
 * metal in the words. Returns the problems without the slot's name, each with what to write instead.
 * @param {SlotPlan} s @param {string} styleName
 * @returns {string[]}
 */
export function slotLookErrors(s, styleName) {
  const o = loadSetRules(styleName).rules.orders;
  /** @type {string[]} */
  const out = [];
  const time = s.order?.staging?.time;
  if (!isScene(s) && time && !o.time.no_characters.includes(time)) out.push(`время суток «${time}» у карточки без персонажей — ей нужен день, time: "day" (BACKGROUNDS.md 13, SETS.md 9.22); утро и вечер из пожеланий — в сценах. Свет, который нужен самому предмету (неон, фары, закат над дорогой), — исключение, его назначает человек (humanRequest)`);
  const at = String(s.order?.palette ?? '').toLowerCase().lastIndexOf(' on ');
  if (s.hue && at > 0) {
    const hero = colourOf(String(s.order.palette).slice(0, at), o.contrast), bg = colourOf(String(s.hue), o.contrast);
    const min = hueDiffMinOf(styleName, o.contrast);
    const d = hero && bg ? Math.min(Math.abs(hero.hue - bg.hue), 360 - Math.abs(hero.hue - bg.hue)) : 360;
    if (hero && bg && d < min && hero.light === bg.light) out.push(`фон «${s.hue}» почти того же цвета, что герой («${hero.word}»): оттенки расходятся на ${d}°, нужно от ${min}° (COLOUR.md 7, SETS.md 9.23) — дайте фон противоположного цвета (синий предмет на золотисто-жёлтом, оранжевый или красный на голубом, жёлтый на фиолетовом, красный на ярко-зелёном, зелёный на розовом) или заметно светлее либо темнее героя (light / pale или dark / deep)`);
  }
  const texts = [['subject', s.order?.subject], ['environment', s.order?.environment], ['wishes', s.wishes], ['scene', s.order?.scene && JSON.stringify(s.order.scene)]];
  for (const t of o.texture) for (const w of t.words) {
    const re = new RegExp(`\\b${w.replace(/[-\s]+/g, '[-\\s]+')}\\b`, 'i');
    const hit = texts.find(([, v]) => typeof v === 'string' && re.test(v));
    if (hit) out.push(`«${w}» в ${hit[0]} — ${t.why} (${t.source}, SETS.md 9.24); напишите вместо этого: «${t.instead}»`);
  }
  return out;
}

/**
 * Checks a set plan by the style's set rules (SETS.md 9 «Проверка», what a program can check) and every order by
 * the style (core/style checkOrder: staging, unseen stagings without humanRequest, assembly).
 * @param {SetPlan} input
 * @param {object} [ctx]
 * @param {RegistryEntry[]} [ctx.registry]  the other sets of the collection (not the variants of this one)
 * @param {SetPlan[]} [ctx.variants]  the other variants of this set (same variant group)
 * @param {string[]} [ctx.titles]  the titles of the other sets of the collection
 * @returns {Verdict & {plan: SetPlan}}  plan: the normalized plan
 */
export function validatePlan(input, { registry = [], variants = [], titles = [] } = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (!input || typeof input !== 'object') return { errors: ['план набора должен быть объектом'], warnings, plan: input };
  if (typeof input.style !== 'string') return { errors: ['нет поля style (имя папки стиля)'], warnings, plan: input };
  const { rules, style } = loadSetRules(input.style);
  const norm = normalizePlan(input);
  const plan = norm.plan;
  errors.push(...norm.errors);
  for (const k of ['title', 'theme', 'angle']) if (typeof (/** @type {any} */ (plan))[k] !== 'string' || !(/** @type {any} */ (plan))[k].trim()) errors.push(`нет поля ${k} (${k === 'angle' ? 'угол темы одной строкой, SETS.md 1.3' : k === 'title' ? 'название набора' : 'тема набора'})`);
  const w = rules.windows[plan.window?.layout];
  if (!w) errors.push(`window.layout = «${plan.window?.layout}» — нет такого окна; есть: ${Object.keys(rules.windows).join(', ')} (SETS.md 4.2)`);
  const templates = w ? windowTemplates(plan.style, w.family) : [];
  if (w && plan.window?.template !== undefined && !templates.includes(plan.window.template)) errors.push(`window.template = «${plan.window.template}» — шаблоны окна ${w.family}: ${templates.join(', ')}`);
  if (!Array.isArray(plan.slots) || plan.slots.length !== rules.set_size) {
    errors.push(`в наборе должно быть ровно ${rules.set_size} слотов, а их ${Array.isArray(plan.slots) ? plan.slots.length : 0} (SETS.md 9.1)`);
    return { errors, warnings, plan };
  }
  const slots = plan.slots;
  const bad = slots.findIndex(s => !s || typeof s !== 'object' || !s.order || typeof s.order !== 'object');
  if (bad >= 0) return { errors: [...errors, `слот ${bad + 1}: нужен объект { stars, frame, kind, order }`], warnings, plan };
  const grand = w?.family === 'grand';
  if (!!plan.grand !== grand && w) errors.push(grand ? 'окно grand — только у гранд-набора: поставьте grand: true' : 'гранд-набор — всегда в окне grand (SETS.md 4.3)');

  // ---- every order by the style ----
  /** @type {string[]} */
  const orderErrors = [];
  slots.forEach((s, i) => {
    for (const e of checkOrder(s.order, style)) orderErrors.push(`${where(i, s)}: ${e}`);
    if (typeof s.kind !== 'string' || !s.kind.trim()) errors.push(`${where(i, s)}: нет поля kind — вид предмета по-английски (для сцены — её ситуация)`);
    if (s.props !== undefined && (!Array.isArray(s.props) || s.props.some(p => typeof p !== 'string' || !p.trim()))) errors.push(`${where(i, s)}: props — список видов предметов сцены (строки)`);
    if (s.props?.length && !isScene(s)) errors.push(`${where(i, s)}: props — только у сцены с персонажами`);
  });

  errors.push(...orderErrors);
  warnings.push(...wishWarnings(plan));
  // ---- what the image model will read: time of day, backdrop against the hero, textures (SETS.md 9.22–9.24) ----
  slots.forEach((s, i) => errors.push(...slotLookErrors(s, plan.style).map(e => `${where(i, s)}: ${e}`)));
  const golden = slots.map((s, i) => (s.order.staging?.time === 'golden' ? i + 1 : 0)).filter(Boolean);
  if (golden.length > rules.orders.time.golden_max) errors.push(`золотой час у ${golden.length} карточек (слоты ${golden.join(', ')}), а в наборе — не больше ${rules.orders.time.golden_max}: в эталоне он редкий, 5 карточек из 160 (SETS.md 9.22); остальным — день`);
  // the category follows from the staging (BACKGROUNDS.md «Категория как следствие постановки»)
  slots.forEach((s, i) => {
    const row = rules.stagings.find(r => r.id === stagingRow(s.order, rules, style));
    if (!row || !s.order.staging) return;
    const allowed = rowCategories(s.order, row, style);
    const c = Number(s.order.staging.category);
    if (allowed.length && !allowed.includes(c)) errors.push(`${where(i, s)}: постановка «${row.title}» даёт категорию ${allowed.join(' или ')}, а в заказе ${c} (BACKGROUNDS.md «Категория как следствие постановки»)`);
  });

  // ---- window: stars, frames, scenes (SETS.md 4.2–4.4, 9.4–9.6) ----
  if (w) {
    slots.forEach((s, i) => {
      if (!Number.isInteger(s.stars) || s.stars < 1 || s.stars > 5) errors.push(`${where(i, s)}: stars — целое от 1 до 5`);
      if (!rules.frames.includes(s.frame)) errors.push(`${where(i, s)}: frame = «${s.frame}» — рамки: ${rules.frames.join(', ')}`);
    });
    const stars = slots.map(s => s.stars);
    if (w.stars && stars.join() !== w.stars.join()) errors.push(`звёзды окна ${plan.window.layout} — ровно ${w.stars.join(' ')}, а в плане ${stars.join(' ')} (SETS.md 4.2)`);
    if (!w.stars && w.stars_order === 'non-decreasing' && stars.some((v, i) => i && v < stars[i - 1])) errors.push(`звёзды по слотам не должны убывать (окно ${plan.window.layout}), а в плане ${stars.join(' ')} (SETS.md 9.5)`);
    const sceneSlots = slots.map((s, i) => (isScene(s) ? i + 1 : 0)).filter(Boolean);
    const count = sceneSlots.length;
    if (!w.scenes.includes(count)) errors.push(`сцен с персонажами в окне ${plan.window.layout} должно быть ${w.scenes.join(' или ')}, а их ${count} (SETS.md 3.6, 4.2)`);
    const tail = sceneSlots.every((n, k) => n === rules.set_size - count + 1 + k);
    if (!tail) errors.push(`сцены с персонажами — только в хвосте окна, после всех карточек без персонажей; сейчас в слотах ${sceneSlots.join(', ')} (SETS.md 3.1, 9.4)`);
    if (w.family === 'small' && sceneSlots.some(n => !rules.small_scene_slots.includes(n))) errors.push(`в малом окне сцены — только в слотах ${rules.small_scene_slots.join('–')} (SETS.md 4.2)`);
    slots.forEach((s, i) => {
      const scene = isScene(s);
      const gold = s.frame === 'gold';
      if (w.family === 'grand') { if (s.frame !== 'crystal') errors.push(`${where(i, s)}: в гранд-окне все рамки кристальные (crystal)`); return; }
      if (s.frame === 'crystal') errors.push(`${where(i, s)}: кристальная рамка — только в гранд-окне`);
      if (w.gold === 'scenes' && gold !== scene) errors.push(`${where(i, s)}: в окне ${plan.window.layout} золото стоит ровно на сценах с персонажами — ${scene ? 'сцене нужна золотая рамка' : 'предмету без персонажей — серебряная'} (SETS.md 4.2, 9.6)`);
      if (w.gold === 'none' && gold) errors.push(`${where(i, s)}: в окне ${plan.window.layout} золотых рамок нет`);
      if (w.gold === 'items' && gold && scene) errors.push(`${where(i, s)}: в окне ${plan.window.layout} золото — только на предметах без персонажей`);
    });
    if (w.gold === 'items' && !slots.some(s => s.frame === 'gold')) errors.push(`в окне ${plan.window.layout} нужны золотые рамки на главных предметах хвоста (SETS.md 4.2, «Малое: золото на предметах»)`);
  }

  // ---- kinds inside the set (SETS.md 3.8, 9.7) ----
  const heroes = slots.filter(s => !isScene(s));
  /** @type {Map<string, number[]>} */
  const kinds = new Map();
  slots.forEach((s, i) => { if (!isScene(s) && s.kind) { const k = kindKey(s.kind); kinds.set(k, [...(kinds.get(k) || []), i + 1]); } });
  for (const [k, at] of kinds) if (at.length > 1) errors.push(`вид предмета «${k}» повторяется в наборе: слоты ${at.join(', ')} (SETS.md 3.8)`);

  // ---- categories, backdrops (regular sets: SETS.md 3.5, 3.7, 9.2, 9.8–9.10) ----
  if (!grand && w) {
    /** @type {Map<number, number>} */
    const cat = new Map();
    for (const s of heroes) { const c = Number(s.order.staging?.category); cat.set(c, (cat.get(c) || 0) + 1); }
    const missing = rules.categories.regular.filter(c => !cat.get(c));
    if (missing.length) errors.push(`в наборе нет категори${missing.length > 1 ? 'й' : 'и'} ${missing.join(', ')}: каждая из 1–4 — хотя бы один раз (SETS.md 3.5, 9.2)`);
    for (const [c, n] of cat) if (n > rules.categories.max_each_preferred) warnings.push(`категория ${c} — ${n} карточек: предпочтительно не больше ${rules.categories.max_each_preferred} (SETS.md 9.2)`);

    const abstract = slots.map(s => !isScene(s) && matches(rules.abstract_when, s.order, style));
    const nAbs = abstract.filter(Boolean).length;
    const [lo, hi] = rules.abstract_share[w.family === 'large' ? 'large' : 'small'];
    if (nAbs < lo || nAbs > hi) errors.push(`абстрактный фон (поле или стена с узором или градиентом) у ${nAbs} карточек, а в ${w.family === 'large' ? 'большом' : 'малом'} окне нужно ${lo}–${hi} (SETS.md 3.7, 9.8)`);
    /** @type {Map<string, number>} */
    const patterns = new Map();
    slots.forEach((s, i) => {
      if (!abstract[i]) return;
      const p = patternKey(s.order, style);
      patterns.set(p, (patterns.get(p) || 0) + 1);
      if (p === 'n/a') errors.push(`${where(i, s)}: у абстрактного фона нужен узор или градиент (staging.pattern), а не n/a (SETS.md 3.7)`);
      if (typeof s.hue !== 'string' || !s.hue.trim()) errors.push(`${where(i, s)}: у карточки с абстрактным фоном нужен hue — оттенок фона словом (SETS.md 3.7)`);
      else if (s.order.palette && !s.order.palette.toLowerCase().includes(s.hue.toLowerCase().trim())) warnings.push(`${where(i, s)}: оттенок фона «${s.hue}» не назван в palette — модель изображения его не узнает`);
    });
    const [dlo, dhi] = rules.patterns.distinct;
    if (nAbs && (patterns.size < Math.min(dlo, nAbs) || patterns.size > dhi)) errors.push(`разных узоров на абстрактных фонах ${patterns.size}, нужно ${dlo}–${dhi} (SETS.md 3.7, 9.9)`);
    for (const [p, n] of patterns) if (n > rules.patterns.max_same) errors.push(`узор ${p} — у ${n} карточек, не больше ${rules.patterns.max_same} (SETS.md 9.9)`);
    const cols = rules.grid.columns;
    slots.forEach((s, i) => {
      for (const j of [i % cols < cols - 1 ? i + 1 : -1, i + cols]) {
        if (j < 0 || j >= slots.length || !abstract[i] || !abstract[j]) continue;
        const t = slots[j];
        if (patternKey(s.order, style) === patternKey(t.order, style) && String(s.hue).toLowerCase().trim() === String(t.hue).toLowerCase().trim()) errors.push(`соседние слоты ${i + 1} и ${j + 1}: абстрактные фоны совпадают и по узору, и по оттенку — поменяйте оттенок, узор или раскладку (SETS.md 3.7, 9.10)`);
      }
    });
  }

  // ---- scenes (SETS.md 3.6, 9.11) ----
  const sceneSlots = slots.filter(isScene);
  if (sceneSlots.length && !grand) {
    const own = new Set(heroes.map(s => kindKey(s.kind)));
    const plays = sceneSlots.some(s => [...(s.props || []), s.order.scene?.item ?? ''].some(p => own.has(kindKey(p))));
    if (!plays) warnings.push('ни одна сцена не разыгрывает предмет этого набора: назовите его в props или scene.item (SETS.md 3.6, рекомендация)');
  }
  for (const [i, s] of slots.entries()) if (isScene(s) && !s.props?.length) warnings.push(`${where(i, s)}: не записаны props — заметные предметы сцены; без них реестр коллекции не знает, что в ней видно (SETS.md 6.2.6)`);

  // ---- grand set (SETS.md 2, 6.4) ----
  if (grand) {
    if (typeof plan.place !== 'string' || !plan.place.trim()) errors.push('гранд-набор: нужно поле place — одно место на все 10 сцен (SETS.md 2)');
    else slots.forEach((s, i) => { if (s.order.place !== plan.place) errors.push(`${where(i, s)}: в гранд-наборе место у всех сцен одно — order.place = «${plan.place}» (SETS.md 2)`); });
  }

  // ---- captions (SETS.md 5.3, 9.12) ----
  const cap = rules.captions;
  /** @type {Map<string, number[]>} */
  const caps = new Map();
  slots.forEach((s, i) => {
    const t = String(s.order.title ?? '').trim();
    if (!t) { errors.push(`${where(i, s)}: нет подписи (order.title)`); return; }
    const words = t.split(/\s+/).length;
    const [wlo, whi] = grand ? cap.grand_words : cap.words;
    if (words < wlo || words > whi) errors.push(`${where(i, s)}: подпись — ${wlo === whi ? `${wlo} слово` : `${wlo}–${whi} слова`}, а в ней ${words} (SETS.md 5.3${grand ? ', 6.4' : ''})`);
    if (t.length < cap.chars[0] || t.length > cap.chars[1]) errors.push(`${where(i, s)}: подпись — ${cap.chars[0]}–${cap.chars[1]} знаков, а в ней ${t.length} (SETS.md 5.3)`);
    if (plan.title && t.toLowerCase() === plan.title.toLowerCase()) warnings.push(`${where(i, s)}: подпись совпадает с названием набора (SETS.md 5.3, рекомендация)`);
    caps.set(t.toLowerCase(), [...(caps.get(t.toLowerCase()) || []), i + 1]);
  });
  for (const [c, at] of caps) if (at.length > 1) errors.push(`подпись «${c}» повторяется в наборе: слоты ${at.join(', ')} (SETS.md 5.3)`);

  // ---- the collection: nothing noticeable repeats (SETS.md 1.5, 9.17–9.19) ----
  const others = registry.filter(r => !(plan.variant && r.group === plan.variant.group));
  /** @type {Map<string, RegistryEntry>} */
  const taken = new Map(others.filter(r => r.key).map(r => [r.key, r]));
  slots.forEach((s, i) => {
    const mine = isScene(s) ? (s.props || []) : [s.kind];
    for (const k of mine) {
      const hit = taken.get(kindKey(k));
      if (hit) errors.push(`${where(i, s)}: вид «${k}» уже есть в наборе «${hit.set}» (${hit.role === 'hero' ? 'героем' : 'в сцене'}); в коллекции он не появляется заметно второй раз — возьмите другой вид (SETS.md 1.5)`);
    }
    const t = String(s.order.title ?? '').toLowerCase().trim();
    const same = others.find(r => r.caption && r.caption.toLowerCase().trim() === t);
    if (t && same) errors.push(`${where(i, s)}: подпись «${s.order.title}» уже есть в наборе «${same.set}» — подписи в коллекции не повторяются (SETS.md 9.19)`);
  });
  if (plan.title && titles.some(t => t.toLowerCase() === plan.title.toLowerCase())) errors.push(`набор «${plan.title}» в коллекции уже есть — названия наборов не повторяются (SETS.md 1.5)`);

  // ---- variants of one set (SETS.md 4.5, 9.14–9.15) ----
  for (const v of variants) {
    const vn = normalizePlan(v).plan;
    const label = `вариант ${vn.variant?.n ?? '?'}`;
    const layout = (/** @type {SetPlan} */ p) => JSON.stringify([p.window?.layout, (p.slots || []).map(s => [s.stars, s.frame, isScene(s)])]);
    if (layout(vn) !== layout(plan)) errors.push(`${label}: раскладка окна у вариантов одна — то же окно, звёзды, рамки и места сцен (SETS.md 4.5, 9.14)`);
    const rowsOf = (/** @type {SetPlan} */ p) => {
      /** @type {Map<string, Set<string>>} */
      const m = new Map();
      for (const e of registryOf(p)) if (e.key) m.set(e.key, new Set([...(m.get(e.key) || []), e.row ?? 'scene']));
      return m;
    };
    const a = rowsOf(plan), b = rowsOf(vn);
    const shared = [...a.keys()].filter(k => b.has(k));
    if (shared.length > rules.variants.max_shared_kinds) errors.push(`${label}: общих видов предметов ${shared.length} (${shared.join(', ')}), а варианты делят не больше ${rules.variants.max_shared_kinds} (SETS.md 4.5, 9.15)`);
    for (const k of shared) {
      const same = [.../** @type {Set<string>} */ (a.get(k))].filter(r => /** @type {Set<string>} */ (b.get(k)).has(r));
      if (same.length) errors.push(`${label}: общий вид «${k}» в той же постановке (${same.join(', ')}) — в другом варианте дайте ему другую постановку (SETS.md 4.5, 9.15)`);
    }
  }

  // the person's word wins (VISION «Слово человека — главное»): with humanRequest the set rules only warn; the
  // orders keep their own errors (an order states its own humanRequest to core/style)
  if (plan.humanRequest) {
    const ruleErrors = errors.filter(e => !orderErrors.includes(e));
    return { errors: errors.filter(e => orderErrors.includes(e)), warnings: [...warnings, ...ruleErrors.map(e => `по просьбе человека («${plan.humanRequest}»): ${e}`)], plan };
  }
  return { errors, warnings, plan };
}

/**
 * The pattern of an abstract backdrop as counted by SETS.md 3.7 (straight stripes: their direction is part of it).
 * @param {CardOrder} order @param {import('../style/style.js').Style} style
 */
function patternKey(order, style) {
  const p = String(stagingValue(order, style, 'pattern'));
  return p === 'stripes_straight' ? `${p}/${stagingValue(order, style, 'stripes')}` : p;
}

/**
 * Checks the plans of a whole collection: each set against the others (registry, titles, captions), the grand set
 * last, and the growth of scenes towards the end (SETS.md 1.4, 9.16–9.21).
 * @param {SetPlan[]} plans  in collection order (by `number` when given)
 * @param {{complete?: boolean}} [o]  complete: the collection must have all its sets (16)
 * @returns {Verdict & {sets: (Verdict & {title: string})[]}}
 */
export function validateCollection(plans, { complete = true } = {}) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (!plans.length) return { errors: ['в коллекции нет наборов'], warnings, sets: [] };
  const { rules } = loadSetRules(plans[0].style);
  const ordered = [...plans].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const reg = ordered.map(p => registryOf(normalizePlan(p).plan));
  const sets = ordered.map((p, i) => {
    const sameGroup = (/** @type {SetPlan} */ q) => q !== p && !!p.variant && q.variant?.group === p.variant.group;
    const v = validatePlan(p, {
      registry: reg.filter((_, j) => j !== i).flat(),
      variants: ordered.filter(sameGroup),
      titles: ordered.filter(q => q !== p && !sameGroup(q)).map(q => q.title),
    });
    return { title: p.title, errors: v.errors, warnings: v.warnings };
  });
  // one set per place in the collection: variants of a set count once
  /** @type {Map<string, SetPlan>} */
  const byPlace = new Map();
  for (const p of ordered) byPlace.set(p.variant?.group ?? `#${p.number ?? p.title}`, p);
  const placed = [...byPlace.values()];
  const n = rules.collection.sets;
  if (complete && placed.length !== n) errors.push(`в коллекции ${n} наборов, а их ${placed.length} (SETS.md 1.1, 9.16)`);
  const grands = placed.filter(p => p.grand);
  if (grands.length > 1) errors.push('гранд-набор в коллекции один');
  if (grands.length && placed[placed.length - 1] !== grands[0]) errors.push('гранд-набор — последний в коллекции (SETS.md 1.4, 9.16)');
  const regular = placed.filter(p => !p.grand);
  const k = rules.collection.growth_window;
  if (regular.length >= 2 * k) {
    const scenes = (/** @type {SetPlan[]} */ ps) => ps.reduce((sum, p) => sum + (p.slots || []).filter(isScene).length, 0);
    const first = scenes(regular.slice(0, k)), last = scenes(regular.slice(-k));
    if (last <= first) errors.push(`сцен с персонажами в последних ${k} обычных наборах (${last}) должно быть больше, чем в первых ${k} (${first}) (SETS.md 1.4, 9.20)`);
  }
  return { errors, warnings, sets };
}
