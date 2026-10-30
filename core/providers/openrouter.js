// OpenRouter-compatible image provider. Sources: OpenRouter API docs
// (openrouter.ai/docs: POST /images, POST /chat/completions with image input, GET /models?output_modalities=image,
// GET /credits).
// Every value comes from the caller: the factory keeps them in settings/defaults.json (provider.openrouter).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @type {Record<string, string>} */
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** @typedef {{timeoutMs?: number, retries?: number, backoffMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>}} NetOptions */

/** Provider failure: `status` is the HTTP status (0 for timeout/network), `providerMessage` is the provider's own text. */
export class ProviderError extends Error {
  /** @param {string} message @param {{status?: number, providerMessage?: string}} [info] */
  constructor(message, { status = 0, providerMessage = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

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
 * One HTTP call with timeout and retry on 429/5xx (exponential backoff). Returns parsed JSON.
 * Timeouts and network errors are not retried: a generation that timed out may still be billed.
 * @param {{endpoint: string, apiKey: string, method?: string, route: string, body?: object, query?: Record<string, string>} & NetOptions} o
 * @returns {Promise<any>}
 */
async function request({ endpoint, apiKey, method = 'GET', route, body, query, timeoutMs = 30000, retries = 0, backoffMs = 1000, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const url = new URL(endpoint.replace(/\/+$/, '') + route);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt);
      continue;
    }
    const providerMessage = redact(json?.error?.message || (text || '').slice(0, 300) || 'пустой ответ', apiKey);
    throw new ProviderError(`Провайдер вернул HTTP ${res.status} (${route}): ${providerMessage}`, { status: res.status, providerMessage });
  }
}

/** @param {{bytes?: Uint8Array, path?: string, mime?: string}} ref */
async function toDataUrl(ref) {
  const bytes = ref.bytes ?? await fs.promises.readFile(/** @type {string} */ (ref.path));
  const mime = ref.mime ?? MIME_BY_EXT[path.extname(ref.path || '').toLowerCase()];
  if (!mime) throw new Error('У образца не указан mime, и его нельзя определить по имени файла.');
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
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
  if (!img?.b64_json) throw new ProviderError('Провайдер ответил без картинки.', { status: 200, providerMessage: redact(JSON.stringify(json.error || {}).slice(0, 300), apiKey) });
  const cost = json.usage?.cost;
  return { bytes: Buffer.from(img.b64_json, 'base64'), mime: img.media_type, model, cost: typeof cost === 'number' ? cost : null, usage: json.usage, raw: { created: json.created } };
}

/**
 * Asks a vision model about one image (POST {endpoint}/chat/completions: the text first, then the image, as the
 * OpenRouter image-understanding guide recommends). Reasoning is turned off and temperature is 0: the answer is a
 * short structured one.
 * @param {object} o
 * @param {string} o.endpoint @param {string} o.apiKey @param {string} o.model @param {string} o.prompt
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}} o.image
 * @param {number} [o.maxTokens]
 * @param {NetOptions} [o.net]
 * @returns {Promise<{text: string, model: string, cost: number|null}>}
 */
export async function askVision({ endpoint, apiKey, model, prompt, image, maxTokens = 400, net = {} }) {
  const body = {
    model, temperature: 0, max_tokens: maxTokens, reasoning: { enabled: false },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: await toDataUrl(image) } }] }],
  };
  const json = await request({ endpoint, apiKey, method: 'POST', route: '/chat/completions', body, ...net });
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new ProviderError('Провайдер ответил без текста.', { status: 200, providerMessage: redact(JSON.stringify(json.error || {}).slice(0, 300), apiKey) });
  const cost = json.usage?.cost;
  return { text, model, cost: typeof cost === 'number' ? cost : null };
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
