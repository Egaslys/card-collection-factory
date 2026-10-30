// Factory settings: settings/defaults.json (tracked) merged with settings/local.json (personal, ignored by Git;
// the editor's settings write it through saveLocalSettings). What each value means is in the `_about` of defaults.json; the values live only there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS_DIR = path.join(ROOT, 'settings');
/** The settings folder in use. CCF_SETTINGS_DIR replaces it and exists for tests only (a folder with defaults.json and,
 * when a test needs one, its own local.json), so that the person's real settings/local.json never reaches a test. */
const settingsDir = () => (process.env.CCF_SETTINGS_DIR ? path.resolve(process.env.CCF_SETTINGS_DIR) : SETTINGS_DIR);

/** @typedef {import('./providers/preset.js').PresetSettings} PresetSettings */

/**
 * @typedef {object} CodexCliSettings  also the `defaults` of core/providers/codex-cli.js
 * @property {string} command
 * @property {string|null} model  null = the model of the user's Codex config
 * @property {string} aspectRatio
 * @property {number} timeoutMs
 * @property {string} reasoningEffort
 * @property {string} sandbox
 * @property {string} promptTemplate
 */

/**
 * @typedef {object} ProviderSettings
 * @property {'api'|'codex-cli'} use  who draws: the preset's image model, or Codex
 * @property {import('./providers/preset.js').PresetName} preset  the service of every keyed call (images, vision, text)
 * @property {PresetSettings} openrouter
 * @property {PresetSettings} google
 * @property {CodexCliSettings} codexCli
 * @property {Record<string, import('./providers/models.js').ModelProfile>} models  per model id ("codex-cli" for Codex)
 */

/**
 * @typedef {object} Settings
 * @property {ProviderSettings} provider
 * @property {{attempts: number, maxSpendUsd: number, tuneProcessing: boolean, editPrompt: string, editLegend: string, fix: import('./card/fix.js').FixSettings}} card
 * @property {Record<string, import('./image/adjust.js').AdjustSettings>} processing  per model id; overrides the style's start
 * @property {import('./card/hero.js').VisionSettings} vision  the vision model that looks at finished cards
 * @property {import('./card/hero.js').HeroSettings} hero  finding the hero's outline when nobody gives its box
 * @property {import('./card/look.js').LookSettings} look  the vision model's look at every attempt: order and adequacy
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Personal settings written before the API presets (2026-10-30), in today's shape: provider.use "openrouter" → "api"
 * with the openrouter preset; vision.model and set.plan.model (OpenRouter ids then) → provider.openrouter.visionModel
 * and textModel. Anything else is returned as it is.
 * @param {Record<string, any>} local
 * @returns {Record<string, any>}
 */
export function migrateLocal(local) {
  const out = structuredClone(local);
  /** @param {Record<string, any>} o @param {string[]} keys */
  const dropEmpty = (o, keys) => { for (const k of keys) if (isObject(o[k]) && !Object.keys(o[k]).length) delete o[k]; };
  if (out.provider?.use === 'openrouter') { out.provider.use = 'api'; out.provider.preset ??= 'openrouter'; }
  /** @param {Record<string, any>|undefined} from @param {string} to */
  const move = (from, to) => {
    if (!isObject(from) || !('model' in from)) return;
    const or = ((out.provider ??= {}).openrouter ??= {});
    or[to] ??= from.model;
    delete from.model;
  };
  move(out.vision, 'visionModel');
  move(out.set?.plan, 'textModel');
  if (isObject(out.set)) dropEmpty(out.set, ['plan']);
  dropEmpty(out, ['vision', 'set']);
  return out;
}

/**
 * Merges the local override into the defaults: objects key by key, anything else replaced. A key the defaults do
 * not have is refused (a typo would otherwise be silently ignored), except under an open map of the defaults (an empty
 * object, or one marked "_open": true) and keys starting with "_" (comments). A value whose default is a number must
 * be a finite number (an emptied field would otherwise become 0 or null).
 * @param {Record<string, any>} defaults
 * @param {Record<string, any>} local
 * @param {string} [where]  key path for error messages
 * @returns {Record<string, any>}
 */
export function mergeSettings(defaults, local, where = '') {
  const open = Object.keys(defaults).length === 0 || defaults._open === true;
  /** @type {Record<string, any>} */
  const out = { ...defaults };
  for (const [key, value] of Object.entries(local)) {
    if (key.startsWith('_')) continue;
    const name = where ? `${where}.${key}` : key;
    if (!(key in defaults)) {
      if (!open) throw new Error(`Настройки: неизвестный ключ «${name}» в settings/local.json.`);
      out[key] = value;
    } else if (isObject(defaults[key])) {
      if (!isObject(value)) throw new Error(`Настройки: «${name}» должен быть объектом.`);
      out[key] = mergeSettings(defaults[key], value, name);
    } else if (typeof defaults[key] === 'number' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`Настройки: «${name}» должно быть числом, а не ${JSON.stringify(value)} (по умолчанию ${defaults[key]}).`);
    } else out[key] = value;
  }
  return out;
}

/**
 * Reads the settings: defaults.json, then local.json over it when it exists.
 * @param {{dir?: string}} [o]
 * @returns {Settings}
 */
export function loadSettings({ dir = settingsDir() } = {}) {
  /** @param {string} name */
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const defaults = read('defaults.json');
  const local = fs.existsSync(path.join(dir, 'local.json')) ? migrateLocal(read('local.json')) : {};
  return /** @type {Settings} */ (mergeSettings(defaults, local));
}

/**
 * Personal settings only (settings/local.json, in today's shape: migrateLocal), `{}` when there is none.
 * @param {{dir?: string}} [o]
 * @returns {Record<string, any>}
 */
export function readLocalSettings({ dir = settingsDir() } = {}) {
  const file = path.join(dir, 'local.json');
  return fs.existsSync(file) ? migrateLocal(JSON.parse(fs.readFileSync(file, 'utf8'))) : {};
}

/**
 * Writes personal changes into settings/local.json: `patch` is merged into the file key by key (objects deep,
 * anything else replaced); a value equal to the default is dropped from the file, so local.json keeps only what
 * differs. `reset`: dotted paths taken out of the file, so they are back at their default (an emptied field of the
 * editor). The result is checked against defaults.json before it is written (an unknown key or a non-number where the
 * default is a number throws, and nothing is written).
 * @param {Record<string, any>} patch
 * @param {{dir?: string, reset?: string[]}} [o]
 * @returns {Settings} the merged settings after the write
 */
export function saveLocalSettings(patch, { dir = settingsDir(), reset = [] } = {}) {
  const defaults = JSON.parse(fs.readFileSync(path.join(dir, 'defaults.json'), 'utf8'));
  /** @param {any} o @param {string} p */
  const at = (o, p) => p.split('.').reduce((x, k) => (isObject(x) ? x[k] : undefined), o);
  for (const p of reset) if (at(defaults, p) === undefined) throw new Error(`Настройки: неизвестный ключ «${p}».`);
  /** @param {Record<string, any>} base @param {Record<string, any>} add @returns {Record<string, any>} */
  const deep = (base, add) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(add)) out[k] = isObject(v) && isObject(out[k]) ? deep(out[k], v) : v;
    return out;
  };
  /** @param {Record<string, any>} local @param {Record<string, any>} def @returns {Record<string, any>} */
  const prune = (local, def) => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(local)) {
      if (isObject(v) && isObject(def?.[k]) && Object.keys(def[k]).length) {
        const inner = prune(v, def[k]);
        if (Object.keys(inner).length) out[k] = inner;
      } else if (JSON.stringify(v) !== JSON.stringify(def?.[k])) out[k] = v;
    }
    return out;
  };
  const next = migrateLocal(deep(readLocalSettings({ dir }), patch));
  for (const p of reset) {
    const ks = p.split('.');
    const parent = ks.length === 1 ? next : at(next, ks.slice(0, -1).join('.'));
    if (isObject(parent)) delete parent[/** @type {string} */ (ks.at(-1))];
  }
  const local = prune(next, defaults);
  const merged = mergeSettings(defaults, local);
  const file = path.join(dir, 'local.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(local, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return /** @type {Settings} */ (merged);
}
