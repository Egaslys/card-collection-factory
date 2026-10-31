// The editor's hints (the author's decisions of 2026-10-31 on the approved mockup): which one a screen shows, and what
// this browser remembers about them. Three kinds:
// - 'next' — the quiet «Следующий шаг» line in the main section's header row: what to do next on this screen;
// - 'first' — a must-know action shown in the same row the first time it is needed, gone by itself once it is done;
// - 'setup' — the first screen's card when the service key is missing or Codex (chosen to draw) is not ready.
// One step hint at a time on a screen: a first-use hint wins over the «next» line. × hides that one hint for good; the
// «Подсказки» switch (Settings → Вид) hides them all, and turning it on brings the hidden ones back. Empty states are
// part of their screens, not hints: neither × nor the switch touches them. Remembered in this browser like the theme
// (every read and write may fail: private mode, no storage — the page then works from memory until it reloads).
// No DOM here, so the rules are tested in Node (tests/editor-hints.test.mjs); the markup is hints-ui.js.

const KEY = 'ccf-hints';
/** Sent on the window whenever what the hints show may have changed (their memory, the key, Codex). */
export const HINTS_EVENT = 'ccf:hints';

/** @typedef {{on: boolean, dismissed: string[], done: string[]}} HintMemory  done: first-use hints the person did */
/** @typedef {{kind: 'next'|'first', id: string}} Hint */

/** @returns {HintMemory} */
function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const list = (/** @type {unknown} */ x) => (Array.isArray(x) ? x.filter(i => typeof i === 'string') : []);
      return { on: v.on !== false, dismissed: list(v.dismissed), done: list(v.done) };
    }
  } catch { /* no storage, or not ours */ }
  return { on: true, dismissed: [], done: [] };
}

let memory = read();

/** @param {HintMemory} next */
function remember(next) {
  memory = next;
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* private mode */ }
  hintsChanged();
}

/** Tells the screens to draw their hints again. */
export function hintsChanged() {
  if (typeof dispatchEvent === 'function') dispatchEvent(new Event(HINTS_EVENT));
}

/** What this browser remembers. @returns {HintMemory} */
export const hintMemory = () => memory;

/** The switch: off hides every hint; on shows them and brings back those hidden with ×. @param {boolean} on */
export const setHintsOn = on => remember({ ...memory, on, dismissed: on ? [] : memory.dismissed });

/** × on a hint: hides that one. @param {string} id */
export const dismissHint = id => { if (!memory.dismissed.includes(id)) remember({ ...memory, dismissed: [...memory.dismissed, id] }); };

/** «Вернуть» in the toast after ×. @param {string} id */
export const restoreHint = id => remember({ ...memory, dismissed: memory.dismissed.filter(x => x !== id) });

/** A first-use action the person did: its hint is not needed any more. @param {string} id */
export const hintDone = id => { if (!memory.done.includes(id)) remember({ ...memory, done: [...memory.done, id] }); };

/** @param {string} id @param {HintMemory} m */
const shown = (id, m) => m.on && !m.dismissed.includes(id);

/**
 * The hint of a set screen. Cards in the pool and an empty place: drag one in (first use); after the first drag, click
 * a card in the window (first use); a full window with no card «Есть проблемы»: export; cards in the window: check
 * and swap them.
 * @param {{places: number, filled: number, made: number, problems: number, freeCards: number}} f  places of the
 *   window; filled: places holding a card; made: of them, made cards; problems: cards in it with problems (FAIL);
 *   freeCards: cards in no set
 * @param {HintMemory} [m]
 * @returns {Hint|null}
 */
export function setHint(f, m = memory) {
  if (!m.on) return null;
  if (!m.done.includes('set.drag') && shown('set.drag', m) && f.filled < f.places && f.freeCards > 0) return { kind: 'first', id: 'set.drag' };
  if (m.done.includes('set.drag') && !m.done.includes('set.place') && shown('set.place', m) && f.filled > 0) return { kind: 'first', id: 'set.place' };
  const id = f.made === f.places && !f.problems ? 'set.export' : f.filled > 0 ? 'set.check' : null;
  return id && shown(id, m) ? { kind: 'next', id } : null;
}

/**
 * The hint of a collection screen: none without sets (its empty state says the step); while something is generated
 * in it, that the cards come by themselves; else open a set.
 * @param {{sets: number, generating: boolean}} f @param {HintMemory} [m]
 * @returns {Hint|null}
 */
export function collectionHint(f, m = memory) {
  if (!f.sets) return null;
  const id = f.generating ? 'collection.generating' : 'collection.open';
  return shown(id, m) ? { kind: 'next', id } : null;
}

/**
 * The first screen's setup card: what is not ready, the key first. Gone by itself once it is ready.
 * @param {{key: string, codex: string|null}} f  key: the key status's source (none, temporary, permanent); codex:
 *   null when Codex does not draw, else its status (ready, login, missing, error)
 * @param {HintMemory} [m]
 * @returns {string[]}  'setup.key', 'setup.codex'
 */
export function setupHints(f, m = memory) {
  return [f.key === 'none' && 'setup.key', f.codex && f.codex !== 'ready' && 'setup.codex']
    .filter(/** @returns {id is string} */ id => !!id && shown(id, m));
}
