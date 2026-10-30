// The editor's API key (VISION «Ключ»): permanent — from the environment or the project's .env; temporary — typed
// into the editor's settings and held only in this process's memory, gone when the editor stops. Core operations
// read the key from process.env (core/providers/openrouter.js loadApiKey), so the temporary key is put there and
// nowhere else: it is never written to disk or logged, and the browser sees only whether there is one and of which kind.
import { loadApiKey } from '../../core/providers/openrouter.js';

/** @type {{envVar: string, permanent: string|null, temporary: string|null}} */
const state = { envVar: '', permanent: null, temporary: null };

/**
 * Reads the permanent key once (environment, then .env) for the variable named in the settings.
 * @param {string} envVar
 */
export function initKey(envVar) {
  if (state.envVar === envVar) return;
  if (state.envVar && state.temporary) delete process.env[state.envVar];
  state.envVar = envVar;
  try { state.permanent = loadApiKey({ envVar }); } catch { state.permanent = null; }
  if (state.temporary) process.env[envVar] = state.temporary;
}

/** @param {string} key */
export function setTemporaryKey(key) {
  const k = String(key ?? '').trim();
  if (!k) throw new Error('Пустой ключ: вставьте ключ целиком.');
  if (/\s/.test(k)) throw new Error('В ключе есть пробелы или переносы строк: вставьте ключ одной строкой.');
  state.temporary = k;
  process.env[state.envVar] = k;
}

export function clearTemporaryKey() {
  state.temporary = null;
  if (state.permanent) process.env[state.envVar] = state.permanent;
  else delete process.env[state.envVar];
}

/** @returns {{source: 'temporary'|'permanent'|'none', envVar: string}} no part of the key itself */
export function keyStatus() {
  return { source: state.temporary ? 'temporary' : state.permanent ? 'permanent' : 'none', envVar: state.envVar };
}

/** The key in use, for the operations of this process only. @returns {string|null} */
export const currentKey = () => state.temporary ?? state.permanent;
