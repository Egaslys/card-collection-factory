// The card order: what the agent (or the editor) asks the program to draw for one card, and its
// validator. The staging vocabulary and which fields a staging needs are read from the style's
// prompt-assembly.json (`fields`), not written here; core/style/README.md explains every field.
import path from 'node:path';
import { assemble, stagingValue, matches } from './assembly.js';
import { loadStyle, styleDirOf } from './style.js';

/**
 * Staging of a card. The first nine fields are the spec fields of styles/<style>/checks/check-card.mjs
 * (the same names and values, so an order can be checked as it is); the rest pick a variant
 * inside a bible fragment. Allowed values: `fields` of styles/<style>/prompt-assembly.json.
 * @typedef {object} Staging
 * @property {number} category   1–5
 * @property {string} backdrop   field | wall | environment | none
 * @property {string} pattern    rays | rings | … | plain_gradient | other | n/a
 * @property {string} placement  floating_field | resting | wall_mounted | …
 * @property {string} support    none | ephemeral | fragment | ground | …
 * @property {string} camera     eye_level | high | low
 * @property {number} characters 0 | 1 | 2
 * @property {string} time       day | golden | dusk | night | n/a
 * @property {boolean} sky_top   the top of the frame is day sky
 * @property {string} [stripes]  vertical | diagonal (straight stripes)
 * @property {string} [surface]  the textured support or the full-frame surface: sand | grass | wood | deck | tiles | water
 * @property {string} [medium]   sky | water (floating in its own medium)
 * @property {string} [setting]  outdoor | interior | sky_structure (category 4 environments; interior also for scenes)
 * @property {string} [wall]     stripes | planks | brick | curtain | plain | plaster
 * @property {string} [floor]    wood | tiles | stage (floor in front of a wall)
 * @property {string} [shape]    boxy (default) | front_facing | flat
 * @property {string|string[]} [material]  main material(s) of the hero: labels of the bible's material fragments
 * @property {boolean} [effects]       steam, smoke, foam, droplets, light cones on the card
 * @property {boolean} [stage_lights]  coloured rim from stage spots
 * @property {string} [brand]          house | cow — the style's brand mark on the hero
 * @property {string} [brand_finish]   embossed | patch | carved | sticker | stamp
 */

/**
 * @typedef {object} SceneCharacter
 * @property {string} name      man | pig | sheep | rooster | cow (`cast` of prompt-assembly.json)
 * @property {string} [costume] English sentence appended after the character's description
 */

/**
 * A golden scene (category 5). English words that fill the scene frame of the bible.
 * @typedef {object} Scene
 * @property {string} theme       "lake fishing"
 * @property {string} time        "at sunset" — the time of day as words (staging.time is the checks' value)
 * @property {string} action      what the characters do: "sit on the dock fishing"
 * @property {string} item        the set item they do it with: "rods"
 * @property {string} joke        the gentle comic twist
 * @property {string} reactor     who reacts to the twist: "the Man"
 * @property {string} jokeObject  the twist object: "the old boot"
 * @property {string} crop        hips | waist | knees — where the bottom edge cuts the characters
 * @property {SceneCharacter[]} characters  one or two; their count equals staging.characters
 */

/**
 * @typedef {object} CardOrder
 * @property {string} id
 * @property {string} style        style folder name: styles/<style>
 * @property {string} [title]      caption (not used in the prompt)
 * @property {string} [subject]    English description of the hero; required for categories 1–4
 * @property {string} [object]     short English name of the hero for the staging phrase ("fishing bobber")
 * @property {string} [place]      short English place ("lake shore"): category 4 outdoors, scenes
 * @property {string} [environment] English description of the place for the setting phrase
 * @property {string} [motif]      backdrop icon motif (pattern motif_repeat)
 * @property {string} [palette]    hero against backdrop colours ("a red-and-white object on sky blue")
 * @property {Staging} staging
 * @property {Scene} [scene]       required for category 5
 * @property {string} [promptExtra]    appended to the assembled prompt
 * @property {string} [promptOverride] replaces the assembled prompt entirely (the human's word wins)
 * @property {number[]} [references]   reference card numbers to attach instead of the picked ones
 */

const ORDER_KEYS = ['id', 'style', 'title', 'subject', 'object', 'place', 'environment', 'motif', 'palette', 'staging', 'scene', 'promptExtra', 'promptOverride', 'references'];
const SCENE_KEYS = ['theme', 'time', 'action', 'item', 'joke', 'reactor', 'jokeObject', 'crop', 'characters'];
const TEXT_KEYS = ['id', 'style', 'title', 'subject', 'object', 'place', 'environment', 'motif', 'palette', 'promptExtra', 'promptOverride'];

/** @param {unknown} v */
const show = v => JSON.stringify(v);

/**
 * Checks an order against the style. Returns readable errors; an empty list means the order is valid
 * and buildPrompt can assemble it.
 * @param {CardOrder} order
 * @param {{styleDir?: string}} [opts]  default: styles/<order.style>
 * @returns {Promise<string[]>}
 */
export async function validateOrder(order, { styleDir } = {}) {
  if (!order || typeof order !== 'object') return ['заказ карточки должен быть объектом'];
  if (!styleDir && typeof order.style !== 'string') return ['нет поля style (имя папки стиля)'];
  return checkOrder(order, loadStyle(styleDir || styleDirOf(order.style)));
}

/**
 * The same check with a loaded style (synchronous).
 * @param {CardOrder} order
 * @param {import('./style.js').Style} style
 * @returns {string[]}
 */
export function checkOrder(order, style) {
  /** @type {string[]} */
  const errors = [];
  const o = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (order));
  for (const k of Object.keys(o)) if (!ORDER_KEYS.includes(k)) errors.push(`неизвестное поле заказа «${k}»; допустимы: ${ORDER_KEYS.join(', ')}`);
  for (const k of TEXT_KEYS) if (o[k] !== undefined && (typeof o[k] !== 'string' || !String(o[k]).trim())) errors.push(`поле ${k} должно быть непустой строкой`);
  if (typeof order.id !== 'string') errors.push('нет поля id');
  if (typeof order.style !== 'string') errors.push('нет поля style (имя папки стиля)');
  else if (order.style !== path.basename(style.dir)) errors.push(`style = ${show(order.style)}, а папка стиля — ${path.basename(style.dir)}`);

  const st = order.staging;
  if (!st || typeof st !== 'object') return [...errors, 'нет поля staging (постановка)'];
  errors.push(...checkStaging(order, style));
  if (errors.length) return errors;

  const category = stagingValue(order, style, 'category');
  if (category !== 5 && !order.subject) errors.push('нет поля subject: описание предмета по-английски нужно для категорий 1–4');
  if (category === 5) errors.push(...checkScene(order, style));
  else if (order.scene !== undefined) errors.push('поле scene — только для категории 5 (сцена с персонажами)');

  if (order.references !== undefined) {
    if (!Array.isArray(order.references) || !order.references.length) errors.push('references — непустой список номеров эталонных карточек');
    else {
      const known = new Set(style.references.map(r => r.ref));
      for (const n of order.references) if (!known.has(n)) errors.push(`references: нет эталонной карточки №${show(n)}`);
      if (new Set(order.references).size !== order.references.length) errors.push('references: номера повторяются');
    }
  }
  if (errors.length) return errors;
  if (order.promptOverride) return errors; // the assembled prompt is not used: its slots need no values
  return assemble(order, style).errors;
}

/** @param {CardOrder} order @param {import('./style.js').Style} style @returns {string[]} */
function checkStaging(order, style) {
  /** @type {string[]} */
  const errors = [];
  const fields = style.assembly.fields;
  const st = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (order.staging));
  for (const k of Object.keys(st)) if (!fields[k]) errors.push(`неизвестное поле постановки staging.${k}; допустимы: ${Object.keys(fields).join(', ')}`);
  for (const [name, rule] of Object.entries(fields)) {
    const v = st[name];
    if (v === undefined) {
      if (rule.required) errors.push(`нет поля staging.${name}`);
      continue;
    }
    const allowed = rule.values_from ? itemLabels(style, rule.values_from) : rule.values || [];
    const list = rule.list && Array.isArray(v) ? v : [v];
    if (!list.length) errors.push(`staging.${name}: пустой список`);
    for (const x of list) if (!allowed.includes(x)) errors.push(`staging.${name} = ${show(x)} — нет такого значения; допустимо: ${allowed.map(show).join(', ')}`);
  }
  if (errors.length) return errors;
  for (const [name, rule] of Object.entries(fields)) {
    if (st[name] !== undefined || !rule.required_when) continue;
    if (rule.required_when.some(c => matches(c, order, style))) errors.push(`для этой постановки нужно поле staging.${name}: ${(rule.values_from ? itemLabels(style, rule.values_from) : rule.values || []).map(show).join(', ')}`);
  }
  for (const f of style.assembly.forbid) if (matches(f.when, order, style)) errors.push(f.message);
  return errors;
}

/** @param {CardOrder} order @param {import('./style.js').Style} style @returns {string[]} */
function checkScene(order, style) {
  const sc = order.scene;
  if (!sc || typeof sc !== 'object') return ['категория 5: нужно поле scene (сцена с персонажами)'];
  /** @type {string[]} */
  const errors = [];
  const s = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (sc));
  for (const k of Object.keys(s)) if (!SCENE_KEYS.includes(k)) errors.push(`неизвестное поле scene.${k}; допустимы: ${SCENE_KEYS.join(', ')}`);
  for (const k of SCENE_KEYS) if (k !== 'characters' && s[k] !== undefined && (typeof s[k] !== 'string' || !String(s[k]).trim())) errors.push(`scene.${k} должно быть непустой строкой`);
  if (!Array.isArray(sc.characters) || !sc.characters.length) return [...errors, 'scene.characters — список персонажей сцены: [{ name, costume? }]'];
  const cast = style.assembly.cast;
  sc.characters.forEach((c, n) => {
    if (!c || typeof c !== 'object' || !cast[c.name]) errors.push(`scene.characters[${n}].name = ${show(c?.name)} — нет такого персонажа; есть: ${Object.keys(cast).join(', ')}`);
    if (c && c.costume !== undefined && (typeof c.costume !== 'string' || !c.costume.trim())) errors.push(`scene.characters[${n}].costume должно быть непустой строкой`);
  });
  if (new Set(sc.characters.map(c => c?.name)).size !== sc.characters.length) errors.push('scene.characters: персонаж повторяется');
  if (sc.characters.length !== stagingValue(order, style, 'characters')) errors.push(`staging.characters = ${stagingValue(order, style, 'characters')}, а в scene.characters их ${sc.characters.length}`);
  return errors;
}

/**
 * Labels of a labelled fragment's items (e.g. the material names).
 * @param {import('./style.js').Style} style
 * @param {string} id
 * @returns {string[]}
 */
export function itemLabels(style, id) {
  const f = style.fragments.get(id);
  return (f?.items || []).flatMap(it => (it.label ? [it.label] : []));
}
