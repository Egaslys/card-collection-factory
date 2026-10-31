// Whether Codex CLI is ready to draw, for the page (its first screen says what to do when it is not): asked only when
// the settings have Codex draw (provider.use = codex-cli), with core's free `codex login status` (codexStatus). The
// server asks when it starts, after the settings are saved, and when a page connects (a person who just ran
// `codex login` reloads the page); the page sees only the status word, never what Codex printed.
import { codexStatus } from '../../core/providers/codex-cli.js';
import { keyEnvVars } from '../../core/providers/preset.js';

/** @typedef {'ready'|'login'|'missing'|'error'|null} CodexState  null: Codex does not draw, or not asked yet */

/** @type {CodexState} */
let state = null;
let asked = 0;

/** The last answer. @returns {CodexState} */
export const codexState = () => state;

/**
 * Asks Codex again when the settings have it draw (else the state is null), and tells `onChange` a changed state. An
 * answer overtaken by a newer question is dropped.
 * @param {any} settings  loadSettings()
 * @param {(s: CodexState) => void} [onChange]
 * @param {import('../../core/providers/codex-cli.js').CodexNet} [net]
 * @returns {Promise<CodexState>}
 */
export async function checkCodex(settings, onChange, net) {
  const my = ++asked;
  const p = settings.provider;
  const next = p.use === 'codex-cli' ? await codexStatus({ settings: p.codexCli, withoutEnv: keyEnvVars(p), net }) : null;
  if (my !== asked) return state;
  if (next !== state) { state = next; onChange?.(state); }
  return state;
}
