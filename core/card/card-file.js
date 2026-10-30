// The files of one card: the one description of the card folder and of card.json. A card lives once in its
// collection's pool, collections/<collection>/cards/<card id>/ (core/store/README.md: where, and how a set's slots
// refer to cards); core/card writes the folder the store gives it (store cardDir).
//
//   <card folder>/
//     card.json            CardFile: the order, every attempt and the chosen one
//     card.png             the chosen attempt's card (a copy of attempts/<n>/card.png)
//     attempts/<n>/        one generation (or an image an agent handed in), n = 1, 2, …
//       model.<ext>        the image as the model returned it (or as the agent handed it in)
//       prepared.png       cropped and scaled to the card size, before post-processing
//       card.png           after post-processing: the card that was checked
//       check.json         the full result of the style's checks (measures, results, visual checklist)
//       card.mask.png      the proposed hero outline over the card, when the checks found one
//
// An order whose output is not a card (kind "character-sheet", core/style/README.md) keeps the model's frame:
// prepared.png and card.png have the model image's size, not the card size, and check.json holds only the list of
// checks for eyes (`visual`, no `results`): no pixel checks run, so nothing blocks.
//
// Who chooses the card: the checks (the best attempt, `chosenBy` "checks") or an explicit request of a person or an
// agent (regenerate with a wish, edit, import: the best of the attempts the request made, `chosenBy` "request");
// a choice by request is kept when the checks run again.
//
// collections/ is not tracked by Git (VISION.md «Устройство и стек»).
import fs from 'node:fs';
import path from 'node:path';

export const CARD_FILE = 'card.json';
export const FINAL_IMAGE = 'card.png';
/** File names inside attempts/<n>/ (the model original is `model` + the extension of its format). */
export const ATTEMPT_FILES = { original: 'model', prepared: 'prepared.png', card: 'card.png', check: 'check.json', mask: 'card.mask.png' };

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
 * @property {string} maskStatus  proposal | confirmed | rejected | not found | not checked (an order kind without pixel checks)
 * @property {number} blocking  FAILs that do not rest on an unconfirmed outline: they make the loop regenerate
 * @property {number} warns
 * @property {CheckFail[]} fails
 */

/**
 * @typedef {object} Review  what a person or an agent confirmed by eye for the checks of one attempt
 * @property {'confirmed'|'rejected'} [mask]  the proposed hero outline (card.mask.png) is / is not the hero
 * @property {number[]} [hero_box]  [x0, y0, x1, y1] px of the hero, drawn by eye
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
 * @property {number|null} cost  USD as reported by the provider; null = unknown
 * @property {string} [original]  file name of the model image in the attempt folder
 * @property {import('../image/adjust.js').AdjustSettings} [processing]  post-processing applied (the editor's slider positions)
 * @property {boolean} [processingFixed]  `processing` was set by hand (`card adjust`): never tuned again
 * @property {import('./tune.js').Tuning} [tuning]  how `processing` was found: start, measures before and after, basis
 * @property {Review} [review]
 * @property {CheckSummary} [check]
 * @property {{stage: 'generate'|'process', message: string, status?: number}} [error]
 */

/**
 * @typedef {object} CardFile
 * @property {import('../style/card-order.js').CardOrder} order  the current order; each attempt keeps its own prompt
 * @property {Attempt[]} attempts
 * @property {number|null} chosen  n of the chosen attempt (card.png is its copy)
 * @property {'checks'|'request'} [chosenBy]  absent = checks
 */

/** @param {string} dir @param {number} n */
export const attemptDir = (dir, n) => path.join(dir, 'attempts', String(n));

/** @param {string} dir @returns {CardFile|null} */
export function readCardFile(dir) {
  const file = path.join(dir, CARD_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** @param {string} dir @param {CardFile} card */
export function writeCardFile(dir, card) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CARD_FILE);
  fs.writeFileSync(file + '.tmp', JSON.stringify(card, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}
