// OpenRouter-compatible image provider. Sources: OpenRouter API docs
// (openrouter.ai/docs: POST /images, POST /chat/completions with image input, GET /models?output_modalities=image,
// GET /credits).
// Every value comes from the caller: the factory keeps them in settings/defaults.json (provider.openrouter).
// `request`, `readImage`, `loadApiKey` and ProviderError are shared with the other HTTP providers (gemini.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @type {Record<string, string>} */
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** @typedef {{timeoutMs?: number, retries?: number, backoffMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>}} NetOptions */

/**
 * What kind of failure a provider error is: `auth` — the service does not accept the key (missing, invalid, expired,
 * leaked, no access); `billing` — no money or no billing (credits or Prepay balance depleted, billing disabled, a daily
 * quota used up); `rate` — too many requests for now, worth waiting; `other` — anything else (a refusal, a model down,
 * a bad request, the network). auth and billing stop a run: no later call can succeed until a person acts.
 * @typedef {'auth'|'billing'|'rate'|'other'} ErrorKind
 */

/**
 * Provider failure: `status` is the HTTP status (0 for timeout/network), `providerMessage` is the provider's own text,
 * `kind` what it means for a run (ErrorKind).
 */
export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, providerMessage?: string, cost?: number|null, kind?: ErrorKind}} [info]  cost: USD of a
   *   call that was answered and paid but is of no use (no image, no text); null = not known or nothing paid
   */
  constructor(message, { status = 0, providerMessage = '', cost = null, kind = 'other' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.providerMessage = providerMessage;
    this.cost = cost;
    this.kind = kind;
  }
}

/**
 * The kind of an HTTP error answer, from its status and body. Sources, checked 2026-10-31:
 * - OpenRouter (openrouter.ai/docs/api-reference/errors): body {error: {code: <HTTP status>, message, metadata?}};
 *   401 invalid credentials (disabled or invalid key), 402 insufficient credits, 403 forbidden — insufficient
 *   permissions, or a guardrail or moderation block (those carry `metadata` and are a refusal, not the key), 429 rate
 *   limited.
 * - Gemini API (ai.google.dev/gemini-api/docs/api-errors and …/troubleshooting): codes `authentication` (401: key
 *   missing, invalid or expired), `payment_required` (402: Prepay credits depleted), `permission_denied` (403: no
 *   permission, project restricted, a key reported as leaked), `failed_precondition` (400: e.g. billing disabled),
 *   `quota_exceeded` (429: daily quota) apart from `rate_limit_exceeded` / `too_many_requests` (429). generateContent
 *   also answers {error: {code: <HTTP status>, status: "INVALID_ARGUMENT"|"FAILED_PRECONDITION"|"PERMISSION_DENIED"|
 *   "RESOURCE_EXHAUSTED", message, details: [{reason: "API_KEY_INVALID"}, {violations: [{quotaId}]}]}}: an invalid key
 *   comes as 400 with reason API_KEY_INVALID, a daily quota as 429 with a quotaId "…PerDay…".
 * @param {number} status @param {any} json  the parsed body, or null
 * @returns {ErrorKind}
 */
export function errorKind(status, json) {
  const e = json?.error && typeof json.error === 'object' ? json.error : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const state = typeof e.status === 'string' ? e.status : '';
  const message = String(e.message ?? '');
  const details = (Array.isArray(e.details) ? e.details : []).flatMap((/** @type {any} */ d) => [d?.reason, ...(Array.isArray(d?.violations) ? d.violations.map((/** @type {any} */ v) => v?.quotaId) : [])]).filter(Boolean).join(' ');
  if (status === 401 || code === 'authentication' || /API_KEY_INVALID/.test(details) || /API key not valid|API key expired/i.test(message)) return 'auth';
  if (status === 402 || code === 'payment_required' || code === 'failed_precondition' || state === 'FAILED_PRECONDITION') return 'billing';
  if (status === 403) return e.metadata || /moderat|flagged|guardrail/i.test(message) ? 'other' : 'auth';
  if (status === 429) return code === 'quota_exceeded' || /PerDay/i.test(details) ? 'billing' : 'rate';
  return 'other';
}

/** USD of an OpenRouter answer (usage.cost), or null. @param {any} json @returns {number|null} */
const usageCost = json => (typeof json?.usage?.cost === 'number' ? json.usage.cost : null);

/**
 * Reads the API key from the environment, loading `.env` from the repo root first when it exists.
 * @param {{envVar: string, env?: Record<string, string|undefined>, envFile?: string}} options
 * @returns {string}
 */
export function loadApiKey({ envVar, env = process.env, envFile = path.join(REPO_ROOT, '.env') }) {
  if (!env[envVar] && fs.existsSync(envFile)) {
    // process.loadEnvFile fills process.env and never overrides variables that are already set.
    if (env === process.env) process.loadEnvFile(envFile);
    else for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
    }
  }
  const key = env[envVar]?.trim();
  if (!key) throw new Error(`Не найден ключ ${envVar}: задайте его в переменной окружения или в файле .env в корне проекта.`);
  return key;
}

/** @param {unknown} text @param {string} apiKey */
const redact = (text, apiKey) => (apiKey ? String(text).split(apiKey).join('[ключ скрыт]') : String(text));
/** @param {number} ms */
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * One HTTP call with timeout and retry on 429/5xx (exponential backoff). Returns parsed JSON. The key goes in
 * `Authorization: Bearer` unless `auth` names another header (Gemini API: x-goog-api-key); it is never in the URL.
 * Timeouts and network errors are not retried: a generation that timed out may still be billed.
 * @param {{endpoint: string, apiKey: string, auth?: string, method?: string, route: string, body?: object, query?: Record<string, string>} & NetOptions} o
 * @returns {Promise<any>}
 */
export async function request({ endpoint, apiKey, auth, method = 'GET', route, body, query, timeoutMs = 30000, retries = 0, backoffMs = 1000, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const url = new URL(endpoint.replace(/\/+$/, '') + route);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { ...(auth ? { [auth]: apiKey } : { Authorization: `Bearer ${apiKey}` }), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (/** @type {any} */ e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new ProviderError(timedOut ? `Провайдер не ответил за ${timeoutMs} мс (${route}).` : `Сеть: ${redact(e?.message, apiKey)} (${route}).`);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body is reported below */ }
    if (res.ok && json) return json;
    const kind = errorKind(res.status, json);
    // a 429 that is a used-up quota (billing) does not pass by waiting
    if ((kind === 'rate' || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt);
      continue;
    }
    const providerMessage = redact(json?.error?.message || (text || '').slice(0, 300) || 'пустой ответ', apiKey);
    throw new ProviderError(`Провайдер вернул HTTP ${res.status} (${route}): ${providerMessage}`, { status: res.status, providerMessage, kind });
  }
}

/**
 * An image as base64 with its mime type (from `mime`, else the file's extension).
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}} ref @returns {Promise<{mime: string, base64: string}>}
 */
export async function readImage(ref) {
  const bytes = ref.bytes ?? await fs.promises.readFile(/** @type {string} */ (ref.path));
  const mime = ref.mime ?? MIME_BY_EXT[path.extname(ref.path || '').toLowerCase()];
  if (!mime) throw new Error('У образца не указан mime, и его нельзя определить по имени файла.');
  return { mime, base64: Buffer.from(bytes).toString('base64') };
}

/** @param {{bytes?: Uint8Array, path?: string, mime?: string}} ref */
async function toDataUrl(ref) {
  const { mime, base64 } = await readImage(ref);
  return `data:${mime};base64,${base64}`;
}

/**
 * Generates one image (POST {endpoint}/images).
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model @param {string} o.prompt
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}[]} [o.references] style references, sent as input_references
 * @param {string} [o.aspectRatio] e.g. "4:5"  @param {string} [o.resolution] e.g. "1K"
 * @param {Record<string, unknown>} [o.params] any other request fields (size, quality, seed, provider, ...), passed as is
 * @param {NetOptions} [o.net]
 * @returns {Promise<{bytes: Buffer, mime: string|undefined, model: string, cost: number|null, usage: object|undefined, raw: {created?: number}}>}
 */
export async function generateImage({ endpoint, apiKey, model, prompt, references = [], aspectRatio, resolution, params = {}, net = {} }) {
  /** @type {Record<string, unknown>} */
  const body = { model, prompt, ...params };
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (resolution) body.resolution = resolution;
  if (references.length) {
    body.input_references = await Promise.all(references.map(async r => ({ type: 'image_url', image_url: { url: await toDataUrl(r) } })));
  }
  const json = await request({ endpoint, apiKey, method: 'POST', route: '/images', body, ...net });
  const img = json.data?.[0];
  if (!img?.b64_json) throw new ProviderError('Провайдер ответил без картинки.', { status: 200, providerMessage: redact(JSON.stringify(json.error || {}).slice(0, 300), apiKey), cost: usageCost(json) });
  return { bytes: Buffer.from(img.b64_json, 'base64'), mime: img.media_type, model, cost: usageCost(json), usage: json.usage, raw: { created: json.created } };
}

/**
 * Asks a vision model about one image (POST {endpoint}/chat/completions: the text first, then the image, as the
 * OpenRouter image-understanding guide recommends), temperature 0: the answer is a short structured one.
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model @param {string} o.prompt
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}} o.image
 * @param {number} [o.maxTokens]
 * @param {Record<string, unknown>} [o.reasoning]  the request's `reasoning` field as is (e.g. {effort: "minimal"}); not sent when absent
 * @param {NetOptions} [o.net]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function askVision({ endpoint, apiKey, model, prompt, image, maxTokens = 400, reasoning, net = {} }) {
  const body = {
    model, temperature: 0, max_tokens: maxTokens, ...(reasoning ? { reasoning } : {}),
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: await toDataUrl(image) } }] }],
  };
  const json = await request({ endpoint, apiKey, method: 'POST', route: '/chat/completions', body, ...net });
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new ProviderError('Провайдер ответил без текста.', { status: 200, providerMessage: redact(JSON.stringify(json.error || {}).slice(0, 300), apiKey), cost: usageCost(json) });
  return { text, model, cost: usageCost(json) };
}

/**
 * Models that can output images (GET {endpoint}/models?output_modalities=image).
 * @returns {Promise<{id: string, name?: string, pricing?: object, outputModalities?: string[]}[]>}
 */
/** @param {{endpoint: string, apiKey: string, net?: NetOptions}} o */
export async function listImageModels({ endpoint, apiKey, net = {} }) {
  const json = await request({ endpoint, apiKey, route: '/models', query: { output_modalities: 'image' }, ...net });
  return (json.data || []).map((/** @type {any} */ m) => ({ id: m.id, name: m.name, pricing: m.pricing, outputModalities: m.architecture?.output_modalities }));
}

/**
 * Account balance (GET {endpoint}/credits): `remaining` = total_credits - total_usage, in USD.
 * @returns {Promise<{total: number, used: number, remaining: number}>}
 */
/** @param {{endpoint: string, apiKey: string, net?: NetOptions}} o */
export async function getCredits({ endpoint, apiKey, net = {} }) {
  const d = (await request({ endpoint, apiKey, route: '/credits', ...net })).data || {};
  return { total: d.total_credits, used: d.total_usage, remaining: d.total_credits - d.total_usage };
}
