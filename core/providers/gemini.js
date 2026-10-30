// Gemini API (Google AI Studio) provider: images, vision and text through generateContent, behind the same contracts as
// openrouter.js (generateImage, askVision) and openrouter-text.js (complete). Sources, checked 2026-10-30:
// - ai.google.dev/api/generate-content: POST {endpoint}/models/{model}:generateContent; contents[].parts (text,
//   inlineData {mimeType, data}); generationConfig (responseModalities, imageConfig {aspectRatio, imageSize},
//   responseMimeType, maxOutputTokens, thinkingConfig.thinkingLevel MINIMAL | LOW | MEDIUM | HIGH); the answer's
//   candidates[0].content.parts (thought parts are the model's thinking), finishReason, promptFeedback.blockReason,
//   usageMetadata (promptTokenCount, candidatesTokenCount, thoughtsTokenCount, candidatesTokensDetails by modality).
// - ai.google.dev/gemini-api/docs/api-key: the key goes in the x-goog-api-key header.
// - ai.google.dev/gemini-api/docs/troubleshooting: Gemini 3.6+ ignore temperature (400 in a future release) — so no
//   temperature is ever sent; retry only 429 and 5xx.
// - ai.google.dev/gemini-api/docs/pricing: prices per 1M tokens; the answer carries no cost, so it is computed here
//   from usageMetadata and the prices the caller gives (settings provider.google.prices).
// Google's docs now recommend the Interactions API for new projects and call generateContent legacy but fully
// supported; both models of the preset list generateContent in GET /v1beta/models (supportedGenerationMethods).
import { ProviderError, readImage, request } from './openrouter.js';

/** @typedef {import('./openrouter.js').NetOptions} NetOptions */
/** @typedef {import('./openrouter-text.js').ChatMessage} ChatMessage */
/** @typedef {{until?: string, input: number, output: number, imageOutput?: number}} PricePeriod  USD per 1M tokens; until = the last day (UTC, YYYY-MM-DD) the price holds */
/** @typedef {Record<string, PricePeriod[]|string>} Prices  per model id: its price periods in order (the last has no `until`); a string = the source note */

const AUTH = 'x-goog-api-key';

/** @param {unknown} text @param {string} apiKey */
const redact = (text, apiKey) => (apiKey ? String(text).split(apiKey).join('[ключ скрыт]') : String(text));

/**
 * The price of a model on a day: the first period whose `until` is not past.
 * @param {Prices|undefined} prices @param {string} model @param {Date} [now]
 * @returns {PricePeriod|null}
 */
export function priceOf(prices, model, now = new Date()) {
  const periods = prices?.[model];
  if (!Array.isArray(periods)) return null;
  const day = now.toISOString().slice(0, 10);
  return periods.find(p => !p.until || day <= p.until) ?? null;
}

/**
 * USD of one answer from its usageMetadata: prompt tokens at the input price, image tokens of the answer at the image
 * price, the rest of the answer and the thinking at the output price. null when the model has no price.
 * @param {any} usage @param {PricePeriod|null} price
 * @returns {number|null}
 */
export function costOf(usage, price) {
  if (!price || !usage) return null;
  const image = (usage.candidatesTokensDetails ?? []).filter((/** @type {any} */ d) => d.modality === 'IMAGE').reduce((/** @type {number} */ s, /** @type {any} */ d) => s + (d.tokenCount ?? 0), 0);
  const out = (usage.candidatesTokenCount ?? 0) - image + (usage.thoughtsTokenCount ?? 0);
  const usd = ((usage.promptTokenCount ?? 0) * price.input + out * price.output + image * (price.imageOutput ?? price.output)) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/** @param {Record<string, any>} a @param {Record<string, any>} b  b over a; plain objects merge one level deep */
const over = (a, b) => {
  /** @type {Record<string, any>} */
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? { ...out[k], ...v } : v;
  return out;
};

/** The reasoning setting (OpenRouter's shape, {effort}) as Gemini's thinkingConfig. @param {Record<string, unknown>|undefined} reasoning */
const thinkingOf = reasoning => (typeof reasoning?.effort === 'string' ? { thinkingConfig: { thinkingLevel: reasoning.effort.toUpperCase() } } : {});

/**
 * One generateContent call.
 * @param {{endpoint: string, apiKey: string, model: string, body: object, net?: NetOptions}} o
 */
const generate = ({ endpoint, apiKey, model, body, net = {} }) =>
  request({ endpoint, apiKey, auth: AUTH, method: 'POST', route: `/models/${encodeURIComponent(model)}:generateContent`, body, ...net });

/** Why an answer has no usable part, in the provider's own words. @param {any} json */
function why(json) {
  const c = json.candidates?.[0];
  const reason = json.promptFeedback?.blockReason ? `запрос заблокирован: ${json.promptFeedback.blockReason}` : c?.finishReason ? `finishReason ${c.finishReason}${c.finishMessage ? ` — ${c.finishMessage}` : ''}` : 'пустой ответ';
  return reason;
}

/** The answer's parts that are not the model's thinking. @param {any} json @returns {any[]} */
const answerParts = json => (json.candidates?.[0]?.content?.parts ?? []).filter((/** @type {any} */ p) => !p.thought);

/**
 * Generates one image (the same contract as openrouter.js generateImage).
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model @param {string} o.prompt
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}[]} [o.references] input images, sent after the prompt
 * @param {string} [o.aspectRatio] e.g. "4:5" (generationConfig.imageConfig.aspectRatio)
 * @param {Record<string, unknown>} [o.params] generationConfig fields (imageConfig merged key by key), e.g. {imageConfig: {imageSize: "1K"}}
 * @param {Prices} [o.prices] @param {NetOptions} [o.net]
 * @returns {Promise<{bytes: Buffer, mime: string|undefined, model: string, cost: number|null, usage: object|undefined, raw: {created?: number}}>}
 */
export async function generateImage({ endpoint, apiKey, model, prompt, references = [], aspectRatio, params = {}, prices, net = {} }) {
  const images = await Promise.all(references.map(readImage));
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.base64 } }))] }],
    generationConfig: over({ responseModalities: ['IMAGE'], ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}) }, params),
  };
  const json = await generate({ endpoint, apiKey, model, body, net });
  const img = answerParts(json).filter(p => p.inlineData?.data).at(-1);
  if (!img) throw new ProviderError(`Провайдер ответил без картинки (${redact(why(json), apiKey)}).`, { status: 200, providerMessage: redact(why(json), apiKey) });
  return { bytes: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType, model, cost: costOf(json.usageMetadata, priceOf(prices, model)), usage: json.usageMetadata, raw: {} };
}

/** The text of an answer, or a ProviderError. @param {any} json @param {string} apiKey @param {string} what */
function textOf(json, apiKey, what) {
  const text = answerParts(json).map(p => p.text ?? '').join('');
  if (!text.trim()) throw new ProviderError(`${what} ответила без текста (${redact(why(json), apiKey)}).`, { status: 200, providerMessage: redact(why(json), apiKey) });
  return text;
}

/**
 * Asks a vision model about one image (the same contract as openrouter.js askVision): the text first, then the image.
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model @param {string} o.prompt
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}} o.image
 * @param {number} [o.maxTokens]  maxOutputTokens; the model's thinking counts in it
 * @param {Record<string, unknown>} [o.reasoning]  {effort}: sent as thinkingConfig.thinkingLevel
 * @param {Prices} [o.prices] @param {NetOptions} [o.net]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function askVision({ endpoint, apiKey, model, prompt, image, maxTokens = 400, reasoning, prices, net = {} }) {
  const i = await readImage(image);
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: i.mime, data: i.base64 } }] }],
    generationConfig: { maxOutputTokens: maxTokens, ...thinkingOf(reasoning) },
  };
  const json = await generate({ endpoint, apiKey, model, body, net });
  return { text: textOf(json, apiKey, 'Смотрящая модель'), model, cost: costOf(json.usageMetadata, priceOf(prices, model)) };
}

/**
 * Asks a text model for one answer (the same contract as openrouter-text.js complete). System messages become the
 * systemInstruction, assistant turns the model's. `temperature` is accepted and not sent (see the header).
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model
 * @param {ChatMessage[]} o.messages
 * @param {number} [o.maxTokens] @param {number} [o.temperature]
 * @param {boolean} [o.json]  responseMimeType application/json
 * @param {Record<string, unknown>} [o.reasoning]  {effort}: sent as thinkingConfig.thinkingLevel
 * @param {Prices} [o.prices] @param {NetOptions} [o.net]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function complete({ endpoint, apiKey, model, messages, maxTokens, json = false, reasoning, prices, net = {} }) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { ...(maxTokens ? { maxOutputTokens: maxTokens } : {}), ...(json ? { responseMimeType: 'application/json' } : {}), ...thinkingOf(reasoning) },
  };
  const answer = await generate({ endpoint, apiKey, model, body, net: { timeoutMs: 120000, ...net } });
  return { text: textOf(answer, apiKey, 'Текстовая модель'), model, cost: costOf(answer.usageMetadata, priceOf(prices, model)) };
}

/**
 * The models of the account that answer generateContent (GET {endpoint}/models). The listing does not say which of
 * them draw, so all are returned; `name` is Google's display name.
 * @param {{endpoint: string, apiKey: string, net?: NetOptions}} o
 * @returns {Promise<{id: string, name?: string}[]>}
 */
export async function listImageModels({ endpoint, apiKey, net = {} }) {
  const json = await request({ endpoint, apiKey, auth: AUTH, route: '/models', query: { pageSize: '1000' }, ...net });
  return (json.models || [])
    .filter((/** @type {any} */ m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((/** @type {any} */ m) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName }));
}
