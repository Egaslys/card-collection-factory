// The hero of a card: its outline (mask), box and how far the outline can be trusted, for the style's checks.
//
// Two ways in, one refinement:
//   1. A box from an agent or a person (they see the card): the outline is cut inside it by GrabCut
//      (core/image/segment.js). Free, offline, well under a second.
//   2. No box (the editor without an agent, unattended runs): the vision model of the settings (settings → vision)
//      answers with the hero's box, and the outline is cut inside it. The model is asked twice — on the card and on
//      its mirror image — and the outline is trusted only when the two boxes agree (settings → hero.agreeIou): one
//      model, one self-consistency check.
// An outline that is not trusted comes back with confidence "low": the loop then asks the agent for a box (path 1).
// The box has its own confidence: in scenes and environments the outline takes sky and water between the
// characters, but the box is right, so composition can still be measured on it (the style says where: outlineFits).
// Measured accuracy, cost and time: CHANGELOG.md, entry of 2026-10-30 on the hero outline.
import sharp from 'sharp';
import { boxIou, boxOf, outlineInBox } from '../image/segment.js';
import { apiOf, presetOf } from '../providers/preset.js';

/** @typedef {import('../image/segment.js').Box} Box */
/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */
/** @typedef {{bytes?: Uint8Array, path?: string, mime?: string}} ImageRef */

/**
 * @typedef {object} VisionSettings  settings/defaults.json → vision: how the preset's visionModel is asked (provider.<preset>)
 * @property {string} format  answer format of the model's family: a key of FORMATS
 * @property {Record<string, unknown>|null} reasoning  the reasoning field ({effort}); null = not sent
 * @property {number} timeoutMs  per call
 */

/**
 * @typedef {object} HeroSettings  settings/defaults.json → hero
 * @property {boolean} mirrorCheck  ask the model also on the mirror image and trust the outline only when the boxes agree
 * @property {number} agreeIou  the least overlap (intersection over union) of the two boxes for a trusted outline
 * @property {number} maxTokens
 * @property {{template: string, object: string, scene: string}} prompt  {width} {height} {hero} {answer}; {what}
 */

/** @typedef {{view: 'card'|'mirror', box: Box|null, cost: number|null, error?: string}} VisionAnswer  box in the card's coordinates */

/**
 * @typedef {object} Hero
 * @property {Uint8Array|null} fg  1 = hero pixel; null when no outline was made
 * @property {Box|null} box  the box the outline was cut in (the agent's, the person's or the model's)
 * @property {'box'|'vision'|null} source  where that box came from
 * @property {'high'|'low'} confidence  of the outline: high = the outline-based checks may be measured on it
 * @property {'high'|'low'} boxConfidence  of the box: high = composition may be measured on it (as on a box by eye)
 * @property {string[]} reasons  why either confidence is low (empty when both are high)
 * @property {VisionAnswer[]} [vision]  the model's answers
 * @property {number|null} [agreement]  IoU of the boxes on the card and on its mirror image
 * @property {number} cost  USD spent on vision calls (0 for a given box)
 */

// An outline cut in a box is not believed when it collapsed: it covers less than this share of the box, or its own
// box overlaps the given box less than this. On the 173 cards of the measurement with a box by eye, the outline's
// box overlapped the given box at least 0.65.
const MIN_FILL = 0.15;
const MIN_BOX_IOU = 0.5;

/**
 * Answer formats a vision model is asked for, each in the convention its family was trained on
 * (Gemini: box_2d [ymin, xmin, ymax, xmax] on 0–1000; Qwen-VL: bbox_2d [x1, y1, x2, y2] on 0–1000).
 * key: the answer's field; quad: four numbers of it → [x0, y0, x1, y1] px.
 * @type {Record<string, {key: string, answer: string, quad: (q: number[], width: number, height: number) => number[]}>}
 */
export const FORMATS = {
  gemini: {
    key: 'box_2d',
    answer: 'Answer only JSON: {"box_2d": [ymin, xmin, ymax, xmax]} with coordinates normalized to 0-1000.',
    quad: (q, w, h) => [q[1] / 1000 * w, q[0] / 1000 * h, q[3] / 1000 * w, q[2] / 1000 * h],
  },
  qwen: {
    key: 'bbox_2d',
    answer: 'Answer only JSON: {"bbox_2d": [x1, y1, x2, y2]} with coordinates normalized to 0-1000.',
    quad: (q, w, h) => [q[0] / 1000 * w, q[1] / 1000 * h, q[2] / 1000 * w, q[3] / 1000 * h],
  },
  pixels: {
    key: 'box',
    answer: 'Answer only JSON: {"box": [x0, y0, x1, y1]} in pixels, x from the left edge, y from the top edge.',
    quad: q => q,
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
 * The box in a model's answer, or null. The numbers after the format's field are read in fours, so the variants
 * the model was seen to answer with also count: a list of boxes ([[…], […]] — their union, e.g. one per character),
 * an object of four values, JSON with a missing bracket, a misspelt key ("box_d" for "box_2d").
 * @param {string} text @param {string} format key of FORMATS @param {number} width @param {number} height
 * @returns {Box|null}
 */
export function parseBox(text, format, width, height) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Неизвестный формат ответа модели: «${format}» (есть: ${Object.keys(FORMATS).join(', ')}).`);
  const s = String(text);
  // The documented key first; else any key that looks like a box (Gemini 3.8 Flash was seen answering "box_d"),
  // its numbers read in the format's order.
  const m = new RegExp(`"${f.key}"\\s*:`).exec(s) || /"[a-z0-9_]*box[a-z0-9_]*"\s*:/i.exec(s);
  if (!m) return null;
  const rest = s.slice(m.index + m[0].length), end = rest.indexOf('}');
  const nums = ((end < 0 ? rest : rest.slice(0, end)).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 4 || nums.length % 4) return null;
  /** @type {Box|null} */
  let union = null;
  for (let i = 0; i < nums.length; i += 4) {
    const b = cleanBox(f.quad(nums.slice(i, i + 4), width, height), width, height);
    if (!b) return null;
    union = union ? [Math.min(union[0], b[0]), Math.min(union[1], b[1]), Math.max(union[2], b[2]), Math.max(union[3], b[3])] : b;
  }
  return union;
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
 * The vision prompt.
 * @param {{order: CardOrder, format: string, width: number, height: number, settings: HeroSettings}} o
 */
export function visionPrompt({ order, format, width, height, settings }) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Неизвестный формат ответа модели: «${format}».`);
  return settings.prompt.template.replace('{width}', String(width)).replace('{height}', String(height))
    .replace('{hero}', heroWords(order, settings.prompt)).replace('{answer}', f.answer);
}

/** The box of a mirror image in the card's coordinates. @param {Box} b @param {number} width @returns {Box} */
export const unmirror = (b, width) => [width - 1 - b[2], b[1], width - 1 - b[0], b[3]];

/**
 * Asks the vision model for the hero's box on the card and, with mirrorCheck, on its mirror image. `ask` is the
 * provider call (visionAsk); a failed call is recorded, not thrown.
 * @param {{image: ImageRef, order: CardOrder, width: number, height: number, vision: VisionSettings, settings: HeroSettings,
 *   ask: (req: {prompt: string, image: ImageRef, maxTokens: number}) => Promise<{text: string, cost: number|null}>}} o
 * @returns {Promise<VisionAnswer[]>}
 */
export async function locateHero({ image, order, width, height, vision, settings, ask }) {
  const prompt = visionPrompt({ order, format: vision.format, width, height, settings });
  /** @param {'card'|'mirror'} view @returns {Promise<VisionAnswer>} */
  const one = async view => {
    try {
      const img = view === 'card' ? image : { bytes: await sharp(image.bytes ?? image.path).flop().png().toBuffer(), mime: 'image/png' };
      const r = await ask({ prompt, image: img, maxTokens: settings.maxTokens });
      const b = parseBox(r.text, vision.format, width, height);
      if (!b) return { view, box: null, cost: r.cost, error: `no box in the answer: ${r.text.slice(0, 120)}` };
      return { view, box: view === 'card' ? b : unmirror(b, width), cost: r.cost };
    } catch (/** @type {any} */ e) {
      return { view, box: null, cost: typeof e?.cost === 'number' ? e.cost : null, error: String(e?.message || e) };
    }
  };
  return Promise.all(settings.mirrorCheck ? [one('card'), one('mirror')] : [one('card')]);
}

/**
 * The `ask` of locateHero through the API preset of the settings (its endpoint, vision model, retries and backoff),
 * asked as settings → vision says.
 * @param {{settings: import('../settings.js').Settings, apiKey: string}} o
 */
export function visionAsk({ settings, apiKey }) {
  const p = presetOf(settings.provider), v = settings.vision;
  /** @param {{prompt: string, image: ImageRef, maxTokens: number}} req */
  return ({ prompt, image, maxTokens }) => apiOf(p.name).askVision({
    endpoint: p.endpoint, apiKey, prices: p.prices, model: p.visionModel, prompt, image, maxTokens, reasoning: v.reasoning ?? undefined,
    net: { timeoutMs: v.timeoutMs, retries: p.retries, backoffMs: p.backoffMs },
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
 * the vision model gives the box. Without either nothing is made and confidence is low.
 * @param {object} o
 * @param {ArrayLike<number>} o.pixels  RGB or RGBA of the card
 * @param {number} o.width @param {number} o.height
 * @param {number[]} [o.box]  [x0, y0, x1, y1] px
 * @param {() => Promise<VisionAnswer[]>} [o.locate]  e.g. () => locateHero(…)
 * @param {number} [o.agreeIou]  settings → hero.agreeIou (needed with locate)
 * @param {boolean} [o.outlineFits]  false = the style knows the outline is unreliable on this staging (Scapes: scenes
 *   and environments, where it takes sky and water between the characters): the box can still be trusted
 * @returns {Promise<Hero>}
 */
export async function findHero({ pixels, width, height, box, locate, agreeIou, outlineFits = true }) {
  const misfit = 'the outline is not reliable on this staging (the style says so): only the box is used';
  if (box) {
    const b = cleanBox(box, width, height);
    if (!b) return { fg: null, box: null, source: 'box', confidence: 'low', boxConfidence: 'low', reasons: [`not a box inside the ${width} × ${height} frame: ${JSON.stringify(box)}`], cost: 0 };
    const r = outlineFromBox({ pixels, width, height, box: b });
    const reasons = [...r.reasons, ...(outlineFits ? [] : [misfit])];
    return { fg: r.fg, box: b, source: 'box', confidence: reasons.length ? 'low' : 'high', boxConfidence: 'high', reasons, cost: 0 };
  }
  if (!locate) return { fg: null, box: null, source: null, confidence: 'low', boxConfidence: 'low', reasons: ['no box given and no vision model to ask'], cost: 0 };
  const vision = await locate();
  const cost = vision.reduce((s, v) => s + (v.cost || 0), 0);
  const first = vision[0]?.box;
  if (!first) return { fg: null, box: null, source: 'vision', confidence: 'low', boxConfidence: 'low', reasons: [`the vision model gave no box (${vision[0]?.error || 'no answer'})`], vision, agreement: null, cost };
  /** @type {string[]} */
  const reasons = [];
  const agreement = vision.length > 1 ? boxIou(first, vision[1].box) : null;
  if (agreement == null) reasons.push('no second look (mirror check off): the box is not cross-checked');
  else if (agreeIou == null || agreement < agreeIou) reasons.push(`the boxes on the card and on its mirror image disagree: IoU ${agreement.toFixed(2)} (< ${agreeIou})${vision[1].error ? `; ${vision[1].error}` : ''}`);
  const boxConfidence = reasons.length ? 'low' : 'high';
  const r = outlineFromBox({ pixels, width, height, box: first });
  reasons.push(...r.reasons, ...(outlineFits ? [] : [misfit]));
  return { fg: r.fg, box: first, source: 'vision', confidence: reasons.length ? 'low' : 'high', boxConfidence, reasons, vision, agreement, cost };
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
