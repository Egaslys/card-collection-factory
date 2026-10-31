// core/providers/catalog.js with a mocked fetch: the model lists of OpenRouter and the Gemini API, and which of their
// models fit the settings' image, vision and text fields. No network, no real key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listModels, modelsFor } from '../core/providers/catalog.js';

const reply = (/** @type {object} */ body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const mock = (/** @type {object[]} */ ...bodies) => {
  /** @type {{url: string, init: any}[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return reply(/** @type {object} */ (bodies.shift())); };
  return { calls, fetchImpl };
};

test('каталог OpenRouter: все модели (и только рисующие), их входы и выходы; поля настроек получают подходящие', async () => {
  const { calls, fetchImpl } = mock({ data: [
    { id: 'z/text', name: 'Z Text', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'a/draw', name: 'A Draw', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } },
    { id: 'm/see', name: 'M See', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  ] });
  const models = await listModels('openrouter', { endpoint: 'https://or.test/api/v1/', apiKey: 'k', net: { fetchImpl } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://or.test/api/v1/models?output_modalities=all');
  assert.deepEqual(models.map(m => m.id), ['a/draw', 'm/see', 'z/text']);
  assert.deepEqual(modelsFor(models, 'image').map(m => m.id), ['a/draw']);
  assert.deepEqual(modelsFor(models, 'vision').map(m => m.id), ['m/see']);
  assert.deepEqual(modelsFor(models, 'text').map(m => m.id), ['m/see', 'z/text']);
});

test('каталог Gemini API: страницы по nextPageToken, ключ в x-goog-api-key, без generateContent — мимо, рисующие — по id', async () => {
  const { calls, fetchImpl } = mock(
    { models: [
      { name: 'models/gemini-3-flash', displayName: 'Gemini 3 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
    ], nextPageToken: 'p2' },
    { models: [{ name: 'models/gemini-nano-banana-2.1', displayName: 'Nano Banana 2.1', supportedGenerationMethods: ['generateContent'] }] },
  );
  const models = await listModels('google', { endpoint: 'https://g.test/v1beta', apiKey: 'gk', net: { fetchImpl } });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/v1beta\/models\?pageSize=1000$/);
  assert.match(calls[1].url, /pageToken=p2/);
  assert.equal(new Headers(calls[0].init.headers).get('x-goog-api-key'), 'gk');
  assert.deepEqual(models.map(m => m.id), ['gemini-3-flash', 'gemini-nano-banana-2.1']);
  assert.deepEqual(modelsFor(models, 'image').map(m => m.id), ['gemini-nano-banana-2.1']);
  assert.deepEqual(modelsFor(models, 'vision').map(m => m.id), ['gemini-3-flash']);
});
