// Picks the style's reference cards to attach to a generation request: the cards whose staging is
// closest to the order (weights, count and excluded cards: `references` of prompt-assembly.json),
// or the cards the order names in `references`.
import { castNames, joinNames, stagingValue } from './assembly.js';
import { fillSlots, sentence } from './fragments.js';

/** @typedef {import('./style.js').Style} Style */
/** @typedef {import('./style.js').ReferenceCard} ReferenceCard */
/** @typedef {import('./card-order.js').CardOrder} CardOrder */

/**
 * Score of a reference card for an order: the sum of the weights of the staging fields that are
 * equal, plus the `cast` weight per scene character shown on the card.
 * @param {ReferenceCard} card
 * @param {CardOrder} order
 * @param {Style} style
 */
export function referenceScore(card, order, style) {
  const { weights } = style.assembly.references;
  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (k === 'cast') continue;
    if (card.staging[k] === stagingValue(order, style, k)) score += w;
  }
  const cast = (order.scene?.characters || []).map(c => c.name);
  score += (weights.cast || 0) * cast.filter(n => card.cast.includes(n)).length;
  return score;
}

/**
 * The reference cards for an order: forced by `order.references`, else the `count` best by score
 * (ties: the lower card number), never one of `exclude`.
 * @param {CardOrder} order
 * @param {Style} style
 * @returns {ReferenceCard[]}
 */
export function pickReferences(order, style) {
  const rules = style.assembly.references;
  if (order.references?.length) {
    return order.references.map(n => {
      const card = style.references.find(r => r.ref === n);
      if (!card) throw new Error(`references: нет эталонной карточки №${n}`);
      return card;
    });
  }
  const exclude = new Set(rules.exclude);
  return style.references
    .filter(r => !exclude.has(r.ref))
    .map(r => ({ r, s: referenceScore(r, order, style) }))
    .sort((a, b) => b.s - a.s || a.r.ref - b.r.ref)
    .slice(0, rules.count)
    .map(x => x.r);
}

/**
 * The sentence that tells the model what the attached images are. When every attached card shows
 * every scene character, the character note (keep them as drawn); otherwise the style note.
 * @param {CardOrder} order
 * @param {Style} style
 * @param {ReferenceCard[]} cards
 * @returns {string|null}
 */
export function referenceNote(order, style, cards) {
  if (!cards.length) return null;
  const rules = style.assembly.references;
  const cast = (order.scene?.characters || []).map(c => c.name);
  const showsCast = cast.length > 0 && cards.every(card => cast.every(n => card.cast.includes(n)));
  const images = cards.length === 1 ? 'Image 1' : `Images 1–${cards.length}`;
  /** @type {Record<string, string>} */
  const values = { images, who: joinNames(castNames(order, style)) };
  const { text } = fillSlots(showsCast ? rules.note_cast : rules.note_style, { named: k => values[k], chosen: new Map() });
  return sentence(text);
}
