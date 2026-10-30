// core/providers/openrouter.js with a mocked fetch: no network, no real key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { askVision, generateImage, getCredits, listImageModels, loadApiKey, ProviderError } from '../core/providers/openrouter.js';

const KEY = 'sk-test-secret-123';
const base = { endpoint: 'https://example.test/api/v1', apiKey: KEY };
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
// A fetch that answers from a queue and records the calls.
const mock = (...replies) => { const calls = []; const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return replies.shift(); }; return { calls, fetchImpl }; };
const png = Buffer.from('fake-png');
const ok = { data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.0345 }, created: 1 };

test('generateImage: тело запроса, образцы как data URL, результат', async () => {
  const { calls, fetchImpl } = mock(reply(200, ok));
  const r = await generateImage({ ...base, model: 'm/x', prompt: 'p', aspectRatio: '4:5', resolution: '1K', params: { quality: 'high' },
    references: [{ bytes: Buffer.from('abc'), mime: 'image/png' }], net: { fetchImpl } });
  assert.equal(calls[0].url, 'https://example.test/api/v1/images');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].init.body);
  const { input_references, ...rest } = body;
  assert.deepEqual(rest, { model: 'm/x', prompt: 'p', aspect_ratio: '4:5', resolution: '1K', quality: 'high' });
  assert.equal(input_references[0].image_url.url, 'data:image/png;base64,' + Buffer.from('abc').toString('base64'));
  assert.deepEqual(r.bytes, png);
  assert.equal(r.mime, 'image/png');
  assert.equal(r.cost, 0.0345);
  assert.equal(r.model, 'm/x');
});

test('generateImage: образец по пути, mime по расширению', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf prov '));
  try {
    fs.writeFileSync(path.join(dir, 'a.webp'), 'w');
    const { calls, fetchImpl } = mock(reply(200, ok));
    await generateImage({ ...base, model: 'm', prompt: 'p', references: [{ path: path.join(dir, 'a.webp') }], net: { fetchImpl } });
    assert.match(JSON.parse(calls[0].init.body).input_references[0].image_url.url, /^data:image\/webp;base64,/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ошибка HTTP: статус и сообщение провайдера, ключ скрыт', async () => {
  const { fetchImpl } = mock(reply(402, { error: { message: `no credits for ${KEY}` } }));
  await assert.rejects(generateImage({ ...base, model: 'm', prompt: 'p', net: { fetchImpl } }), e => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.status, 402);
    assert.match(e.message, /402/);
    assert.match(e.message, /no credits/);
    assert.ok(!e.message.includes(KEY) && !e.providerMessage.includes(KEY));
    return true;
  });
});

test('повтор при 429 и 5xx с паузой, затем успех', async () => {
  const { calls, fetchImpl } = mock(reply(429, { error: { message: 'slow' } }, { 'retry-after': '3' }), reply(503, 'down'), reply(200, ok));
  const pauses = [];
  const r = await generateImage({ ...base, model: 'm', prompt: 'p', net: { fetchImpl, retries: 2, backoffMs: 100, sleep: async ms => { pauses.push(ms); } } });
  assert.equal(calls.length, 3);
  assert.deepEqual(pauses, [3000, 200]);
  assert.equal(r.cost, 0.0345);
});

test('повторы кончились — ошибка; 4xx не повторяется', async () => {
  const a = mock(reply(500, 'x'), reply(500, 'x'));
  await assert.rejects(generateImage({ ...base, model: 'm', prompt: 'p', net: { fetchImpl: a.fetchImpl, retries: 1, sleep: async () => {} } }), e => e.status === 500);
  assert.equal(a.calls.length, 2);
  const b = mock(reply(400, { error: { message: 'bad' } }), reply(200, ok));
  await assert.rejects(generateImage({ ...base, model: 'm', prompt: 'p', net: { fetchImpl: b.fetchImpl, retries: 3, sleep: async () => {} } }), e => e.status === 400);
  assert.equal(b.calls.length, 1);
});

test('таймаут: понятная ошибка, без повтора', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
  await assert.rejects(generateImage({ ...base, model: 'm', prompt: 'p', net: { fetchImpl, retries: 3, timeoutMs: 5 } }), e => e instanceof ProviderError && /не ответил/.test(e.message));
  assert.equal(n, 1);
});

test('ответ без картинки — ошибка', async () => {
  const { fetchImpl } = mock(reply(200, { data: [], error: { message: 'filtered' } }));
  await assert.rejects(generateImage({ ...base, model: 'm', prompt: 'p', net: { fetchImpl } }), /без картинки/);
});

test('listImageModels: фильтр по выходу «image»', async () => {
  const { calls, fetchImpl } = mock(reply(200, { data: [{ id: 'a/b', name: 'B', architecture: { output_modalities: ['image', 'text'] } }] }));
  const models = await listImageModels({ ...base, net: { fetchImpl } });
  assert.equal(calls[0].url, 'https://example.test/api/v1/models?output_modalities=image');
  assert.deepEqual(models.map(m => m.id), ['a/b']);
  assert.deepEqual(models[0].outputModalities, ['image', 'text']);
});

test('getCredits: остаток = куплено − потрачено', async () => {
  const { fetchImpl } = mock(reply(200, { data: { total_credits: 10, total_usage: 2.5 } }));
  assert.deepEqual(await getCredits({ ...base, net: { fetchImpl } }), { total: 10, used: 2.5, remaining: 7.5 });
});

test('loadApiKey: из окружения, из .env, без ключа — ошибка по-русски без значения', t => {
  assert.equal(loadApiKey({ envVar: 'K', env: { K: ' v1 ' }, envFile: '/nonexistent' }), 'v1');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf env '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'OTHER=1\nK=from-file\n');
  assert.equal(loadApiKey({ envVar: 'K', env: {}, envFile: file }), 'from-file');
  assert.equal(loadApiKey({ envVar: 'K', env: { K: 'env-wins' }, envFile: file }), 'env-wins');
  assert.throws(() => loadApiKey({ envVar: 'K', env: {}, envFile: '/nonexistent' }), /Не найден ключ K/);
});

test('askVision: сначала текст, затем картинка data URL; рассуждения как заданы; текст ответа и цена', async () => {
  const { calls, fetchImpl } = mock(reply(200, { choices: [{ message: { content: '{"box_2d": [1, 2, 3, 4]}' } }], usage: { cost: 0.0003 } }));
  const r = await askVision({ ...base, model: 'v/m', prompt: 'find it', image: { bytes: Buffer.from('img'), mime: 'image/png' }, maxTokens: 100, reasoning: { enabled: false }, net: { fetchImpl } });
  assert.equal(calls[0].url, 'https://example.test/api/v1/chat/completions');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'v/m');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 100);
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.deepEqual(body.messages[0].content.map(c => c.type), ['text', 'image_url']);
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,' + Buffer.from('img').toString('base64'));
  assert.deepEqual(r, { text: '{"box_2d": [1, 2, 3, 4]}', model: 'v/m', cost: 0.0003 });
  const { calls: c2, fetchImpl: empty } = mock(reply(200, { choices: [] }));
  await assert.rejects(askVision({ ...base, model: 'v/m', prompt: 'p', image: { bytes: Buffer.from('i'), mime: 'image/png' }, net: { fetchImpl: empty } }), /без текста/);
  assert.equal('reasoning' in JSON.parse(c2[0].init.body), false, 'no reasoning field unless given');
});

test('профиль модели: ближайшая принятая пропорция, свои поля запроса, лимит образцов; без профиля — 1:1', async () => {
  const { closestAspect, modelIds, profileOf, requestFor, SAFE_ASPECT } = await import('../core/providers/models.js');
  const { runSettings } = await import('../core/providers/preset.js');
  const { loadSettings } = await import('../core/settings.js');
  const models = loadSettings().provider.models;
  const gpt = profileOf(models, 'openai/gpt-image-2.5-flare');
  assert.equal(closestAspect('4:5', gpt.aspectRatios), '3:4', '4:5 у GPT Image нет, ближайшая — 3:4');
  assert.equal(closestAspect('4:5', gpt.aspectRatios, 430 / 480), '1:1', 'картинку режут до карточки 430 × 480: меньше всего срезает 1:1');
  assert.equal(closestAspect('4:5', profileOf(models, 'google/gemini-nano-banana-2.1').aspectRatios, 430 / 480), '4:5', 'принятую пропорцию не меняем');
  assert.equal(closestAspect('4:5', profileOf(models, 'google/gemini-nano-banana-2.1').aspectRatios), '4:5');
  assert.equal(closestAspect('2:3', gpt.aspectRatios), '2:3');
  assert.equal(closestAspect('4:5', null), '4:5', 'любая пропорция — словами (Codex)');
  assert.deepEqual(requestFor(profileOf(models, 'google/gemini-nano-banana-2.1'), { model: 'nb', aspectRatio: '4:5', references: 2 }), { aspectRatio: '4:5', params: { resolution: '1K' } });
  assert.deepEqual(requestFor(profileOf(models, 'some/new-model'), { model: 'x', aspectRatio: '4:5', references: 9 }), { aspectRatio: SAFE_ASPECT, params: {} });
  assert.equal(profileOf(models, '_open').aspectRatios?.[0], SAFE_ASPECT, 'служебный ключ — не профиль');
  assert.throws(() => requestFor(profileOf(models, 'codex-cli'), { model: 'codex-cli', aspectRatio: '4:5', references: 6 }), /не больше 5 картинок-образцов, а в запросе 6/);
  const nb = profileOf(models, 'gemini-nano-banana-2.1');
  assert.deepEqual(requestFor(nb, { model: 'nb', aspectRatio: '4:5', references: 14 }), { aspectRatio: '4:5', params: { imageConfig: { imageSize: '1K' } } }, 'та же модель у Google: пропорции и образцы — из её профиля у OpenRouter, поля запроса — свои');
  assert.deepEqual(modelIds(models, 'gemini-nano-banana-2.1'), ['gemini-nano-banana-2.1', 'google/gemini-nano-banana-2.1']);
  const p = /** @type {any} */ ({ use: 'codex-cli', preset: 'openrouter', openrouter: {}, google: {} });
  assert.deepEqual([runSettings(p, { model: 'a/b' }).use, runSettings(p, { model: 'a/b' }).preset], ['api', 'openrouter']);
  assert.equal(runSettings(p, {}), p);
  assert.deepEqual([runSettings({ ...p, use: 'api' }, { provider: 'codex-cli' }).use], ['codex-cli']);
  assert.deepEqual([runSettings(p, { provider: 'google' }).use, runSettings(p, { provider: 'google' }).preset], ['api', 'google']);
  assert.throws(() => runSettings(p, { provider: 'nope' }), /неизвестный сервис/);
});
