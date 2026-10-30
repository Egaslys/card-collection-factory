#!/usr/bin/env node
// check-card.mjs — runs the pixel-measurable checks of the Scapes style bible on finished cards.
//
// Input: a JSON spec listing card PNGs and, per card, the staging the card was ordered with (see --help).
// For every check from the «Проверка» sections that pixels can answer it prints PASS / WARN / FAIL with the
// measured value, the threshold and the bible document and check number. Thresholds come only from
// thresholds.json next to this script. Checks that need eyes are listed per card as «visual».
// Measures: measures.mjs (the method that produced the bible's numbers). Reads images with sharp (npm install).
// Imported as a module it runs nothing: `checkCard`, `restsOnUnconfirmedMask`, `CARD_SIZE`, `processingMeasures` and
// `heroOutline` are its contract with the card loop (core/card/); the command line runs only when this file is the entry point.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '../../../tools/cli-args.mjs';
import * as M from './measures.mjs';
import { outlineInBox } from '../../../core/image/segment.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE_SPEC = join(HERE, 'reference-spec.json');
const CLI_SPEC = {
  name: 'styles/scapes/checks/check-card.mjs',
  usage: ['styles/scapes/checks/check-card.mjs [--spec SPEC.json] [--only ID,ID] [--json OUT.json] [--summary] [--quiet] [--no-visual] [--overlays DIR]'],
  about: `Checks Scapes cards against the bible («Проверка» sections) wherever pixels can answer; prints PASS / WARN /
FAIL per check with the value, the norm or limit and the bible document and check number, then the checks
that need eyes. Thresholds: thresholds.json next to this script. Exit code 1 when a FAIL is not an expected one
(a reference card the bible names as «избегать» or as an allowed exception, or a known measurement failure).

The spec is JSON {"cards": [ {...}, ... ]}; one entry per card:
  id         name to print (required)
  file       PNG path, relative to the spec file (required)
  category   1–5 as ordered
  backdrop   field | wall | environment | none
  pattern    rays | rings | spiral | stripes_straight | stripes_wavy | rhombi | checker |
             motif_repeat | brick | plain_gradient | other | n/a
  placement  floating_field | hung_from_above | wall_mounted | resting | embedded |
             lying_top_down | floating_native | other
  support    none | ephemeral (plain untextured floor) | fragment (piece of real surface) |
             ground | furniture | fills_frame | wall_fixed | other
  camera     eye_level | high | low
  characters 0 | 1 | 2
  time       day | golden | dusk | night | n/a
  sky_top    true when the top of the frame is sky (with time day it enables COLOUR 14)
  hero_box   optional [x0,y0,x1,y1] px drawn by a person; used for composition instead of the mask
  mask       optional "confirmed" | "rejected": a person looked at the mask overlay (--overlays);
             rejected = mask-based checks are not measured (give hero_box for composition)
  ref        optional reference card number (matches the avoid / exceptions lists of thresholds.json)`,
  options: {
    spec: { type: 'string', value: 'FILE', help: 'the cards to check (default: reference-spec.json, the 160 reference cards — the control run)' },
    only: { type: 'string', value: 'LIST', help: 'only these card ids, comma-separated' },
    json: { type: 'string', value: 'FILE', help: 'also write every measure and result as JSON' },
    summary: { type: 'boolean', help: 'after the cards, a table of results per check over all cards' },
    quiet: { type: 'boolean', help: 'print only WARN and FAIL lines per card' },
    'no-visual': { type: 'boolean', help: 'do not print the visual checklist per card' },
    overlays: { type: 'string', value: 'DIR', help: 'write <id>.mask.png per card: the proposed hero mask over the card, to confirm or reject it' },
    outlines: { type: 'boolean', help: 'as the card loop measures: on an abstract backdrop, a card with hero_box gets the outline cut in that box (GrabCut, core/image/segment.js) as a trusted automatic outline' },
  },
};
const CFG = JSON.parse(readFileSync(join(HERE, 'thresholds.json'), 'utf8'));
const T = CFG.checks, METHOD = Object.fromEntries(Object.entries(CFG.method).map(([k, v]) => [k, v.value]));
/** The card size of the style (BASE_RULES.1): the size a model image is prepared to. */
export const CARD_SIZE = { width: T['BASE_RULES.1'].size[0], height: T['BASE_RULES.1'].size[1] };

// ---------- values that post-processing moves ----------
// Check id → its value from the measures: wc = M.wholeCard, ov = M.overshoot, tr = M.traces of the whole card,
// bg = the backdrop's main colour (M.heroBackdrop; only with a hero outline). checkCard reads these values from here,
// and the card loop's processing search (core/card/tune.js through processingMeasures) measures the same ones.
const VALUE_OF = {
  'COLOUR.1': m => m.wc.C_p50, 'COLOUR.2': m => m.wc.grey_share, 'COLOUR.3a': m => m.wc.black_share, 'COLOUR.3b': m => m.wc.darkest2.C,
  'COLOUR.4': m => m.wc.white_share, 'COLOUR.5a': m => m.wc.L_p50, 'COLOUR.5b': m => m.wc.L_p1, 'COLOUR.5c': m => m.wc.L_p99,
  'COLOUR.6': m => m.wc.n_hues, 'COLOUR.8a': m => m.bg.C, 'COLOUR.8b': m => m.bg.s, 'COLOUR.8c': m => m.bg.L,
  'COLOUR.15a': m => m.wc.L_p50, 'COLOUR.15b': m => m.wc.C_p50, 'COLOUR.15c': m => m.wc.L_p50,
  'RENDERING.16a': m => m.tr.flat_grain, 'RENDERING.17a': m => m.ov.overshoot_med, 'RENDERING.17b': m => m.ov.width_med,
};
const isNight = staging => staging.time === 'night' || staging.time === 'dusk';
const isEvening = staging => staging.time === 'golden' || staging.time === 'dusk';
// COLOUR.15a and 15b at night or dusk, 15c at golden hour or dusk
const timeFits = (id, staging) => !id.startsWith('COLOUR.15') || (id === 'COLOUR.15c' ? isEvening(staging) : isNight(staging));
/** The norm of a check for this staging: its time-of-day norm (`norm_by_time`) where the staging's time is one of its times. */
const normFor = (id, staging) => (T[id].norm_by_time?.times.includes(staging.time) ? T[id].norm_by_time.norm : T[id].norm);
const isAbstract = staging => staging.backdrop === 'field' || staging.backdrop === 'wall';

/**
 * The checks `ids` (of VALUE_OF) that apply to this staging, measured on RGB pixels of the card size, each with the
 * range post-processing aims at: the bible's adjustment target where it gives one, else the norm (its time-of-day norm where it has one), else the limit.
 * COLOUR.15a–b only at night or dusk, 15c at golden hour or dusk; COLOUR.8 only on an abstract backdrop and with `fg`, a
 * hero outline confirmed by eye.
 * @returns {{id: string, value: number, aim: {min?: number, max?: number}}[]}
 */
export function processingMeasures(rgb, { staging, ids, fg }) {
  const P = M.planes(rgb), cache = {};
  const once = (k, f) => () => (k in cache ? cache[k] : (cache[k] = f()));
  // measured only when a requested check needs them (the search asks for the colour checks alone many times)
  const m = Object.defineProperties({}, {
    wc: { get: once('wc', () => M.wholeCard(P)) }, ov: { get: once('ov', () => M.overshoot(P)) }, tr: { get: once('tr', () => M.traces(P)) },
    bg: { get: once('bg', () => (fg && isAbstract(staging) ? M.heroBackdrop(P, fg).bg?.dominant : null)) },
  });
  const applies = id => VALUE_OF[id] && timeFits(id, staging) && (!id.startsWith('COLOUR.8') || m.bg);
  return ids.filter(applies).map(id => ({ id, value: VALUE_OF[id](m), aim: T[id].target ?? normFor(id, staging) ?? T[id].limit }));
}

/** The proposed hero outline of RGB pixels of the card size (the one card.mask.png shows), or null when none is found. */
export function heroOutline(rgb) {
  const mask = M.heroMask(M.planes(rgb));
  return mask.ok ? mask.fg : null;
}

// ---------- result helpers ----------
const fmt = v => v == null ? 'n/a' : typeof v === 'number' ? String(+v.toFixed(3)) : Array.isArray(v) ? `[${v.join(', ')}]` : String(v);
const rangeText = r => r ? (r.min != null && r.max != null ? `${r.min}–${r.max}` : r.min != null ? `≥ ${r.min}` : `≤ ${r.max}`) : null;
// a value is compared at the precision the bible gives the bound (method.compare_at_bible_precision)
const decimals = b => { const s = String(b); return s.includes('.') ? s.split('.')[1].length : 0; };
const atPrec = (v, b) => METHOD.compare_at_bible_precision ? +v.toFixed(decimals(b)) : v;
const inRange = (v, r) => !r || ((r.min == null || atPrec(v, r.min) >= r.min) && (r.max == null || atPrec(v, r.max) <= r.max));
function threshText(t, norm = t.norm, limit = t.limit) {
  return [norm && `norm ${rangeText(norm)}`, limit && `limit ${rangeText(limit)}`, t.proposed && '(proposed)'].filter(Boolean).join(', ');
}
function make(id, status, value, threshold, note) {
  const t = T[id]; return { id, doc: t.doc, check: t.check, title: t.title, status, value, threshold, note: note || null };
}
function range(id, v, { norm, limit, note, soft } = {}) {
  const t = T[id]; norm = norm ?? t.norm; limit = limit ?? t.limit;
  if (v == null || Number.isNaN(v)) return make(id, 'NOT_MEASURED', null, threshText(t, norm, limit), note || 'no value');
  let st = 'PASS';
  if (!inRange(v, limit)) st = t.proposed || t.soft || soft ? 'WARN' : 'FAIL';
  else if (!inRange(v, norm)) st = 'WARN';
  return make(id, st, v, threshText(t, norm, limit), st !== 'PASS' ? (note || t.note) : null);
}
const na = (id, why) => make(id, 'N/A', null, null, why);
const nm = (id, why) => make(id, 'NOT_MEASURED', null, null, why);

// a FAIL that rests on an unconfirmed mask may be the mask's fault (it can take a shadow, a stand or the floor)
const maskBased = /^(COLOUR\.(7|8|9|10|11|12)|RENDERING\.(4|6|11)|BACKGROUNDS\.(6c|6d|7a|9)|COMPOSITION\.)/;
/** True when result r of a card with hero info `hero` is a FAIL that rests on a mask nobody has confirmed. A trusted
 * automatic outline ("auto": cut by core/card/hero.js in a box an agent gave or the vision model found twice) counts as
 * confirmed: the outline-based norms were re-measured with such outlines on all 81 abstract-backdrop references
 * (thresholds.json method, 2026-10-30) and the control run passes with them. */
export const restsOnUnconfirmedMask = (r, hero) => r.status === 'FAIL' && hero?.mask_status === 'proposal' && maskBased.test(r.id)
  && !(r.id.startsWith('COMPOSITION') && hero.box_source === 'spec') && !(hero.box_source === 'given' && boxOnly.test(r.id));
// checks that read only the hero box: with a trusted box given with the outline they rest on the box, as with a box by eye
const boxOnly = /^(COMPOSITION\.(2|3|4a|4b|5b)|BACKGROUNDS\.(6c|6d|7a|9))$/;

/** Whether a hero outline cut in a box can be measured on for this staging: on an abstract backdrop. In scenes and
 * environments it takes sky and water between the characters (measured on trial round 2); use only its box there. */
export const outlineFits = staging => staging?.backdrop === 'field' || staging?.backdrop === 'wall';

// ---------- busyness (RENDERING.18) ----------
// Luma central differences gx = Y[x+1] − Y[x−1], gy = Y[y+1] − Y[y−1]; a pixel is strong when hypot(gx, gy) > stepMin.
// Returns the share of strong pixels among the interior ones (no border row or column), in %, over the whole card.
function busyness(Y, stepMin) {
  let strong = 0, n = 0;
  for (let y = 1; y < M.H - 1; y++) for (let x = 1; x < M.W - 1; x++) {
    const p = y * M.W + x;
    if (Math.hypot(Y[p + 1] - Y[p - 1], Y[p + M.W] - Y[p - M.W]) > stepMin) strong++;
    n++;
  }
  return { strong_pct: M.r1(100 * strong / n) };
}

// ---------- one card ----------
// card: one spec entry (see --help); baseDir: the folder card.file is relative to; overlaysDir: where to write
// <id>.mask.png (optional); outline: the hero outline found outside the checker ({fg, box, confidence, boxConfidence}
// of core/card/hero.js findHero): it replaces the proposer's mask and the spec's hero_box (it was cut inside that box);
// confidence "high" gives the mask status "auto" (trusted, like a confirmed outline), "low" gives "proposal"
// (unconfirmed: restsOnUnconfirmedMask); with boxConfidence "high" the checks that read only the box rest on outline.box, as on a box by eye.
// Returns { id, file, staging, hero, measures, results, visual }.
export async function checkCard(card, { baseDir, overlaysDir, outline } = {}) {
  const file = resolve(baseDir || '.', card.file);
  if (!existsSync(file)) throw new Error(`${card.id}: no such file ${file}`);
  const s = { category: card.category, backdrop: card.backdrop, pattern: card.pattern || 'n/a', placement: card.placement, support: card.support || 'none', camera: card.camera || 'eye_level', characters: +card.characters || 0, time: card.time || 'n/a', sky_top: !!card.sky_top };
  const abstract = s.backdrop === 'field' || s.backdrop === 'wall';
  const chars = s.characters > 0;
  const floating = ['floating_field', 'hung_from_above', 'wall_mounted', 'floating_native'].includes(s.placement);
  const night = s.time === 'night' || s.time === 'dusk';
  const res = [], meas = {};
  const dec = await M.decode(file);
  const t1 = T['BASE_RULES.1'];
  const sizeOk = dec.width === t1.size[0] && dec.height === t1.size[1];
  if (!sizeOk) {
    res.push(make('BASE_RULES.1', 'FAIL', `${dec.width} x ${dec.height}`, `${t1.size[0]} x ${t1.size[1]}`, 'wrong size: no other check was run'));
    return { id: card.id, file, staging: s, hero: null, measures: meas, results: res, visual: [] };
  }
  const P = M.planes(dec.rgb);
  const fr = M.frame(P, METHOD.frame_dE); meas.frame = fr;
  const banded = Object.entries(fr).filter(([, v]) => v >= METHOD.frame_share).map(([k]) => k);
  {
    const bad = dec.transparent > t1.transparent_max ? `${dec.transparent} transparent px` : null;
    const st = bad || banded.length === 4 ? 'FAIL' : banded.length ? 'WARN' : 'PASS';
    res.push(make('BASE_RULES.1', st, `${dec.width} x ${dec.height}, transparent ${dec.transparent}, edge bands: ${banded.join(' ') || 'none'}`, `${t1.size.join(' x ')}, ${t1.transparent_max} transparent, no frame`, st === 'PASS' ? null : bad || (banded.length === 4 ? 'a band along all four edges: frame' : 'a band along some edges: plate or strip? check by eye')));
  }

  // hero
  const given = outline?.fg ? M.givenMask(outline.fg) : null;
  const mask = given || M.heroMask(P);
  if (overlaysDir && mask.box) await M.writeOverlay(P, mask.fg, mask.box, join(resolve(overlaysDir), `${String(card.id).replace(/[^\w.-]+/g, '_')}.mask.png`));
  const maskStatus = !mask.ok ? 'not found' : card.mask === 'rejected' ? 'rejected' : card.mask === 'confirmed' ? 'confirmed' : given && outline.confidence === 'high' ? 'auto' : 'proposal';
  if (maskStatus === 'rejected') { mask.ok = false; mask.reason = 'the mask was rejected by a person (spec "mask": "rejected")'; }
  const specBox = given ? null : card.hero_box;
  // with the outline: the box it was cut in, when that box is trusted (composition then rests on it as on a box by eye)
  const givenBox = given && mask.ok && outline.boxConfidence === 'high' && outline.box ? outline.box : null;
  const box = specBox || givenBox || (mask.ok ? mask.box : null);
  const hero = { mask_status: maskStatus, mask_ok: mask.ok,mask_reason: mask.reason, mask_box: mask.box, mask_diagnostics: mask.diagnostics, box, box_source: specBox ? 'spec' : givenBox ? 'given' : mask.ok ? 'mask' : null, ...(given ? { mask_source: outline.source ?? 'given', mask_confidence: outline.confidence ?? null } : {}) };
  const noHero = `hero not found by the mask proposer (${mask.reason}); give hero_box in the spec or check by eye`;

  // ---------- COLOUR, whole card ----------
  const wc = M.wholeCard(P); meas.whole = wc;
  res.push(range('COLOUR.1', VALUE_OF['COLOUR.1']({ wc }), { norm: normFor('COLOUR.1', s) }));
  res.push(range('COLOUR.2', VALUE_OF['COLOUR.2']({ wc })));
  res.push(range('COLOUR.3a', VALUE_OF['COLOUR.3a']({ wc })));
  res.push(range('COLOUR.3b', VALUE_OF['COLOUR.3b']({ wc })));
  res.push(range('COLOUR.4', VALUE_OF['COLOUR.4']({ wc })));
  res.push(range('COLOUR.5a', VALUE_OF['COLOUR.5a']({ wc })));
  res.push(range('COLOUR.5b', VALUE_OF['COLOUR.5b']({ wc })));
  res.push(range('COLOUR.5c', VALUE_OF['COLOUR.5c']({ wc })));
  res.push(range('COLOUR.6', VALUE_OF['COLOUR.6']({ wc }), { note: wc.n_hues === 1 ? T['COLOUR.6'].note : undefined }));

  // ---------- hero vs backdrop ----------
  let hb = null;
  if (mask.ok) { hb = M.heroBackdrop(P, mask.fg); meas.hero_backdrop = hb; }
  if (abstract && hb) {
    // a floor, a support or a wall around the hero enters the backdrop measures: past a limit is then for the eye
    const byEye = METHOD.backdrop_colour_strict_placements.includes(s.placement) ? {} : { soft: true, note: 'the floor, support or wall around the hero is in the backdrop measure: check by eye' };
    const t7 = T['COLOUR.7'], h = hb.hero?.dominant, b = hb.bg?.dominant;
    if (h && b) {
      const achrom = h.C < t7.achromatic_hero_C_max;
      const hueOk = hb.hero_chromatic && hb.bg_chromatic && hb.hue_diff >= t7.hue_diff_min;
      const ok = achrom || hueOk || Math.abs(hb.dL) >= t7.dL_min;
      res.push(make('COLOUR.7', ok ? 'PASS' : 'FAIL', `hero ${h.hex} vs backdrop ${b.hex}: hue diff ${hb.hue_diff}°, dL ${hb.dL}, hero C* ${h.C}`, `hue diff ≥ ${t7.hue_diff_min}° or |dL| ≥ ${t7.dL_min}; hero C* < ${t7.achromatic_hero_C_max} passes`, ok ? null : t7.note));
      res.push(range('COLOUR.8a', VALUE_OF['COLOUR.8a']({ bg: b }), byEye)); res.push(range('COLOUR.8b', VALUE_OF['COLOUR.8b']({ bg: b }))); res.push(range('COLOUR.8c', VALUE_OF['COLOUR.8c']({ bg: b })));
      res.push(range('COLOUR.8d', hb.bg.L_p90 - hb.bg.L_p10));
    } else for (const id of ['COLOUR.7', 'COLOUR.8a', 'COLOUR.8b', 'COLOUR.8c', 'COLOUR.8d']) res.push(nm(id, 'hero or backdrop region too small'));
    if (hb.bg_near && hb.bg_corners) {
      res.push(range('COLOUR.9a', M.r1(hb.bg_near.L - hb.bg_corners.L), byEye));
      res.push(range('COLOUR.9b', M.r1(hb.bg_near.C - hb.bg_corners.C)));
      res.push(hb.bg_near.s > 0.15 ? range('COLOUR.9c', Math.abs(M.hueDiff(hb.bg_corners.hue, hb.bg_near.hue)), byEye) : na('COLOUR.9c', 'backdrop near the hero almost colourless'));
    }
    res.push(range('COLOUR.10', hb.bg_mid?.C ? M.r2(hb.bg_dark.C / hb.bg_mid.C) : null, byEye));
  } else {
    const why = !abstract ? 'not an abstract backdrop' : noHero;
    for (const id of ['COLOUR.7', 'COLOUR.8a', 'COLOUR.8b', 'COLOUR.8c', 'COLOUR.8d', 'COLOUR.9a', 'COLOUR.9b', 'COLOUR.9c', 'COLOUR.10']) res.push(abstract ? nm(id, why) : na(id, why));
  }
  if (hb && hb.ramps.length) {
    res.push(range('COLOUR.11', Math.min(...hb.ramps.map(f => f.dark_C_ratio)), { note: `families: ${hb.ramps.map(f => `${f.centre}° ratio ${f.dark_C_ratio}`).join('; ')}` }));
    const t12 = T['COLOUR.12'];
    const fx = hb.ramps.filter(f => t12.skip_within_deg_of.every(c => Math.abs(M.hueDiff(f.mid.hue, c)) > t12.skip_deg));
    if (fx.length) {
      const dist = (h) => Math.abs(M.hueDiff(h, 60));
      let wrong = 0; const n = fx.length * 2;
      for (const f of fx) { if (dist(f.dark.hue) < dist(f.mid.hue)) wrong++; if (dist(f.light.hue) > dist(f.mid.hue)) wrong++; }
      res.push(range('COLOUR.12', M.r2(wrong / n), { note: `${wrong} of ${n} shifts reversed` }));
    } else res.push(na('COLOUR.12', 'all hue families are within 15° of yellow or blue'));
  } else for (const id of ['COLOUR.11', 'COLOUR.12']) res.push(mask.ok ? nm(id, 'no hue family of 10 % of the hero') : nm(id, noHero));
  if (s.sky_top && s.time === 'day') {
    const t14 = T['COLOUR.14'], ts = wc.top_strip;
    const ok = inRange(ts.hue, t14.hue) && inRange(ts.C, t14.C);
    res.push(make('COLOUR.14', ok ? 'PASS' : 'FAIL', `top band ${ts.hex}: hue ${ts.hue}°, C* ${ts.C}`, `hue ${rangeText(t14.hue)}°, C* ${rangeText(t14.C)}`));
  } else res.push(na('COLOUR.14', s.sky_top ? `the sky at the top is not day sky (time ${s.time})` : 'top of the frame is not sky (sky_top not set)'));
  if (night) { res.push(range('COLOUR.15a', VALUE_OF['COLOUR.15a']({ wc }))); res.push(range('COLOUR.15b', VALUE_OF['COLOUR.15b']({ wc }))); }
  else for (const id of ['COLOUR.15a', 'COLOUR.15b']) res.push(na(id, 'not night or dusk'));
  res.push(isEvening(s) ? range('COLOUR.15c', VALUE_OF['COLOUR.15c']({ wc })) : na('COLOUR.15c', 'not golden hour or dusk'));

  // ---------- BACKGROUNDS ----------
  const floorWanted = abstract && METHOD.floor_supports.includes(s.support);
  let geo = null;
  if (abstract) {
    const ex = METHOD.exclusion_box_without_hero_pct;
    const gbox = box || [Math.round(ex[0] / 100 * M.W), Math.round(ex[1] / 100 * M.H), Math.round(ex[2] / 100 * M.W) - 1, Math.round(ex[3] / 100 * M.H) - 1];
    geo = M.backdropGeometry(P, gbox, s.pattern, floorWanted); meas.backdrop = geo;
  }
  const heroC = box ? [((box[0] + box[2] + 1) / 2) / M.W * 100, ((box[1] + box[3] + 1) / 2) / M.H * 100] : null;
  const cutBelow = box && box[3] >= M.H - 1;
  if (geo && geo.steps && geo.steps.edges) {
    res.push(range('BACKGROUNDS.4a', geo.steps.step_med, { note: `${geo.steps.edges} band edges measured; 90th percentile ${geo.steps.step_p90} L*` }));
    res.push(range('BACKGROUNDS.4b', geo.steps.width_med, { note: `${geo.steps.edges} band edges measured` }));
  } else for (const id of ['BACKGROUNDS.4a', 'BACKGROUNDS.4b']) res.push(!abstract ? na(id, 'not an abstract backdrop') : ['plain_gradient', 'n/a', 'other', 'brick'].includes(s.pattern) ? na(id, 'no graphic pattern (plain gradient, material wall or other)') : nm(id, 'no band edge with flat sides found (pattern too faint or too busy)'));
  // BACKGROUNDS 5 (glow centre) is checked by eye: the bible gives no number (thresholds.json «visual»)
  // rays
  if (geo?.rays) {
    const r = geo.rays, t6a = T['BACKGROUNDS.6a'], variant = inRange(r.rays_per_turn, t6a.variant);
    res.push(variant ? make('BACKGROUNDS.6a', 'PASS', r.rays_per_turn, `norm ${rangeText(t6a.norm)}; variant ${rangeText(t6a.variant)}`, t6a.variant_note) : (() => { const x = range('BACKGROUNDS.6a', r.rays_per_turn, { limit: t6a.norm }); return x; })());
    const t6b = T['BACKGROUNDS.6b'];
    if (variant) res.push(na('BACKGROUNDS.6b', 'thin-ray variant'));
    else { const ok = inRange(r.light_deg_med, t6b.light) && inRange(r.dark_deg_med, t6b.dark); res.push(make('BACKGROUNDS.6b', ok ? 'PASS' : 'FAIL', `light ${r.light_deg_med}°, dark ${r.dark_deg_med}°`, `light ${rangeText(t6b.light)}°, dark ${rangeText(t6b.dark)}°`)); }
    if (heroC) {
      res.push(range('BACKGROUNDS.6c', M.r1(Math.abs(r.centre_pct[0] - heroC[0])), { note: `ray centre ${fmt(r.centre_pct)} %, hero centre ${fmt(heroC.map(M.r1))} %` }));
      if (cutBelow && METHOD.rays_cut_from_below_skip_height) res.push(na('BACKGROUNDS.6d', 'hero cut by the bottom edge'));
      else { const t6d = T['BACKGROUNDS.6d'], lim = floating ? t6d.floating : t6d.standing; res.push(range('BACKGROUNDS.6d', M.r1(r.centre_pct[1] - heroC[1]), { limit: lim, note: floating ? 'floating hero' : 'standing hero' })); }
    } else for (const id of ['BACKGROUNDS.6c', 'BACKGROUNDS.6d']) res.push(nm(id, noHero));
  } else for (const id of ['BACKGROUNDS.6a', 'BACKGROUNDS.6b', 'BACKGROUNDS.6c', 'BACKGROUNDS.6d']) res.push(na(id, 'pattern is not rays'));
  // rings
  if (geo?.rings && s.pattern === 'rings') {
    const r = geo.rings, t7 = T['BACKGROUNDS.7a'];
    if (heroC) {
      const lim = floating ? t7.floating : t7.standing, dx = M.r1(r.centre_pct[0] - heroC[0]), dy = M.r1(r.centre_pct[1] - heroC[1]);
      const ok = Math.abs(dx) <= lim.dx && dy >= lim.dy_min && dy <= lim.dy_max;
      res.push(make('BACKGROUNDS.7a', ok ? 'PASS' : 'FAIL', `dx ${dx}, dy ${dy} (${floating ? 'floating' : 'standing'})`, `|dx| ≤ ${lim.dx}, dy ${lim.dy_min}–${lim.dy_max}`));
    } else res.push(nm('BACKGROUNDS.7a', noHero));
    res.push(range('BACKGROUNDS.7b', r.rings_to_far_corner));
    res.push(range('BACKGROUNDS.7c', r.period_px));
  } else for (const id of ['BACKGROUNDS.7a', 'BACKGROUNDS.7b', 'BACKGROUNDS.7c']) res.push(na(id, 'pattern is not rings'));
  // stripes
  if (geo?.stripes && s.pattern === 'stripes_straight') {
    const st = geo.stripes, a = st.angle_deg, absA = Math.abs(a);
    res.push(range('BACKGROUNDS.8a', absA));
    const t8 = T['BACKGROUNDS.8b'], tol = METHOD.stripe_angle_tolerance_deg;
    const isVert = absA >= 90 - tol, okAngle = s.backdrop === 'wall' ? isVert : (isVert || t8.angles.some(x => x < 90 && Math.abs(a - x) <= tol));
    res.push(make('BACKGROUNDS.8b', okAngle ? 'PASS' : 'FAIL', `${a}° (90 = vertical, + = rising to the right)`, `${s.backdrop === 'wall' ? 'wall: vertical only' : t8.angles.join('° / ') + '°'} ± ${tol}°`));
    res.push(range('BACKGROUNDS.8c', st.stripe_width_px, { note: `period ${st.period_px} px` }));
  } else for (const id of ['BACKGROUNDS.8a', 'BACKGROUNDS.8b', 'BACKGROUNDS.8c']) res.push(na(id, 'pattern is not straight stripes'));
  // floor
  if (floorWanted) {
    const f = geo.floor, t9 = T['BACKGROUNDS.9'], lim = s.camera === 'high' ? t9.high : t9.eye_level;
    if (!f.agree) res.push(nm('BACKGROUNDS.9', `no clear floor line (left ${f.y_left} % dE ${f.dE_left}, right ${f.y_right} % dE ${f.dE_right})`));
    else if (!box) res.push(make('BACKGROUNDS.9', inRange(f.y, { min: lim.line_min, max: lim.line_max }) ? 'PASS' : 'FAIL', `line ${f.y} %; hero base not measured (${noHero})`, `line ${lim.line_min}–${lim.line_max} %`));
    else {
      const below = M.r1((box[3] + 1) / M.H * 100 - f.y), okL = inRange(f.y, { min: lim.line_min, max: lim.line_max }), okB = inRange(below, { min: lim.below_min, max: lim.below_max });
      res.push(make('BACKGROUNDS.9', okL && okB ? 'PASS' : 'FAIL', `line ${f.y} %, hero base ${below} % below it (${s.camera})`, `line ${lim.line_min}–${lim.line_max} %, base ${lim.below_min}–${lim.below_max} % below`));
    }
  } else res.push(na('BACKGROUNDS.9', 'no floor line expected for this staging'));

  // ---------- COMPOSITION ----------
  if (box) {
    const safe = { ...T['COMPOSITION.11'], top_band: T['COMPOSITION.11'].top_band - METHOD.safe_zone_top_depth_px };
    const comp = M.composition(specBox ? null : mask.fg, box, { openR: METHOD.main_mass_open_px, safe }); meas.composition = comp;
    const objAbstract = abstract && !chars;
    res.push(range('COMPOSITION.2', Math.abs(comp.centre_dx_px), { note: `offset ${comp.centre_dx_px} px; ${T['COMPOSITION.2'].note}` }));
    const g3 = chars ? 'characters' : s.backdrop, t3 = T['COMPOSITION.3'].groups[g3];
    res.push(t3 ? range('COMPOSITION.3', comp.centre_dy_px, { norm: t3.norm, limit: t3.limit, note: `group ${g3}` }) : nm('COMPOSITION.3', `no norm for backdrop "${s.backdrop}"`));
    const g = chars ? 'characters' : s.backdrop === 'environment' ? 'environment' : 'abstract';
    res.push(range('COMPOSITION.4a', comp.area_frac, { norm: T['COMPOSITION.4a'][g], note: `group ${g}` }));
    if (objAbstract) {
      res.push(range('COMPOSITION.4b', comp.width_frac));
      res.push(comp.main_margin_top != null ? range('COMPOSITION.5a', comp.main_margin_top) : nm('COMPOSITION.5a', 'main mass not separated (hero box from the spec)'));
      res.push(range('COMPOSITION.5b', Math.min(comp.margin_left, comp.margin_right), { note: `left ${comp.margin_left}, right ${comp.margin_right} px` }));
      if (comp.edge_cover) {
        const tail = METHOD.tail_cover_max, touched = Object.entries(comp.edge_cover).filter(([, v]) => v > 0), wide = touched.filter(([, v]) => v > tail);
        res.push(make('COMPOSITION.5c', wide.length ? 'FAIL' : 'PASS', touched.length ? `edge cover ${touched.map(([k, v]) => `${k} ${v}`).join(', ')}` : 'inside the frame', `no edge, or a thin tail covering ≤ ${tail} of an edge`, wide.length ? 'the object is cut by the frame (a cut thin tail is allowed)' : touched.length ? 'a thin part touches the edge: allowed tail? check by eye' : null));
      } else res.push(make('COMPOSITION.5c', comp.touches.length ? 'FAIL' : 'PASS', comp.touches.length ? `box touches ${comp.touches.join(', ')}` : 'inside the frame', 'touches no edge', comp.touches.length ? 'box only (no mask): a thin cut tail is allowed — check by eye' : null));
    } else for (const id of ['COMPOSITION.4b', 'COMPOSITION.5a', 'COMPOSITION.5b', 'COMPOSITION.5c']) res.push(na(id, 'not an object on an abstract backdrop'));
    if (comp.main_px != null) {
      const t11 = T['COMPOSITION.11'], tol = METHOD.safe_zone_tolerance_px;
      const hard = comp.main_in_top_band_px + comp.main_beyond_corner_arc_px, sq = comp.main_in_top_corners_px;
      const st = hard > tol ? 'FAIL' : sq > tol ? 'WARN' : 'PASS';
      res.push(make('COMPOSITION.11', st, `main mass px: top ${safe.top_band} px ${comp.main_in_top_band_px},beyond the rounded corners ${comp.main_beyond_corner_arc_px}, inside the 80 x 80 corner squares ${sq}; outside x ${t11.rect[0]}–${t11.rect[2]}, y ${t11.rect[1]}–${t11.rect[3]}: ${comp.main_outside_safe_px} (for the eye)`, `top ${t11.top_band} px and rounded ${t11.corner} px corners free (≤ ${tol} px); corner squares: WARN`,
        st === 'FAIL' ? 'main mass in the top band or the rounded corners — or the mask took a shadow or support: check by eye' : st === 'WARN' ? 'main mass inside an 80 x 80 corner square but not beyond the rounded corner: check by eye' : null));
    } else res.push(nm('COMPOSITION.11', 'hero box from the spec: main mass not separated'));
  } else for (const id of ['COMPOSITION.2', 'COMPOSITION.3', 'COMPOSITION.4a', 'COMPOSITION.4b', 'COMPOSITION.5a', 'COMPOSITION.5b', 'COMPOSITION.5c', 'COMPOSITION.11']) res.push(nm(id, noHero));

  // ---------- RENDERING ----------
  if (hb?.light) res.push(make('RENDERING.2', 'INFO', `highlight dy ${hb.light.highlight_dy}, shade dy ${hb.light.shade_dy} (− = up)`, 'guide: highlight above, shade below; never a failure'));
  else res.push(nm('RENDERING.2', noHero));
  if (night) {
    const t = T['RENDERING.3'], ok = wc.luma_p005 > t.dark_min && wc.luma_p995 > t.light_min;
    res.push(make('RENDERING.3', ok ? 'PASS' : 'WARN', `p0.5 ${wc.luma_p005}, p99.5 ${wc.luma_p995}`, `> ${t.dark_min} and > ${t.light_min} (proposed)`));
  } else res.push(na('RENDERING.3', 'not night or dusk'));
  if (mask.ok) {
    const e = M.edges(P, mask.fg); meas.edges = e;
    res.push(range('RENDERING.4', e.dark_min_dir, { note: `dark share by direction ${JSON.stringify(e.dark_by_dir)}` }));
    res.push(range('RENDERING.6', e.width_med));
    res.push(range('RENDERING.11', hb.hero_near_white));
  } else for (const id of ['RENDERING.4', 'RENDERING.6', 'RENDERING.11']) res.push(nm(id, noHero));
  const tr = M.traces(P); meas.traces = tr;
  res.push(range('RENDERING.16a', VALUE_OF['RENDERING.16a']({ tr })));
  { const g = T['RENDERING.16b'].grid_max, both = tr.jpeg_grid_h > g && tr.jpeg_grid_v > g; res.push(make('RENDERING.16b', both ? 'FAIL' : 'PASS', `h ${tr.jpeg_grid_h}, v ${tr.jpeg_grid_v}`, `not both > ${g}`)); }
  const ov = M.overshoot(P); meas.overshoot = ov;
  { const t = T['RENDERING.17a']; const r = range('RENDERING.17a', VALUE_OF['RENDERING.17a']({ ov })); if (r.status === 'PASS' && ov.overshoot_med >= t.halo_warn) { r.status = 'WARN'; r.note = `≥ ${t.halo_warn}: visible halos, stronger than most reference cards`; } res.push(r); }
  res.push(range('RENDERING.17b', VALUE_OF['RENDERING.17b']({ ov }), { note: `${ov.steps} steps` }));
  {
    const b = busyness(P.Y, METHOD.busyness_luma_step_min); meas.busyness = b;
    const g = chars ? 'scene' : abstract ? 'abstract' : 'environment', t = T['RENDERING.18'];
    const low = b.strong_pct < t.groups[g].norm.min;
    res.push(range('RENDERING.18', b.strong_pct, { ...t.groups[g], soft: t.groups[g].proposed, note: `group ${g}; ${low ? t.note_low : t.note}` }));
  }

  for (const r of res) if (restsOnUnconfirmedMask(r, hero))
    r.note = `${r.note ? r.note + '; ' : ''}rests on an unconfirmed mask: look at the overlay (--overlays)`;
  // avoid lists
  for (const r of res) {
    if (r.status !== 'FAIL' || card.ref == null) continue;
    const t = T[r.id] || {};
    if (t.avoid?.includes(card.ref)) r.expected = 'bible names this card as one to avoid';
    else if (t.exceptions?.includes(card.ref)) r.expected = `bible names this card as an allowed exception (${t.exceptions_source})`;
    else if (METHOD.known_measure_failures?.[r.id]?.includes(card.ref)) r.expected = 'automatic measurement known to be wrong on this reference card (checked by eye when the bible was written)';
  }

  // visual checklist
  const applies = a => !a || (a === 'floating' && floating) || (a === 'abstract' && abstract) || (a === 'floor' && floorWanted) || (a === 'none' && s.backdrop === 'none')
    || (a === 'environment' && s.backdrop === 'environment') || (a === 'characters' && chars) || (a === 'object' && !chars) || (a === 'night' && night);
  const visual = CFG.visual.filter(v => applies(v.applies)).map(v => ({ id: v.id, doc: v.doc, check: v.check, what: v.what }));
  for (const r of res) if (r.status === 'NOT_MEASURED') visual.push({ id: r.id, doc: r.doc, check: r.check, what: `${r.title} — not measured: ${r.note}` });
  return { id: card.id, file, staging: s, hero, measures: meas, results: res, visual };
}

// ---------- run ----------
if (import.meta.main) {
  const { values: opts } = await cli(CLI_SPEC);
  const specFile = resolve(opts.spec || REFERENCE_SPEC);
  const SPEC = JSON.parse(readFileSync(specFile, 'utf8'));
  const only = opts.only ? new Set(opts.only.split(',')) : null;
  const out = [];
  const cards = SPEC.cards.filter(c => !only || only.has(String(c.id)));
  if (only && cards.length !== only.size) { console.error(`unknown id in --only: ${[...only].filter(i => !SPEC.cards.some(c => String(c.id) === i)).join(', ')}`); process.exit(2); }
  for (const card of cards) {
    let entry = card, outline;
    if (opts.outlines && card.hero_box && outlineFits(card)) {
      const { hero_box: box, mask, ...rest } = card;
      const dec = await M.decode(resolve(dirname(specFile), card.file));
      outline = { fg: outlineInBox(dec.rgb, dec.width, dec.height, box), box, source: 'box', confidence: 'high', boxConfidence: 'high' };
      entry = rest;
    }
    const r = await checkCard(entry, { baseDir: dirname(specFile), overlaysDir: opts.overlays, outline }); out.push(r);
    const s = r.staging;
    console.log(`\n== ${r.id}  (cat ${s.category}, ${s.backdrop}/${s.pattern}, ${s.placement} on ${s.support}, camera ${s.camera}, characters ${s.characters}, time ${s.time})`);
    console.log(r.hero ? `   hero: ${r.hero.box ? `${r.hero.box_source} box [${r.hero.box.join(', ')}], mask ${r.hero.mask_status}` : `not found — ${r.hero.mask_reason}`}` : '');
    for (const x of r.results) {
      if (opts.quiet && !['WARN', 'FAIL'].includes(x.status)) continue;
      console.log(`  ${x.status.padEnd(12)} ${x.id.padEnd(16)} ${x.title}: ${fmt(x.value)}${x.threshold ? `  | ${x.threshold}` : ''}  [${x.doc} #${x.check}]${x.note ? `  — ${x.note}` : ''}${x.expected ? `  (expected: ${x.expected})` : ''}`);
    }
    if (!opts['no-visual']) { console.log('  visual (for a person or an agent):'); for (const v of r.visual) console.log(`    - [${v.doc} #${v.check}] ${v.what}`); }
  }
  if (opts.summary) {
    const ids = [...new Set(out.flatMap(r => r.results.map(x => x.id)))];
    console.log(`\n== summary over ${out.length} cards: PASS / WARN / FAIL / not measured / n/a; FAIL cards (* = expected: a card the bible says to avoid, a named exception, or a known measurement failure)`);
    for (const id of ids) {
      const rs = out.map(r => ({ card: r.id, x: r.results.find(x => x.id === id) })).filter(o => o.x);
      const c = st => rs.filter(o => o.x.status === st).length;
      const fails = rs.filter(o => o.x.status === 'FAIL').map(o => o.card + (o.x.expected ? '*' : ''));
      console.log(`  ${id.padEnd(16)} ${c('PASS')} / ${c('WARN')} / ${c('FAIL')} / ${c('NOT_MEASURED')} / ${c('N/A')}${c('INFO') ? ` / info ${c('INFO')}` : ''}${fails.length ? `   FAIL: ${fails.join(' ')}` : ''}`);
    }
  }
  if (opts.json) writeFileSync(resolve(opts.json), JSON.stringify(out, null, 1));
  const hard = out.reduce((n, r) => n + r.results.filter(x => x.status === 'FAIL' && !x.expected).length, 0);
  process.exitCode = hard ? 1 : 0;
}
