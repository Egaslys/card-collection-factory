// The production loop of one card: order → prompt → generation → preparation → post-processing → checks, repeated
// while the style's automatic checks fail, within the attempt limit and the spend cap; then the best attempt
// becomes the card. Files: card-file.js. The loop never decides on art: the agent looks at the chosen attempt,
// edits the order (staging, subject, promptExtra / promptOverride) and runs it again on the same card; new attempts
// are appended. A new card is made in the collection's pool (core/store); `place` puts it into a set's slot.
//
// A person's (or an agent's) requests on a made card, the editor's buttons: regenerate with a wish (the order plus
// their words), edit (the card's model image goes to the provider as the input image with their words), adjust
// (post-processing set by hand, or reset to the program's own), import (an image the agent drew with its own tool,
// checked as strictly as a generated one), choose (make any earlier version — attempt — the card). They make one
// attempt unless told otherwise, and their result becomes the card even when an earlier attempt passes more checks:
// the person's word outranks the rules (VISION.md «Слово человека — главное»).
//
// Outline policy. Many checks need the hero separated from the backdrop. Each attempt's hero outline is cut in a box
// (hero.js, GrabCut): the box an agent or a person gave (`card check --hero-box`), else the box the vision model of the
// settings finds on the card and on its mirror image alike (when the provider holds a key). An outline the style can
// measure on (on an abstract backdrop) and that did not collapse is trusted: its FAILs are blocking, as on an
// outline a person confirmed. Where only the box is trusted (scenes, environments), composition is measured on the box
// as on a box drawn by eye. Without either, the style's checker proposes an outline of its own, unreliable on generated
// cards (styles/scapes/checks/README.md): a FAIL resting on it never triggers a paid regeneration but is reported as
// "needs eyes"; the agent opens attempts/<n>/card.mask.png, confirms or rejects it (or gives hero_box) with
// `card check`, and the checks run again. The other FAILs ("blocking") make the loop regenerate.
//
// The look (look.js). With a key, the vision model also looks at each attempt: is it what the order asked for, and
// nothing unordered? Its "no" to an order question of a blocking kind (settings → look) counts as a blocking problem
// and the loop regenerates; its other answers go to the report. Its calls and the hero's are added to the spend.
//
// Learning from a failure (fix.js). A regeneration does not repeat the same prompt blindly: before each new attempt
// whose earlier attempt has findings (the run's own last failed attempt; for `regenerateCard`, the version the person
// starts from), the text model of the preset writes a correction from them that is added at the end of the prompt and
// kept in the attempt (`fix`, its cost counted as text). Without the preset's key there is no correction.
//
// Post-processing is tuned per attempt (tune.js): from the style's start settings for the model, the search moves
// saturation, brightness and sharpening until the whole-card measures are inside the bible's aims, with the smallest
// change. The backdrop's colour joins the measures when the hero outline is trusted, or once a person or the agent
// has confirmed the checker's own outline (`card check --mask confirmed`): then the attempt is tuned again. Settings
// and measures are kept in card.json.
import fs from 'node:fs';
import path from 'node:path';
import { adjust } from '../image/adjust.js';
import { encodePng, prepareCard } from '../image/prepare.js';
import * as codexCli from '../providers/codex-cli.js';
import { modelIds, profileOf, requestFor } from '../providers/models.js';
import { loadApiKey } from '../providers/openrouter.js';
import { apiOf, keyEnvVars, presetOf } from '../providers/preset.js';
import { ROOT } from '../settings.js';
import { orderOutput, validateOrder } from '../style/card-order.js';
import { OrderError, buildPrompt as styleBuildPrompt } from '../style/prompt.js';
import { loadStyle, styleDirOf } from '../style/style.js';
import * as factoryStore from '../store/index.js';
import { said, saidError, textSaid } from '../say.js';
import { ATTEMPT_FILES, FINAL_IMAGE, attemptCost, attemptDir, markBusy, readCardFile, reserveAttempt, updateCardFile } from './card-file.js';
import { checkAttempt, styleChecker, styleDir, withLook } from './check.js';
import { findingsOf, proposeWish, writeFix } from './fix.js';
import { findHero, locateHero, readOutline, readPixels as heroPixels, writeOutline } from './hero.js';
import { lookAtCard } from './look.js';
import { pickVersion } from './pick.js';
import { tuneProcessing } from './tune.js';
import { textCallOptions } from '../text/draft.js';

/** @typedef {import('./card-file.js').Attempt} Attempt */
/** @typedef {import('./card-file.js').CardFile} CardFile */
/** @typedef {{path?: string, bytes?: Uint8Array, mime?: string}} ImageRef */
/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */
/** @typedef {import('../image/adjust.js').AdjustSettings} AdjustSettings */
/** @typedef {import('../style/style.js').OrderOutput} OrderOutput */

/**
 * The image provider of a run. model: the id recorded in the attempts and used to pick post-processing;
 * free: the provider takes no payment per image (its cost is recorded as 0); generate: one image for the prompt,
 * answering like core/providers/openrouter.js generateImage.
 * aspectRatio: the order kind's own frame, else the provider settings'; crop: the card size the image will be cut to, when
 * it is (a model that lacks the ratio is asked for the one closest to it). fallback: the provider to try, in the same
 * attempt, when this one fails (an error, a refusal, an answer without an image). legend: what the attached images
 * are, for a provider that says it in words (Codex); default: style references. vision: asks the vision model about one
 * image (or several, each after its label: the choice among versions) through the API preset of the run (provider.preset, with its key); absent when there is no key — the loop then
 * finds no hero box by itself and does not look (settings → vision, hero, look). text: the text model of the preset
 * (with its key), which writes the correction of a failed picture before the next attempt (fix.js); absent without a key.
 * @typedef {{model: string, free?: boolean, fallback?: Provider, vision?: VisionCall, text?: import('./fix.js').TextCall,
 *   generate: (req: {prompt: string, references: {path: string}[], aspectRatio?: string, legend?: string, crop?: {width: number, height: number}}) => Promise<{bytes: Uint8Array, mime?: string, cost: number|null}>}} Provider
 */

/**
 * The vision call of a connection; `model`: its preset's vision model (without it, the settings preset's).
 * @typedef {((req: {model: string, prompt: string, image?: ImageRef, images?: (ImageRef & {label?: string})[], maxTokens: number, reasoning?: Record<string, unknown>, timeoutMs: number}) => Promise<{text: string, cost: number|null}>) & {model?: string}} VisionCall
 */

/** @typedef {((req: {prompt: string, image?: ImageRef, images?: (ImageRef & {label?: string})[], maxTokens: number, reasoning?: Record<string, unknown>}) => Promise<{text: string, cost: number|null}>) & {model: string}} Ask  the vision model of the run (reasoning: instead of the settings'); model: its id, recorded */

/**
 * The prompt of an order (core/style buildPrompt): legend = what the attached images are, as the prompt says it,
 * handed to a provider that writes its own legend (Codex) so it does not say something else.
 * @typedef {(order: CardOrder) => Promise<{prompt: string, references: {path: string}[], legend?: string|null}>} BuildPrompt
 */

/**
 * Why a run stopped: passed = no blocking FAIL; attempts = the attempt limit; budget = the next call could pass
 * the spend cap; provider-error = the provider failed (recorded in the attempt); key = the service refused the key or
 * wants money (ProviderError kind auth or billing, from the image call or the vision model's): no later call can
 * succeed, so no fallback model is tried, and a run over many cards (a set, a collection) stops too — the report's
 * `keyProblem` says what a person must do; cost-unknown = the provider did not report the price, so the cap cannot be
 * kept; cancelled = the caller's signal was aborted (checked before every call: a call already sent is not interrupted).
 * @typedef {'passed'|'attempts'|'budget'|'provider-error'|'key'|'cost-unknown'|'cancelled'} StopReason
 */

/**
 * What stopped a run on the key: `kind` auth (the key is not accepted) or billing (no money, no billing, a used-up
 * daily quota), `message` in Russian for a person, starting «С ключом проблема:»; for Codex (no key): not logged in,
 * not installed, or the subscription's limit is used up, its own message starting «Codex CLI». `said`: the same as data
 * for the editor's page (core/say.js): key.auth / key.billing with the service's reply, or Codex's codex.* code.
 * @typedef {{kind: 'auth'|'billing', message: string, said?: import('../say.js').Said}} KeyProblem
 */

/**
 * A key problem from a provider's failure (its ErrorKind), or null. Codex has no key: its error already says what a
 * person must do (log in, wait for the subscription's limit), and that is the message.
 * @param {{kind?: string, message?: string, service?: string, providerMessage?: string, said?: import('../say.js').Said}|null|undefined} e @returns {KeyProblem|null}
 */
export function keyProblemOf(e) {
  if (e?.kind !== 'auth' && e?.kind !== 'billing') return null;
  if (e.service === 'codex-cli') return { kind: e.kind, message: String(e.message ?? ''), ...(e.said ? { said: e.said } : {}) };
  const what = e.kind === 'billing' ? 'на счёте сервиса кончились деньги, не включена оплата или исчерпана дневная квота' : 'сервис не принял ключ (неверный, отозван или без доступа)';
  return { kind: e.kind, message: `С ключом проблема: ${what}. Ответ сервиса: ${e.message ?? ''} Пополните счёт или замените ключ и запустите снова.`,
    said: said(`key.${e.kind}`, { reply: e.providerMessage || String(e.message ?? '') }) };
}

/**
 * A run's progress for the caller (the editor's queue): stage of attempt `n`, attempts finished (`done`) of at most `of`,
 * USD `spent` so far.
 * @typedef {{stage: 'generate'|'process'|'done', n: number|null, done: number, of: number, spent: number}} Progress
 */

/** @typedef {{signal?: AbortSignal, onProgress?: (e: Progress) => void}} RunControl  cancel and watch a run */

/**
 * @typedef {object} AttemptReport
 * @property {number} n
 * @property {string} model
 * @property {number|null} cost
 * @property {Attempt['fallbackFrom']} [fallbackFrom]
 * @property {Attempt['error']} [error]
 * @property {import('./card-file.js').CheckSummary} [check]
 * @property {{doc: string, check: number, what: string}[]} [visual]  the checks left for eyes
 * @property {Record<string, string>} files  absolute paths of the attempt's files that exist
 */

/**
 * @typedef {object} CardReport
 * @property {string} dir
 * @property {string} id  the card's id: its folder in the collection's pool
 * @property {number|null} chosen
 * @property {string|null} image  the final card.png
 * @property {import('./card-file.js').CheckSummary|null} chosenCheck  the checks of the chosen attempt (it may be from an earlier run)
 * @property {{doc: string, check: number, what: string}[]} chosenVisual  the chosen attempt's checks left for eyes
 * @property {AttemptReport[]} attempts
 * @property {string[]} warnings
 * @property {StopReason} [stop]  make only
 * @property {KeyProblem} [keyProblem]  with stop "key"
 * @property {number} [spent]  make only: USD spent by this run (known costs)
 * @property {{attempts: number, maxSpendUsd: number}} [limits]  make only
 */

const EXT_BY_MIME = /** @type {Record<string, string>} */ ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' });
const MIME_BY_EXT = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });
/** The model recorded for an image an agent made with its own tool (`importImage`); the style's processing start has an entry for it. */
export const AGENT_MODEL = 'agent';
/** The key of Codex's profile in provider.models. */
const CODEX_PROFILE = 'codex-cli';
const EPSILON_USD = 1e-9;
const NO_VISION = 'Смотрящая модель не спрошена (нет ключа сервиса — provider.preset): рамку героя для проверок даёт только агент или человек, взгляда на карточку нет.';

/**
 * Whether the loop may make one more paid call, or why not.
 * @param {{done: number, spent: number, limits: {attempts: number, maxSpendUsd: number}, priceHint: number}} o
 *   done = attempts of this run; priceHint = the highest known price of one call with this model (0 = none known)
 * @returns {'attempts'|'budget'|null}
 */
export function nextStep({ done, spent, limits, priceHint }) {
  if (done >= limits.attempts) return 'attempts';
  if (limits.maxSpendUsd <= 0 || spent + priceHint > limits.maxSpendUsd + EPSILON_USD) return 'budget';
  return null;
}

/**
 * The checked attempts, best first: fewest blocking problems the vision model saw (a drawing error, the wrong subject,
 * a thing nobody ordered: they outweigh a measured FAIL, the author's decision of 2026-10-31), then fewest blocking
 * FAILs of the style's checks, then fewest FAILs left for eyes, then fewest WARNs, then the earliest.
 * @param {Attempt[]} attempts
 * @returns {Attempt[]}
 */
export function rankAttempts(attempts) {
  const checked = attempts.filter(a => a.check && !a.error);
  /** @param {Attempt} a */
  const key = a => {
    const c = /** @type {import('./card-file.js').CheckSummary} */ (a.check);
    const seen = c.look?.issues.filter(i => i.blocking).length ?? 0, measured = c.blocking - seen;
    return [seen, measured, c.fails.length - measured, c.warns, a.n];
  };
  return checked.sort((a, b) => { const x = key(a), y = key(b); return x.map((v, i) => v - y[i]).find(d => d !== 0) ?? 0; });
}

/** The best checked attempt by the program's order (rankAttempts). @param {Attempt[]} attempts @returns {number|null} */
export const pickBest = attempts => rankAttempts(attempts)[0]?.n ?? null;

/** @param {string} style @returns {any} the style's processing.json */
const styleProcessing = style => JSON.parse(fs.readFileSync(path.join(styleDir(style), 'processing.json'), 'utf8'));

/**
 * Starting post-processing settings for a model (or the model its profile says it is the same as, `sameAs`): the
 * factory settings' override for the model, else the style's start for it (a name there refers to another entry, e.g.
 * "neutral"), else none (neutral) with a warning.
 * @param {{style: string, model: string, settings: import('../settings.js').Settings}} o
 * @returns {{processing: AdjustSettings, warning?: string}}
 */
export function processingFor({ style, model, settings }) {
  const own = styleProcessing(style);
  const ids = modelIds(settings.provider?.models, model);
  const id = ids.find(i => settings.processing[i] || own.start?.[i]) ?? model;
  const start = own.start?.[id];
  const chosen = settings.processing[id] ?? (typeof start === 'string' ? own[start] : start);
  if (chosen) return { processing: chosen };
  return { processing: own.neutral, warning: `Для модели ${model} нет начальных настроек обработки ни в настройках, ни в styles/${style}/processing.json: начато с нейтральных.` };
}

/**
 * Tunes the processing of one attempt from its prepared pixels (tune.js) against the style's measures.
 * @param {{order: CardOrder, card: {pixels: Uint8Array, width: number, height: number}, start: AdjustSettings, fg?: Uint8Array|null, outline?: string}} o
 *   fg: a hero outline confirmed by eye or trusted (adds the backdrop's colour to the measures); outline: which (for the record)
 */
async function tuneFor({ order, card, start, fg, outline = 'confirmed' }) {
  const checker = await styleChecker(order.style);
  const own = styleProcessing(order.style);
  const lift = shadowLiftFor(own, order.staging ?? {});
  const { shadows: shadowAxis, ...axes } = own.bounds;
  const bounds = { ...axes, sharpen: { ...own.bounds.sharpen, max: own.sharpen_amount_max }, ...(lift ? { shadows: shadowAxis } : {}) };
  const ids = [...own.tune_checks, ...(lift ? [lift.check] : [])];
  return tuneProcessing({
    ...card, start, neutral: own.neutral, bounds,
    basis: fg ? `whole card + backdrop (${outline} outline)` : 'whole card',
    measure: (rgb, prefix) => checker.processingMeasures(rgb, { staging: order.staging ?? {}, ids: ids.filter(id => !prefix || id.startsWith(prefix)), fg })
      .map(m => (lift && m.id === lift.check ? { ...m, aim: lift.aim } : m)),
  });
}

/**
 * The style's shadow lift for a staging (processing.json `shadows`: the check it moves, the aim, and `when` — staging
 * fields with a lower bound, e.g. scenes: characters ≥ 1), or null when the staging does not match or the style has none.
 * @param {any} own  processing.json @param {Record<string, any>} staging
 * @returns {{check: string, aim: {min?: number, max?: number}}|null}
 */
export function shadowLiftFor(own, staging) {
  const s = own.shadows;
  if (!s || !own.bounds?.shadows) return null;
  const fits = Object.entries(s.when ?? {}).every(([field, b]) => typeof staging[field] === 'number' && staging[field] >= (/** @type {any} */ (b).min ?? -Infinity));
  return fits ? { check: s.check, aim: s.aim } : null;
}

/** @param {string} file @returns {Promise<{pixels: Uint8Array, width: number, height: number}>} */
async function readPixels(file) {
  return prepareCard(file, undefined);
}

/**
 * The provider chosen in the settings (provider.use): the image model of the API preset (provider.preset →
 * provider.<preset>, its key), whose `fallbackModel`, when set, is the fallback of the main one (`model` replaces the
 * main one for this run); or Codex. Each model is asked through its profile (provider.models,
 * core/providers/models.js): the ratio it accepts closest to the wanted one, its own request fields, no more input
 * images than it takes. The key is read from the environment or .env, never printed, unless the caller holds it (a
 * running editor's temporary key). With a key, the provider also carries `vision` through the preset — for Codex too,
 * whose images need no key: without one it has no `vision`.
 * @param {import('../settings.js').ProviderSettings} settings
 * @param {{apiKey?: string, model?: string}} [o]  model: the preset's image model of this run instead of its `model`
 * @returns {Provider}
 */
export function providerFrom(settings, { apiKey: held, model: chosen } = {}) {
  /** the model's own framing correction (its profile's `framing`) at the end of its prompt */
  const withFraming = (/** @type {string} */ prompt, /** @type {import('../providers/models.js').ModelProfile} */ p) => [prompt, p.framing].filter(Boolean).join('\n\n');
  if (settings.use === 'codex-cli') {
    if (chosen) throw new Error(`Модель ${chosen} выбирается только у сервиса с ключом (provider.use = api); Codex рисует своей (provider.codexCli.model).`);
    const c = settings.codexCli;
    const profile = profileOf(settings.models, CODEX_PROFILE);
    const vision = visionFrom(settings, { apiKey: held });
    const text = textFrom(settings, { apiKey: held });
    return {
      model: 'codex-cli' + (c.model ? `/${c.model}` : ''), free: true,
      generate: async ({ prompt, references, aspectRatio, legend, crop }) => codexCli.generateImage({
        settings: c, prompt: withFraming(prompt, profile), references, legend, withoutEnv: keyEnvVars(settings),
        aspectRatio: requestFor(profile, { model: CODEX_PROFILE, aspectRatio: aspectRatio ?? c.aspectRatio, references: references.length, crop }).aspectRatio,
      }),
      ...(vision ? { vision } : {}),
      ...(text ? { text } : {}),
    };
  }
  if (settings.use !== 'api') throw new Error(`Настройки: неизвестный провайдер provider.use = «${settings.use}» (есть api и codex-cli).`);
  const o = presetOf(settings);
  const api = apiOf(o.name);
  const apiKey = held ?? loadApiKey({ envVar: o.keyEnvVar });
  const net = { timeoutMs: o.timeoutMs, retries: o.retries, backoffMs: o.backoffMs };
  /** @param {string} model @returns {Provider} */
  const on = model => {
    const profile = profileOf(settings.models, model);
    return {
      model,
      generate: async ({ prompt, references, aspectRatio, crop }) => {
        const r = requestFor(profile, { model, aspectRatio: aspectRatio ?? o.aspectRatio, references: references.length, crop });
        return api.generateImage({ endpoint: o.endpoint, apiKey, prices: o.prices, model, prompt: withFraming(prompt, profile), references, aspectRatio: r.aspectRatio, params: { ...o.params, ...r.params }, net });
      },
    };
  };
  const main = chosen ?? o.model;
  const fallback = o.fallbackModel && o.fallbackModel !== main ? o.fallbackModel : null;
  return {
    ...on(main), ...(fallback ? { fallback: on(fallback) } : {}),
    vision: /** @type {VisionCall} */ (visionFrom(settings, { apiKey })), text: /** @type {import('./fix.js').TextCall} */ (textFrom(settings, { apiKey })),
  };
}

/**
 * The vision call through the API preset (provider.preset: its endpoint and vision model) with the caller's key (a
 * running editor's) or the one in the environment or .env; null without a key. It never throws: an image an agent
 * hands in is checked without the vision model when there is no key, as Codex's images are.
 * @param {import('../settings.js').ProviderSettings} settings
 * @param {{apiKey?: string|null}} [o]
 * @returns {VisionCall|null}
 */
export function visionFrom(settings, { apiKey } = {}) {
  const o = presetOf(settings);
  let key = apiKey ?? null;
  try { key ??= loadApiKey({ envVar: o.keyEnvVar }); } catch { /* no key: nothing looks */ }
  if (!key) return null;
  const k = key;
  /** @type {VisionCall} */
  const call = ({ model, prompt, image, images, maxTokens, reasoning, timeoutMs }) => apiOf(o.name).askVision({
    endpoint: o.endpoint, apiKey: k, prices: o.prices, model, prompt, image, images, maxTokens, reasoning, net: { timeoutMs, retries: o.retries, backoffMs: o.backoffMs },
  });
  return Object.assign(call, { model: o.visionModel });
}

/**
 * The text call through the API preset (its endpoint and text model) with the caller's key or the one in the
 * environment or .env; null without a key. It never throws for a missing key: without one, a failed picture is simply
 * drawn again from the same prompt.
 * @param {import('../settings.js').ProviderSettings} settings
 * @param {{apiKey?: string|null}} [o]
 * @returns {import('./fix.js').TextCall|null}
 */
export function textFrom(settings, { apiKey } = {}) {
  const o = presetOf(settings);
  let key = apiKey ?? null;
  try { key ??= loadApiKey({ envVar: o.keyEnvVar }); } catch { /* no key: no correction */ }
  if (!key) return null;
  const k = key;
  const call = (/** @type {Parameters<import('./fix.js').TextCall>[0]} */ { messages, maxTokens, json, reasoning, timeoutMs }) => apiOf(o.name).complete({
    endpoint: o.endpoint, apiKey: k, prices: o.prices, model: o.textModel, messages, maxTokens, json, ...(reasoning ? { reasoning } : {}),
    net: { timeoutMs, retries: o.retries, backoffMs: o.backoffMs },
  });
  return Object.assign(call, { model: o.textModel });
}

/**
 * The vision model of the run through a connection (the provider's `vision`: its preset's vision model, else the
 * settings preset's), asked as settings → vision says; null without a connection.
 * @param {VisionCall|null|undefined} call @param {import('../settings.js').Settings} settings @returns {Ask|null}
 */
function askOf(call, settings) {
  if (!call) return null;
  const v = settings.vision;
  const model = call.model ?? presetOf(settings.provider).visionModel;
  /** @type {Ask} */
  const ask = Object.assign(
    /** @type {(req: Parameters<Ask>[0]) => ReturnType<Ask>} */ (req => call({ model, reasoning: v.reasoning ?? undefined, timeoutMs: v.timeoutMs, ...req })),
    { model },
  );
  return ask;
}

/**
 * What the program does with the order's image (core/style/card-order.js orderOutput).
 * @param {CardOrder} order
 * @returns {OrderOutput}
 */
function outputOf(order) {
  return orderOutput(order, loadStyle(styleDirOf(order.style)));
}

/** @typedef {import('./hero.js').Hero} Hero */

/**
 * Runs the style's checks on the attempt with its hero (a trusted outline is measured on; a trusted box alone counts
 * as a box by eye), or, for an order kind without pixel checks, writes check.json with only the checklist for eyes:
 * nothing blocks, so the loop does not regenerate. The vision model's look of the attempt, if any, is added.
 * @param {{order: CardOrder, dir: string, attempt: Attempt, output: OrderOutput, hero?: Hero|null}} o
 * @returns {Promise<import('./card-file.js').CheckSummary>}
 */
async function checkOrSkip({ order, dir, attempt, output, hero }) {
  const review = attempt.review;
  if (!output.checks) {
    fs.writeFileSync(path.join(dir, ATTEMPT_FILES.check), JSON.stringify({ results: [], visual: output.visual }, null, 1));
    return withLook({ maskStatus: 'not checked', blocking: 0, needsEyes: 0, warns: 0, fails: [] }, attempt.look);
  }
  const given = hero?.fg && hero.confidence === 'high' ? { outline: /** @type {any} */ (hero) }
    : hero?.box && hero.boxConfidence === 'high' && !review?.hero_box ? { review: { ...review, hero_box: hero.box } } : {};
  return withLook((await checkAttempt({ order, dir, review, ...given })).summary, attempt.look);
}

/**
 * The hero of an attempt, found on its prepared image (hero.js): the outline cut in the box an agent or a person gave
 * (`review.hero_box`), else in the box the vision model finds (`ask`); null without either, or for an order kind
 * without pixel checks. Writes card.hero.png and records the hero in the attempt (its vision cost included).
 * @param {{order: CardOrder, attempt: Attempt, dir: string, ask: Ask|null, settings?: import('../settings.js').Settings}} o
 *   settings: needed with `ask` (vision and hero)
 * @returns {Promise<Hero|null>}
 */
async function findAttemptHero({ order, attempt, dir, ask, settings }) {
  const box = attempt.review?.hero_box;
  if (!box && !(ask && settings)) return null;
  const checker = await styleChecker(order.style);
  const outlineFits = checker.outlineFits?.(order.staging ?? {}) ?? true;
  const file = path.join(dir, ATTEMPT_FILES.prepared);
  const { pixels, width, height } = await heroPixels(file);
  const s = /** @type {import('../settings.js').Settings} */ (settings);
  const hero = box ? await findHero({ pixels, width, height, box, outlineFits })
    : await findHero({
      pixels, width, height, outlineFits, agreeIou: s.hero.agreeIou,
      locate: () => locateHero({ image: { path: file }, order, width, height, vision: s.vision, settings: s.hero, ask: /** @type {Ask} */ (ask) }),
    });
  const out = path.join(dir, ATTEMPT_FILES.hero);
  if (hero.fg) await writeOutline(hero.fg, width, height, out);
  else fs.rmSync(out, { force: true });
  attempt.hero = { source: hero.source, box: hero.box, confidence: hero.confidence, boxConfidence: hero.boxConfidence, reasons: hero.reasons, ...(hero.agreement !== undefined ? { agreement: hero.agreement } : {}), cost: hero.cost };
  return hero;
}

/**
 * The hero recorded in an attempt, with its outline read back from card.hero.png; null when none was recorded.
 * @param {Attempt} attempt @param {string} dir @returns {Promise<Hero|null>}
 */
async function storedHero(attempt, dir) {
  if (!attempt.hero) return null;
  const file = path.join(dir, ATTEMPT_FILES.hero);
  const fg = fs.existsSync(file) ? (await readOutline(file)).fg : null;
  return { ...attempt.hero, box: /** @type {any} */ (attempt.hero.box), fg };
}

/** @param {Hero|null|undefined} hero  the outline the processing may measure the backdrop with: a trusted one */
const trustedFg = hero => (hero?.fg && hero.confidence === 'high' ? hero.fg : null);

/**
 * The vision model looks at the attempt's card (look.js); writes look.json and records the look in the attempt.
 * @param {{order: CardOrder, attempt: Attempt, dir: string, ask: Ask, settings: import('../settings.js').Settings}} o
 */
async function lookAt({ order, attempt, dir, ask, settings }) {
  const checked = JSON.parse(fs.readFileSync(path.join(dir, ATTEMPT_FILES.check), 'utf8'));
  const visual = (checked.visual ?? []).map((/** @type {any} */ v) => ({ ...v, id: v.id ?? `${String(v.doc).replace(/\.md$/, '')}.${v.check}` }));
  const { record, prompt, text } = await lookAtCard({ image: { path: path.join(dir, ATTEMPT_FILES.card) }, order, visual, wish: attempt.wish, model: ask.model, settings: settings.look, ask });
  fs.writeFileSync(path.join(dir, ATTEMPT_FILES.look), JSON.stringify({ ...record, prompt, answer: text }, null, 1));
  attempt.look = record;
}

/**
 * Model image → prepared.png (cut to the card size, or the model's frame) → the hero → card.png (post-processed) →
 * checks → the vision model's look, in the attempt folder.
 * @param {{order: CardOrder, attempt: Attempt, dir: string, bytes: Uint8Array, mime?: string, processing: AdjustSettings, output: OrderOutput,
 *   settings: import('../settings.js').Settings, ask: Ask|null}} o
 */
async function processAttempt({ order, attempt, dir, bytes, mime, processing, output, settings, ask }) {
  const { CARD_SIZE } = await styleChecker(order.style);
  attempt.original = ATTEMPT_FILES.original + (EXT_BY_MIME[mime ?? ''] ?? '.bin');
  fs.writeFileSync(path.join(dir, attempt.original), bytes);
  const card = await prepareCard(bytes, output.crop ? CARD_SIZE : undefined);
  if (card.cutBottom) attempt.cutBottom = card.cutBottom;
  fs.writeFileSync(path.join(dir, ATTEMPT_FILES.prepared), await encodePng(card.pixels, card.width, card.height));
  const hero = output.checks ? await findAttemptHero({ order, attempt, dir, ask, settings }) : null;
  const fg = trustedFg(hero);
  if (settings.card.tuneProcessing && output.checks) ({ settings: attempt.processing, tuning: attempt.tuning } = await tuneFor({ order, card, start: processing, fg, outline: 'trusted' }));
  else attempt.processing = processing;
  const pixels = adjust(card.pixels, card.width, card.height, /** @type {AdjustSettings} */ (attempt.processing));
  fs.writeFileSync(path.join(dir, ATTEMPT_FILES.card), await encodePng(pixels, card.width, card.height));
  attempt.check = await checkOrSkip({ order, dir, attempt, output, hero });
  if (ask && settings.look.use) {
    await lookAt({ order, attempt, dir, ask, settings });
    attempt.check = withLook(attempt.check, attempt.look);
  }
}

/**
 * Chooses the card's attempt and copies its card to the card folder. by 'checks': the best checked attempt of the
 * card; by 'request': the best of `ns` (the attempts a person's or an agent's explicit request just made: their
 * word outranks the checks), the choice kept unchanged when none of them reached the checks. `eye`: the version the
 * vision model picked among those (pickByEye) wins over the program's order (`chosenBy` "look").
 * @param {string} dir @param {CardFile} card @param {'checks'|'request'} by @param {number[]} [ns] @param {number|null} [eye]
 */
function choose(dir, card, by, ns = [], eye = null) {
  const pool = by === 'checks' ? card.attempts : card.attempts.filter(a => ns.includes(a.n));
  const seen = eye != null && pool.some(a => a.n === eye && a.check && !a.error);
  const best = seen ? eye : pickBest(pool);
  if (by === 'request' && best == null) return;
  card.chosen = best;
  card.chosenBy = seen ? 'look' : by;
  copyChosen(dir, card);
}

/**
 * The vision model's choice among the card's versions after a run (pick.js): the best `settings.card.pick.maxVersions`
 * of the checked attempts (all of the card's, or `ns`) by the program's order, shown at once, when there are two or
 * more, the run made one of them and its spend cap leaves room for the call (about one look per version shown). The
 * pick is recorded in the run's last attempt (`pick`, pick.json), its cost counted there.
 * @param {{dir: string, card: CardFile, ns?: number[], run: {ns: number[], spent: number, stop: StopReason, warnings: string[]}, provider: Provider,
 *   settings: import('../settings.js').Settings, limits: {maxSpendUsd: number}}} o
 * @returns {Promise<{best: number|null, attempt: Attempt}|null>}  null = not asked
 */
async function pickByEye({ dir, card, ns, run, provider, settings, limits }) {
  const p = settings.card.pick, ask = askOf(provider.vision, settings);
  const holder = card.attempts.find(a => a.n === run.ns.at(-1));
  if (!p?.use || !ask || !settings.look.use || !holder || run.stop === 'key' || run.stop === 'cancelled') return null;
  const versions = rankAttempts(ns ? card.attempts.filter(a => ns.includes(a.n)) : card.attempts)
    .filter(a => fs.existsSync(path.join(attemptDir(dir, a.n), ATTEMPT_FILES.card))).slice(0, p.maxVersions);
  if (versions.length < 2 || !versions.some(a => run.ns.includes(a.n))) return null;
  // about one look per picture shown: the versions and the style's reference cards before them
  const hint = Math.max(0, ...versions.map(a => a.look?.cost ?? 0)) * (versions.length + (p.references ?? 0));
  if (run.spent + hint > limits.maxSpendUsd + EPSILON_USD) {
    run.warnings.push(textSaid(`Выбор лучшей версии смотрящей моделью пропущен: он не помещается в потолок расходов ($${limits.maxSpendUsd}); выбрано по проверкам.`, 'pick.cap', { cap: limits.maxSpendUsd }));
    return null;
  }
  const { record, prompt, text } = await pickVersion({
    versions: versions.map(a => ({ n: a.n, attempt: a, image: { path: path.join(attemptDir(dir, a.n), ATTEMPT_FILES.card) } })),
    order: card.order, model: ask.model, settings: p, look: settings.look, ask,
  });
  fs.writeFileSync(path.join(attemptDir(dir, holder.n), ATTEMPT_FILES.pick), JSON.stringify({ ...record, prompt, answer: text }, null, 1));
  holder.pick = record;
  run.spent += record.cost;
  if (record.error) run.warnings.push(textSaid(`Смотрящая модель не выбрала версию: ${record.error}`, 'pick.failed', { reason: record.error }));
  return { best: record.best, attempt: holder };
}

/** @param {string} dir @param {CardFile} card */
function copyChosen(dir, card) {
  if (card.chosen != null) fs.copyFileSync(path.join(attemptDir(dir, card.chosen), ATTEMPT_FILES.card), path.join(dir, FINAL_IMAGE));
}

/**
 * Writes an operation's part of a card into card.json as it is now (card-file.js updateCardFile: another operation,
 * here or in another process, may have added attempts or chosen meanwhile): its own attempts, replaced by n or added,
 * and whatever `also` decides on the current card (the order, the choice). `card`, the operation's copy, then takes
 * the file's state, keeping the operation's own attempt objects.
 * @param {string} dir @param {CardFile} card @param {Attempt[]} own @param {(current: CardFile) => void} [also]
 */
function saveCard(dir, card, own, also) {
  const fresh = updateCardFile(dir, file => {
    const c = file ?? { order: card.order, attempts: [], chosen: null };
    for (const a of own) {
      const i = c.attempts.findIndex(x => x.n === a.n);
      if (i >= 0) c.attempts[i] = a; else c.attempts.push(a);
    }
    c.attempts.sort((x, y) => x.n - y.n);
    also?.(c);
    return c;
  });
  const mine = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (card));
  for (const k of Object.keys(mine)) if (!(k in fresh)) delete mine[k];
  Object.assign(card, fresh);
}

/**
 * @param {string} dir @param {CardFile} card @param {number[]} ns  attempts to report
 * @returns {CardReport}
 */
export function cardReport(dir, card, ns) {
  /** @param {number} n */
  const visualOf = n => {
    const file = path.join(attemptDir(dir, n), ATTEMPT_FILES.check);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).visual : undefined;
  };
  const attempts = card.attempts.filter(a => ns.includes(a.n)).map(a => {
    const adir = attemptDir(dir, a.n);
    /** @type {Record<string, string>} */
    const files = {};
    for (const [k, name] of Object.entries({ ...ATTEMPT_FILES, original: a.original ?? '' })) if (name && fs.existsSync(path.join(adir, name))) files[k] = path.join(adir, name);
    const visual = visualOf(a.n);
    return { n: a.n, model: a.model, cost: a.cost, ...(a.fallbackFrom ? { fallbackFrom: a.fallbackFrom } : {}), ...(a.error ? { error: a.error } : {}), ...(a.check ? { check: a.check } : {}), ...(visual ? { visual } : {}), files };
  });
  const chosen = card.attempts.find(a => a.n === card.chosen);
  return {
    dir, id: path.basename(dir), chosen: card.chosen, image: chosen ? path.join(dir, FINAL_IMAGE) : null,
    chosenCheck: chosen?.check ?? null, chosenVisual: (chosen && visualOf(chosen.n)) ?? [], attempts, warnings: [],
  };
}

/**
 * Appends attempts to a card until one has no blocking FAIL or a limit is reached; writes card.json after each.
 * @param {object} o
 * @param {string} o.dir  the card folder
 * @param {CardFile} o.card
 * @param {{prompt: string, references: {path: string}[], legend?: string}} o.request  what every attempt sends
 * @param {Partial<Attempt>} [o.mark]  recorded in every attempt of the run (the person's wish, the attempt edited)
 * @param {Attempt|null} [o.failed]  an earlier attempt whose findings the first attempt of the run corrects (regenerate);
 *   later attempts correct the findings of the run's own last failed attempt (fix.js, settings card.fix)
 * @param {Provider} o.provider
 * @param {import('../settings.js').Settings} o.settings
 * @param {{attempts: number, maxSpendUsd: number}} o.limits
 * @param {RunControl} [o.control]
 * @param {string} o.what  the operation, for the card's busy marker (card-file.js markBusy)
 * @returns {Promise<{ns: number[], spent: number, stop: StopReason, warnings: string[], keyProblem?: KeyProblem}>}
 */
async function runAttempts({ what, ...o }) {
  const release = markBusy(o.dir, what);
  try { return await attemptsRun(o); } finally { release(); }
}

/** runAttempts without the busy marker. @param {Omit<Parameters<typeof runAttempts>[0], 'what'>} o */
async function attemptsRun({ dir, card, request, mark = {}, failed = null, provider, settings, limits, control = {} }) {
  const { order } = card;
  const output = outputOf(order);
  const ask = askOf(provider.vision, settings);
  /** @type {Set<string>} */
  const warnings = new Set(ask ? [] : [NO_VISION]);
  /** @param {string} model the highest known price of one call with the model in this card (0 = none known) */
  const priceHint = model => Math.max(0, ...card.attempts.filter(a => a.model === model && typeof a.cost === 'number').map(a => /** @type {number} */ (a.cost)));
  const req = {
    ...request, references: request.references.map(r => ({ path: r.path })), ...(output.aspectRatio ? { aspectRatio: output.aspectRatio } : {}),
    ...(output.crop ? { crop: (await styleChecker(order.style)).CARD_SIZE } : {}),
  };
  /** @param {any} e */
  const failure = e => ({ message: String(e?.message ?? e), ...(e?.status ? { status: e.status } : {}), ...(keyProblemOf(e) ? { kind: e.kind } : {}), ...(e?.said ? { said: e.said } : {}) });
  /** @type {KeyProblem|null} */
  let keyProblem = null;
  /** @type {number[]} */
  const ns = [];
  /** @type {Attempt[]} this run's attempts: its part of card.json */
  const own = [];
  const save = () => saveCard(dir, card, own);
  let spent = 0;
  /** @type {StopReason|undefined} */
  let stop;
  /** the attempt whose findings the next one corrects */
  let last = failed;
  /** @param {Progress['stage']} stage @param {number|null} n  the attempt under way (null: the run is over) */
  const tell = (stage, n) => control.onProgress?.({ stage, n, done: ns.length - (n == null ? 0 : 1), of: limits.attempts, spent });
  for (;;) {
    const limit = control.signal?.aborted ? 'cancelled' : nextStep({ done: ns.length, spent, limits, priceHint: priceHint(provider.model) });
    if (limit) { stop = limit; break; }
    /** @type {Attempt['fix']} */
    let fix;
    try { fix = await fixFor({ last, request, wish: mark.wish, provider, settings }); } catch (/** @type {any} */ e) {
      // the text model's service refused the key or wants money: no later call of it can succeed
      if ((keyProblem = keyProblemOf(e))) { stop = 'key'; break; }
      fix = { from: /** @type {Attempt} */ (last).n, text: null, model: provider.text?.model ?? '', cost: typeof e?.cost === 'number' ? e.cost : 0, error: String(e?.message ?? e) };
    }
    spent += fix?.cost ?? 0;
    const prompt = fix?.text ? `${request.prompt}\n\n${fix.text}` : request.prompt;
    const n = reserveAttempt(dir, Math.max(0, ...card.attempts.map(a => a.n)));
    /** @type {Attempt} */
    const attempt = { n, at: new Date().toISOString(), model: provider.model, ...mark, prompt, ...(fix ? { fix } : {}), references: request.references.map(r => path.relative(ROOT, r.path)), cost: null };
    card.attempts.push(attempt);
    own.push(attempt);
    ns.push(n);
    tell('generate', n);
    const adir = attemptDir(dir, n);
    let answer, used = provider;
    /** @type {number|null} USD of this attempt's failed calls that were paid all the same (their errors carry it) */
    let failedUsd = null;
    /** @param {any} e */
    const paid = e => { if (typeof e?.cost === 'number') { failedUsd = (failedUsd ?? 0) + e.cost; spent += e.cost; } };
    try {
      answer = await provider.generate({ ...req, prompt });
    } catch (/** @type {any} */ e) {
      paid(e);
      const fallback = provider.fallback;
      if (control.signal?.aborted) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'cancelled'; }
      else if ((keyProblem = keyProblemOf(e))) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'key'; }
      else if (!fallback) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'provider-error'; }
      else if (spent + priceHint(fallback.model) > limits.maxSpendUsd + EPSILON_USD) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'budget'; }
      else {
        // the main model failed (error, refusal, no image): the fallback model makes this attempt
        attempt.fallbackFrom = { model: provider.model, error: failure(e) };
        attempt.model = fallback.model;
        used = fallback;
        try { answer = await fallback.generate({ ...req, prompt }); } catch (/** @type {any} */ e2) {
          paid(e2);
          attempt.error = { stage: 'generate', ...failure(e2) };
          stop = (keyProblem = keyProblemOf(e2)) ? 'key' : 'provider-error';
        }
      }
      if (!answer) { attempt.cost = failedUsd; save(); break; }
    }
    attempt.cost = used.free ? 0 : answer.cost == null ? null : answer.cost + (failedUsd ?? 0);
    spent += used.free ? 0 : answer.cost ?? 0;
    tell('process', n);
    for (const w of await processInto({ order, attempt, dir: adir, bytes: answer.bytes, mime: answer.mime, settings, output, ask })) warnings.add(w);
    spent += attemptCost(attempt) - (attempt.cost ?? 0) - (attempt.fix?.cost ?? 0);
    save();
    if (attempt.check && attempt.check.blocking > 0) last = attempt;
    // the vision model's service refused the key: the next attempts could not be looked at either
    if ((keyProblem = keyProblemOf(attempt.look?.error ? { kind: attempt.look.errorKind, message: attempt.look.error } : null))) { stop = 'key'; break; }
    if (attempt.cost == null) { stop = 'cost-unknown'; break; }
    if (attempt.check && attempt.check.blocking === 0) { stop = 'passed'; break; }
  }
  tell('done', null);
  return { ns, spent, stop: /** @type {StopReason} */ (stop), warnings: [...(keyProblem ? [keyProblem.said ? textSaid(keyProblem.message, keyProblem.said.code, keyProblem.said.params) : keyProblem.message] : []), ...warnings], ...(keyProblem ? { keyProblem } : {}) };
}

/**
 * The correction of the next attempt (fix.js): written by the provider's text model from the findings of `last`, the
 * attempt it follows, when settings card.fix allow it; undefined when there is nothing to correct or no text model.
 * Throws when the call fails (a ProviderError carries its cost and kind).
 * @param {{last: Attempt|null, request: {prompt: string}, wish?: string, provider: Provider, settings: import('../settings.js').Settings}} o
 * @returns {Promise<Attempt['fix']>}
 */
async function fixFor({ last, request, wish, provider, settings }) {
  const findings = last ? findingsOf(last) : [];
  if (!last || !findings.length || !settings.card.fix?.use || !provider.text) return undefined;
  const r = await writeFix({ prompt: request.prompt, findings, previous: last.fix?.text ?? undefined, wish, text: provider.text, settings: settings.card.fix, model: textCallOptions(settings) });
  return { from: last.n, text: r.text, model: provider.text.model, cost: r.cost ?? 0, ...(r.skipped?.length ? { skipped: r.skipped } : {}), ...(r.error ? { error: r.error } : {}) };
}

/**
 * Prepares, finds the hero, post-processes, checks and looks at an image in its attempt; a failure is recorded in the
 * attempt.
 * @param {{order: CardOrder, attempt: Attempt, dir: string, bytes: Uint8Array, mime?: string, settings: import('../settings.js').Settings, output: OrderOutput, ask?: Ask|null}} o
 * @returns {Promise<string[]>} warnings: about the start of post-processing; that the image was taller than the card;
 *   that the vision model gave no answer
 */
async function processInto({ order, attempt, dir, bytes, mime, settings, output, ask = null }) {
  const { processing, warning } = processingFor({ style: order.style, model: attempt.model, settings });
  try {
    await processAttempt({ order, attempt, dir, bytes, mime, processing, output, settings, ask });
  } catch (/** @type {any} */ e) {
    attempt.error = { stage: 'process', message: String(e?.message ?? e) };
  }
  return [
    ...(warning ? [warning] : []),
    ...(attempt.cutBottom ? [`Картинка попытки ${attempt.n} (${attempt.model}) выше карточки: срезано ${attempt.cutBottom} px снизу. Модель надо просить о кадре не выше карточки — проверьте её профиль (settings provider.models).`] : []),
    ...(attempt.look?.error ? [`Смотрящая модель не дала ответа на попытку ${attempt.n}: ${attempt.look.error}`] : []),
  ];
}

/** @typedef {Pick<typeof import('../store/index.js'), 'cardDir'|'newCardId'|'moveCard'>} CardStore  the Store API core/card uses */

/**
 * The card folder for a card made from an order: an existing card of the collection (`card`), else a new card of
 * the collection's pool, its id taken from the order's id.
 * @param {{store: CardStore, collection: string, card?: string, order: CardOrder}} o
 */
function cardFolder({ store, collection, card, order }) {
  if (card == null) { const id = store.newCardId(collection, order.id); return { id, dir: store.cardDir(collection, id) }; }
  const dir = store.cardDir(collection, card);
  if (!readCardFile(dir)) throw new Error(`В коллекции «${collection}» нет карточки «${card}» (${dir}).`);
  return { id: card, dir };
}

/**
 * @param {string} dir @param {CardFile} card @param {number[]} ns
 * @param {{stop: StopReason, spent: number, warnings: string[], keyProblem?: KeyProblem}} run @param {{attempts: number, maxSpendUsd: number}} limits
 * @returns {CardReport}
 */
const runReport = (dir, card, ns, run, limits) => ({ ...cardReport(dir, card, ns), stop: run.stop, spent: run.spent, limits, warnings: run.warnings, ...(run.keyProblem ? { keyProblem: run.keyProblem } : {}) });

/** @param {string} dir @returns {CardFile} */
function needCard(dir) {
  const card = readCardFile(dir);
  if (!card) throw new Error(`Нет карточки: ${dir} (нет card.json).`);
  return card;
}

/**
 * The attempt `n`, or the chosen one, with the file the operation needs.
 * @param {string} dir @param {CardFile} card @param {number|undefined} n @param {string} file  a name in the attempt folder
 * @returns {{attempt: Attempt, file: string}}
 */
function sourceAttempt(dir, card, n, file) {
  const k = n ?? card.chosen;
  if (k == null) throw new Error('У карточки нет выбранной попытки: укажите номер попытки.');
  const attempt = card.attempts.find(a => a.n === k);
  const name = file === ATTEMPT_FILES.original ? attempt?.original : file;
  const full = name && path.join(attemptDir(dir, k), name);
  if (!attempt || !full || !fs.existsSync(full)) throw new Error(`У карточки нет попытки ${k} с файлом ${file}.`);
  return { attempt, file: full };
}

/** Attempts of one person's (or agent's) request when the run gives no limit: the request is done once. */
const REQUEST_ATTEMPTS = 1;

/**
 * Makes one card of a collection: appends attempts to the card folder until one has no blocking FAIL or a limit is
 * reached, chooses the best attempt and, with `place`, puts the card into a set's slot.
 * @param {object} o
 * @param {CardOrder} o.order
 * @param {string} o.collection  the collection id (store)
 * @param {string} [o.card]  an existing card of the collection to continue (the order replaces its order); default: a
 *   new card in the collection's pool
 * @param {{setId: string, slot: number}} [o.place]  the set and its 0-based slot to put the card into (store moveCard)
 * @param {import('../settings.js').Settings} o.settings  card limits and post-processing
 * @param {Provider} o.provider
 * @param {BuildPrompt} [o.buildPrompt]  default: the style's assembly (core/style/prompt.js); it throws OrderError on an
 *   invalid order, before anything is paid
 * @param {{attempts?: number, maxSpendUsd?: number}} [o.limits]  this run's overrides of settings.card
 * @param {CardStore} [o.store]  default: the factory's collections/ (tests pass createStore({root}))
 * @param {AbortSignal} [o.signal]  @param {RunControl['onProgress']} [o.onProgress]
 * @returns {Promise<CardReport>}
 */
export async function makeCard({ order, collection, card: cardId, place, settings, provider, buildPrompt = o => styleBuildPrompt(o), limits = {}, store = factoryStore, signal, onProgress }) {
  const { prompt, references, legend } = await buildPrompt(order);
  const { id, dir } = cardFolder({ store, collection, card: cardId, order });
  /** @type {CardFile} */
  const card = readCardFile(dir) ?? { order, attempts: [], chosen: null };
  saveCard(dir, card, [], c => { c.order = order; });
  const lim = { attempts: limits.attempts ?? settings.card.attempts, maxSpendUsd: limits.maxSpendUsd ?? settings.card.maxSpendUsd };
  const run = await runAttempts({ what: 'make', dir, card, request: { prompt, references, ...(legend ? { legend } : {}) }, provider, settings, limits: lim, control: { signal, onProgress } });
  const eye = await pickByEye({ dir, card, run, provider, settings, limits: lim });
  saveCard(dir, card, eye ? [eye.attempt] : [], c => choose(dir, c, 'checks', [], eye?.best));
  if (place) await store.moveCard(collection, id, place);
  return runReport(dir, card, run.ns, run, lim);
}

/**
 * What an agent needs to draw a card with its own image tool (its built-in generation): the prompt the program
 * assembles for the order, the style reference images to attach, the frame, and what to do with the result.
 * Nothing is generated or paid.
 * @param {{order: CardOrder, settings: import('../settings.js').Settings, buildPrompt?: (order: CardOrder) => Promise<{prompt: string, references: {path: string}[]}>}} o
 * @returns {Promise<{prompt: string, references: string[], aspectRatio: string, next: string}>}  references: absolute paths, in the
 *   order the prompt names them
 */
export async function orderPrompt({ order, settings, buildPrompt = o => styleBuildPrompt(o) }) {
  const { prompt, references } = await buildPrompt(order);
  const p = settings.provider;
  const aspectRatio = outputOf(order).aspectRatio ?? (p.use === 'codex-cli' ? p.codexCli : p.openrouter).aspectRatio;
  return {
    prompt, references: references.map(r => r.path), aspectRatio,
    next: 'Нарисуйте картинку своим инструментом по prompt, приложив references в этом порядке, в пропорции aspectRatio; '
      + 'затем сдайте её: node ccf.mjs card import ORDER.json IMAGE --collection ID [--set ID --slot N] (новая карточка) или card import CARD_DIR IMAGE (новая попытка). '
      + 'Программа обрежет её до карточки, подберёт обработку и проверит.',
  };
}

/**
 * Generates the card again from its order, as new attempts; the best of them becomes the card. The person's wish, when
 * given, is appended to the prompt as it is (as `promptExtra`; added to `promptOverride` when the order has one). A
 * wish is not required: when the attempt the person starts from (`n`, default the chosen one) has findings — FAILs,
 * what the vision model saw — the text model writes a correction from them, with the wish outranking them, that is
 * added at the end of the prompt (fix.js, settings card.fix; needs the preset's key).
 * @param {object} o
 * @param {string} o.dir  the card folder
 * @param {string} [o.wish]  the person's words, sent as they are
 * @param {number} [o.n]  the attempt whose findings the new picture corrects (default: the chosen one)
 * @param {import('../settings.js').Settings} o.settings
 * @param {Provider} o.provider
 * @param {BuildPrompt} [o.buildPrompt]
 * @param {{attempts?: number, maxSpendUsd?: number}} [o.limits]  default: one attempt, settings card.maxSpendUsd
 * @param {AbortSignal} [o.signal]  @param {RunControl['onProgress']} [o.onProgress]
 * @returns {Promise<CardReport>}
 */
export async function regenerateCard({ dir, wish, n, settings, provider, buildPrompt = o => styleBuildPrompt(o), limits = {}, signal, onProgress }) {
  const text = typeof wish === 'string' ? wish.trim() : '';
  const card = needCard(dir);
  const { order } = card;
  const from = n ?? card.chosen;
  const failed = from == null ? null : card.attempts.find(a => a.n === from) ?? null;
  if (n != null && !failed) throw new Error(`У карточки нет попытки ${n}.`);
  const key = order.promptOverride ? 'promptOverride' : 'promptExtra';
  const { prompt, references, legend } = await buildPrompt(text ? { ...order, [key]: [order[key], text].filter(Boolean).join(' ') } : order);
  const lim = { attempts: limits.attempts ?? REQUEST_ATTEMPTS, maxSpendUsd: limits.maxSpendUsd ?? settings.card.maxSpendUsd };
  const run = await runAttempts({ what: 'regenerate', dir, card, request: { prompt, references, ...(legend ? { legend } : {}) }, mark: text ? { wish: text } : {}, failed, provider, settings, limits: lim, control: { signal, onProgress } });
  const eye = await pickByEye({ dir, card, ns: run.ns, run, provider, settings, limits: lim });
  saveCard(dir, card, eye ? [eye.attempt] : [], c => choose(dir, c, 'request', run.ns, eye?.best));
  return runReport(dir, card, run.ns, run, lim);
}

/**
 * Edits the card's image: the model image of an attempt (default: the chosen one) goes to the provider as the input
 * image with the person's instruction (settings card.editPrompt); the answer is prepared, tuned and checked as a new
 * attempt, and the best of the new attempts becomes the card.
 * @param {object} o
 * @param {string} o.dir
 * @param {string} o.wish  what to change, in the person's words
 * @param {number} [o.n]  the attempt to edit
 * @param {import('../settings.js').Settings} o.settings
 * @param {Provider} o.provider
 * @param {{attempts?: number, maxSpendUsd?: number}} [o.limits]  default: one attempt, settings card.maxSpendUsd
 * @param {AbortSignal} [o.signal]  @param {RunControl['onProgress']} [o.onProgress]
 * @returns {Promise<CardReport>}
 */
export async function editCard({ dir, wish, n, settings, provider, limits = {}, signal, onProgress }) {
  const text = needWish(wish);
  const card = needCard(dir);
  const { attempt, file } = sourceAttempt(dir, card, n, ATTEMPT_FILES.original);
  const request = { prompt: settings.card.editPrompt.replace('{wish}', () => text), references: [{ path: file }], legend: settings.card.editLegend };
  const lim = { attempts: limits.attempts ?? REQUEST_ATTEMPTS, maxSpendUsd: limits.maxSpendUsd ?? settings.card.maxSpendUsd };
  const run = await runAttempts({ what: 'edit', dir, card, request, mark: { wish: text, editOf: attempt.n }, provider, settings, limits: lim, control: { signal, onProgress } });
  const eye = await pickByEye({ dir, card, ns: run.ns, run, provider, settings, limits: lim });
  saveCard(dir, card, eye ? [eye.attempt] : [], c => choose(dir, c, 'request', run.ns, eye?.best));
  return runReport(dir, card, run.ns, run, lim);
}

/**
 * Proposes a wish for the card's wish field (the editor's text help, «Сформулировать»): the text model reads what the
 * attempt (`n`, default the chosen one) was ordered to show and what its checks and the vision model found, with the
 * person's rough notes first when there are any, and writes what to change in the picture, for the person to read,
 * edit and send. Nothing is saved; the call's cost goes to the spend ledger (store recordSpend, kind text).
 * @param {object} o
 * @param {string} o.dir  the card folder
 * @param {number} [o.n]
 * @param {string} [o.notes]  the person's rough notes in the field
 * @param {string} [o.language]  a key of settings card.fix.languages (default "ru")
 * @param {string|null} [o.collectionId]  the collection the spend counts for
 * @param {import('../settings.js').Settings} o.settings
 * @param {import('./fix.js').TextCall} o.text  the preset's text model with its key (textFrom)
 * @param {Pick<typeof import('../store/index.js'), 'recordSpend'>} [o.store]
 * @returns {Promise<{text: string, findings: string[], model: string, cost: number|null}>}  findings: what the wish was written from
 */
export async function proposeCardWish({ dir, n, notes, language = 'ru', collectionId = null, settings, text, store = factoryStore }) {
  const card = needCard(dir);
  const k = n ?? card.chosen;
  const attempt = card.attempts.find(a => a.n === k);
  if (!attempt) throw new Error(k == null ? 'У карточки нет выбранной версии: укажите номер версии.' : `У карточки нет попытки ${k}.`);
  const findings = findingsOf(attempt);
  if (!findings.length && !notes?.trim()) throw saidError('Проверки и смотрящая модель ничего не нашли у этой версии: напишите в поле, что хотите изменить, — модель сформулирует.', 'wish.nothingFound');
  /** @type {{text: string|null, cost: number|null, error?: string}} */
  let r;
  try {
    r = await proposeWish({ title: String(card.order.title ?? ''), prompt: attempt.prompt || (await styleBuildPrompt(card.order)).prompt, findings, notes, language, text, settings: settings.card.fix, model: textCallOptions(settings) });
  } catch (e) {
    const cost = /** @type {any} */ (e)?.cost;
    if (typeof cost === 'number' && cost > 0) await store.recordSpend(collectionId, { kind: 'text', what: 'card-wish', model: text.model, usd: cost });
    throw e;
  }
  await store.recordSpend(collectionId, { kind: 'text', what: 'card-wish', model: text.model, usd: r.cost });
  if (!r.text) throw saidError('Текстовая модель не предложила пожелание: попробуйте ещё раз.', 'wish.noAnswer');
  return { text: r.text, findings: findings.map(f => f.text), model: text.model, cost: r.cost };
}

/** @param {unknown} wish */
function needWish(wish) {
  const text = typeof wish === 'string' ? wish.trim() : '';
  if (!text) throw saidError('Пожелание пустое: напишите, что изменить.', 'wish.empty');
  return text;
}

/**
 * Sets the post-processing of an attempt (default: the chosen one) by hand: card.png is drawn again from
 * prepared.png with the given values (the others stay as they were), the values are kept as the person's
 * (`processingFixed`: never tuned again), and the attempt is checked again. `reset` instead gives the attempt back
 * the processing the program finds by itself: tuned again as after its generation (from the same start, on the same
 * hero outline; settings card.tuneProcessing), or the start for its model when tuning is off. The chosen attempt
 * stays chosen.
 * @param {object} o
 * @param {string} o.dir
 * @param {number} [o.n]
 * @param {number} [o.saturation]  multiplier, 1 = unchanged
 * @param {number} [o.brightness]  levels added to luma, 0 = unchanged
 * @param {number} [o.sharpen]  unsharp-mask amount, 0 = none (the radius stays)
 * @param {number} [o.shadows]  shadow lift, levels added to black, 0 = none
 * @param {boolean} [o.reset]  instead of the values: the program's own processing again
 * @param {import('../settings.js').Settings} [o.settings]  required with `reset`
 * @returns {Promise<CardReport>}
 */
export async function adjustCard({ dir, n, saturation, brightness, sharpen, shadows, reset = false, settings }) {
  const card = needCard(dir);
  const { attempt: a, file } = sourceAttempt(dir, card, n, ATTEMPT_FILES.prepared);
  const given = saturation != null || brightness != null || sharpen != null || shadows != null;
  if (reset && given) throw new Error('Сброс обработки идёт без значений: либо значения, либо сброс.');
  if (!reset && !given) throw new Error('Не задано ни одного значения обработки (насыщенность, яркость, резкость, тени).');
  const range = styleProcessing(card.order.style).manual?.saturation;
  if (saturation != null && range && !(saturation >= range.min && saturation <= range.max)) {
    throw new Error(`Насыщенность ×${saturation} вне диапазона ручной правки ×${range.min}–×${range.max} (styles/${card.order.style}/processing.json, manual).`);
  }
  const adir = attemptDir(dir, a.n);
  const pic = await readPixels(file);
  const hero = await storedHero(a, adir);
  if (reset) {
    if (!settings) throw new Error('Для сброса обработки нужны настройки фабрики.');
    delete a.processingFixed;
    await autoProcessing({ order: card.order, attempt: a, adir, card: pic, hero, settings });
  } else {
    const base = a.processing ?? styleProcessing(card.order.style).neutral;
    a.processing = {
      ...base, ...(saturation != null ? { saturation } : {}), ...(brightness != null ? { brightness } : {}),
      ...(sharpen != null ? { sharpen: { ...base.sharpen, amount: sharpen } } : {}), ...(shadows != null ? { shadows } : {}),
    };
    a.processingFixed = true;
  }
  fs.writeFileSync(path.join(adir, ATTEMPT_FILES.card), await encodePng(adjust(pic.pixels, pic.width, pic.height, /** @type {AdjustSettings} */ (a.processing)), pic.width, pic.height));
  a.check = await checkOrSkip({ order: card.order, dir: adir, attempt: a, output: outputOf(card.order), hero });
  saveCard(dir, card, [a], c => { if (c.chosen === a.n) copyChosen(dir, c); });
  return cardReport(dir, card, [a.n]);
}

/**
 * The processing the program gives an attempt by itself, as processAttempt does after a generation: from the start
 * the attempt was tuned from (else the start for its model), tuned on the hero outline it was tuned on — a trusted
 * one, or the checker's own outline a person confirmed — or on the whole card; the start as it is when tuning is off.
 * @param {{order: CardOrder, attempt: Attempt, adir: string, card: {pixels: Uint8Array, width: number, height: number}, hero: Hero|null, settings: import('../settings.js').Settings}} o
 */
async function autoProcessing({ order, attempt: a, adir, card, hero, settings }) {
  const start = a.tuning?.start ?? processingFor({ style: order.style, model: a.model, settings }).processing;
  if (!settings.card.tuneProcessing || !outputOf(order).checks) { a.processing = start; delete a.tuning; return; }
  let fg = trustedFg(hero), outline = 'trusted';
  if (!fg && a.review?.mask === 'confirmed') {
    const { heroOutline } = await styleChecker(order.style);
    fg = heroOutline((await readPixels(path.join(adir, ATTEMPT_FILES.card))).pixels);
    outline = 'confirmed';
  }
  ({ settings: a.processing, tuning: a.tuning } = await tuneFor({ order, card, start, fg, outline }));
}

/**
 * Sets the card's caption — its order's `title`: the name printed in a set's window, the thumbnail's name and the
 * export file's — by a person's word (the editor's place settings). Written under the card's lock; the attempts and
 * their prompts stay as they were (a new picture is drawn from the order with the new caption). Nothing is generated
 * or paid. The style's caption rules (SETS.md) do not bind a person's caption.
 * @param {{dir: string, title: string}} o
 * @returns {Promise<{title: string}>}
 */
export async function setCardTitle({ dir, title }) {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) throw saidError('Подпись пустая: напишите, как назвать карточку.', 'title.empty');
  needCard(dir);
  updateCardFile(dir, c => {
    if (!c) throw new Error(`Нет карточки: ${dir} (нет card.json).`);
    return { ...c, order: { ...c.order, title: text } };
  });
  return { title: text };
}

/**
 * Makes a version (an attempt) the card by the word of a person or an agent: its card.png becomes the card's, and the
 * choice (`chosenBy` "choice") is kept when the checks run again; a later request (regenerate, edit, import) or
 * `makeCard` chooses anew. Nothing is generated or paid.
 * @param {{dir: string, n: number}} o
 * @returns {Promise<CardReport>}
 */
export async function chooseAttempt({ dir, n }) {
  const card = needCard(dir);
  const a = card.attempts.find(x => x.n === n);
  if (!a) throw new Error(`У карточки нет версии ${n}: есть ${card.attempts.map(x => x.n).join(', ') || 'ни одной'}.`);
  if (!fs.existsSync(path.join(attemptDir(dir, n), ATTEMPT_FILES.card))) {
    throw new Error(`Версия ${n} не может стать карточкой: у неё нет готовой картинки${a.error ? ` (${a.error.message})` : ''}.`);
  }
  saveCard(dir, card, [], c => { c.chosen = n; c.chosenBy = 'choice'; copyChosen(dir, c); });
  return cardReport(dir, card, [n]);
}

/**
 * Takes in an image an agent made with its own tool (its built-in image generation), or a person's own image: as a
 * new attempt of a card, or as the first attempt of a new card made from an order. The image goes through the same
 * steps as a generated one (VISION.md «Источник изображений»: as strictly): prepared, its hero found by the vision
 * model when `vision` is given (or no outline but the checker's own, as without a key), tuned, checked, looked at
 * against the order; the vision calls are its spend. The attempt's model is "agent", its image cost 0, its prompt
 * empty (the program did not send it). The attempt becomes the card when it reached the checks.
 * @param {object} o
 * @param {string} o.image  the image file
 * @param {string} [o.dir]  an existing card folder
 * @param {CardOrder} [o.order]  instead of `dir`: a new card of `collection`
 * @param {string} [o.collection]
 * @param {{setId: string, slot: number}} [o.place]  with `order`: the set slot to put the new card into
 * @param {import('../settings.js').Settings} o.settings
 * @param {VisionCall|null} [o.vision]  the vision model's connection (visionFrom); without it nothing looks, with a warning
 * @param {CardStore} [o.store]
 * @returns {Promise<CardReport>}
 */
export async function importImage({ image, dir, order, collection, place, settings, vision = null, store = factoryStore }) {
  const mime = MIME_BY_EXT[path.extname(image).toLowerCase()];
  if (!mime) throw new Error(`Картинка должна быть PNG, JPEG или WebP: ${image}`);
  const bytes = fs.readFileSync(image);
  let id;
  /** @type {CardFile} */
  let card;
  if (dir) card = needCard(dir);
  else {
    if (!order || !collection) throw new Error('Нужна папка карточки или заказ с коллекцией.');
    const errors = await validateOrder(order);
    if (errors.length) throw new OrderError(errors);
    ({ id, dir } = cardFolder({ store, collection, order }));
    card = { order, attempts: [], chosen: null };
  }
  const release = markBusy(dir, 'import');
  let n = 0, warnings = /** @type {string[]} */ ([]);
  try {
    n = reserveAttempt(dir, Math.max(0, ...card.attempts.map(a => a.n)));
    /** @type {Attempt} */
    const attempt = { n, at: new Date().toISOString(), model: AGENT_MODEL, prompt: '', references: [], cost: 0 };
    card.attempts.push(attempt);
    const ask = askOf(vision, settings);
    warnings = await processInto({ order: card.order, attempt, dir: attemptDir(dir, n), bytes, mime, settings, output: outputOf(card.order), ask });
    if (!ask) warnings.unshift(NO_VISION);
    saveCard(dir, card, [attempt], c => choose(dir, c, 'request', [attempt.n]));
  } finally {
    release();
  }
  if (place && id) await store.moveCard(/** @type {string} */ (collection), id, place);
  return { ...cardReport(dir, card, [n]), warnings };
}

/**
 * Tunes an attempt again with a hero outline — `fg`, or else the checker's own outline on its card.png that a person
 * confirmed — and rewrites card.png.
 * @param {CardOrder} order @param {Attempt} a @param {string} adir @param {Uint8Array|null} [fg] @param {string} [outline]
 */
async function retune(order, a, adir, fg = null, outline = 'confirmed') {
  if (!fg) {
    const { heroOutline } = await styleChecker(order.style);
    fg = heroOutline((await readPixels(path.join(adir, ATTEMPT_FILES.card))).pixels);
    if (!fg) return;
  }
  const card = await readPixels(path.join(adir, ATTEMPT_FILES.prepared));
  ({ settings: a.processing, tuning: a.tuning } = await tuneFor({ order, card, start: /** @type {import('./tune.js').Tuning} */ (a.tuning).start, fg, outline }));
  fs.writeFileSync(path.join(adir, ATTEMPT_FILES.card), await encodePng(adjust(card.pixels, card.width, card.height, /** @type {AdjustSettings} */ (a.processing)), card.width, card.height));
}

/**
 * Runs the checks again on attempts of a card (after the order's staging was edited, or with what a person or an
 * agent confirmed by eye), then chooses the best attempt again, unless the choice came from a request (regenerate,
 * edit, import), from the vision model's pick among the versions, or a version was chosen by hand (chooseAttempt): then it stays. A hero box given here cuts a new outline (free; it replaces any verdict on the outline
 * shown before, `mask`), and the attempt is tuned again with it when it is trusted; an attempt whose checker outline
 * has just been confirmed is tuned again too — both unless its processing was set by hand. The vision model is not
 * asked again: the hero and the look recorded in the attempt are reused.
 * @param {{dir: string, n?: number, review?: import('./card-file.js').Review}} o
 *   n = only this attempt (required with review); otherwise every attempt that has a card image
 * @returns {Promise<CardReport>}
 */
export async function recheckCard({ dir, n, review }) {
  const card = needCard(dir);
  if (review && n == null) throw new Error('Подтверждение контура или рамка героя относятся к одной попытке: укажите её номер.');
  const targets = card.attempts.filter(a => (n == null || a.n === n) && fs.existsSync(path.join(attemptDir(dir, a.n), ATTEMPT_FILES.card)));
  if (n != null && !targets.length) throw new Error(`У карточки нет попытки ${n} с картинкой.`);
  const output = outputOf(card.order);
  for (const a of targets) {
    const adir = attemptDir(dir, a.n);
    if (review?.hero_box) { const { mask: _shown, ...rest } = a.review ?? {}; a.review = { ...rest, hero_box: review.hero_box }; }
    else if (review) a.review = { ...a.review, ...review };
    let hero = null;
    if (output.checks) {
      hero = review?.hero_box ? await findAttemptHero({ order: card.order, attempt: a, dir: adir, ask: null }) : await storedHero(a, adir);
      const fresh = review?.hero_box ? trustedFg(hero) : null;
      const canTune = a.tuning && !a.processingFixed;
      if (canTune && fresh) await retune(card.order, a, adir, fresh, 'trusted');
      else if (canTune && !trustedFg(hero) && a.review?.mask === 'confirmed' && a.tuning?.basis === 'whole card') await retune(card.order, a, adir);
    }
    a.check = await checkOrSkip({ order: card.order, dir: adir, attempt: a, output, hero });
  }
  saveCard(dir, card, targets, c => {
    if (c.chosenBy === 'request' || c.chosenBy === 'look' || c.chosenBy === 'choice') copyChosen(dir, c);
    else choose(dir, c, 'checks');
  });
  return cardReport(dir, card, targets.map(a => a.n));
}
