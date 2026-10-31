// The page's link to the editor server: operations (POST /api/op/<name>), jobs and live events (SSE).
import { words } from './i18n.js';

const t = words({
  ru: { offline: 'Редактор не отвечает: возможно, его остановили. Запустите его снова и обновите страницу.', restarted: 'Редактор перезапущен: страница обновляется.', error: 'Ошибка {status}' },
  en: { offline: 'The editor is not responding: it may have been stopped. Start it again and reload the page.', restarted: 'The editor was restarted: the page reloads.', error: 'Error {status}' },
});

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
    throw new Error(t('offline'));
  }
  if (res.status === 403) { reloadForNewToken(); throw new Error(t('restarted')); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? t('error', { status: res.status }));
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

/** The editor was started again: this page's token is no longer valid, and a reload gets the new one. */
function reloadForNewToken() { location.reload(); }

/** How often a closed live channel asks whether the editor is back. */
const PROBE_MS = 2000;

/**
 * Opens the live channel and reports the connection state as events. EventSource reconnects by itself after a dropped
 * connection; when the editor was stopped and started again, its answer to this page's old token closes the channel
 * for good — then the page asks the editor until it answers, and reloads itself to take the new token.
 */
export function connect() {
  const es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
  es.onmessage = m => {
    const e = JSON.parse(m.data);
    if (e.type === 'hello') { jobs.clear(); for (const j of e.jobs) jobs.set(j.id, j); }
    if (e.type === 'job') jobs.set(e.job.id, e.job);
    for (const fn of listeners) fn(e);
  };
  es.onerror = () => {
    for (const fn of listeners) fn({ type: 'offline' });
    if (es.readyState === EventSource.CLOSED) setTimeout(probe, PROBE_MS);
  };
  es.onopen = () => { for (const fn of listeners) fn({ type: 'online' }); };
}

async function probe() {
  try {
    const res = await fetch('/api/op/health', { method: 'POST', headers: HEADERS, body: '{}' });
    if (res.status === 403) { reloadForNewToken(); return; }
    if (res.ok) { connect(); return; }
  } catch { /* not running yet */ }
  setTimeout(probe, PROBE_MS);
}
