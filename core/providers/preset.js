// API presets: the service every keyed call goes to — images (when provider.use is "api"), the vision model (hero,
// look) and the text model (set plans, text help). Settings provider.preset names one; provider.<preset> holds its
// endpoint, key variable, model ids and network settings (settings/defaults.json, `_about`). Each preset's calls keep
// one contract (openrouter.js / openrouter-text.js): {endpoint, apiKey, model, ...}; gemini.js also takes `prices`.
import * as gemini from './gemini.js';
import * as openrouter from './openrouter.js';
import { complete as openrouterComplete } from './openrouter-text.js';

/**
 * @typedef {object} PresetSettings  settings provider.openrouter / provider.google
 * @property {string} endpoint
 * @property {string} model  the image model
 * @property {string|null} fallbackModel  tried in the same attempt when `model` fails; null = none
 * @property {string} visionModel  looks at cards (hero box, look)
 * @property {string} textModel  writes set plans and text help
 * @property {string} aspectRatio  wanted for a card; each model gets the closest ratio of its profile
 * @property {string} keyEnvVar  the environment variable (or .env line) holding the key; the key itself is never in settings
 * @property {Record<string, unknown>} params  other request fields, passed as is
 * @property {number} timeoutMs @property {number} retries @property {number} backoffMs
 * @property {import('./gemini.js').Prices} [prices]  USD per 1M tokens per model, for a service whose answers carry no cost
 */

/** @typedef {'openrouter'|'google'} PresetName */

/**
 * The calls of each preset. getCredits: the account balance, null where the service has no such call.
 * The contract is gemini.js's signatures (openrouter.js takes the same options and ignores `prices`).
 * @type {Record<PresetName, {generateImage: typeof gemini.generateImage, askVision: typeof gemini.askVision, complete: typeof gemini.complete, listImageModels: typeof gemini.listImageModels, getCredits: typeof openrouter.getCredits | null}>}
 */
const APIS = {
  openrouter: { generateImage: openrouter.generateImage, askVision: openrouter.askVision, complete: openrouterComplete, listImageModels: openrouter.listImageModels, getCredits: openrouter.getCredits },
  google: { generateImage: gemini.generateImage, askVision: gemini.askVision, complete: gemini.complete, listImageModels: gemini.listImageModels, getCredits: null },
};

/** The names of the presets, as provider.preset and `--provider` take them. */
export const PRESETS = /** @type {PresetName[]} */ (Object.keys(APIS));

/** How a person calls each service. @type {Record<PresetName, string>} */
export const PRESET_TITLES = { openrouter: 'OpenRouter', google: 'Google AI Studio' };

/**
 * The preset of the settings (or the one named): its name and settings.
 * @param {{preset: string} & Record<string, any>} provider  settings provider
 * @param {string} [name]
 * @returns {PresetSettings & {name: PresetName}}
 */
export function presetOf(provider, name = provider.preset) {
  if (!PRESETS.includes(/** @type {PresetName} */ (name)) || !provider[name]) {
    throw new Error(`Настройки: неизвестный сервис provider.preset = «${name}» (есть ${PRESETS.join(' и ')}).`);
  }
  return { ...provider[name], name: /** @type {PresetName} */ (name) };
}

/** The calls of a preset. @param {PresetName} name */
export const apiOf = name => APIS[name];

/**
 * The provider settings of one run: `--provider openrouter | google` draws with that preset's models and sends its
 * vision and text calls there too; `--provider codex-cli` draws with Codex; a model alone draws with the preset's API.
 * @template {{use: string, preset: string}} P
 * @param {P} provider  settings provider
 * @param {{provider?: string, model?: string}} run
 * @returns {P}
 */
export function runSettings(provider, { provider: name, model } = {}) {
  if (name === 'codex-cli') return { ...provider, use: 'codex-cli' };
  if (name !== undefined) return { ...provider, use: 'api', preset: presetOf(provider, name).name };
  return model ? { ...provider, use: 'api' } : provider;
}
