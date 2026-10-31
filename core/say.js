// What a person reads, as data: a message `code` with its `params`, so the editor's page says it in the person's
// language (editor/web/said.js holds the words). The Russian text stays as it was — the fallback for agents, the
// terminal and the logs, and for any code the page does not know yet. Only what core or the server writes is coded;
// what a model or a service wrote (its reply, its plan) goes in `params` as it is and is never translated.

/**
 * @typedef {object} Said
 * @property {string} code  e.g. 'key.auth', 'codex.login', 'provider.http'
 * @property {Record<string, string|number|boolean|null>} [params]
 */

/** @param {string} code @param {Said['params']} [params] @returns {Said} */
export const said = (code, params) => (params ? { code, params } : { code });

/**
 * An Error whose message is the Russian text and whose `said` is the same message as data.
 * @param {string} text @param {string} code @param {Said['params']} [params]
 * @returns {Error & {said: Said}}
 */
export const saidError = (text, code, params) => Object.assign(new Error(text), { said: said(code, params) });

/** The message of a thrown value as data, or null when it has none. @param {unknown} e @returns {Said|null} */
export const saidOf = e => /** @type {any} */ (e)?.said ?? null;

// A warning stays a string in every result (agents and the terminal read it as it is); its data is remembered by its
// text here, for the editor's server in the same process (editor/server/jobs.js), so a result's shape does not change.
// The text carries its params, so one text has one meaning; the oldest are forgotten past KNOWN_LIMIT.
const KNOWN_LIMIT = 500;
/** @type {Map<string, Said>} */
const known = new Map();

/**
 * The text of a warning, with its message as data remembered for saidOfText.
 * @param {string} text @param {string} code @param {Said['params']} [params] @returns {string}
 */
export function textSaid(text, code, params) {
  known.delete(text);
  known.set(text, said(code, params));
  if (known.size > KNOWN_LIMIT) known.delete(/** @type {string} */ (known.keys().next().value));
  return text;
}

/** The message as data of a warning made by textSaid, or null. @param {string} text @returns {Said|null} */
export const saidOfText = text => known.get(text) ?? null;
