// The hero of a card: its outline (mask), box and how far the outline can be trusted, for the style's checks.
//
// Two ways in, one refinement:
//   1. A box from an agent or a person (they see the card): the outline is cut inside it by GrabCut
//      (core/image/segment.js). Free, offline, about 0.5 s.
//   2. No box (the editor without an agent, unattended runs): vision models answer with the hero's box
//      (core/providers/openrouter.js askVision; models, prompt and agreement threshold in settings → hero), and the
//      outline is cut inside the first model's box. Two models are asked; the outline is trusted only when their boxes
//      agree. About $0.0004 and 2 s per card with the default models.
// An outline that is not trusted comes back with confidence "low": the loop then asks the agent for a box (path 1).
//
// Measured on the 160 Scapes reference cards and 13 generated attempts of trial round 2 (CHANGELOG 2026-10-30):
// a box drawn by eye → outline whose check statuses agree with the person-confirmed outlines on 98.4 % of the
// outline-based checks; the vision path with agreement ≥ 0.8 is trusted on 140 of 173 cards, 94 % of them correct.
import sharp from 'sharp';
import { boxIou, boxOf, outlineInBox } from '../image/segment.js';
import { askVision } from '../providers/openrouter.js';

/** @typedef {import('../image/segment.js').Box} Box */
/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */

/**
 * @typedef {object} HeroSettings  settings/defaults.json → hero
 * @property {{id: string, format: string}[]} models  vision models in order; the first one's box is cut; format = key of FORMATS
 * @property {number} agreeIou  the outline is trusted when the first two models' boxes overlap at least this much (IoU)
 * @property {number} maxTokens
 * @property {number} timeoutMs  per vision call
 * @property {{template: string, object: string, scene: string}} prompt  {width} {height} {hero} {answer}; {what}
 */

/**
 * @typedef {object} Hero
 * @property {Uint8Array|null} fg  1 = hero pixel; null when no outline was made
 * @property {Box|null} box  box of the outline
 * @property {'box'|'vision'|null} source  where the box the outline was cut in came from
 * @property {'high'|'low'} confidence  high = the checks may rest on the outline; low = ask for a box
 * @property {string[]} reasons  why the confidence is low (empty when high)
 * @property {{model: string, box: Box|null, cost: number|null, error?: string}[]} [vision]  the models' answers
 * @property {number|null} [agreement]  IoU of the first two models' boxes
 * @property {number} cost  USD spent on vision calls (0 for a given box)
 */

// An outline cut in a box is not believed when it collapsed: it covers less than this share of the box, or its own
// box overlaps the given box less than this (on the 173 cards with a box by eye neither happened).
const MIN_FILL = 0.15;
const MIN_BOX_IOU = 0.5;

/**
 * Answer formats the vision models are asked for, each in the convention its model family was trained on
 * (Gemini: box_2d [ymin, xmin, ymax, xmax] on 0–1000; Qwen-VL: bbox_2d [x1, y1, x2, y2] on 0–1000).
 * @type {Record<string, {answer: string, toBox: (j: any, width: number, height: number) => number[]|null}>}
 */
export const FORMATS = {
  gemini: {
    answer: 'Answer only JSON: {"box_2d": [ymin, xmin, ymax, xmax]} with coordinates normalized to 0-1000.',
    toBox: (j, w, h) => (Array.isArray(j.box_2d) && j.box_2d.length === 4 ? [j.box_2d[1] / 1000 * w, j.box_2d[0] / 1000 * h, j.box_2d[3] / 1000 * w, j.box_2d[2] / 1000 * h] : null),
  },
  qwen: {
    answer: 'Answer only JSON: {"bbox_2d": [x1, y1, x2, y2]} with coordinates normalized to 0-1000.',
    toBox: (j, w, h) => (Array.isArray(j.bbox_2d) && j.bbox_2d.length === 4 ? [j.bbox_2d[0] / 1000 * w, j.bbox_2d[1] / 1000 * h, j.bbox_2d[2] / 1000 * w, j.bbox_2d[3] / 1000 * h] : null),
  },
  pixels: {
    answer: 'Answer only JSON: {"box": [x0, y0, x1, y1]} in pixels, x from the left edge, y from the top edge.',
    toBox: j => (Array.isArray(j.box) && j.box.length === 4 ? j.box : null),
  },
};

/**
 * A box clamped to the frame and rounded, or null when it is not a box (wrong shape, not numbers, under 4 px a side).
 * @param {unknown} b @param {number} width @param {number} height @returns {Box|null}
 */
export function cleanBox(b, width, height) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const x0 = Math.max(0, Math.round(Math.min(b[0], b[2]))), x1 = Math.min(width - 1, Math.round(Math.max(b[0], b[2])));
  const y0 = Math.max(0, Math.round(Math.min(b[1], b[3]))), y1 = Math.min(height - 1, Math.round(Math.max(b[1], b[3])));
  return x1 - x0 >= 4 && y1 - y0 >= 4 ? [x0, y0, x1, y1] : null;
}

/**
 * The box in a model's answer (the first JSON object in the text), or null.
 * @param {string} text @param {string} format key of FORMATS @param {number} width @param {number} height
 * @returns {Box|null}
 */
export function parseBox(text, format, width, height) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Неизвестный формат ответа модели: «${format}» (есть: ${Object.keys(FORMATS).join(', ')}).`);
  const m = String(text).match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { return cleanBox(f.toBox(JSON.parse(m[0]), width, height), width, height); } catch { return null; }
}

/**
 * Words naming the hero of an order for the vision prompt.
 * @param {CardOrder} order @param {HeroSettings['prompt']} p
 */
export function heroWords(order, p) {
  const scene = order.scene;
  const what = order.subject || order.object
    || (scene ? [scene.characters?.map(c => c.name).join(' and '), scene.action, scene.item, scene.jokeObject].filter(Boolean).join('; ') : '')
    || order.title || 'the main subject';
  return ((order.staging?.characters ?? 0) > 0 ? p.scene : p.object).replace('{what}', what);
}

/**
 * The vision prompt for one model.
 * @param {{order: CardOrder, format: string, width: number, height: number, settings: HeroSettings}} o
 */
export function visionPrompt({ order, format, width, height, settings }) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Неизвестный формат ответа модели: «${format}».`);
  return settings.prompt.template.replace('{width}', String(width)).replace('{height}', String(height))
    .replace('{hero}', heroWords(order, settings.prompt)).replace('{answer}', f.answer);
}

/**
 * Asks each model of the settings for the hero's box. `ask` is the provider call (openrouter.askVision with the
 * endpoint and key bound); a failed call is recorded, not thrown.
 * @param {{image: {bytes?: Uint8Array, path?: string, mime?: string}, order: CardOrder, width: number, height: number, settings: HeroSettings,
 *   ask: (req: {model: string, prompt: string, image: {bytes?: Uint8Array, path?: string, mime?: string}, maxTokens: number}) => Promise<{text: string, cost: number|null}>}} o
 * @returns {Promise<{model: string, box: Box|null, cost: number|null, error?: string}[]>}
 */
export async function locateHero({ image, order, width, height, settings, ask }) {
  return Promise.all(settings.models.map(async ({ id, format }) => {
    try {
      const r = await ask({ model: id, prompt: visionPrompt({ order, format, width, height, settings }), image, maxTokens: settings.maxTokens });
      const box = parseBox(r.text, format, width, height);
      return box ? { model: id, box, cost: r.cost } : { model: id, box: null, cost: r.cost, error: `no box in the answer: ${r.text.slice(0, 120)}` };
    } catch (/** @type {any} */ e) {
      return { model: id, box: null, cost: null, error: String(e?.message || e) };
    }
  }));
}

/**
 * The `ask` of locateHero through the OpenRouter provider of the settings (its endpoint, retries and backoff;
 * the timeout of settings → hero).
 * @param {{settings: import('../settings.js').Settings, apiKey: string}} o
 */
export function openrouterAsk({ settings, apiKey }) {
  const or = settings.provider.openrouter;
  /** @param {{model: string, prompt: string, image: {bytes?: Uint8Array, path?: string, mime?: string}, maxTokens: number}} req */
  return ({ model, prompt, image, maxTokens }) => askVision({
    endpoint: or.endpoint, apiKey, model, prompt, image, maxTokens,
    net: { timeoutMs: settings.hero.timeoutMs, retries: or.retries, backoffMs: or.backoffMs },
  });
}

/**
 * The outline cut inside a box, with the checks that it did not collapse.
 * @param {{pixels: ArrayLike<number>, width: number, height: number, box: Box}} o
 * @returns {{fg: Uint8Array, box: Box|null, reasons: string[]}}
 */
export function outlineFromBox({ pixels, width, height, box }) {
  const fg = outlineInBox(pixels, width, height, box);
  const own = boxOf(fg, width);
  let area = 0; for (let p = 0; p < fg.length; p++) area += fg[p];
  const boxArea = (box[2] - box[0] + 1) * (box[3] - box[1] + 1);
  /** @type {string[]} */
  const reasons = [];
  if (area < MIN_FILL * boxArea) reasons.push(`the outline covers ${(area / boxArea).toFixed(2)} of the box (< ${MIN_FILL})`);
  if (boxIou(own, box) < MIN_BOX_IOU) reasons.push(`the outline's box overlaps the given box ${boxIou(own, box).toFixed(2)} (< ${MIN_BOX_IOU})`);
  return { fg, box: own, reasons };
}

/**
 * The hero of a card. With `box` (from an agent or a person) the outline is cut in it; otherwise, with `locate`,
 * vision models give the box. Without either nothing is made and confidence is low.
 * @param {object} o
 * @param {ArrayLike<number>} o.pixels  RGB or RGBA of the card
 * @param {number} o.width @param {number} o.height
 * @param {number[]} [o.box]  [x0, y0, x1, y1] px
 * @param {() => Promise<{model: string, box: Box|null, cost: number|null, error?: string}[]>} [o.locate]  e.g. () => locateHero(…)
 * @param {number} [o.agreeIou]  settings → hero.agreeIou (needed with locate)
 * @returns {Promise<Hero>}
 */
export async function findHero({ pixels, width, height, box, locate, agreeIou }) {
  if (box) {
    const b = cleanBox(box, width, height);
    if (!b) return { fg: null, box: null, source: 'box', confidence: 'low', reasons: [`not a box inside the ${width} × ${height} frame: ${JSON.stringify(box)}`], cost: 0 };
    const r = outlineFromBox({ pixels, width, height, box: b });
    return { fg: r.fg, box: r.box, source: 'box', confidence: r.reasons.length ? 'low' : 'high', reasons: r.reasons, cost: 0 };
  }
  if (!locate) return { fg: null, box: null, source: null, confidence: 'low', reasons: ['no box given and no vision model to ask'], cost: 0 };
  const vision = await locate();
  const cost = vision.reduce((s, v) => s + (v.cost || 0), 0);
  const first = vision[0]?.box;
  if (!first) return { fg: null, box: null, source: 'vision', confidence: 'low', reasons: [`the first vision model gave no box (${vision[0]?.error || 'no model in the settings'})`], vision, agreement: null, cost };
  /** @type {string[]} */
  const reasons = [];
  const agreement = vision.length > 1 ? boxIou(first, vision[1].box) : null;
  if (agreement == null) reasons.push('only one vision model: no second opinion');
  else if (agreeIou == null || agreement < agreeIou) reasons.push(`the two vision models disagree: box IoU ${agreement.toFixed(2)} (< ${agreeIou})`);
  const r = outlineFromBox({ pixels, width, height, box: first });
  reasons.push(...r.reasons);
  return { fg: r.fg, box: r.box, source: 'vision', confidence: reasons.length ? 'low' : 'high', reasons, vision, agreement, cost };
}

/**
 * RGB pixels of an image file (the card as checked).
 * @param {string} file @returns {Promise<{pixels: Uint8Array, width: number, height: number}>}
 */
export async function readPixels(file) {
  const { data, info } = await sharp(file).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

/**
 * The outline as a PNG: white = hero, black = backdrop (what an editor or another program reads back).
 * @param {Uint8Array} fg @param {number} width @param {number} height @param {string} file
 */
export async function writeOutline(fg, width, height, file) {
  await sharp(Buffer.from(fg.map(v => (v ? 255 : 0))), { raw: { width, height, channels: 1 } }).png().toFile(file);
}

/**
 * An outline PNG written by writeOutline (or drawn by a person: any pixel brighter than mid-grey is hero).
 * @param {string} file @returns {Promise<{fg: Uint8Array, width: number, height: number}>}
 */
export async function readOutline(file) {
  const { data, info } = await sharp(file).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  return { fg: Uint8Array.from(data, v => (v > 127 ? 1 : 0)), width: info.width, height: info.height };
}
