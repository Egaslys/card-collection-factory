// The production loop of one card: order → prompt → generation → preparation → post-processing → checks, repeated
// while the style's automatic checks fail, within the attempt limit and the spend cap; then the best attempt
// becomes the card. Files: card-file.js. The loop never decides on art: the agent looks at the chosen attempt,
// edits the order (staging, subject, promptExtra / promptOverride) and runs it again on the same card; new attempts
// are appended. A new card is made in the collection's pool (core/store); `place` puts it into a set's slot.
//
// A person's (or an agent's) requests on a made card, the editor's buttons: regenerate with a wish (the order plus
// their words), edit (the card's model image goes to the provider as the input image with their words), adjust
// (post-processing set by hand), import (an image the agent drew with its own tool). They make one attempt unless told
// otherwise, and their result becomes the card even when an earlier attempt passes more checks: the person's word
// outranks the rules (VISION.md «Слово человека — главное»).
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
import * as openrouter from '../providers/openrouter.js';
import { ROOT } from '../settings.js';
import { orderOutput, validateOrder } from '../style/card-order.js';
import { OrderError, buildPrompt as styleBuildPrompt } from '../style/prompt.js';
import { loadStyle, styleDirOf } from '../style/style.js';
import * as factoryStore from '../store/index.js';
import { ATTEMPT_FILES, FINAL_IMAGE, attemptCost, attemptDir, readCardFile, writeCardFile } from './card-file.js';
import { checkAttempt, styleChecker, styleDir, withLook } from './check.js';
import { findHero, locateHero, readOutline, readPixels as heroPixels, writeOutline } from './hero.js';
import { lookAtCard } from './look.js';
import { tuneProcessing } from './tune.js';

/** @typedef {import('./card-file.js').Attempt} Attempt */
/** @typedef {import('./card-file.js').CardFile} CardFile */
/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */
/** @typedef {import('../image/adjust.js').AdjustSettings} AdjustSettings */
/** @typedef {import('../style/style.js').OrderOutput} OrderOutput */

/**
 * The image provider of a run. model: the id recorded in the attempts and used to pick post-processing;
 * free: the provider takes no payment per image (its cost is recorded as 0); generate: one image for the prompt,
 * answering like core/providers/openrouter.js generateImage.
 * aspectRatio: the order kind's own frame, else the provider settings'. fallback: the provider to try, in the same
 * attempt, when this one fails (an error, a refusal, an answer without an image). legend: what the attached images
 * are, for a provider that says it in words (Codex); default: style references. vision: asks a vision model about one
 * image through the same connection (OpenRouter-compatible, with its key); absent when there is no key — the loop then
 * finds no hero box by itself and does not look (settings → vision, hero, look).
 * @typedef {{model: string, free?: boolean, fallback?: Provider, vision?: VisionCall,
 *   generate: (req: {prompt: string, references: {path: string}[], aspectRatio?: string, legend?: string}) => Promise<{bytes: Uint8Array, mime?: string, cost: number|null}>}} Provider
 */

/**
 * @typedef {(req: {model: string, prompt: string, image: {path?: string, bytes?: Uint8Array, mime?: string}, maxTokens: number, reasoning?: Record<string, unknown>, timeoutMs: number}) => Promise<{text: string, cost: number|null}>} VisionCall
 */

/** @typedef {(req: {prompt: string, image: {path?: string, bytes?: Uint8Array, mime?: string}, maxTokens: number, reasoning?: Record<string, unknown>}) => Promise<{text: string, cost: number|null}>} Ask  the vision model of the settings (reasoning: instead of the settings') */

/**
 * The prompt of an order (core/style buildPrompt): legend = what the attached images are, as the prompt says it,
 * handed to a provider that writes its own legend (Codex) so it does not say something else.
 * @typedef {(order: CardOrder) => Promise<{prompt: string, references: {path: string}[], legend?: string|null}>} BuildPrompt
 */

/**
 * Why a run stopped: passed = no blocking FAIL; attempts = the attempt limit; budget = the next call could pass
 * the spend cap; provider-error = the provider failed (recorded in the attempt); cost-unknown = the provider did
 * not report the price, so the cap cannot be kept; cancelled = the caller's signal was aborted (checked before every
 * call: a call already sent is not interrupted).
 * @typedef {'passed'|'attempts'|'budget'|'provider-error'|'cost-unknown'|'cancelled'} StopReason
 */

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
 * @property {number} [spent]  make only: USD spent by this run (known costs)
 * @property {{attempts: number, maxSpendUsd: number}} [limits]  make only
 */

const EXT_BY_MIME = /** @type {Record<string, string>} */ ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' });
const MIME_BY_EXT = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });
/** The model recorded for an image an agent made with its own tool (`importImage`); the style's processing start has an entry for it. */
export const AGENT_MODEL = 'agent';
const EPSILON_USD = 1e-9;

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
 * The best checked attempt: fewest blocking FAILs, then fewest FAILs left for eyes, then fewest WARNs, then the
 * earliest.
 * @param {Attempt[]} attempts
 * @returns {number|null}
 */
export function pickBest(attempts) {
  const checked = attempts.filter(a => a.check && !a.error);
  /** @param {Attempt} a */
  const key = a => { const c = /** @type {import('./card-file.js').CheckSummary} */ (a.check); return [c.blocking, c.fails.length - c.blocking, c.warns, a.n]; };
  checked.sort((a, b) => { const x = key(a), y = key(b); return x.map((v, i) => v - y[i]).find(d => d !== 0) ?? 0; });
  return checked[0]?.n ?? null;
}

/** @param {string} style @returns {any} the style's processing.json */
const styleProcessing = style => JSON.parse(fs.readFileSync(path.join(styleDir(style), 'processing.json'), 'utf8'));

/**
 * Starting post-processing settings for a model: the factory settings' override for the model, else the style's
 * start for it (a name there refers to another entry, e.g. "neutral"), else none (neutral) with a warning.
 * @param {{style: string, model: string, settings: import('../settings.js').Settings}} o
 * @returns {{processing: AdjustSettings, warning?: string}}
 */
export function processingFor({ style, model, settings }) {
  const own = styleProcessing(style);
  const start = own.start?.[model];
  const chosen = settings.processing[model] ?? (typeof start === 'string' ? own[start] : start);
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
  const bounds = { ...own.bounds, sharpen: { ...own.bounds.sharpen, max: own.sharpen_amount_max } };
  return tuneProcessing({
    ...card, start, neutral: own.neutral, bounds,
    basis: fg ? `whole card + backdrop (${outline} outline)` : 'whole card',
    measure: (rgb, prefix) => checker.processingMeasures(rgb, { staging: order.staging ?? {}, ids: own.tune_checks.filter((/** @type {string} */ id) => !prefix || id.startsWith(prefix)), fg }),
  });
}

/** @param {string} file @returns {Promise<{pixels: Uint8Array, width: number, height: number}>} */
async function readPixels(file) {
  return prepareCard(file, undefined);
}

/**
 * The provider chosen in the settings (provider.use); for OpenRouter with `fallbackModel` set, that model is the
 * fallback of the main one. The OpenRouter key is read from the environment or .env, never printed, unless the caller
 * holds it (a running editor's temporary key). With a key, the provider also carries `vision` through
 * provider.openrouter's endpoint — for Codex too, whose images need no key: without one it has no `vision`.
 * @param {import('../settings.js').ProviderSettings} settings
 * @param {{apiKey?: string}} [o]
 * @returns {Provider}
 */
export function providerFrom(settings, { apiKey: held } = {}) {
  const o = settings.openrouter;
  /** @param {string} apiKey @returns {VisionCall} */
  const visionWith = apiKey => ({ model, prompt, image, maxTokens, reasoning, timeoutMs }) => openrouter.askVision({
    endpoint: o.endpoint, apiKey, model, prompt, image, maxTokens, reasoning, net: { timeoutMs, retries: o.retries, backoffMs: o.backoffMs },
  });
  if (settings.use === 'codex-cli') {
    const c = settings.codexCli;
    let key = held;
    try { key ??= openrouter.loadApiKey({ envVar: o.keyEnvVar }); } catch { /* no key: Codex draws without one, nothing looks */ }
    return {
      model: 'codex-cli' + (c.model ? `/${c.model}` : ''), free: true,
      generate: ({ prompt, references, aspectRatio, legend }) => codexCli.generateImage({ settings: c, prompt, references, aspectRatio: aspectRatio ?? c.aspectRatio, legend }),
      ...(key ? { vision: visionWith(key) } : {}),
    };
  }
  if (settings.use !== 'openrouter') throw new Error(`Настройки: неизвестный провайдер provider.use = «${settings.use}» (есть openrouter и codex-cli).`);
  const apiKey = held ?? openrouter.loadApiKey({ envVar: o.keyEnvVar });
  const net = { timeoutMs: o.timeoutMs, retries: o.retries, backoffMs: o.backoffMs };
  /** @param {string} model @returns {Provider} */
  const on = model => ({
    model,
    generate: ({ prompt, references, aspectRatio }) => openrouter.generateImage({
      endpoint: o.endpoint, apiKey, model, prompt, references, aspectRatio: aspectRatio ?? o.aspectRatio, resolution: o.resolution, params: o.params, net,
    }),
  });
  return { ...on(o.model), ...(o.fallbackModel ? { fallback: on(o.fallbackModel) } : {}), vision: visionWith(apiKey) };
}

/**
 * The vision model of the settings (settings → vision) through the provider's connection, or null when it has none.
 * @param {Provider|undefined} provider @param {import('../settings.js').Settings} settings @returns {Ask|null}
 */
function askOf(provider, settings) {
  const call = provider?.vision, v = settings.vision;
  return call ? req => call({ model: v.model, reasoning: v.reasoning ?? undefined, timeoutMs: v.timeoutMs, ...req }) : null;
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
  const { record, prompt, text } = await lookAtCard({ image: { path: path.join(dir, ATTEMPT_FILES.card) }, order, visual, wish: attempt.wish, model: settings.vision.model, settings: settings.look, ask });
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
 * word outranks the checks), the choice kept unchanged when none of them reached the checks.
 * @param {string} dir @param {CardFile} card @param {'checks'|'request'} by @param {number[]} [ns]
 */
function choose(dir, card, by, ns = []) {
  const best = pickBest(by === 'checks' ? card.attempts : card.attempts.filter(a => ns.includes(a.n)));
  if (by === 'request' && best == null) return;
  card.chosen = best;
  card.chosenBy = by;
  copyChosen(dir, card);
}

/** @param {string} dir @param {CardFile} card */
function copyChosen(dir, card) {
  if (card.chosen != null) fs.copyFileSync(path.join(attemptDir(dir, card.chosen), ATTEMPT_FILES.card), path.join(dir, FINAL_IMAGE));
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
 * @param {Provider} o.provider
 * @param {import('../settings.js').Settings} o.settings
 * @param {{attempts: number, maxSpendUsd: number}} o.limits
 * @param {RunControl} [o.control]
 * @returns {Promise<{ns: number[], spent: number, stop: StopReason, warnings: string[]}>}
 */
async function runAttempts({ dir, card, request, mark = {}, provider, settings, limits, control = {} }) {
  const { order } = card;
  const output = outputOf(order);
  const ask = askOf(provider, settings);
  /** @type {Set<string>} */
  const warnings = new Set(ask ? [] : ['Смотрящая модель не спрошена (нет ключа OpenRouter): рамку героя для проверок даёт только агент или человек, взгляда на карточку нет.']);
  /** @param {string} model the highest known price of one call with the model in this card (0 = none known) */
  const priceHint = model => Math.max(0, ...card.attempts.filter(a => a.model === model && typeof a.cost === 'number').map(a => /** @type {number} */ (a.cost)));
  const req = { ...request, references: request.references.map(r => ({ path: r.path })), ...(output.aspectRatio ? { aspectRatio: output.aspectRatio } : {}) };
  /** @param {any} e */
  const failure = e => ({ message: String(e?.message ?? e), ...(e?.status ? { status: e.status } : {}) });
  /** @type {number[]} */
  const ns = [];
  let spent = 0;
  /** @type {StopReason|undefined} */
  let stop;
  /** @param {Progress['stage']} stage @param {number|null} n  the attempt under way (null: the run is over) */
  const tell = (stage, n) => control.onProgress?.({ stage, n, done: ns.length - (n == null ? 0 : 1), of: limits.attempts, spent });
  for (;;) {
    const limit = control.signal?.aborted ? 'cancelled' : nextStep({ done: ns.length, spent, limits, priceHint: priceHint(provider.model) });
    if (limit) { stop = limit; break; }
    const n = Math.max(0, ...card.attempts.map(a => a.n)) + 1;
    /** @type {Attempt} */
    const attempt = { n, at: new Date().toISOString(), model: provider.model, ...mark, prompt: request.prompt, references: request.references.map(r => path.relative(ROOT, r.path)), cost: null };
    card.attempts.push(attempt);
    ns.push(n);
    tell('generate', n);
    const adir = attemptDir(dir, n);
    fs.mkdirSync(adir, { recursive: true });
    let answer, used = provider;
    try {
      answer = await provider.generate(req);
    } catch (/** @type {any} */ e) {
      const fallback = provider.fallback;
      if (control.signal?.aborted) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'cancelled'; }
      else if (!fallback) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'provider-error'; }
      else if (spent + priceHint(fallback.model) > limits.maxSpendUsd + EPSILON_USD) { attempt.error = { stage: 'generate', ...failure(e) }; stop = 'budget'; }
      else {
        // the main model failed (error, refusal, no image): the fallback model makes this attempt
        attempt.fallbackFrom = { model: provider.model, error: failure(e) };
        attempt.model = fallback.model;
        used = fallback;
        try { answer = await fallback.generate(req); } catch (/** @type {any} */ e2) { attempt.error = { stage: 'generate', ...failure(e2) }; stop = 'provider-error'; }
      }
      if (!answer) { writeCardFile(dir, card); break; }
    }
    attempt.cost = used.free ? 0 : answer.cost;
    spent += attempt.cost ?? 0;
    tell('process', n);
    for (const w of await processInto({ order, attempt, dir: adir, bytes: answer.bytes, mime: answer.mime, settings, output, ask })) warnings.add(w);
    spent += attemptCost(attempt) - (attempt.cost ?? 0);
    writeCardFile(dir, card);
    if (attempt.cost == null) { stop = 'cost-unknown'; break; }
    if (attempt.check && attempt.check.blocking === 0) { stop = 'passed'; break; }
  }
  tell('done', null);
  return { ns, spent, stop: /** @type {StopReason} */ (stop), warnings: [...warnings] };
}

/**
 * Prepares, finds the hero, post-processes, checks and looks at an image in its attempt; a failure is recorded in the
 * attempt.
 * @param {{order: CardOrder, attempt: Attempt, dir: string, bytes: Uint8Array, mime?: string, settings: import('../settings.js').Settings, output: OrderOutput, ask?: Ask|null}} o
 * @returns {Promise<string[]>} warnings: about the start of post-processing; that the vision model gave no answer
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
 * @param {{stop: StopReason, spent: number, warnings: string[]}} run @param {{attempts: number, maxSpendUsd: number}} limits
 * @returns {CardReport}
 */
const runReport = (dir, card, ns, run, limits) => ({ ...cardReport(dir, card, ns), stop: run.stop, spent: run.spent, limits, warnings: run.warnings });

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
  card.order = order;
  const lim = { attempts: limits.attempts ?? settings.card.attempts, maxSpendUsd: limits.maxSpendUsd ?? settings.card.maxSpendUsd };
  const run = await runAttempts({ dir, card, request: { prompt, references, ...(legend ? { legend } : {}) }, provider, settings, limits: lim, control: { signal, onProgress } });
  choose(dir, card, 'checks');
  writeCardFile(dir, card);
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
 * Generates the card again from its order with the person's wish appended to the prompt (as `promptExtra`; added to
 * `promptOverride` when the order has one), as new attempts. The best of them becomes the card.
 * @param {object} o
 * @param {string} o.dir  the card folder
 * @param {string} o.wish  the person's words, sent as they are
 * @param {import('../settings.js').Settings} o.settings
 * @param {Provider} o.provider
 * @param {BuildPrompt} [o.buildPrompt]
 * @param {{attempts?: number, maxSpendUsd?: number}} [o.limits]  default: one attempt, settings card.maxSpendUsd
 * @param {AbortSignal} [o.signal]  @param {RunControl['onProgress']} [o.onProgress]
 * @returns {Promise<CardReport>}
 */
export async function regenerateCard({ dir, wish, settings, provider, buildPrompt = o => styleBuildPrompt(o), limits = {}, signal, onProgress }) {
  const text = needWish(wish);
  const card = needCard(dir);
  const { order } = card;
  const key = order.promptOverride ? 'promptOverride' : 'promptExtra';
  const { prompt, references, legend } = await buildPrompt({ ...order, [key]: [order[key], text].filter(Boolean).join(' ') });
  const lim = { attempts: limits.attempts ?? REQUEST_ATTEMPTS, maxSpendUsd: limits.maxSpendUsd ?? settings.card.maxSpendUsd };
  const run = await runAttempts({ dir, card, request: { prompt, references, ...(legend ? { legend } : {}) }, mark: { wish: text }, provider, settings, limits: lim, control: { signal, onProgress } });
  choose(dir, card, 'request', run.ns);
  writeCardFile(dir, card);
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
  const run = await runAttempts({ dir, card, request, mark: { wish: text, editOf: attempt.n }, provider, settings, limits: lim, control: { signal, onProgress } });
  choose(dir, card, 'request', run.ns);
  writeCardFile(dir, card);
  return runReport(dir, card, run.ns, run, lim);
}

/** @param {unknown} wish */
function needWish(wish) {
  const text = typeof wish === 'string' ? wish.trim() : '';
  if (!text) throw new Error('Пожелание пустое: напишите, что изменить.');
  return text;
}

/**
 * Sets the post-processing of an attempt (default: the chosen one) by hand: card.png is drawn again from
 * prepared.png with the given values (the others stay as they were), the values are kept as the person's
 * (`processingFixed`: never tuned again), and the attempt is checked again. The chosen attempt stays chosen.
 * @param {object} o
 * @param {string} o.dir
 * @param {number} [o.n]
 * @param {number} [o.saturation]  multiplier, 1 = unchanged
 * @param {number} [o.brightness]  levels added to luma, 0 = unchanged
 * @param {number} [o.sharpen]  unsharp-mask amount, 0 = none (the radius stays)
 * @returns {Promise<CardReport>}
 */
export async function adjustCard({ dir, n, saturation, brightness, sharpen }) {
  const card = needCard(dir);
  const { attempt: a, file } = sourceAttempt(dir, card, n, ATTEMPT_FILES.prepared);
  if (saturation == null && brightness == null && sharpen == null) throw new Error('Не задано ни одного значения обработки (насыщенность, яркость, резкость).');
  const base = a.processing ?? styleProcessing(card.order.style).neutral;
  const processing = {
    ...base, ...(saturation != null ? { saturation } : {}), ...(brightness != null ? { brightness } : {}),
    ...(sharpen != null ? { sharpen: { ...base.sharpen, amount: sharpen } } : {}),
  };
  a.processing = processing;
  a.processingFixed = true;
  const adir = attemptDir(dir, a.n);
  const pic = await readPixels(file);
  fs.writeFileSync(path.join(adir, ATTEMPT_FILES.card), await encodePng(adjust(pic.pixels, pic.width, pic.height, processing), pic.width, pic.height));
  a.check = await checkOrSkip({ order: card.order, dir: adir, attempt: a, output: outputOf(card.order), hero: await storedHero(a, adir) });
  if (card.chosen === a.n) copyChosen(dir, card);
  writeCardFile(dir, card);
  return cardReport(dir, card, [a.n]);
}

/**
 * Takes in an image an agent made with its own tool (its built-in image generation): as a new attempt of a card,
 * or as the first attempt of a new card made from an order. The image is prepared, tuned and checked like a
 * generated one; the attempt's model is "agent", its cost 0, its prompt empty (the program did not send it). The
 * attempt becomes the card when it reached the checks.
 * @param {object} o
 * @param {string} o.image  the image file
 * @param {string} [o.dir]  an existing card folder
 * @param {CardOrder} [o.order]  instead of `dir`: a new card of `collection`
 * @param {string} [o.collection]
 * @param {{setId: string, slot: number}} [o.place]  with `order`: the set slot to put the new card into
 * @param {import('../settings.js').Settings} o.settings
 * @param {CardStore} [o.store]
 * @returns {Promise<CardReport>}
 */
export async function importImage({ image, dir, order, collection, place, settings, store = factoryStore }) {
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
  const n = Math.max(0, ...card.attempts.map(a => a.n)) + 1;
  /** @type {Attempt} */
  const attempt = { n, at: new Date().toISOString(), model: AGENT_MODEL, prompt: '', references: [], cost: 0 };
  card.attempts.push(attempt);
  const adir = attemptDir(dir, n);
  fs.mkdirSync(adir, { recursive: true });
  const warnings = await processInto({ order: card.order, attempt, dir: adir, bytes, mime, settings, output: outputOf(card.order) });
  choose(dir, card, 'request', [n]);
  writeCardFile(dir, card);
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
 * edit, import): then it stays. A hero box given here cuts a new outline (free; it replaces any verdict on the outline
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
  if (card.chosenBy === 'request') copyChosen(dir, card);
  else choose(dir, card, 'checks');
  writeCardFile(dir, card);
  return cardReport(dir, card, targets.map(a => a.n));
}
