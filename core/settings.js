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

/**
 * @typedef {object} OpenRouterSettings
 * @property {string} endpoint
 * @property {string} model
 * @property {string|null} fallbackModel  tried in the same attempt when `model` fails; null = none
 * @property {string} aspectRatio  wanted for a card; each model gets the closest ratio of its profile
 * @property {string} keyEnvVar  name of the environment variable holding the key; the key itself is never in settings
 * @property {Record<string, unknown>} params  other request fields, passed as is
 * @property {number} timeoutMs
 * @property {number} retries
 * @property {number} backoffMs
 */

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
 * @property {'openrouter'|'codex-cli'} use
 * @property {OpenRouterSettings} openrouter
 * @property {CodexCliSettings} codexCli
 * @property {Record<string, import('./providers/models.js').ModelProfile>} models  per model id ("codex-cli" for Codex)
 */

/**
 * @typedef {object} Settings
 * @property {ProviderSettings} provider
 * @property {{attempts: number, maxSpendUsd: number, tuneProcessing: boolean, editPrompt: string, editLegend: string}} card
 * @property {Record<string, import('./image/adjust.js').AdjustSettings>} processing  per model id; overrides the style's start
 * @property {import('./card/hero.js').VisionSettings} vision  the vision model that looks at finished cards
 * @property {import('./card/hero.js').HeroSettings} hero  finding the hero's outline when nobody gives its box
 * @property {import('./card/look.js').LookSettings} look  the vision model's look at every attempt: order and adequacy
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Merges the local override into the defaults: objects key by key, anything else replaced. A key the defaults do
 * not have is refused (a typo would otherwise be silently ignored), except under an open map of the defaults (an empty
 * object, or one marked "_open": true) and keys starting with "_" (comments).
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
  const local = fs.existsSync(path.join(dir, 'local.json')) ? read('local.json') : {};
  return /** @type {Settings} */ (mergeSettings(defaults, local));
}

/**
 * Personal settings only (settings/local.json), `{}` when there is none.
 * @param {{dir?: string}} [o]
 * @returns {Record<string, any>}
 */
export function readLocalSettings({ dir = settingsDir() } = {}) {
  const file = path.join(dir, 'local.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/**
 * Writes personal changes into settings/local.json: `patch` is merged into the file key by key (objects deep,
 * anything else replaced); a value equal to the default is dropped from the file, so local.json keeps only what
 * differs. The result is checked against defaults.json before it is written (an unknown key throws).
 * @param {Record<string, any>} patch
 * @param {{dir?: string}} [o]
 * @returns {Settings} the merged settings after the write
 */
export function saveLocalSettings(patch, { dir = settingsDir() } = {}) {
  const defaults = JSON.parse(fs.readFileSync(path.join(dir, 'defaults.json'), 'utf8'));
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
  const local = prune(deep(readLocalSettings({ dir }), patch), defaults);
  const merged = mergeSettings(defaults, local);
  const file = path.join(dir, 'local.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(local, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return /** @type {Settings} */ (merged);
}
