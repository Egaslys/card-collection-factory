// buildPrompt: the image-model prompt of one card, assembled by the program from the style
// bible's fragments (docs/plans/VISION.md, the image source section). The agent gives the staging and the
// English words; `promptExtra` is appended, `promptOverride` replaces the assembled text.
import { assemble } from './assembly.js';
import { checkOrder } from './card-order.js';
import { pickAnchors, pickReferences, referenceNote } from './references.js';
import { loadStyle, styleDirOf } from './style.js';

/** @typedef {import('./card-order.js').CardOrder} CardOrder */
/** @typedef {import('./assembly.js').UsedFragment} UsedFragment */

/** An order the program cannot assemble; `errors` are readable (Russian) and name the field to fix. */
export class OrderError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super('Заказ карточки не годится:\n- ' + errors.join('\n- '));
    this.name = 'OrderError';
    this.errors = errors;
  }
}

/**
 * @typedef {object} BuiltPrompt
 * @property {string} prompt  the text for the image model
 * @property {UsedFragment[]} fragments  the bible fragments in it, in order: id and `FILE.md:line`
 *   (labelled items as `id[label]`; glue templates as id "template"); empty with promptOverride
 * @property {{path: string, ref?: number, anchor?: string}[]} references  images to attach, absolute paths, in the
 *   order the prompt numbers them (Image 1, Image 2, …): first the characters' anchor portraits of a scene
 *   (`anchor` = the character), then the style reference cards (`ref` = the card number)
 * @property {{name: string, text: string}[]} sections  the prompt by sections: the rules' sections
 *   (format, subject, staging, cast, backdrop, composition, colour, rendering), then references and extra
 * @property {string|null} legend  what the attached images are, as the prompt says it (its «references» section);
 *   null when nothing is attached or the prompt is the order's own (promptOverride). The card loop hands it to a
 *   provider that writes its own legend (Codex), so the provider does not contradict the prompt.
 */

/**
 * Assembles the prompt of a card. Throws OrderError when the order is invalid.
 * @param {CardOrder} order
 * @param {{styleDir?: string}} [opts]  default: styles/<order.style>
 * @returns {Promise<BuiltPrompt>}
 */
export async function buildPrompt(order, { styleDir } = {}) {
  if (!styleDir && typeof order?.style !== 'string') throw new OrderError(['нет поля style (имя папки стиля)']);
  const style = loadStyle(styleDir || styleDirOf(order.style));
  const errors = checkOrder(order, style);
  if (errors.length) throw new OrderError(errors);
  const cards = pickReferences(order, style);
  const references = [...pickAnchors(order, style).map(a => ({ path: a.path, anchor: a.name })), ...cards.map(c => ({ path: c.path, ref: c.ref }))];
  if (order.promptOverride) return { prompt: order.promptOverride.trim(), fragments: [], references, sections: [], legend: null };

  const { sections } = assemble(order, style);
  const out = sections.map(s => ({ name: s.name, text: s.text }));
  const note = referenceNote(order, style, cards);
  if (note) out.push({ name: 'references', text: note });
  if (order.promptExtra) out.push({ name: 'extra', text: order.promptExtra.trim() });
  return {
    prompt: out.map(s => s.text).join('\n\n'),
    fragments: sections.flatMap(s => s.fragments),
    references,
    sections: out,
    legend: note,
  };
}
