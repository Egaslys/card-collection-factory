// Long operations of the editor (planning and making sets and collections, generating a card) run as jobs: the
// request returns at once with the job, progress goes to every open page as `job` events, and a caller (the page
// or an agent through editor/remote.js) can wait for the end. A job is cancelled through its AbortSignal; an
// operation that does not take a signal stops only at its next check, so cancelling is offered only where the
// operation supports it.

import { saidError, saidOf, saidOfText } from '../../core/say.js';

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {string} op
 * @property {string} title  for a person: what is being done (Russian, for agents and the log; the page words it from
 *   `op` and `about`)
 * @property {JobAbout} [about]  what the job is about, for the page to say it in the person's language
 * @property {{collectionId?: string, setId?: string, cardId?: string}} scope
 * @property {'running'|'done'|'failed'|'cancelled'} status
 * @property {string} startedAt
 * @property {string|null} endedAt
 * @property {{at: string, text: string, say?: Say}[]} log  newest last; `say`: the same line as data the page words
 * @property {number|null} spent  USD so far, when the operation reports it
 * @property {boolean} cancellable
 * @property {JobItem[]} [items]  one row per card being made, when the operation reports cards
 * @property {unknown} [result]
 * @property {string} [error]
 * @property {import('../../core/say.js').Said} [errorSaid]  the error as data, for the page to say it in the person's language
 * @property {string[]} [warnings]  what did not work in a job that finished (the result's `warnings`)
 * @property {(import('../../core/say.js').Said|null)[]} [warningSaid]  the warnings as data, where core gave one;
 *   null = the page shows the warning's text
 */

/**
 * @typedef {object} JobItem
 * @property {string|null} set
 * @property {number|null} slot  1-based; null for a card made into the pool (core/set/cards.js), its row keyed by title
 * @property {string|null} cardId
 * @property {string} title
 * @property {string} status  start | made | kept | skipped | failed | cancelled …, as core/set reports it
 * @property {number} spent
 * @property {{stage: string, k: number, of: number}} [attempt]  the card's attempt under way: the k-th of this run's `of`
 *   (from its last `attempt` say: `done` + 1 — not `n`, the card's version number, which counts earlier runs too)
 */

/**
 * @typedef {object} JobAbout
 * @property {string} [theme]  of a set, a collection or a batch of cards
 * @property {string} [title]  of the card
 * @property {string} [mode]  buildCollection: missing | variants
 * @property {number} [count]  cards the job makes, when known before it starts
 * @property {boolean} [codex]  Codex CLI draws the job's pictures, on this computer in the background
 */

/**
 * A journal line as data: a step of a card's run (core/card's progress: generating or processing attempt `n` of at
 * most `of`), or the job stopping on a person's request.
 * @typedef {{k: 'attempt', stage: string, n: number|null, done: number, of: number, title?: string} | {k: 'stopping'} | CardSay | PlanSay
 *   | {k: 'note', code: string, number?: number, title?: string} | ({k: 'said'} & import('../../core/say.js').Said)} Say
 */
/**
 * A card's line: its status and what the page needs to word it (core/set's RowFacts).
 * @typedef {{k: 'card', status: string, title: string, slot?: number, image?: boolean, stop?: string, blocking?: number, why?: string, error?: string,
 *   errorSaid?: import('../../core/say.js').Said, spent?: number}} CardSay
 */
/** A planning line. @typedef {{k: 'plan', status: string, title?: string, number?: number, errors?: number, error?: string, count?: number, set?: string}} PlanSay */

/** The statuses of a card row (core/set's progress); others (planning, planned, invalid) are lines of the plan. */
const CARD_STATUSES = new Set(['start', 'made', 'kept', 'skipped', 'failed', 'cancelled']);
const PLAN_STATUSES = new Set(['planning', 'planned', 'invalid']);

/** Drops the fields that are not set. @param {Record<string, unknown>} o */
const defined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

/**
 * A journal line as data: what core said with it (`o.say`; a card's attempt gets the card's title and slot), else
 * what the page can tell from a card's or a plan's progress event, else what core remembered of the text (a warning,
 * core/say.js textSaid), else nothing (the page shows the text).
 * @param {string} text @param {any} o @returns {Say|undefined}
 */
function sayOf(text, o) {
  if (o.say) return o.say.k === 'attempt' ? { ...defined({ title: o.title, slot: o.slot }), ...o.say } : o.say;
  if (o.title && CARD_STATUSES.has(o.status)) {
    return /** @type {CardSay} */ ({ k: 'card', ...defined({ status: o.status, title: o.title, slot: o.slot, image: o.image, stop: o.stop, blocking: o.blocking, why: o.why, error: o.error, errorSaid: o.errorSaid, spent: o.status === 'made' ? o.spent : undefined }) });
  }
  if (PLAN_STATUSES.has(o.status)) return /** @type {PlanSay} */ ({ k: 'plan', ...defined({ status: o.status, title: o.title, number: o.number, errors: o.errors, error: o.error, count: o.count, set: o.set }) });
  const s = saidOfText(text);
  return s ? { k: 'said', ...s } : undefined;
}


const LOG_LIMIT = 200;
const KEEP_FINISHED = 30;

/**
 * @param {(event: {type: 'job', job: Job}) => void} emit
 */
export function createJobs(emit) {
  /** @type {Map<string, {job: Job, abort: AbortController, done: Promise<Job>}>} */
  const jobs = new Map();
  let seq = 0;

  /** @param {Job} job */
  const send = job => emit({ type: 'job', job });

  /**
   * @param {{op: string, title: string, about?: JobAbout, scope?: Job['scope'], cancellable?: boolean,
   *   run: (ctx: {progress: (text: string, o?: any) => void, signal: AbortSignal}) => Promise<unknown>,
   *   spentOf?: (result: any) => number|null}} o
   * @returns {Job}
   */
  function start({ op, title, about, scope = {}, cancellable = false, run, spentOf }) {
    const id = `${Date.now().toString(36)}-${(++seq).toString(36)}`;
    /** @type {Job} */
    const job = { id, op, title, ...(about ? { about } : {}), scope, status: 'running', startedAt: new Date().toISOString(), endedAt: null, log: [], spent: null, cancellable };
    const abort = new AbortController();
    /** @type {Map<string, JobItem>} */
    const items = new Map();
    /**
     * A line of the journal; `o.slot` (with `o.set`) updates the row of that card in the job's queue (core/set's
     * progress data) — a card made into the pool has no slot, its row is its title —, `o.total` sets the spend of the
     * whole job, `o.spent` of the row, `o.say` is the line as data for the page.
     * @param {string} text @param {{set?: string, slot?: number, cardId?: string|null, title?: string, status?: string, spent?: number, total?: number, say?: Say}} [o]
     */
    const progress = (text, o = {}) => {
      const say = sayOf(text, o);
      job.log.push({ at: new Date().toISOString(), text: String(text), ...(say ? { say } : {}) });
      if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
      const key = o.slot != null ? `${o.set ?? ''}:${o.slot}` : o.title && CARD_STATUSES.has(o.status ?? '') ? `card:${o.title}` : null;
      if (key) {
        const attempt = o.say?.k === 'attempt' ? { stage: o.say.stage, k: o.say.done + 1, of: o.say.of } : items.get(key)?.attempt;
        items.set(key, { ...items.get(key), set: o.set ?? null, slot: o.slot ?? null, cardId: o.cardId ?? items.get(key)?.cardId ?? null, title: o.title ?? '', status: o.status ?? '', spent: o.spent ?? 0, attempt: o.status === 'start' ? attempt : undefined });
        job.items = [...items.values()];
        job.spent = (base ?? 0) + job.items.reduce((s, i) => s + (i.spent ?? 0), 0);
      }
      if (typeof o.total === 'number') { base = o.total; job.spent = o.total + (job.items ?? []).reduce((s, i) => s + (i.spent ?? 0), 0); }
      send(job);
    };
    /** spend of the job outside the card rows (planning) */
    let base = /** @type {number|null} */ (null);
    const done = (async () => {
      send(job);
      try {
        job.result = await run({ progress, signal: abort.signal });
        const spent = spentOf?.(job.result);
        if (typeof spent === 'number') job.spent = spent;
        const warnings = /** @type {any} */ (job.result)?.warnings;
        if (Array.isArray(warnings) && warnings.length) {
          job.warnings = warnings.map(String);
          // what core remembered of them (core/say.js textSaid)
          const ws = job.warnings.map(saidOfText);
          if (ws.some(Boolean)) job.warningSaid = ws;
        }
        job.status = abort.signal.aborted ? 'cancelled' : 'done';
      } catch (/** @type {any} */ e) {
        job.status = abort.signal.aborted ? 'cancelled' : 'failed';
        job.error = String(e?.message ?? e);
        const s = saidOf(e);
        if (s) job.errorSaid = s;
      }
      job.endedAt = new Date().toISOString();
      send(job);
      prune();
      return job;
    })();
    jobs.set(id, { job, abort, done });
    return job;
  }

  function prune() {
    const finished = [...jobs.values()].filter(j => j.job.status !== 'running');
    for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) jobs.delete(j.job.id);
  }

  /** @param {string} id */
  function cancel(id) {
    const j = jobs.get(id);
    if (!j) throw saidError('Такой задачи нет: возможно, редактор перезапускали.', 'job.notFound');
    if (!j.job.cancellable) throw saidError('Эту задачу нельзя остановить на ходу: дождитесь конца.', 'job.notCancellable');
    if (j.job.status === 'running') { j.abort.abort(); j.job.log.push({ at: new Date().toISOString(), text: 'Остановка: доделываю начатый шаг…', say: { k: 'stopping' } }); send(j.job); }
    return j.job;
  }

  return {
    start,
    cancel,
    /** @returns {Job[]} newest first */
    list: () => [...jobs.values()].map(j => j.job).reverse(),
    /** @param {string} id */
    get: id => jobs.get(id)?.job ?? null,
    /** @param {string} id @returns {Promise<Job>|null} */
    wait: id => jobs.get(id)?.done ?? null,
    running: () => [...jobs.values()].filter(j => j.job.status === 'running').length,
  };
}
