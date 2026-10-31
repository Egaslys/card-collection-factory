// Choosing the best version of a card by eye (the author's decision, 2026-10-31): when a card has several versions,
// the vision model sees them all at once, with what the style's checks and its earlier look found in each, and names
// the best with a short reason. What can be seen in a picture — a drawing error, the wrong subject, a thing nobody
// ordered — outweighs a measured style FAIL; the prompt says so (settings card.pick). The card loop asks after a run
// that made a new version (core/card/make.js), within the run's spend cap; without an answer the program's own order
// (make.js rankAttempts) stands.
import { findingsOf } from './fix.js';
import { orderWords } from './look.js';

/** @typedef {import('./card-file.js').Attempt} Attempt */
/** @typedef {import('./card-file.js').PickRecord} PickRecord */
/** @typedef {import('./look.js').ImageRef} ImageRef */

/**
 * @typedef {object} PickSettings  settings/defaults.json → card.pick
 * @property {boolean} use  ask when a run leaves the card with two versions or more
 * @property {number} maxVersions  the most versions shown at once: the best ones by the program's order
 * @property {number} maxTokens  per answer (the model's thinking counts in it)
 * @property {string} template  {title} {order} {count} {versions}
 * @property {string} version  one version's block: {n} {findings} {wish}
 * @property {string} wish  {wish}: the person's words a version was drawn with
 * @property {string} clean  what a version's block says when nothing was found in it
 */

/**
 * The prompt of the choice.
 * @param {{title: string, order: string, versions: {n: number, attempt: Attempt}[], settings: PickSettings}} o
 */
export function pickPrompt({ title, order, versions, settings }) {
  const blocks = versions.map(({ n, attempt }) => {
    const found = findingsOf(attempt).map(f => `- ${f.text}`).join('\n') || settings.clean;
    return settings.version.replace('{n}', () => String(n)).replace('{findings}', () => found)
      .replace('{wish}', () => (attempt.wish ? settings.wish.replace('{wish}', () => String(attempt.wish)) : ''));
  }).join('\n\n');
  return settings.template.replace('{title}', () => title).replace('{order}', () => order)
    .replace('{count}', () => String(versions.length)).replace('{versions}', () => blocks);
}

/**
 * The answer: {"best": n, "reason": "..."} as the first JSON object of the text; null when it is not there.
 * @param {string} text @returns {{best: number, reason: string}|null}
 */
export function parsePick(text) {
  const s = String(text), from = s.indexOf('{'), to = s.lastIndexOf('}');
  try {
    const j = from >= 0 && to > from ? JSON.parse(s.slice(from, to + 1)) : null;
    const best = Number(j?.best);
    return Number.isInteger(best) ? { best, reason: typeof j.reason === 'string' ? j.reason.trim() : '' } : null;
  } catch { return null; }
}

/**
 * Asks the vision model which version is the best. A failed call or an unusable answer gives `best` null with
 * `error`, never a throw: the choice by eye informs the loop, it never stops it.
 * @param {object} o
 * @param {{n: number, attempt: Attempt, image: ImageRef}[]} o.versions  in the program's order, best first
 * @param {import('../style/card-order.js').CardOrder} o.order
 * @param {string} o.model  recorded
 * @param {PickSettings} o.settings
 * @param {import('./look.js').LookSettings} o.look  the order's words are built as the look builds them
 * @param {(req: {prompt: string, images: (ImageRef & {label: string})[], maxTokens: number}) => Promise<{text: string, cost: number|null}>} o.ask
 * @param {Parameters<typeof orderWords>[0]['buildPrompt']} [o.buildPrompt]
 * @returns {Promise<{record: PickRecord, prompt: string, text: string|null}>}
 */
export async function pickVersion({ versions, order, model, settings, look, ask, buildPrompt }) {
  const ns = versions.map(v => v.n);
  let prompt = '', r;
  try {
    prompt = pickPrompt({ title: String(order.title ?? ''), order: await orderWords({ order, settings: look, ...(buildPrompt ? { buildPrompt } : {}) }), versions, settings });
    r = await ask({ prompt, images: versions.map(v => ({ ...v.image, label: `Version ${v.n}:` })), maxTokens: settings.maxTokens });
  } catch (/** @type {any} */ e) {
    return { record: { ns, best: null, model, cost: typeof e?.cost === 'number' ? e.cost : 0, error: String(e?.message ?? e) }, prompt, text: null };
  }
  const answer = parsePick(r.text);
  const cost = r.cost ?? 0;
  if (!answer || !ns.includes(answer.best)) return { record: { ns, best: null, model, cost, error: `the vision model named no version of ${ns.join(', ')}` }, prompt, text: r.text };
  return { record: { ns, best: answer.best, reason: answer.reason, model, cost }, prompt, text: r.text };
}
