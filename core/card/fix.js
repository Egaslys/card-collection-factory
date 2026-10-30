// Learning from a failed picture (the author's review, 2026-10-31: «Сделать заново» must by itself take into account
// why the picture failed, and a wish must not be required). The findings of an attempt — the style's FAILs and what
// the vision model saw — go to the text model of the settings with the prompt the attempt was drawn from; it writes a
// correction in plain positive sentences that is added at the end of the same prompt for the next picture (`writeFix`),
// or, for the editor's text help, a wish the person can read, edit and send (`proposeWish`). The prompts' words are in
// settings card.fix; the model, its reasoning and its timeout are the text help's (core/text/draft.js textModel).
// The card loop calls writeFix before each new attempt of a run whose last attempt failed, and regenerateCard before
// its attempt when the attempt it starts from has findings (core/card/make.js).

/** @typedef {import('./card-file.js').Attempt} Attempt */

/**
 * @typedef {object} FixSettings  settings/defaults.json → card.fix
 * @property {boolean} use  write a correction before a new attempt when the last one has findings
 * @property {number} maxTokens  per answer (the model's thinking counts in it)
 * @property {string} template  {prompt} {findings} {previous} {wish}
 * @property {string} previous  {fix}: the correction the failed attempt already had
 * @property {string} wish  {wish}: the person's words of the new attempt
 * @property {string} propose  the editor's proposed wish: {language} {notes} {title} {prompt} {findings}
 * @property {string} proposeNotes  {notes}: the person's rough notes, when there are any
 * @property {Record<string, string>} languages  a language code → its name in the prompt
 */

/**
 * The text call of a run: the preset's text model with the key bound (make.js textFrom); `model`: its id.
 * @typedef {((req: {messages: {role: 'system'|'user'|'assistant', content: string}[], maxTokens: number, json?: boolean, reasoning?: Record<string, unknown>, timeoutMs: number}) => Promise<{text: string, cost: number|null}>) & {model: string}} TextCall
 */

/**
 * @typedef {object} Finding
 * @property {boolean} must  it made the attempt fail (a blocking FAIL, a blocking problem the vision model saw)
 * @property {string} text  one line for the text model
 */

/** @param {unknown} v */
const shown = v => (v == null ? 'n/a' : typeof v === 'number' ? String(+v.toFixed(3)) : Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

/**
 * What an attempt's checks and look found: every FAIL the style's checks made (but those resting on a hero outline
 * nobody confirmed: they may be the outline's fault) and everything the vision model named. Empty for a clean attempt.
 * @param {Attempt} attempt
 * @returns {Finding[]}
 */
export function findingsOf(attempt) {
  /** @type {Finding[]} */
  const out = [];
  for (const f of attempt.check?.fails ?? []) {
    if (f.needsMask) continue;
    out.push({ must: true, text: `${f.id} — ${f.title}: measured ${shown(f.value)}, wanted ${f.threshold ?? 'n/a'}${f.note ? ` (${f.note})` : ''}` });
  }
  for (const i of attempt.look?.issues ?? []) out.push({ must: i.blocking, text: `${i.kind === 'checklist' ? `style check ${i.id}` : i.kind}: ${i.what}` });
  return out;
}

/** @param {Finding[]} findings */
const listOf = findings => findings.map(f => `- ${f.must ? 'must' : 'also noticed'}: ${f.text}`).join('\n');

/**
 * Asks the text model for one JSON answer and reads `key` out of it; the cost is returned even when the answer is of
 * no use. Never throws for a bad answer: `text` is null then, `error` says why; a failed call throws (a ProviderError
 * carries its cost and kind).
 * @param {{prompt: string, key: string, text: TextCall, settings: FixSettings, model: {reasoning: Record<string, unknown>|null, timeoutMs: number}}} o
 * @returns {Promise<{text: string|null, cost: number|null, skipped?: string[], error?: string}>}
 */
async function ask({ prompt, key, text, settings, model }) {
  const r = await text({ messages: [{ role: 'user', content: prompt }], maxTokens: settings.maxTokens, json: true, ...(model.reasoning ? { reasoning: model.reasoning } : {}), timeoutMs: model.timeoutMs });
  const s = String(r.text), from = s.indexOf('{'), to = s.lastIndexOf('}');
  /** @type {any} */
  let json = null;
  try { json = from >= 0 && to > from ? JSON.parse(s.slice(from, to + 1)) : null; } catch { /* below */ }
  const value = typeof json?.[key] === 'string' ? json[key].trim() : '';
  if (!value) return { text: null, cost: r.cost, error: 'the text model gave no usable answer' };
  return { text: value, cost: r.cost, ...(Array.isArray(json.skipped) ? { skipped: json.skipped.map(String) } : {}) };
}

/**
 * The correction for the next picture: the text model reads the prompt the failed attempt was drawn from (its own
 * correction, if it had one, apart), what was found, and the person's wish, and writes the sentences to add at the
 * end of the prompt. Null text when there is nothing to fix.
 * @param {object} o
 * @param {string} o.prompt  the prompt without any correction (the order's assembled prompt, with the wish if any)
 * @param {Finding[]} o.findings
 * @param {string} [o.previous]  the correction the failed attempt already carried
 * @param {string} [o.wish]  the person's words for the new attempt
 * @param {TextCall} o.text
 * @param {FixSettings} o.settings
 * @param {{reasoning: Record<string, unknown>|null, timeoutMs: number}} o.model  how the text model is asked (draft.js textModel)
 * @returns {Promise<{text: string|null, cost: number|null, skipped?: string[], error?: string}>}
 */
export async function writeFix({ prompt, findings, previous, wish, text, settings, model }) {
  if (!findings.length) return { text: null, cost: 0 };
  const p = settings.template
    .replace('{previous}', () => (previous ? settings.previous.replace('{fix}', () => previous) : ''))
    .replace('{wish}', () => (wish ? settings.wish.replace('{wish}', () => wish) : ''))
    .replace('{prompt}', () => prompt).replace('{findings}', () => listOf(findings));
  return ask({ prompt: p, key: 'fix', text, settings, model });
}

/**
 * A wish for the person to read, edit and send (the editor's text help on a card's wish field): from the card's
 * order and the findings of the attempt, with the person's rough notes first when there are any.
 * @param {object} o
 * @param {string} o.title  the card's caption
 * @param {string} o.prompt  what the picture was ordered to show (the attempt's prompt)
 * @param {Finding[]} o.findings
 * @param {string} [o.notes]
 * @param {string} o.language  a key of settings languages
 * @param {TextCall} o.text @param {FixSettings} o.settings @param {{reasoning: Record<string, unknown>|null, timeoutMs: number}} o.model
 * @returns {Promise<{text: string|null, cost: number|null, error?: string}>}
 */
export async function proposeWish({ title, prompt, findings, notes, language, text, settings, model }) {
  const lang = settings.languages[language];
  if (!lang) throw new Error(`Язык «${language}» не знаком подсказке: есть ${Object.keys(settings.languages).join(', ')}.`);
  const p = settings.propose.replace('{language}', () => lang)
    .replace('{notes}', () => (notes?.trim() ? settings.proposeNotes.replace('{notes}', () => notes.trim()) : ''))
    .replace('{title}', () => title).replace('{prompt}', () => prompt)
    .replace('{findings}', () => (findings.length ? listOf(findings) : '(nothing: the picture passed its checks)'));
  return ask({ prompt: p, key: 'wish', text, settings, model });
}
