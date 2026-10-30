// Per-card post-processing: the search for the core/image/adjust.js settings that put the card's measures inside the
// ranges the style aims at, with the smallest change from the starting settings. Generic: the measures and their
// ranges come from the caller (for a style: its checker's processingMeasures), the bounds from the style's
// processing.json (`bounds`, `sharpen_amount_max`).
import { adjust } from '../image/adjust.js';

/** @typedef {import('../image/adjust.js').AdjustSettings} AdjustSettings */
/** @typedef {{min?: number, max?: number}} Range */
/** @typedef {{id: string, value: number, aim: Range}} Measure */
/** @typedef {{min: number, max: number, step: number, serves: string}} Axis  serves: the measure ids (prefix) this axis is for */

/**
 * @typedef {object} Tuning  how the attempt's processing settings were found (kept in the attempt next to them)
 * @property {AdjustSettings} start  the starting settings (style or factory settings for the model)
 * @property {{id: string, aim: Range, model: number, start: number, chosen: number}[]} measures
 *   each measure on the model's image (no processing), with the starting and with the chosen settings
 * @property {{model: number, start: number, chosen: number}} miss  how far outside the aims, summed (0 = all inside)
 * @property {string} basis  which measures the search used: whole card, or also the backdrop (confirmed outline)
 */

/**
 * How far a value is outside its range, in units of the range (its width, or the size of a one-sided bound).
 * @param {number} v @param {Range} r
 */
export function outside(v, r) {
  const scale = r.min != null && r.max != null ? r.max - r.min : Math.abs(r.min ?? r.max ?? 1) || 1;
  if (r.min != null && v < r.min) return (r.min - v) / scale;
  if (r.max != null && v > r.max) return (v - r.max) / scale;
  return 0;
}

/** @param {Axis} a @param {number} start */
function grid(a, start) {
  const values = new Set([start]);
  for (let v = a.min; v <= a.max + 1e-9; v += a.step) values.add(Math.round(v * 1e6) / 1e6);
  return [...values].sort((x, y) => x - y);
}

/**
 * Two stages, in the order adjust.js applies them. Colour (only the measures the colour axes serve): saturation and
 * brightness in turn, each scanned over its whole grid with the other fixed, until neither moves (sharpening as at
 * the start) — the smallest summed miss, then the smallest change from the start (in steps of each axis).
 * Sharpness (every measure): every sharpening amount with that colour — the smallest miss of the
 * measures the sharpening axis serves, then the smallest change. Neither stage takes a setting that pushes out a
 * measure that is inside its aim at the start (the sharpness stage also may not add to the colour miss); if the
 * sharpness stage cannot bring back a measure the colour stage pushed out, the colour stage keeps the start colour.
 * @param {object} o
 * @param {Uint8Array} o.pixels  RGB of the prepared card
 * @param {number} o.width @param {number} o.height
 * @param {AdjustSettings} o.start
 * @param {AdjustSettings} o.neutral  no change: what the model's own image measures as
 * @param {{saturation: Axis, brightness: Axis, sharpen: Axis}} o.bounds  saturation and brightness serve the same measures
 * @param {(rgb: Uint8Array | Uint8ClampedArray, prefix?: string) => Measure[]} o.measure  with `prefix`, only the
 *   measures whose id starts with it (the colour stage measures less: faster)
 * @param {string} o.basis
 * @returns {{settings: AdjustSettings, tuning: Tuning}}
 */
export function tuneProcessing({ pixels, width, height, start, neutral, bounds, measure, basis }) {
  /** @typedef {{settings: AdjustSettings, measures: Measure[], change: number}} Eval */
  /** @type {Map<string, Eval>} */
  const cache = new Map();
  /** @param {AdjustSettings} s @param {string} [prefix] @returns {Eval} */
  const evaluate = (s, prefix) => {
    const key = `${s.saturation}|${s.brightness}|${s.sharpen.amount}|${prefix ?? ''}`;
    let e = cache.get(key);
    if (!e) {
      const change = Math.abs(s.saturation - start.saturation) / bounds.saturation.step + Math.abs(s.brightness - start.brightness) / bounds.brightness.step
        + Math.abs(s.sharpen.amount - start.sharpen.amount) / bounds.sharpen.step;
      e = { settings: s, measures: measure(adjust(pixels, width, height, s), prefix), change };
      cache.set(key, e);
    }
    return e;
  };
  /** @param {Eval} e @param {(id: string) => boolean} [which] */
  const miss = (e, which = () => true) => e.measures.reduce((sum, m) => sum + (which(m.id) ? outside(m.value, m.aim) : 0), 0);
  /** @param {string} prefix */
  const serves = prefix => (/** @type {string} */ id) => id.startsWith(prefix);
  const colour = serves(bounds.saturation.serves), sharpness = serves(bounds.sharpen.serves);
  const first = evaluate(start);
  const kept = first.measures.filter(m => outside(m.value, m.aim) === 0).map(m => m.id);
  /** @param {Eval} e @param {(id: string) => boolean} which */
  const keeps = (e, which) => e.measures.every(m => !which(m.id) || !kept.includes(m.id) || outside(m.value, m.aim) === 0);
  /** @param {Eval} a @param {Eval} b @param {(id: string) => boolean} which */
  const better = (a, b, which) => { const d = miss(a, which) - miss(b, which); return d < -1e-9 || (Math.abs(d) <= 1e-9 && a.change < b.change - 1e-9); };

  /** @param {Eval} from */
  const sharpen = from => {
    let best = from;
    for (const v of grid(bounds.sharpen, start.sharpen.amount)) {
      const e = evaluate({ ...from.settings, sharpen: { ...from.settings.sharpen, amount: v } });
      if (keeps(e, () => true) && miss(e, colour) <= miss(from, colour) + 1e-9 && (!keeps(best, () => true) || better(e, best, sharpness))) best = e;
    }
    return best;
  };
  const sats = grid(bounds.saturation, start.saturation), bris = grid(bounds.brightness, start.brightness);
  let colourBest = evaluate(start, bounds.saturation.serves);
  for (let round = 0; round < 4; round++) {
    const before = colourBest;
    for (const [values, set] of /** @type {const} */ ([[sats, (/** @type {number} */ v) => ({ saturation: v })], [bris, (/** @type {number} */ v) => ({ brightness: v })]])) {
      const base = colourBest.settings;
      for (const v of values) {
        const e = evaluate({ ...base, ...set(v) }, bounds.saturation.serves);
        if (keeps(e, colour) && better(e, colourBest, colour)) colourBest = e;
      }
    }
    if (colourBest === before) break;
  }
  let best = sharpen(evaluate(colourBest.settings));
  if (!keeps(best, () => true)) best = sharpen(first);

  const model = evaluate(neutral);
  /** @param {Eval} e @param {string} id */
  const valueOf = (e, id) => /** @type {Measure} */ (e.measures.find(m => m.id === id)).value;
  return {
    settings: best.settings,
    tuning: {
      start, basis,
      measures: first.measures.map(m => ({ id: m.id, aim: m.aim, model: valueOf(model, m.id), start: m.value, chosen: valueOf(best, m.id) })),
      miss: { model: miss(model), start: miss(first), chosen: miss(best) },
    },
  };
}
