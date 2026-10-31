// OpenRouter-compatible text model: one chat completion (POST {endpoint}/chat/completions). Sources: OpenRouter API
// docs (openrouter.ai/docs: API reference «Completions Request», «Structured outputs»: response_format
// {type: "json_object"}; usage.cost in the answer).
// The editor's planning model writes set plans with it (core/set/planner.js). Every value comes from the caller.
// The HTTP call mirrors `request` of openrouter.js, which does not export it; when it does, this file should use it.
import { ProviderError, errorKind, httpFailure, unreachable } from './openrouter.js';
import { said } from '../say.js';

/** @typedef {import('./openrouter.js').NetOptions} NetOptions */
/** @typedef {{role: 'system'|'user'|'assistant', content: string}} ChatMessage */

/** @param {unknown} text @param {string} apiKey */
const redact = (text, apiKey) => (apiKey ? String(text).split(apiKey).join('[ключ скрыт]') : String(text));
/** @param {number} ms */
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Asks a text model for one answer. `json`: ask for a JSON object (response_format json_object); the text is
 * returned as is, the caller parses it.
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model
 * @param {ChatMessage[]} o.messages
 * @param {number} [o.maxTokens] @param {number} [o.temperature]
 * @param {boolean} [o.json]
 * @param {Record<string, unknown>} [o.reasoning]  the request's `reasoning` field as is; not sent when absent
 * @param {NetOptions} [o.net]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function complete({ endpoint, apiKey, model, messages, maxTokens, temperature, json = false, reasoning, net = {} }) {
  const { timeoutMs = 120000, retries = 0, backoffMs = 1000, fetchImpl = globalThis.fetch, sleep = defaultSleep } = net;
  const body = {
    model, messages,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
  const route = '/chat/completions';
  const url = endpoint.replace(/\/+$/, '') + route;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (/** @type {any} */ e) {
      throw unreachable(e, timeoutMs, route, apiKey);
    }
    const raw = await res.text();
    let answer = null;
    try { answer = JSON.parse(raw); } catch { /* reported below */ }
    if (res.ok && answer) {
      const text = answer.choices?.[0]?.message?.content;
      const cost = typeof answer.usage?.cost === 'number' ? answer.usage.cost : null;
      if (typeof text !== 'string' || !text.trim()) throw new ProviderError('Текстовая модель ответила без текста.', { said: said('provider.noText'), status: 200, providerMessage: redact(JSON.stringify(answer.error || {}).slice(0, 300), apiKey), cost });
      return { text, model, cost };
    }
    const kind = errorKind(res.status, answer);
    if ((kind === 'rate' || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt);
      continue;
    }
    const providerMessage = redact(answer?.error?.message || (raw || '').slice(0, 300) || 'пустой ответ', apiKey);
    throw httpFailure(res.status, route, providerMessage, kind);
  }
}
