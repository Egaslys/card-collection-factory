// Model profiles: what one image model accepts, read from the factory settings (provider.models, keyed by the model id;
// "codex-cli" for Codex). The values and their sources are in settings/defaults.json; this module only applies them.
// A model without a profile is asked for 1:1 (every image model takes it) with no extra request fields; the card is
// cut from whatever comes back (core/image/prepare.js).

/**
 * @typedef {object} ModelProfile
 * @property {string[]|null} aspectRatios  the ratios the model accepts ("W:H"); null = any (said in words, Codex)
 * @property {number} maxReferences  how many input images one request may carry
 * @property {Record<string, unknown>} params  request fields this model needs, sent with every request (e.g. resolution)
 * @property {string} [prompt]  how this model's provider advises writing prompts, with the source (for agents and people)
 */

/**
 * The image provider of one run: the one asked for, OpenRouter when only a model is asked for (the model is an
 * OpenRouter one), else the settings' provider.use.
 * @template {string} U
 * @param {U} use  settings provider.use @param {{provider?: string, model?: string}} run
 * @returns {U}
 */
export const runProvider = (use, { provider, model }) => /** @type {U} */ (provider ?? (model ? 'openrouter' : use));

/** The ratio a model without a profile is asked for. */
export const SAFE_ASPECT = '1:1';

/** @param {string} r "W:H" @returns {number} width / height */
function ratioOf(r) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r);
  if (!m || !+m[1] || !+m[2]) throw new Error(`Пропорция «${r}» не в виде «ширина:высота».`);
  return +m[1] / +m[2];
}

/**
 * The wanted ratio when the model takes it (or any); otherwise the accepted ratio closest to what the image will be cut
 * to — `cropTo`, the card's width / height, when the image is cut to the card (the least cut, so the margins the model
 * drew stay), else the wanted one.
 * @param {string} wanted @param {string[]|null} accepted @param {number} [cropTo]
 * @returns {string}
 */
export function closestAspect(wanted, accepted, cropTo) {
  if (!accepted || accepted.includes(wanted)) return wanted;
  const w = Math.log(cropTo ?? ratioOf(wanted));
  return accepted.reduce((best, r) => (Math.abs(Math.log(ratioOf(r)) - w) < Math.abs(Math.log(ratioOf(best)) - w) ? r : best));
}

/**
 * The profile of a model, or the safe one (1:1, no extra fields) when the settings have none.
 * @param {Record<string, ModelProfile>|undefined} models  settings provider.models
 * @param {string} id
 * @returns {ModelProfile}
 */
export function profileOf(models, id) {
  return (id.startsWith('_') ? undefined : models?.[id]) ?? { aspectRatios: [SAFE_ASPECT], maxReferences: Infinity, params: {} };
}

/**
 * What one request to the model carries: the ratio it accepts (closestAspect), its own fields; refuses more input images
 * than it takes before anything is sent.
 * @param {ModelProfile} profile
 * @param {{model: string, aspectRatio: string, references: number, crop?: {width: number, height: number}}} req
 *   crop: the size the image will be cut to (the card), when it is
 * @returns {{aspectRatio: string, params: Record<string, unknown>}}
 */
export function requestFor(profile, { model, aspectRatio, references, crop }) {
  if (references > profile.maxReferences) {
    throw new Error(`Модель ${model} принимает не больше ${profile.maxReferences} картинок-образцов, а в запросе ${references}.`);
  }
  return { aspectRatio: closestAspect(aspectRatio, profile.aspectRatios, crop && crop.width / crop.height), params: profile.params ?? {} };
}
