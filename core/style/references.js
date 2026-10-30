// Picks the style's reference cards to attach to a generation request: the cards whose staging is
// closest to the order (weights, count and excluded cards: `references` of prompt-assembly.json),
// or the cards the order names in `references`; for a scene with characters also the characters' anchor
// portraits (`references.anchors` of prompt-assembly.json), which come first.
import path from 'node:path';
import { castNames, castOf, joinNames, matches, stagingValue } from './assembly.js';
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
  const cast = castOf(order).map(c => c.name);
  score += (weights.cast || 0) * cast.filter(n => card.cast.includes(n)).length;
  return score;
}

/**
 * The anchor portraits to attach to an order: one per distinct character of the scene when the order
 * matches `references.anchors.when` (the rules' scene condition); none for an order of another kind
 * (a character sheet makes the anchor, it does not use one) or when the style has no anchors rules.
 * @param {CardOrder} order
 * @param {Style} style
 * @returns {{name: string, path: string}[]}
 */
export function pickAnchors(order, style) {
  const rules = style.assembly.references.anchors;
  if (!rules || order.kind || !matches(rules.when, order, style)) return [];
  const names = [...new Set(castOf(order).map(c => c.name))];
  return names.slice(0, rules.max_images).map(name => ({ name, path: path.join(style.dir, rules.dir, rules.file.replace('{name}', () => name)) }));
}

/**
 * The reference cards for an order: forced by `order.references`, else the `count` best by score
 * (ties: the lower card number), never one of `exclude` (nor of an `exclude_when` the order matches); with anchors, no more than `max_images` in all.
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
  if (order.kind && style.assembly.kinds?.[order.kind]?.references === 'anchor_frames') {
    return castOf(order).flatMap(c => style.assembly.cast[c.name]?.anchor_frames ?? []).map(n => {
      const card = style.references.find(r => r.ref === n);
      if (!card) throw new Error(`cast: опорный кадр №${n} не найден среди эталонных карточек`);
      return card;
    });
  }
  const exclude = new Set([...rules.exclude, ...(rules.exclude_when ?? []).filter(x => matches(x.when, order, style)).flatMap(x => x.refs)]);
  const room = rules.anchors ? rules.anchors.max_images - pickAnchors(order, style).length : Infinity;
  return style.references
    .filter(r => !exclude.has(r.ref))
    .map(r => ({ r, s: referenceScore(r, order, style) }))
    .sort((a, b) => b.s - a.s || a.r.ref - b.r.ref)
    .slice(0, Math.min(rules.count, room))
    .map(x => x.r);
}

/**
 * The text that tells the model what the attached images are (the anchors, if any, are Image 1…, then
 * the cards). With anchors: one sentence per anchor and one for the style cards (`references.anchors`);
 * else, when every attached card shows every scene character, the character note (keep them as drawn);
 * otherwise the style note.
 * @param {CardOrder} order
 * @param {Style} style
 * @param {ReferenceCard[]} cards
 * @returns {string|null}
 */
export function referenceNote(order, style, cards) {
  const rules = style.assembly.references;
  const anchors = pickAnchors(order, style);
  if (!cards.length && !anchors.length) return null;
  /** @param {string} template @param {Record<string, string>} values */
  const fill = (template, values) => fillSlots(template, { named: k => values[k], chosen: new Map() }).text;
  const span = (/** @type {number} */ from, /** @type {number} */ n) => (n === 1 ? `Image ${from}` : `Images ${from}–${from + n - 1}`);
  const a = rules.anchors;
  if (a && anchors.length) {
    const who = new Map(castOf(order).map((c, i) => [c.name, castNames(order, style)[i]]));
    const parts = anchors.map((x, i) => fill(a.note_anchor, { n: String(i + 1), who: who.get(x.name) ?? x.name }));
    if (cards.length) parts.push(fill(a.note_style, { images: span(anchors.length + 1, cards.length) }));
    return sentence(`${a.intro} ${parts.join(' ')}`);
  }
  const cast = castOf(order).map(c => c.name);
  const showsCast = cast.length > 0 && cards.every(card => cast.every(n => card.cast.includes(n)));
  /** @type {Record<string, string>} */
  const values = { images: span(1, cards.length), who: joinNames(castNames(order, style)) };
  return sentence(fill(showsCast ? rules.note_cast : rules.note_style, values));
}
