// Long operations of the editor (planning and making sets and collections, generating a card) run as jobs: the
// request returns at once with the job, progress goes to every open page as `job` events, and a caller (the page
// or an agent through editor/remote.js) can wait for the end. A job is cancelled through its AbortSignal; an
// operation that does not take a signal stops only at its next check, so cancelling is offered only where the
// operation supports it.

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {string} op
 * @property {string} title  for a person: what is being done
 * @property {{collectionId?: string, setId?: string, cardId?: string}} scope
 * @property {'running'|'done'|'failed'|'cancelled'} status
 * @property {string} startedAt
 * @property {string|null} endedAt
 * @property {{at: string, text: string}[]} log  newest last
 * @property {number|null} spent  USD so far, when the operation reports it
 * @property {boolean} cancellable
 * @property {JobItem[]} [items]  one row per card being made, when the operation reports cards
 * @property {unknown} [result]
 * @property {string} [error]
 * @property {string[]} [warnings]  what did not work in a job that finished (the result's `warnings`)
 */

/**
 * @typedef {object} JobItem
 * @property {string|null} set
 * @property {number} slot  1-based
 * @property {string|null} cardId
 * @property {string} title
 * @property {string} status  start | made | kept | skipped | failed | cancelled …, as core/set reports it
 * @property {number} spent
 */

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
   * @param {{op: string, title: string, scope?: Job['scope'], cancellable?: boolean,
   *   run: (ctx: {progress: (text: string, o?: any) => void, signal: AbortSignal}) => Promise<unknown>,
   *   spentOf?: (result: any) => number|null}} o
   * @returns {Job}
   */
  function start({ op, title, scope = {}, cancellable = false, run, spentOf }) {
    const id = `${Date.now().toString(36)}-${(++seq).toString(36)}`;
    /** @type {Job} */
    const job = { id, op, title, scope, status: 'running', startedAt: new Date().toISOString(), endedAt: null, log: [], spent: null, cancellable };
    const abort = new AbortController();
    /** @type {Map<string, JobItem>} */
    const items = new Map();
    /**
     * A line of the journal; `o.slot` (with `o.set`) updates the row of that card in the job's queue (core/set's
     * progress data), `o.total` sets the spend of the whole job, `o.spent` of the row.
     * @param {string} text @param {{set?: string, slot?: number, cardId?: string|null, title?: string, status?: string, spent?: number, total?: number}} [o]
     */
    const progress = (text, o = {}) => {
      job.log.push({ at: new Date().toISOString(), text: String(text) });
      if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
      if (o.slot != null) {
        const key = `${o.set ?? ''}:${o.slot}`;
        items.set(key, { ...items.get(key), set: o.set ?? null, slot: o.slot, cardId: o.cardId ?? items.get(key)?.cardId ?? null, title: o.title ?? '', status: o.status ?? '', spent: o.spent ?? 0 });
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
        if (Array.isArray(warnings) && warnings.length) job.warnings = warnings.map(String);
        job.status = abort.signal.aborted ? 'cancelled' : 'done';
      } catch (/** @type {any} */ e) {
        job.status = abort.signal.aborted ? 'cancelled' : 'failed';
        job.error = String(e?.message ?? e);
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
    if (!j) throw new Error('Такой задачи нет: возможно, редактор перезапускали.');
    if (!j.job.cancellable) throw new Error('Эту задачу нельзя остановить на ходу: дождитесь конца.');
    if (j.job.status === 'running') { j.abort.abort(); j.job.log.push({ at: new Date().toISOString(), text: 'Остановка: доделываю начатый шаг…' }); send(j.job); }
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
