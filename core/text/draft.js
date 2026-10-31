// Text help (VISION.md «Помощь с текстом»): the producer jots rough notes into a free-text field of the editor — a
// collection's description, a set's theme or wishes, a card's wish — and the text model turns them into the finished
// text of that field. An empty field gets a text proposed from what it belongs to (the collection's title and
// description, the set's place and theme): a start the person edits. Nothing is saved here: the caller puts the text
// into the field, the person saves it.
// The prompt's words live in the settings (text.help), the model is the factory's text model (textModel below).
import { apiOf, presetOf } from '../providers/preset.js';
import * as factoryStore from '../store/index.js';
import { saidError } from '../say.js';

/**
 * @typedef {object} TextHelpSettings  settings/defaults.json → text.help
 * @property {number} maxTokens  per answer: the bound of one call's price
 * @property {number} temperature
 * @property {string} template  {what} {form} {context} {notes}
 * @property {string} propose  an empty field: {what} {form} {context} {language}
 * @property {string} proposeLead  the line before the context of a proposal: the text is built from it
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
  return { model: presetOf(settings.provider).textModel, ...textCallOptions(settings) };
}

/**
 * How the text model is asked, apart from which model it is: the reasoning and timeout of settings set.plan.
 * @param {any} settings
 * @returns {{reasoning: Record<string, unknown>|null, timeoutMs: number}}
 */
export function textCallOptions(settings) {
  const p = settings.set.plan;
  return { reasoning: p.reasoning ?? null, timeoutMs: p.timeoutMs };
}

/** @param {Record<string, string|undefined>} context @param {TextHelpSettings} help  the context's lines the help knows */
const contextLines = (context, help) => Object.entries(context)
  .filter(([key, v]) => typeof v === 'string' && v.trim() && help.context[key])
  .map(([key, v]) => help.context[key].replace('{value}', () => String(v).trim()));

/**
 * The prompt for one field: what the text is, its form, what it belongs to, and the notes as written; with no notes,
 * the proposal of the text from what it belongs to, in `language` (its name).
 * @param {{kind: string, notes: string, context?: Record<string, string|undefined>, help: TextHelpSettings, language?: string}} o
 */
export function draftPrompt({ kind, notes, context = {}, help, language = 'Russian' }) {
  const k = help.kinds[kind];
  if (!k) throw new Error(`Помощь с текстом не знает поля «${kind}»: есть ${Object.keys(help.kinds).join(', ')}.`);
  const lines = contextLines(context, help);
  if (!notes) {
    return help.propose.replace('{what}', () => k.what).replace('{form}', () => k.form).replace('{language}', () => language)
      .replace('{context}', () => [help.proposeLead, ...lines].join('\n'));
  }
  return help.template.replace('{what}', () => k.what).replace('{form}', () => k.form)
    .replace('{context}', () => (lines.length ? [help.contextLead, ...lines].join('\n') : '')).replace('{notes}', () => notes);
}

/**
 * Turns rough notes into the finished text of one field with the text model — or, when the field is empty, proposes
 * the text from what it belongs to — and records the call's cost in the factory's spend (core/store recordSpend: kind
 * text, for the collection when given).
 * @param {object} o
 * @param {string} o.kind  a key of settings text.help.kinds: collection, setTheme, wishes, cardWish, cardsTheme
 * @param {string} o.notes  the person's words, as typed; empty = propose the text from `context`
 * @param {Record<string, string|undefined>} [o.context]  what the text belongs to: the keys of settings
 *   text.help.context (collection, description, place, set, card)
 * @param {string} [o.language]  a proposal's language: a key of settings card.fix.languages (default "ru"; the
 *   notes' own language otherwise)
 * @param {string|null} [o.collectionId]  the collection the spend counts for; none for a collection not made yet
 * @param {any} o.settings
 * @param {string} o.apiKey
 * @param {typeof import('../providers/gemini.js').complete} [o.complete]  tests (default: the preset's)
 * @param {Pick<typeof factoryStore, 'recordSpend'>} [o.store]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function draftText({ kind, notes, context = {}, language = 'ru', collectionId = null, settings, apiKey, complete, store = factoryStore }) {
  const rough = typeof notes === 'string' ? notes.trim() : '';
  const help = /** @type {TextHelpSettings} */ (settings.text.help);
  if (!rough && !contextLines(context, help).length) throw saidError('Поле пустое, и предложить текст не из чего: напишите мысли как есть, модель сформулирует из них текст.', 'text.empty');
  const languages = /** @type {Record<string, string>} */ (settings.card.fix.languages);
  if (!rough && !languages[language]) throw new Error(`Язык «${language}» не знаком помощи с текстом: есть ${Object.keys(languages).join(', ')}.`);
  const prompt = draftPrompt({ kind, notes: rough, context, help, language: languages[language] });
  const m = textModel(settings);
  const or = presetOf(settings.provider);
  /** @type {{text: string, cost: number|null}} */
  let r;
  try {
    r = await (complete ?? apiOf(or.name).complete)({
      endpoint: or.endpoint, apiKey, prices: or.prices, model: m.model, messages: [{ role: 'user', content: prompt }], maxTokens: help.maxTokens, temperature: help.temperature,
      ...(m.reasoning ? { reasoning: m.reasoning } : {}), net: { timeoutMs: m.timeoutMs, retries: or.retries, backoffMs: or.backoffMs },
    });
  } catch (e) {
    // a call answered and paid but of no use (ProviderError cost): its price still counts
    const cost = /** @type {any} */ (e)?.cost;
    if (typeof cost === 'number' && cost > 0) await store.recordSpend(collectionId, { kind: 'text', what: 'text-help', model: m.model, usd: cost });
    throw e;
  }
  await store.recordSpend(collectionId, { kind: 'text', what: 'text-help', model: m.model, usd: r.cost });
  const text = r.text.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').replace(/^«(.*)»$/s, '$1').trim();
  if (!text) throw saidError('Текстовая модель ответила пустым текстом: попробуйте ещё раз.', 'text.noAnswer');
  return { text, model: m.model, cost: r.cost };
}
