// core/providers/gemini.js and the Google AI Studio preset against a fake Gemini API server on 127.0.0.1: no network,
// no real key.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import './root.mjs';
import { askVision, complete, costOf, generateImage, listImageModels, priceOf } from '../core/providers/gemini.js';
import { ProviderError } from '../core/providers/openrouter.js';
import { presetOf } from '../core/providers/preset.js';
import { loadSettings } from '../core/settings.js';

const KEY = 'AIza-test-secret-123';
const png = Buffer.from('fake-png');
const PRICES = { 'nb': [{ input: 1.5, output: 7.5, imageOutput: 30 }], 'flash': [{ until: '2026-12-31', input: 0.75, output: 3.75 }, { input: 1.5, output: 7.5 }] };

/**
 * A fake Gemini API: answers each request from the queue (a body, or [status, body]) and records it.
 * @param {any[]} replies
 */
async function fakeGemini(t, ...replies) {
  /** @type {{method: string, url: string, headers: http.IncomingHttpHeaders, body: any}[]} */
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      calls.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const r = replies.shift();
      const [status, body] = Array.isArray(r) ? r : [200, r];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => server.close());
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { calls, endpoint: `http://127.0.0.1:${port}/v1beta` };
}

const imageAnswer = {
  candidates: [{ content: { role: 'model', parts: [
    { inlineData: { mimeType: 'image/png', data: Buffer.from('thought-image').toString('base64') }, thought: true },
    { text: 'Here it is.' },
    { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
  ] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1130, thoughtsTokenCount: 100, candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 10 }, { modality: 'IMAGE', tokenCount: 1120 }] },
};

test('gemini generateImage: generateContent, ключ в заголовке, образцы после текста, картинка не из размышлений, цена из токенов', async t => {
  const { calls, endpoint } = await fakeGemini(t, imageAnswer);
  const r = await generateImage({ endpoint, apiKey: KEY, model: 'nb', prompt: 'a lantern', aspectRatio: '4:5', params: { imageConfig: { imageSize: '1K' } }, prices: PRICES,
    references: [{ bytes: Buffer.from('ref'), mime: 'image/png' }] });
  const c = calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, '/v1beta/models/nb:generateContent');
  assert.equal(c.headers['x-goog-api-key'], KEY);
  assert.ok(!c.url.includes(KEY) && !c.headers.authorization, 'ключ только в x-goog-api-key');
  assert.deepEqual(c.body.contents[0].parts, [{ text: 'a lantern' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('ref').toString('base64') } }]);
  assert.deepEqual(c.body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5', imageSize: '1K' } });
  assert.deepEqual(r.bytes, png);
  assert.equal(r.mime, 'image/png');
  // 300 × 1.5 + (10 + 100) × 7.5 + 1120 × 30 per 1M tokens
  assert.equal(r.cost, (300 * 1.5 + 110 * 7.5 + 1120 * 30) / 1e6);
  assert.equal(r.model, 'nb');
});

test('gemini: ответ без картинки и заблокированный запрос — ошибка провайдера с причиной; модель без цены — расход неизвестен', async t => {
  const { endpoint } = await fakeGemini(t,
    { candidates: [{ content: { parts: [{ text: 'cannot' }] }, finishReason: 'NO_IMAGE' }] },
    { promptFeedback: { blockReason: 'IMAGE_SAFETY' } },
    imageAnswer);
  await assert.rejects(generateImage({ endpoint, apiKey: KEY, model: 'nb', prompt: 'p' }), e => e instanceof ProviderError && /без картинки.*NO_IMAGE/.test(e.message));
  await assert.rejects(generateImage({ endpoint, apiKey: KEY, model: 'nb', prompt: 'p' }), /заблокирован: IMAGE_SAFETY/);
  assert.equal((await generateImage({ endpoint, apiKey: KEY, model: 'unpriced', prompt: 'p', prices: PRICES })).cost, null);
});

test('gemini: повтор при 429 и 5xx, затем ошибка HTTP со словами провайдера; ключ скрыт', async t => {
  const { calls, endpoint } = await fakeGemini(t, [429, { error: { code: 429, message: 'slow', status: 'RESOURCE_EXHAUSTED' } }], [503, { error: { message: 'down' } }], [400, { error: { code: 400, message: `API key ${KEY} not valid`, status: 'INVALID_ARGUMENT' } }]);
  const pauses = [];
  await assert.rejects(askVision({ endpoint, apiKey: KEY, model: 'flash', prompt: 'p', image: { bytes: png, mime: 'image/png' }, net: { retries: 2, backoffMs: 10, sleep: async ms => { pauses.push(ms); } } }), e => {
    assert.equal(e.status, 400);
    assert.match(e.message, /not valid/);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(pauses, [10, 20]);
});

test('gemini askVision и complete: уровень размышлений из effort, без temperature, JSON, system → systemInstruction', async t => {
  const textAnswer = text => ({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 150 } });
  const { calls, endpoint } = await fakeGemini(t, textAnswer('{"box_2d": [1, 2, 3, 4]}'), textAnswer('{"plan": 1}'), { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
  const v = await askVision({ endpoint, apiKey: KEY, model: 'flash', prompt: 'find', image: { bytes: png, mime: 'image/png' }, maxTokens: 2000, reasoning: { effort: 'low' }, prices: PRICES });
  assert.equal(v.text, '{"box_2d": [1, 2, 3, 4]}', 'размышления не в ответе');
  assert.deepEqual(calls[0].body.generationConfig, { maxOutputTokens: 2000, thinkingConfig: { thinkingLevel: 'LOW' } });
  assert.deepEqual(calls[0].body.contents[0].parts.map((/** @type {any} */ p) => Object.keys(p)[0]), ['text', 'inlineData']);
  const price = priceOf(PRICES, 'flash');
  assert.equal(v.cost, costOf({ promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 150 }, price));
  const c = await complete({ endpoint, apiKey: KEY, model: 'flash', json: true, maxTokens: 16000, temperature: 0.7, prices: PRICES,
    messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'plan' }, { role: 'assistant', content: 'draft' }, { role: 'user', content: 'fix' }] });
  assert.equal(c.text, '{"plan": 1}');
  const body = calls[1].body;
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'rules' }] });
  assert.deepEqual(body.contents.map((/** @type {any} */ m) => m.role), ['user', 'model', 'user']);
  assert.deepEqual(body.generationConfig, { maxOutputTokens: 16000, responseMimeType: 'application/json' }, 'temperature не отправляется: Gemini 3.6+ её не принимают');
  await assert.rejects(complete({ endpoint, apiKey: KEY, model: 'flash', messages: [{ role: 'user', content: 'x' }] }), /без текста.*MAX_TOKENS/);
});

test('gemini: ответ без текста или без картинки оплачен — ошибка несёт его цену', async t => {
  const usage = { promptTokenCount: 1000, candidatesTokenCount: 0, thoughtsTokenCount: 400 };
  const empty = { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: usage };
  const { endpoint } = await fakeGemini(t, empty, empty, { ...empty, usageMetadata: { ...usage, candidatesTokenCount: 5 } }, empty);
  const price = costOf(usage, priceOf(PRICES, 'flash'));
  assert.ok(price > 0);
  const paid = (/** @type {number|null} */ cost) => (/** @type {any} */ e) => e instanceof ProviderError && e.cost === cost;
  await assert.rejects(askVision({ endpoint, apiKey: KEY, model: 'flash', prompt: 'p', image: { bytes: png, mime: 'image/png' }, prices: PRICES }), paid(price));
  await assert.rejects(complete({ endpoint, apiKey: KEY, model: 'flash', prompt: 'p', messages: [{ role: 'user', content: 'x' }], prices: PRICES }), paid(price));
  await assert.rejects(generateImage({ endpoint, apiKey: KEY, model: 'nb', prompt: 'p', prices: PRICES }), paid(costOf({ ...usage, candidatesTokenCount: 5 }, priceOf(PRICES, 'nb'))));
  await assert.rejects(askVision({ endpoint, apiKey: KEY, model: 'unpriced', prompt: 'p', image: { bytes: png, mime: 'image/png' }, prices: PRICES }), paid(null), 'без цены модели — неизвестно');
});

test('gemini: ошибки по видам — ключ не принят, деньги или квота кончились (без повторов), частота запросов (повтор)', async t => {
  const err = (code, status, message, details) => ({ error: { code, status, message, ...(details ? { details } : {}) } });
  const { calls, endpoint } = await fakeGemini(t,
    [400, err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }])],
    [403, err(403, 'PERMISSION_DENIED', 'Your API key was reported as leaked. Please use another API key.')],
    [402, { error: { code: 'payment_required', message: 'Your Prepay credit balance is depleted.' } }],
    [400, err(400, 'FAILED_PRECONDITION', 'Billing is not enabled for this project.')],
    [429, err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.', [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }])],
    [429, err(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted.', [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }])],
    [429, err(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted.', [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }])],
    [400, err(400, 'INVALID_ARGUMENT', 'Unsupported MIME type.')]);
  const net = { retries: 1, backoffMs: 1, sleep: async () => {} };
  const kinds = [];
  for (let i = 0; i < 7; i++) {
    const e = await askVision({ endpoint, apiKey: KEY, model: 'flash', prompt: 'p', image: { bytes: png, mime: 'image/png' }, net }).catch(x => x);
    assert.ok(e instanceof ProviderError, String(e));
    kinds.push(e.kind);
  }
  assert.deepEqual(kinds, ['auth', 'auth', 'billing', 'billing', 'billing', 'rate', 'other']);
  assert.equal(calls.length, 8, 'дневная квота не повторяется, частота запросов — повторяется');
});

test('gemini: цена по дате — до конца акции и после; список моделей с generateContent', async t => {
  assert.equal(priceOf(PRICES, 'flash', new Date('2026-12-31T23:00:00Z'))?.input, 0.75);
  assert.equal(priceOf(PRICES, 'flash', new Date('2027-01-01T00:00:00Z'))?.input, 1.5);
  assert.equal(priceOf(PRICES, 'none'), null);
  const { calls, endpoint } = await fakeGemini(t, { models: [
    { name: 'models/gemini-nano-banana-2.1', displayName: 'Nano Banana 2.1', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/embedding-x', supportedGenerationMethods: ['embedContent'] },
  ] });
  assert.deepEqual(await listImageModels({ endpoint, apiKey: KEY }), [{ id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1' }]);
  assert.equal(calls[0].url, '/v1beta/models?pageSize=1000');
  assert.equal(calls[0].headers['x-goog-api-key'], KEY);
});

test('пресет Google: providerFrom рисует Nano Banana 2.1 через generateContent, смотрит Gemini 3.8 Flash; обработка — как у той же модели OpenRouter', async t => {
  const loop = await import('../core/card/make.js').catch(() => null);
  if (!loop) return t.skip('sharp не установлен');
  const real = loadSettings();
  const { calls, endpoint } = await fakeGemini(t, imageAnswer, { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } }, imageAnswer);
  const provider = { ...real.provider, use: /** @type {'api'} */ ('api'), preset: /** @type {'google'} */ ('google'), google: { ...real.provider.google, endpoint } };
  const p = loop.providerFrom(provider, { apiKey: KEY });
  assert.equal(p.model, 'gemini-nano-banana-2.1');
  assert.equal(p.fallback, undefined, 'у пресета Google запасной модели нет');
  const r = await p.generate({ prompt: 'p', references: [] });
  assert.ok(r.cost && r.cost > 0.03 && r.cost < 0.04, `цена картинки 1K около $0.034: ${r.cost}`);
  assert.equal(calls[0].url, '/v1beta/models/gemini-nano-banana-2.1:generateContent');
  assert.deepEqual(calls[0].body.generationConfig.imageConfig, { aspectRatio: real.provider.google.aspectRatio, imageSize: '1K' });
  assert.equal(p.vision?.model, 'gemini-3.8-flash');
  await /** @type {any} */ (p.vision)({ model: 'gemini-3.8-flash', prompt: 'q', image: { bytes: png, mime: 'image/png' }, maxTokens: 100, timeoutMs: 5000 });
  assert.equal(calls[1].url, '/v1beta/models/gemini-3.8-flash:generateContent');
  await p.generate({ prompt: 'p', references: [], crop: { width: 430, height: 480 } });
  assert.equal(calls.at(-1).body.generationConfig.imageConfig.aspectRatio, '1:1', 'карточка: кадр не выше карточки (сверху и снизу не режем)');
  assert.equal(presetOf(provider).name, 'google');
  const same = loop.processingFor({ style: 'scapes', model: 'gemini-nano-banana-2.1', settings: real });
  assert.deepEqual(same, loop.processingFor({ style: 'scapes', model: 'google/gemini-nano-banana-2.1', settings: real }));
  assert.equal(same.warning, undefined);
});
