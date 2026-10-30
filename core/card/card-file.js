// The files of one card: the one description of the card folder and of card.json. A card lives once in its
// collection's pool, collections/<collection>/cards/<card id>/ (core/store/README.md: where, and how a set's slots
// refer to cards); core/card writes the folder the store gives it (store cardDir).
//
//   <card folder>/
//     card.json            CardFile: the order, every attempt and the chosen one
//     card.png             the chosen attempt's card (a copy of attempts/<n>/card.png)
//     card.json.lock       while an operation changes card.json (below: several operations on one card)
//     card.busy.<pid>.<n>  while a long operation (a generation, an image handed in) runs on the card
//     attempts/<n>/        one generation (or an image an agent handed in), n = 1, 2, …
//       model.<ext>        the image as the model returned it (or as the agent handed it in)
//       prepared.png       cropped and scaled to the card size, before post-processing
//       card.png           after post-processing: the card that was checked
//       check.json         the full result of the style's checks (measures, results, visual checklist)
//       card.mask.png      the hero outline the checks used, drawn over the card, when there is one
//       card.hero.png      the hero outline found in a box (core/card/hero.js): white = hero
//       look.json          what the vision model saw (core/card/look.js): its answers, as given
//
// An order whose output is not a card (kind "character-sheet", core/style/README.md) keeps the model's frame:
// prepared.png and card.png have the model image's size, not the card size, and check.json holds only the list of
// checks for eyes (`visual`, no `results`): no pixel checks run, so nothing blocks.
//
// Every attempt is a version of the card (version n = attempt n). Who chooses the card: the checks (the best attempt,
// `chosenBy` "checks"), an explicit request of a person or an agent (regenerate with a wish, edit, import: the best of
// the attempts the request made, `chosenBy` "request"), or a person or an agent picking a version by hand
// (`chooseAttempt`, `chosenBy` "choice"); a choice by request or by hand is kept when the checks run again.
//
// collections/ is not tracked by Git (VISION.md «Устройство и стек»).
import fs from 'node:fs';
import path from 'node:path';

export const CARD_FILE = 'card.json';
export const FINAL_IMAGE = 'card.png';
/** File names inside attempts/<n>/ (the model original is `model` + the extension of its format). */
export const ATTEMPT_FILES = { original: 'model', prepared: 'prepared.png', card: 'card.png', check: 'check.json', mask: 'card.mask.png', hero: 'card.hero.png', look: 'look.json' };

/**
 * @typedef {object} CheckFail  an unexpected FAIL of the style's checks
 * @property {string} id  check id, e.g. "COLOUR.8a"
 * @property {string} title
 * @property {unknown} value
 * @property {string|null} threshold
 * @property {string|null} note
 * @property {boolean} needsMask  rests on a hero outline nobody has confirmed: may be the outline's fault
 */

/**
 * @typedef {object} CheckSummary
 * @property {string} maskStatus  proposal | auto (a trusted outline cut in a box) | confirmed | rejected | not found |
 *   not checked (an order kind without pixel checks)
 * @property {number} blocking  FAILs that do not rest on an unconfirmed outline, plus the blocking problems the vision
 *   model saw (`look`): they make the loop regenerate
 * @property {number} [needsEyes]  FAILs that rest on an unconfirmed outline (absent in card.json files written before
 *   the vision model's look: there it is fails.length - blocking)
 * @property {number} warns
 * @property {CheckFail[]} fails
 * @property {{verdict: 'ok'|'fix'|'unknown', issues: LookIssue[]}} [look]  what the vision model saw (the attempt's `look`)
 */

/**
 * @typedef {object} Review  what a person or an agent confirmed by eye for the checks of one attempt
 * @property {'confirmed'|'rejected'} [mask]  the proposed hero outline (card.mask.png) is / is not the hero
 * @property {number[]} [hero_box]  [x0, y0, x1, y1] px of the hero, drawn by eye
 */

/**
 * @typedef {object} HeroRecord  how the hero outline of an attempt was found (core/card/hero.js Hero, without the pixels)
 * @property {'box'|'vision'|null} source  the box came from an agent or a person (`review.hero_box`), or from the vision model
 * @property {number[]|null} box  [x0, y0, x1, y1] px the outline was cut in
 * @property {'high'|'low'} confidence  high = the outline is trusted: the checks measure on it (mask status "auto")
 * @property {'high'|'low'} boxConfidence  high = the box is trusted: composition is measured on it
 * @property {string[]} reasons  why a confidence is low
 * @property {number|null} [agreement]  IoU of the vision model's boxes on the card and on its mirror image
 * @property {number} cost  USD of the vision calls (0 for a given box)
 */

/**
 * @typedef {object} LookIssue  one problem the vision model saw
 * @property {string} kind  an order question (subject, staging, additions, costume) or "checklist" (the style's list for eyes)
 * @property {string} [id]  checklist: the check id, e.g. "RENDERING.12-14"
 * @property {string} what  the model's words
 * @property {boolean} blocking  the kind is in settings → look.blocking: the loop regenerates
 */

/**
 * @typedef {object} LookRecord  the vision model's look at an attempt (core/card/look.js)
 * @property {string} model
 * @property {'ok'|'fix'|'unknown'} verdict  ok = no problem seen; fix = a problem; unknown = no usable answer (`error`)
 * @property {LookIssue[]} issues
 * @property {string} [seen]  how the model names the main subject it sees
 * @property {number} cost  USD (0 when the provider did not report it); a paid answer of no use (no text) counts too
 * @property {string} [error]
 * @property {'auth'|'billing'} [errorKind]  the vision model's service refused the key or wants money
 */

/**
 * USD an attempt spent: the image (when its price is known), the vision model's calls for its hero and its look, and the
 * text model's correction it was drawn with.
 * @param {Attempt} a
 */
export const attemptCost = a => (a.cost ?? 0) + (a.hero?.cost ?? 0) + (a.look?.cost ?? 0) + (a.fix?.cost ?? 0);

/**
 * The same USD split by kind: `images` the image (0 for a free provider and an imported image), `vision` the vision
 * model's calls (hero and look), `text` the text model's correction (fix.js).
 * @param {Attempt} a @returns {{images: number, vision: number, text: number}}
 */
export const attemptSpend = a => ({ images: a.cost ?? 0, vision: (a.hero?.cost ?? 0) + (a.look?.cost ?? 0), text: a.fix?.cost ?? 0 });

/**
 * @typedef {object} FixRecord
 * @property {number} from  the attempt whose findings it corrects
 * @property {string|null} text  the sentences added to the prompt; null = the text model gave none (`error`)
 * @property {string} model  the text model
 * @property {number} cost  USD (0 when the service did not report it)
 * @property {string[]} [skipped]  findings the text model left out, with why
 * @property {string} [error]
 */

/**
 * @typedef {object} Attempt
 * @property {number} n
 * @property {string} at  ISO time the generation was requested
 * @property {string} model  the model that made the image (the fallback one when `fallbackFrom` is set)
 * @property {{model: string, error: {message: string, status?: number}}} [fallbackFrom]  the main model failed in this
 *   attempt (error, refusal, no image) and the fallback model made it
 * @property {string} prompt  exactly as sent; empty for an image an agent handed in (model "agent")
 * @property {string[]} references  images sent with the prompt (style references; for an edit, the image edited)
 * @property {string} [wish]  the person's words this attempt was made for (`card regenerate`, `card edit`)
 * @property {number} [editOf]  an edit: the attempt whose model image was edited
 * @property {number|null} cost  USD as reported by the provider, with any call of the attempt that failed but was paid
 *   (an answer without an image: its error carries the price); null = unknown
 * @property {string} [original]  file name of the model image in the attempt folder
 * @property {number} [cutBottom]  card pixels cut from the bottom of the model image because it came back taller than
 *   the card (core/image/prepare.js); the model's profile should ask it for a frame no taller than the card
 * @property {import('../image/adjust.js').AdjustSettings} [processing]  post-processing applied (the editor's slider positions)
 * @property {boolean} [processingFixed]  `processing` was set by hand (`card adjust`): never tuned again
 * @property {import('./tune.js').Tuning} [tuning]  how `processing` was found: start, measures before and after, basis
 * @property {Review} [review]
 * @property {HeroRecord} [hero]  the hero outline the checks used, when one was cut in a box (card.hero.png)
 * @property {LookRecord} [look]  the vision model's look at the card (look.json)
 * @property {FixRecord} [fix]  the correction added at the end of `prompt`, written by the text model from the findings
 *   of an earlier attempt (core/card/fix.js)
 * @property {CheckSummary} [check]
 * @property {{stage: 'generate'|'process', message: string, status?: number, kind?: 'auth'|'billing'}} [error]  kind: the
 *   service refused the key or wants money (the run stopped, make.js StopReason "key")
 */

/**
 * @typedef {object} CardFile
 * @property {import('../style/card-order.js').CardOrder} order  the current order; each attempt keeps its own prompt
 * @property {Attempt[]} attempts
 * @property {number|null} chosen  n of the chosen attempt (card.png is its copy)
 * @property {'checks'|'request'|'choice'} [chosenBy]  absent = checks; choice = a person or an agent made this
 *   version the card (`chooseAttempt`)
 */

/** @param {string} dir @param {number} n */
export const attemptDir = (dir, n) => path.join(dir, 'attempts', String(n));

/** @param {string} dir @returns {CardFile|null} */
export function readCardFile(dir) {
  const file = path.join(dir, CARD_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** Writes card.json whole; operations on a card go through updateCardFile instead. @param {string} dir @param {CardFile} card */
export function writeCardFile(dir, card) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CARD_FILE);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(card, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// Several operations may work on one card at once: in one process (two jobs of the editor) and across processes (an
// agent's ccf.mjs and the editor). Two rules keep every paid attempt and every change:
// - an attempt's number is taken by creating its folder exclusively (reserveAttempt): no two runs get the same n;
// - card.json is changed only under the card's lock file (updateCardFile): read as it is now, changed, written. Each
//   operation changes only its own part — its attempts, the order it was given, its choice — so a change written by
//   another operation in the meantime stays. Two operations changing the same attempt (adjusting one version twice)
//   still end with the later one's values.
// The lock is held only for that synchronous read-change-write (and copying the chosen card.png), never across a call
// to a provider. A lock left by a process that died (its pid is gone) or older than LOCK_STALE_MS is taken over.
// While a long operation runs on a card (generation, an image handed in), it leaves a busy marker in the card folder
// (markBusy); busyOf lists the live ones, so the editor can hold its buttons whoever runs the operation.

/** The lock of card.json; its text is "<pid> <ms>" of the holder. */
export const LOCK_FILE = CARD_FILE + '.lock';
/** A lock older than this is a hung or dead writer's: a writer holds it for milliseconds. */
const LOCK_STALE_MS = 30000;
/** How long to wait for another writer's lock before giving up. */
const LOCK_WAIT_MS = 15000;
const LOCK_RETRY_MS = 10;
/** Busy markers: card.busy.<pid>.<n>, JSON {what, pid, since}. */
export const BUSY_PREFIX = 'card.busy.';

/** Whether a process of this machine is alive. @param {number} pid */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (/** @type {any} */ e) { return e?.code === 'EPERM'; }
}

/** @param {number} ms */
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Takes the card's lock, waiting for another holder; returns its release. @param {string} dir @returns {() => void} */
function lockCard(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LOCK_FILE);
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeSync(fd, `${process.pid} ${Date.now()}`); } finally { fs.closeSync(fd); }
      return () => fs.rmSync(file, { force: true });
    } catch (/** @type {any} */ e) {
      if (e?.code !== 'EEXIST') throw e;
    }
    let text, age;
    try { text = fs.readFileSync(file, 'utf8'); age = Date.now() - fs.statSync(file).mtimeMs; } catch { continue; } // released meanwhile
    if (age > LOCK_STALE_MS || (text && !alive(Number(text.split(' ')[0])))) {
      // left by a writer that died or hung: taken over unless another waiter already did
      try { if (fs.readFileSync(file, 'utf8') === text) fs.rmSync(file, { force: true }); } catch { /* gone already */ }
      continue;
    }
    if (Date.now() > until) throw new Error(`Карточку меняет другая операция дольше ${LOCK_WAIT_MS / 1000} с (${file}). Если её процесса уже нет, удалите этот файл.`);
    sleepSync(LOCK_RETRY_MS);
  }
}

/**
 * Changes card.json under the card's lock: `change` gets the file as it is now (null when there is none yet) and
 * returns the card to write. `change` must be synchronous.
 * @param {string} dir @param {(card: CardFile|null) => CardFile} change
 * @returns {CardFile} what was written
 */
export function updateCardFile(dir, change) {
  const release = lockCard(dir);
  try {
    const card = change(readCardFile(dir));
    writeCardFile(dir, card);
    return card;
  } finally {
    release();
  }
}

/**
 * Takes the next free attempt number of a card by creating its folder exclusively: after the attempts card.json
 * records and `after`, the first n whose folder does not exist yet.
 * @param {string} dir @param {number} [after]  the highest n the caller knows of
 * @returns {number}
 */
export function reserveAttempt(dir, after = 0) {
  const known = readCardFile(dir)?.attempts ?? [];
  let n = Math.max(0, after, ...known.map(a => a.n)) + 1;
  fs.mkdirSync(path.join(dir, 'attempts'), { recursive: true });
  for (;; n++) {
    try { fs.mkdirSync(attemptDir(dir, n)); return n; } catch (/** @type {any} */ e) { if (e?.code !== 'EEXIST') throw e; }
  }
}

let busySeq = 0;
/**
 * Marks the card busy with a long operation of this process until the returned release is called; markers of
 * processes that are gone are removed.
 * @param {string} dir @param {string} what  the operation, e.g. "regenerate"
 * @returns {() => void}
 */
export function markBusy(dir, what) {
  for (const f of busyFiles(dir)) {
    const b = readBusy(path.join(dir, f));
    if (!b || !alive(b.pid)) fs.rmSync(path.join(dir, f), { force: true });
  }
  const file = path.join(dir, `${BUSY_PREFIX}${process.pid}.${++busySeq}`);
  fs.writeFileSync(file, JSON.stringify({ what, pid: process.pid, since: new Date().toISOString() }));
  return () => fs.rmSync(file, { force: true });
}

/** @param {string} dir @returns {string[]} the busy markers' file names */
export function busyFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => f.startsWith(BUSY_PREFIX)).sort(); } catch { return []; }
}

/** @param {string} file @returns {{what: string, pid: number, since: string}|null} */
function readBusy(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * The long operations running on a card now, in any process of this machine.
 * @param {string} dir @returns {{what: string, pid: number, since: string}[]}
 */
export function busyOf(dir) {
  return busyFiles(dir).flatMap(f => { const b = readBusy(path.join(dir, f)); return b && alive(b.pid) ? [b] : []; });
}
