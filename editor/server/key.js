// The editor's API keys (VISION «Ключ»), one per key variable — each API preset names its own (settings
// provider.<preset>.keyEnvVar: OPENROUTER_API_KEY, GEMINI_API_KEY). Permanent — from the environment or the project's
// .env; temporary — typed into the editor's settings and held only in this process's memory, gone when the editor
// stops. Core operations read a key from process.env (core/providers/openrouter.js loadApiKey), so a temporary key is
// put there, under its own variable, and nowhere else: it is never written to disk or logged, and the browser sees
// only whether there is one and of which kind. Switching the preset never carries a key over to another variable.
import { loadApiKey } from '../../core/providers/openrouter.js';

/** @type {{envVar: string, keys: Map<string, {permanent: string|null, temporary: string|null}>}} */
const state = { envVar: '', keys: new Map() };

/** The keys of one variable, the permanent one read once (environment, then .env). @param {string} envVar */
function slot(envVar) {
  let k = state.keys.get(envVar);
  if (!k) {
    k = { permanent: null, temporary: null };
    try { k.permanent = loadApiKey({ envVar }); } catch { k.permanent = null; }
    state.keys.set(envVar, k);
  }
  return k;
}

/**
 * Selects the key variable of the settings' preset (reading its permanent key once).
 * @param {string} envVar
 */
export function initKey(envVar) {
  slot(envVar);
  state.envVar = envVar;
}

/**
 * Holds a temporary key for a variable (default: the current preset's).
 * @param {string} key @param {string} [envVar]
 */
export function setTemporaryKey(key, envVar = state.envVar) {
  const k = String(key ?? '').trim();
  if (!k) throw new Error('Пустой ключ: вставьте ключ целиком.');
  if (/\s/.test(k)) throw new Error('В ключе есть пробелы или переносы строк: вставьте ключ одной строкой.');
  slot(envVar).temporary = k;
  process.env[envVar] = k;
}

/** Forgets the temporary key of a variable (default: the current preset's). @param {string} [envVar] */
export function clearTemporaryKey(envVar = state.envVar) {
  const s = slot(envVar);
  s.temporary = null;
  if (s.permanent) process.env[envVar] = s.permanent;
  else delete process.env[envVar];
}

/** @param {string} [envVar] @returns {{source: 'temporary'|'permanent'|'none', envVar: string}} no part of the key itself */
export function keyStatus(envVar = state.envVar) {
  const s = slot(envVar);
  return { source: s.temporary ? 'temporary' : s.permanent ? 'permanent' : 'none', envVar };
}

/** The key in use for a variable (default: the current preset's), for the operations of this process only. @param {string} [envVar] @returns {string|null} */
export const currentKey = (envVar = state.envVar) => { const s = slot(envVar); return s.temporary ?? s.permanent; };
