// Text help (VISION.md «Помощь с текстом»): the producer jots rough notes into a free-text field of the editor — a
// collection's description, a set's theme or wishes, a card's wish — and the text model turns them into the finished
// text of that field. Nothing is saved here: the caller puts the text into the field, the person saves it.
// The prompt's words live in the settings (text.help), the model is the factory's text model (textModel below).
import { apiOf, presetOf } from '../providers/preset.js';
import * as factoryStore from '../store/index.js';

/**
 * @typedef {object} TextHelpSettings  settings/defaults.json → text.help
 * @property {number} maxTokens  per answer: the bound of one call's price
 * @property {number} temperature
 * @property {string} template  {what} {form} {context} {notes}
 * @property {Record<string, {what: string, form: string}>} kinds  one entry per field the help serves
 * @property {string} contextLead  the line before the context: it is there to understand the notes, not to be repeated
 * @property {Record<string, string>} context  the words naming each piece of context, by its key ({value})
 */

/**
 * The text model of the factory and how it is called: the API preset's textModel, which also writes the set plans,
 * with the reasoning and timeout of settings set.plan.
 * @param {any} settings
 * @returns {{model: string, reasoning: Record<string, unknown>|null, timeoutMs: number}}
 */
export function textModel(settings) {
  const p = settings.set.plan;
  return { model: presetOf(settings.provider).textModel, reasoning: p.reasoning ?? null, timeoutMs: p.timeoutMs };
}

/**
 * The prompt for one field: what the text is, its form, what it belongs to, and the notes as written.
 * @param {{kind: string, notes: string, context?: Record<string, string|undefined>, help: TextHelpSettings}} o
 */
export function draftPrompt({ kind, notes, context = {}, help }) {
  const k = help.kinds[kind];
  if (!k) throw new Error(`Помощь с текстом не знает поля «${kind}»: есть ${Object.keys(help.kinds).join(', ')}.`);
  const lines = Object.entries(context)
    .filter(([key, v]) => typeof v === 'string' && v.trim() && help.context[key])
    .map(([key, v]) => help.context[key].replace('{value}', () => String(v).trim()));
  return help.template.replace('{what}', () => k.what).replace('{form}', () => k.form)
    .replace('{context}', () => (lines.length ? [help.contextLead, ...lines].join('\n') : '')).replace('{notes}', () => notes);
}

/**
 * Turns rough notes into the finished text of one field with the text model, and records the call's cost in the
 * factory's spend (core/store recordSpend: kind text, for the collection when given).
 * @param {object} o
 * @param {string} o.kind  a key of settings text.help.kinds: collection, setTheme, wishes, cardWish, cardsTheme
 * @param {string} o.notes  the person's words, as typed
 * @param {Record<string, string|undefined>} [o.context]  what the text belongs to: collection, description, set, card
 * @param {string|null} [o.collectionId]  the collection the spend counts for; none for a collection not made yet
 * @param {any} o.settings
 * @param {string} o.apiKey
 * @param {typeof import('../providers/gemini.js').complete} [o.complete]  tests (default: the preset's)
 * @param {Pick<typeof factoryStore, 'recordSpend'>} [o.store]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function draftText({ kind, notes, context, collectionId = null, settings, apiKey, complete, store = factoryStore }) {
  const rough = typeof notes === 'string' ? notes.trim() : '';
  if (!rough) throw new Error('Поле пустое: напишите мысли как есть, модель сформулирует из них текст.');
  const help = /** @type {TextHelpSettings} */ (settings.text.help);
  const prompt = draftPrompt({ kind, notes: rough, context, help });
  const m = textModel(settings);
  const or = presetOf(settings.provider);
  const r = await (complete ?? apiOf(or.name).complete)({
    endpoint: or.endpoint, apiKey, prices: or.prices, model: m.model, messages: [{ role: 'user', content: prompt }], maxTokens: help.maxTokens, temperature: help.temperature,
    ...(m.reasoning ? { reasoning: m.reasoning } : {}), net: { timeoutMs: m.timeoutMs, retries: or.retries, backoffMs: or.backoffMs },
  });
  await store.recordSpend(collectionId, { kind: 'text', what: 'text-help', model: m.model, usd: r.cost });
  const text = r.text.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').replace(/^«(.*)»$/s, '$1').trim();
  if (!text) throw new Error('Текстовая модель ответила пустым текстом: попробуйте ещё раз.');
  return { text, model: m.model, cost: r.cost };
}
