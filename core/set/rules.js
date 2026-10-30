// The set rules of a style (styles/<style>/set-rules.json) and the small helpers every part of core/set shares:
// staging rows and presets, item-kind names, the window skeleton of a layout.
import fs from 'node:fs';
import path from 'node:path';
import { matches } from '../style/assembly.js';
import { unseenStaging } from '../style/card-order.js';
import { loadStyle, styleDirOf } from '../style/style.js';

export const RULES_FILE = 'set-rules.json';

/**
 * @typedef {object} WindowRules  one window layout (SETS.md 4.2)
 * @property {'large'|'small'|'grand'} family
 * @property {number[]} [stars]  exact stars of slots 1–10
 * @property {'non-decreasing'|'free'} [stars_order]  the rule for a ladder of the set's own (when `stars` is absent)
 * @property {number[][]} [examples]  the reference ladders of this layout
 * @property {number[][]} [gold_examples]  gold slots of the reference windows (gold = items)
 * @property {number[]} scenes  allowed numbers of character scenes (the window's tail)
 * @property {'scenes'|'none'|'items'} gold
 * @property {string} frame  the frame of the slots that are not gold
 * @property {string} source
 */

/**
 * A row of BACKGROUNDS.md «Какую постановку выбрать».
 * @typedef {{id: string, title: string, when: import('../style/style.js').Condition, preset: Record<string, unknown>, fill: string[], category: {when?: import('../style/style.js').Condition, category: number}[]}} StagingRow
 */

/**
 * @typedef {object} SetRules
 * @property {number} set_size
 * @property {{columns: number, rows: number}} grid
 * @property {number} max_characters
 * @property {{regular: number[], min_each: number, max_each_preferred: number}} categories
 * @property {{small: number[], large: number[]}} abstract_share
 * @property {{distinct: number[], max_same: number}} patterns
 * @property {import('../style/style.js').Condition} abstract_when
 * @property {{words: number[], chars: number[], grand_words: number[], language: string}} captions
 * @property {{max_shared_kinds: number}} variants
 * @property {string[]} frames
 * @property {Record<string, WindowRules>} windows
 * @property {number[]} small_scene_slots
 * @property {StagingRow[]} stagings
 * @property {{sets: number, growth_window: number, theme_kinds: string[], reference_positions: {window: string, scenes: number}[]}} collection
 * @property {{window: string}} standalone
 * @property {{fragments: Record<string, string>, glue: Record<string, string>}} prompt
 */

/** @type {Map<string, {rules: SetRules, style: import('../style/style.js').Style}>} */
const cache = new Map();

/**
 * The set rules and the loaded style (for the order checks) of a style folder name.
 * @param {string} style
 * @returns {{rules: SetRules, style: import('../style/style.js').Style}}
 */
export function loadSetRules(style) {
  const hit = cache.get(style);
  if (hit) return hit;
  const dir = styleDirOf(style);
  const file = path.join(dir, RULES_FILE);
  if (!fs.existsSync(file)) throw new Error(`У стиля «${style}» нет ${RULES_FILE}: правил набора не из чего взять (styles/${style}/).`);
  const out = { rules: /** @type {SetRules} */ (JSON.parse(fs.readFileSync(file, 'utf8'))), style: loadStyle(dir) };
  cache.set(style, out);
  return out;
}

/**
 * The name of an item kind as compared across sets: lower case, single spaces, no article, a plain plural «s» cut
 * (so «Fishing Rods» and «a fishing rod» are one kind).
 * @param {string} kind
 */
export function kindKey(kind) {
  let k = String(kind ?? '').toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(a|an|the) /, '');
  if (k.length > 3 && /[^s]s$/.test(k)) k = k.slice(0, -1);
  return k;
}

/**
 * The row of BACKGROUNDS.md «Какую постановку выбрать» the order's staging belongs to (first match of `stagings`).
 * @param {import('../style/card-order.js').CardOrder} order
 * @param {SetRules} rules
 * @param {import('../style/style.js').Style} style
 * @returns {string}  the row id, or "other"
 */
export function stagingRow(order, rules, style) {
  return rules.stagings.find(r => matches(r.when, order, style))?.id ?? 'other';
}

/**
 * The categories a staging row gives the order (BACKGROUNDS.md «Категория как следствие постановки»): the first
 * entry whose `when` matches, else any entry without `when`.
 * @param {import('../style/card-order.js').CardOrder} order
 * @param {StagingRow} row
 * @param {import('../style/style.js').Style} style
 * @returns {number[]}
 */
export function rowCategories(order, row, style) {
  const hit = row.category.find(e => e.when && matches(e.when, order, style));
  return hit ? [hit.category] : row.category.filter(e => !e.when).map(e => e.category);
}

/**
 * The backdrop patterns a planner may pick for each staging row that has one: those the style neither forbids nor
 * counts as a staging no reference card shows (core/style unseenStaging; BACKGROUNDS.md «Какую постановку выбрать»).
 * @param {SetRules} rules
 * @param {import('../style/style.js').Style} style
 * @returns {Map<string, string[]>}
 */
export function seenPatterns(rules, style) {
  const values = /** @type {string[]} */ (style.assembly.fields.pattern.values).filter(p => !['n/a', 'other'].includes(p));
  return new Map(rules.stagings.filter(r => r.fill.includes('pattern')).map(r => [r.id, values.filter(pattern => {
    const order = /** @type {any} */ ({ staging: { ...r.preset, pattern } });
    return !style.assembly.forbid.some(f => matches(f.when, order, style)) && unseenStaging(order, style) === null;
  })]));
}

/**
 * Expands `staging.preset` into the preset's staging; the order's own fields win.
 * @param {Record<string, unknown>|undefined} staging
 * @param {SetRules} rules
 * @returns {{staging: Record<string, unknown>|undefined, error?: string}}
 */
export function expandStaging(staging, rules) {
  if (!staging || typeof staging !== 'object' || staging.preset === undefined) return { staging };
  const { preset, ...own } = staging;
  const row = rules.stagings.find(r => r.id === preset);
  if (!row) return { staging: own, error: `staging.preset = «${preset}» — нет такой постановки; есть: ${rules.stagings.map(r => r.id).join(', ')}` };
  return { staging: { ...row.preset, ...own } };
}

/**
 * The window of a layout as slots: stars and frame of each slot and whether a scene stands there.
 * A layout without exact stars takes its first reference ladder that fits the scene count.
 * @param {SetRules} rules
 * @param {string} layout  a key of `windows`
 * @param {number} scenes
 * @returns {{stars: number, frame: string, scene: boolean}[]}
 */
export function windowSkeleton(rules, layout, scenes) {
  const w = rules.windows[layout];
  if (!w) throw new Error(`Нет окна «${layout}»; есть: ${Object.keys(rules.windows).join(', ')}.`);
  if (!w.scenes.includes(scenes)) throw new Error(`Окно «${layout}» допускает сцен с персонажами: ${w.scenes.join(', ')}, а не ${scenes}.`);
  const n = rules.set_size;
  const ladders = w.stars ? [w.stars] : /** @type {number[][]} */ (w.examples);
  // a reference ladder whose top stars sit on the scenes (Seafaring 1 scene → …, 5; Vacation 2 scenes → …, 5, 5)
  const stars = ladders.find(l => scenes === 0 || l.slice(n - scenes).every(s => s === Math.max(...l))) ?? ladders[0];
  const goldItems = new Set(w.gold === 'items' ? w.gold_examples?.[0] ?? [n] : []);
  return stars.map((s, i) => {
    const scene = i >= n - scenes;
    const gold = (w.gold === 'scenes' && scene) || goldItems.has(i + 1);
    return { stars: s, frame: gold ? 'gold' : w.frame, scene };
  });
}
