// The page's link to the editor server: operations (POST /api/op/<name>), jobs and live events (SSE).

const TOKEN = /** @type {HTMLMetaElement} */ (document.querySelector('meta[name="ccf-token"]')).content;
const HEADERS = { 'x-ccf-token': TOKEN, 'content-type': 'application/json' };

/**
 * Calls an operation; a long one returns its job (`{job}`), the others their result.
 * @param {string} op @param {Record<string, unknown>} [args]
 * @returns {Promise<any>}
 */
export async function call(op, args = {}) {
  let res;
  try {
    res = await fetch(`/api/op/${op}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) });
  } catch {
    throw new Error('Редактор не отвечает: возможно, его остановили. Запустите его снова и обновите страницу.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Ошибка ${res.status}`);
  return body.job ? { job: body.job } : body.result;
}

/** @param {string} id */
export async function cancelJob(id) {
  const res = await fetch(`/api/jobs/${id}/cancel`, { method: 'POST', headers: HEADERS });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body;
}

/** @typedef {{type: string, [k: string]: any}} ServerEvent */

/** @type {Set<(e: ServerEvent) => void>} */
const listeners = new Set();
/** @type {Map<string, any>} */
export const jobs = new Map();

/** @param {(e: ServerEvent) => void} fn @returns {() => void} */
export function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Opens the live channel; reconnects by itself (EventSource) and reports the connection state as events. */
export function connect() {
  const es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
  es.onmessage = m => {
    const e = JSON.parse(m.data);
    if (e.type === 'hello') { jobs.clear(); for (const j of e.jobs) jobs.set(j.id, j); }
    if (e.type === 'job') jobs.set(e.job.id, e.job);
    for (const fn of listeners) fn(e);
  };
  es.onerror = () => { for (const fn of listeners) fn({ type: 'offline' }); };
  es.onopen = () => { for (const fn of listeners) fn({ type: 'online' }); };
}
