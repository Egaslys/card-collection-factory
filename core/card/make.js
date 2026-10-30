// The production loop of one card: order → prompt → generation → preparation → post-processing → checks, repeated
// while the style's automatic checks fail, within the attempt limit and the spend cap; then the best attempt
// becomes the card. Files: card-file.js. The loop never decides on art: the agent looks at the chosen attempt,
// edits the order (staging, subject, promptExtra / promptOverride) and runs it again; new attempts are appended.
//
// Outline policy. Many checks need the hero separated from the backdrop, and the outline the checks propose is
// unreliable on generated cards until someone confirms it (styles/scapes/checks/README.md). A FAIL that rests on
// an unconfirmed outline therefore never triggers a paid regeneration: it is reported as "needs eyes"; the agent
// opens attempts/<n>/card.mask.png, confirms or rejects it (or draws hero_box) with `card check`, and the checks
// run again. Only the other FAILs ("blocking") make the loop regenerate.
import fs from 'node:fs';
import path from 'node:path';
import { adjust } from '../image/adjust.js';
import { encodePng, prepareCard } from '../image/prepare.js';
import * as codexCli from '../providers/codex-cli.js';
import * as openrouter from '../providers/openrouter.js';
import { ROOT } from '../settings.js';
import { buildPrompt as styleBuildPrompt } from '../style/prompt.js';
import { ATTEMPT_FILES, FINAL_IMAGE, attemptDir, cardDir, readCardFile, writeCardFile } from './card-file.js';
import { checkAttempt, styleChecker, styleDir } from './check.js';

/** @typedef {import('./card-file.js').Attempt} Attempt */
/** @typedef {import('./card-file.js').CardFile} CardFile */
/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */
/** @typedef {import('../image/adjust.js').AdjustSettings} AdjustSettings */

/**
 * The image provider of a run. model: the id recorded in the attempts and used to pick post-processing;
 * free: the provider takes no payment per image (its cost is recorded as 0); generate: one image for the prompt,
 * answering like core/providers/openrouter.js generateImage.
 * @typedef {{model: string, free?: boolean, generate: (req: {prompt: string, references: {path: string}[]}) => Promise<{bytes: Uint8Array, mime?: string, cost: number|null}>}} Provider
 */

/**
 * Why a run stopped: passed = no blocking FAIL; attempts = the attempt limit; budget = the next call could pass
 * the spend cap; provider-error = the provider failed (recorded in the attempt); cost-unknown = the provider did
 * not report the price, so the cap cannot be kept.
 * @typedef {'passed'|'attempts'|'budget'|'provider-error'|'cost-unknown'} StopReason
 */

/**
 * @typedef {object} AttemptReport
 * @property {number} n
 * @property {string} model
 * @property {number|null} cost
 * @property {Attempt['error']} [error]
 * @property {import('./card-file.js').CheckSummary} [check]
 * @property {{doc: string, check: number, what: string}[]} [visual]  the checks left for eyes
 * @property {Record<string, string>} files  absolute paths of the attempt's files that exist
 */

/**
 * @typedef {object} CardReport
 * @property {string} dir
 * @property {string} id
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

/**
 * Post-processing settings for a model: the factory settings' override for the model, else the style's start for
 * it, else none (neutral) with a warning.
 * @param {{style: string, model: string, settings: import('../settings.js').Settings}} o
 * @returns {{processing: AdjustSettings, warning?: string}}
 */
export function processingFor({ style, model, settings }) {
  const own = JSON.parse(fs.readFileSync(path.join(styleDir(style), 'processing.json'), 'utf8'));
  const chosen = settings.processing[model] ?? own.start?.[model];
  if (chosen) return { processing: chosen };
  return { processing: own.neutral, warning: `Для модели ${model} нет начальных настроек обработки ни в настройках, ни в styles/${style}/processing.json: карточка не обработана (нейтральные настройки).` };
}

/**
 * The provider chosen in the settings (provider.use). The OpenRouter key is read from the environment or .env,
 * never printed.
 * @param {import('../settings.js').ProviderSettings} settings
 * @returns {Provider}
 */
export function providerFrom(settings) {
  if (settings.use === 'codex-cli') {
    const c = settings.codexCli;
    return {
      model: 'codex-cli' + (c.model ? `/${c.model}` : ''), free: true,
      generate: ({ prompt, references }) => codexCli.generateImage({ settings: c, prompt, references, aspectRatio: c.aspectRatio }),
    };
  }
  if (settings.use !== 'openrouter') throw new Error(`Настройки: неизвестный провайдер provider.use = «${settings.use}» (есть openrouter и codex-cli).`);
  const o = settings.openrouter;
  const apiKey = openrouter.loadApiKey({ envVar: o.keyEnvVar });
  const net = { timeoutMs: o.timeoutMs, retries: o.retries, backoffMs: o.backoffMs };
  return {
    model: o.model,
    generate: ({ prompt, references }) => openrouter.generateImage({
      endpoint: o.endpoint, apiKey, model: o.model, prompt, references, aspectRatio: o.aspectRatio, resolution: o.resolution, params: o.params, net,
    }),
  };
}

/**
 * Model image → prepared.png → card.png (post-processed) → checks, in the attempt folder.
 * @param {{order: CardOrder, attempt: Attempt, dir: string, bytes: Uint8Array, mime?: string, processing: AdjustSettings}} o
 */
async function processAttempt({ order, attempt, dir, bytes, mime, processing }) {
  const { CARD_SIZE } = await styleChecker(order.style);
  attempt.original = ATTEMPT_FILES.original + (EXT_BY_MIME[mime ?? ''] ?? '.bin');
  fs.writeFileSync(path.join(dir, attempt.original), bytes);
  const card = await prepareCard(bytes, CARD_SIZE);
  fs.writeFileSync(path.join(dir, ATTEMPT_FILES.prepared), await encodePng(card.pixels, card.width, card.height));
  attempt.processing = processing;
  const pixels = adjust(card.pixels, card.width, card.height, processing);
  fs.writeFileSync(path.join(dir, ATTEMPT_FILES.card), await encodePng(pixels, card.width, card.height));
  attempt.check = (await checkAttempt({ order, dir, review: attempt.review })).summary;
}

/**
 * Sets `chosen` to the best attempt and copies its card to the card folder.
 * @param {string} dir @param {CardFile} card
 */
function choose(dir, card) {
  card.chosen = pickBest(card.attempts);
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
    return { n: a.n, model: a.model, cost: a.cost, ...(a.error ? { error: a.error } : {}), ...(a.check ? { check: a.check } : {}), ...(visual ? { visual } : {}), files };
  });
  const chosen = card.attempts.find(a => a.n === card.chosen);
  return {
    dir, id: card.order.id, chosen: card.chosen, image: chosen ? path.join(dir, FINAL_IMAGE) : null,
    chosenCheck: chosen?.check ?? null, chosenVisual: (chosen && visualOf(chosen.n)) ?? [], attempts, warnings: [],
  };
}

/**
 * Makes one card: appends attempts to the card folder until one has no blocking FAIL or a limit is reached.
 * @param {object} o
 * @param {CardOrder} o.order
 * @param {string} o.collection
 * @param {string} o.set
 * @param {import('../settings.js').Settings} o.settings  card limits and post-processing
 * @param {Provider} o.provider
 * @param {(order: CardOrder) => Promise<{prompt: string, references: {path: string}[]}>} [o.buildPrompt]  default: the
 *   style's assembly (core/style/prompt.js); it throws OrderError on an invalid order, before anything is paid
 * @param {{attempts?: number, maxSpendUsd?: number}} [o.limits]  this run's overrides of settings.card
 * @param {string} [o.root]  the collections folder (tests)
 * @returns {Promise<CardReport>}
 */
export async function makeCard({ order, collection, set, settings, provider, buildPrompt = o => styleBuildPrompt(o), limits = {}, root }) {
  const dir = cardDir({ collection, set, id: order.id, root });
  const { prompt, references } = await buildPrompt(order);
  /** @type {CardFile} */
  const card = readCardFile(dir) ?? { order, attempts: [], chosen: null };
  card.order = order;
  const lim = { attempts: limits.attempts ?? settings.card.attempts, maxSpendUsd: limits.maxSpendUsd ?? settings.card.maxSpendUsd };
  const model = provider.model;
  const { processing, warning } = processingFor({ style: order.style, model, settings });
  /** @type {number[]} */
  const ns = [];
  let spent = 0;
  /** @type {StopReason} */
  let stop;
  for (;;) {
    const known = card.attempts.filter(a => a.model === model && typeof a.cost === 'number').map(a => /** @type {number} */ (a.cost));
    const limit = nextStep({ done: ns.length, spent, limits: lim, priceHint: Math.max(0, ...known) });
    if (limit) { stop = limit; break; }
    const n = Math.max(0, ...card.attempts.map(a => a.n)) + 1;
    /** @type {Attempt} */
    const attempt = { n, at: new Date().toISOString(), model, prompt, references: references.map(r => path.relative(ROOT, r.path)), cost: null };
    card.attempts.push(attempt);
    ns.push(n);
    const adir = attemptDir(dir, n);
    fs.mkdirSync(adir, { recursive: true });
    let answer;
    try {
      answer = await provider.generate({ prompt, references: references.map(r => ({ path: r.path })) });
    } catch (/** @type {any} */ e) {
      attempt.error = { stage: 'generate', message: String(e?.message ?? e), ...(e?.status ? { status: e.status } : {}) };
      stop = 'provider-error';
      writeCardFile(dir, card);
      break;
    }
    attempt.cost = provider.free ? 0 : answer.cost;
    spent += attempt.cost ?? 0;
    try {
      await processAttempt({ order, attempt, dir: adir, bytes: answer.bytes, mime: answer.mime, processing });
    } catch (/** @type {any} */ e) {
      attempt.error = { stage: 'process', message: String(e?.message ?? e) };
    }
    writeCardFile(dir, card);
    if (attempt.cost == null) { stop = 'cost-unknown'; break; }
    if (attempt.check && attempt.check.blocking === 0) { stop = 'passed'; break; }
  }
  choose(dir, card);
  writeCardFile(dir, card);
  const report = cardReport(dir, card, ns);
  return { ...report, stop, spent, limits: lim, warnings: warning ? [warning] : [] };
}

/**
 * Runs the checks again on attempts of a card (after the order's staging was edited, or with what a person or an
 * agent confirmed by eye), then chooses the best attempt again.
 * @param {{dir: string, n?: number, review?: import('./card-file.js').Review}} o
 *   n = only this attempt (required with review); otherwise every attempt that has a card image
 * @returns {Promise<CardReport>}
 */
export async function recheckCard({ dir, n, review }) {
  const card = readCardFile(dir);
  if (!card) throw new Error(`Нет карточки: ${dir} (нет card.json).`);
  if (review && n == null) throw new Error('Подтверждение контура или рамка героя относятся к одной попытке: укажите её номер.');
  const targets = card.attempts.filter(a => (n == null || a.n === n) && fs.existsSync(path.join(attemptDir(dir, a.n), ATTEMPT_FILES.card)));
  if (n != null && !targets.length) throw new Error(`У карточки нет попытки ${n} с картинкой.`);
  for (const a of targets) {
    if (review) a.review = { ...a.review, ...review };
    a.check = (await checkAttempt({ order: card.order, dir: attemptDir(dir, a.n), review: a.review })).summary;
  }
  choose(dir, card);
  writeCardFile(dir, card);
  return cardReport(dir, card, targets.map(a => a.n));
}
