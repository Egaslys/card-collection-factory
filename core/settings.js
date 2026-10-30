// Factory settings: settings/defaults.json (tracked) merged with settings/local.json (personal, ignored by Git;
// the editor will write it). What each value means is in the `_about` of defaults.json; the values live only there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS_DIR = path.join(ROOT, 'settings');

/**
 * @typedef {object} OpenRouterSettings
 * @property {string} endpoint
 * @property {string} model
 * @property {string} aspectRatio
 * @property {string} resolution
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
 */

/**
 * @typedef {object} Settings
 * @property {ProviderSettings} provider
 * @property {{attempts: number, maxSpendUsd: number}} card
 * @property {Record<string, import('./image/adjust.js').AdjustSettings>} processing  per model id; overrides the style's start
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Merges the local override into the defaults: objects key by key, anything else replaced. A key the defaults do
 * not have is refused (a typo would otherwise be silently ignored), except under an empty object of the defaults,
 * which is an open map, and keys starting with "_" (comments).
 * @param {Record<string, any>} defaults
 * @param {Record<string, any>} local
 * @param {string} [where]  key path for error messages
 * @returns {Record<string, any>}
 */
export function mergeSettings(defaults, local, where = '') {
  const open = Object.keys(defaults).length === 0;
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
export function loadSettings({ dir = SETTINGS_DIR } = {}) {
  /** @param {string} name */
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const defaults = read('defaults.json');
  const local = fs.existsSync(path.join(dir, 'local.json')) ? read('local.json') : {};
  return /** @type {Settings} */ (mergeSettings(defaults, local));
}
