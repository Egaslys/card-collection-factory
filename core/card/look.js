// The vision model looks at a finished card (VISION.md «Смотрящая модель» and the adequacy check of «Агентский
// режим»): is the picture what the order asked for — the subject the caption names, the staging and the backdrop, the
// characters' costume — and does it hold nothing that was not ordered and that the thing does not have (faces or
// eyes on fish and objects, extra things, text)? The order's words are the prompt the program assembles from the
// bible (core/style buildPrompt) plus the person's wish; the model also answers the style's checklist for eyes — the
// attempt's `visual` list from the style's checker, the bible's one list — item by item.
// A "no" to an order question of a kind in settings → look.blocking makes the loop regenerate (core/card/make.js);
// checklist answers and the other kinds go to the report. The person's word outranks the rules: what the order or the
// wish asks for is part of the order the model reads, so it is not an addition.
import { buildPrompt as styleBuildPrompt } from '../style/prompt.js';

/** @typedef {import('../style/card-order.js').CardOrder} CardOrder */
/** @typedef {import('./card-file.js').LookIssue} LookIssue */
/** @typedef {import('./card-file.js').LookRecord} LookRecord */
/** @typedef {{bytes?: Uint8Array, path?: string, mime?: string}} ImageRef */
/** @typedef {{id: string, doc?: string, check?: number|string, what: string}} VisualItem  an item of the style's checklist for eyes */

/**
 * @typedef {object} LookSettings  settings/defaults.json → look
 * @property {boolean} use  look at every attempt when the vision model can be asked (a key is there)
 * @property {number} maxTokens  per answer
 * @property {Record<string, unknown>|null} reasoning  the request's `reasoning` field for the look; null = settings → vision's
 * @property {string[]} blocking  the order questions (keys of prompt.questions) whose "no" makes the loop regenerate
 * @property {{template: string, wish: string, questions: Record<string, string>, answer: string}} prompt
 *   template: {title} {order} {questions} {checklist} {answer}; wish: {wish}; answer: {json}
 */

/**
 * What the order asks for, in the words the image model got: the assembled prompt without its note on the attached
 * reference images (the vision model sees only the card), plus the person's wish.
 * @param {{order: CardOrder, wish?: string, settings: LookSettings, buildPrompt?: typeof styleBuildPrompt}} o
 */
export async function orderWords({ order, wish, settings, buildPrompt = styleBuildPrompt }) {
  const built = await buildPrompt(order);
  const text = built.sections.length ? built.sections.filter(s => s.name !== 'references').map(s => s.text).join('\n\n') : built.prompt;
  return wish ? `${text}\n\n${settings.prompt.wish.replace('{wish}', () => wish)}` : text;
}

/**
 * The prompt of the look.
 * @param {{title: string, order: string, visual: VisualItem[], settings: LookSettings}} o
 */
export function lookPrompt({ title, order, visual, settings }) {
  const p = settings.prompt;
  const questions = Object.entries(p.questions).map(([k, q]) => `${k}: ${q}`).join('\n');
  const checklist = visual.map(v => `${v.id}: ${v.what}`).join('\n');
  const json = `{"seen": "...", "defects": ["..."], "differences": ["..."], ${Object.keys(p.questions).map(k => `"${k}": {"ok": true or false, "why": "..."}`).join(', ')}, "checklist": [{"id": "...", "why": "..."}]}`;
  return p.template.replace('{title}', () => title).replace('{order}', () => order).replace('{questions}', () => questions)
    .replace('{checklist}', () => checklist || '(none)').replace('{answer}', () => p.answer.replace('{json}', () => json));
}

/**
 * The answer as an object: the first JSON object in the text (code fences and words around it are ignored); when
 * that is not valid JSON (the model was seen to drop a brace), the fields are read one by one — `"seen"`, each
 * `"<kind>": {"ok": …, "why": "…"}` and each `{"id": "…", "why": "…"}` of the checklist. Null when nothing is found.
 * @param {string} text @param {string[]} [kinds]  the order questions to read field by field
 * @returns {any}
 */
export function parseAnswer(text, kinds = []) {
  const s = String(text), from = s.indexOf('{'), to = s.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { return JSON.parse(s.slice(from, to + 1)); } catch { /* read field by field */ }
  const str = '"((?:[^"\\\\]|\\\\.)*)"';
  /** @type {Record<string, any>} */
  const out = {};
  const seen = s.match(new RegExp(`"seen"\\s*:\\s*${str}`));
  if (seen) out.seen = seen[1];
  for (const k of kinds) {
    const m = s.match(new RegExp(`"${k}"\\s*:\\s*\\{\\s*"ok"\\s*:\\s*(true|false|null)\\s*(?:,\\s*"why"\\s*:\\s*${str})?`));
    if (m) out[k] = { ok: JSON.parse(m[1]), why: m[2] ?? '' };
  }
  const at = s.indexOf('"checklist"');
  if (at >= 0) out.checklist = [...s.slice(at).matchAll(new RegExp(`"id"\\s*:\\s*${str}\\s*,\\s*"why"\\s*:\\s*${str}`, 'g'))].map(m => ({ id: m[1], why: m[2] }));
  return Object.keys(out).length ? out : null;
}

/**
 * The problems in a parsed answer: every order question answered `ok: false` (blocking when its kind is in
 * settings.blocking), and every checklist item of the list that the answer names as not holding (not blocking);
 * `seen`: how the model names the main subject.
 * @param {any} answer @param {VisualItem[]} visual @param {LookSettings} settings
 * @returns {{verdict: LookRecord['verdict'], issues: LookIssue[], seen?: string, error?: string}}
 */
export function issuesOf(answer, visual, settings) {
  if (!answer || typeof answer !== 'object') return { verdict: 'unknown', issues: [], error: 'the answer is not JSON' };
  const seen = typeof answer.seen === 'string' && answer.seen.trim() ? { seen: answer.seen.trim() } : {};
  const kinds = Object.keys(settings.prompt.questions);
  // a question left out (the costume of a card without characters, typically) is not a problem; none answered is
  const answered = kinds.filter(k => typeof answer[k]?.ok === 'boolean' || answer[k]?.ok === null);
  /** @type {LookIssue[]} */
  const issues = [];
  /** @param {any} a @param {string} fallback */
  const why = (a, fallback) => (typeof a?.why === 'string' && a.why.trim() ? a.why.trim() : fallback);
  for (const k of kinds) if (answer[k]?.ok === false) issues.push({ kind: k, what: why(answer[k], 'no reason given'), blocking: settings.blocking.includes(k) });
  const ids = new Set(visual.map(v => v.id));
  for (const c of Array.isArray(answer.checklist) ? answer.checklist : []) {
    if (c && c.ok !== true && ids.has(c.id)) issues.push({ kind: 'checklist', id: String(c.id), what: why(c, 'no reason given'), blocking: false });
  }
  if (!answered.length) return { verdict: 'unknown', issues, ...seen, error: 'no question answered' };
  return { verdict: issues.length ? 'fix' : 'ok', issues, ...seen };
}

/**
 * Asks the vision model about one card. A failed call or an unusable answer gives verdict "unknown" with `error`,
 * never a throw: the look informs, it never stops the loop.
 * @param {object} o
 * @param {ImageRef} o.image  the card as checked
 * @param {CardOrder} o.order
 * @param {VisualItem[]} o.visual  the style's checklist for eyes of this attempt (check.json `visual`)
 * @param {string} [o.wish]  the person's words of this attempt
 * @param {string} o.model  recorded
 * @param {LookSettings} o.settings
 * @param {(req: {prompt: string, image: ImageRef, maxTokens: number, reasoning?: Record<string, unknown>}) => Promise<{text: string, cost: number|null}>} o.ask
 * @param {typeof styleBuildPrompt} [o.buildPrompt]
 * @returns {Promise<{record: LookRecord, prompt: string, text: string|null}>}  text: the model's answer as given
 */
export async function lookAtCard({ image, order, visual, wish, model, settings, ask, buildPrompt = styleBuildPrompt }) {
  let prompt = '', r;
  try {
    // the order may no longer assemble (a rule changed since the card was made): then there is nothing to compare with
    prompt = lookPrompt({ title: String(order.title ?? ''), order: await orderWords({ order, wish, settings, buildPrompt }), visual, settings });
    r = await ask({ prompt, image, maxTokens: settings.maxTokens, ...(settings.reasoning ? { reasoning: settings.reasoning } : {}) });
  } catch (/** @type {any} */ e) {
    // a paid answer of no use (no text) still costs: the provider's error carries its price
    const errorKind = e?.kind === 'auth' || e?.kind === 'billing' ? { errorKind: /** @type {'auth'|'billing'} */ (e.kind) } : {};
    return { record: { model, verdict: 'unknown', issues: [], cost: typeof e?.cost === 'number' ? e.cost : 0, error: String(e?.message ?? e), ...errorKind }, prompt, text: null };
  }
  const { verdict, issues, seen, error } = issuesOf(parseAnswer(r.text, Object.keys(settings.prompt.questions)), visual, settings);
  return { record: { model, verdict, issues, ...(seen ? { seen } : {}), cost: r.cost ?? 0, ...(error ? { error } : {}) }, prompt, text: r.text };
}
