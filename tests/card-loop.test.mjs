// The card loop (core/card/), the settings (core/settings.js) and the agent command line (ccf.mjs).
// The loop runs with a fake provider (no network, no key) over real images; the style's checks are the real ones.
// Tests that read or write images need the installed packages (node tools/setup.mjs); without sharp they are skipped.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { ROOT } from './root.mjs';
import { loadSettings, mergeSettings } from '../core/settings.js';

const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp/package.json'));
const noSharp = !hasSharp && 'пакеты не установлены (node tools/setup.mjs): нет node_modules/sharp';
const temps = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-card-')); temps.push(d); return d; };
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const ccf = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'ccf.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });

// ---------- settings ----------

test('настройки: локальные поверх общих, вложенные объекты сливаются, пустой объект — открытый словарь', () => {
  const defaults = { provider: { model: 'a', params: {} }, card: { attempts: 3 }, processing: {} };
  const merged = mergeSettings(defaults, { _about: 'x', provider: { params: { seed: 1 } }, processing: { 'm/x': { saturation: 1 } } });
  assert.deepEqual(merged, { provider: { model: 'a', params: { seed: 1 } }, card: { attempts: 3 }, processing: { 'm/x': { saturation: 1 } } });
  assert.deepEqual(defaults.provider.params, {}, 'общие настройки не изменены');
  assert.throws(() => mergeSettings(defaults, { card: { atempts: 5 } }), /неизвестный ключ «card\.atempts»/);
  assert.throws(() => mergeSettings(defaults, { card: 5 }), /«card» должен быть объектом/);
});

test('настройки: loadSettings читает defaults.json и local.json; общий файл проекта читается и без ключа', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'defaults.json'), JSON.stringify({ card: { attempts: 3, maxSpendUsd: 0.2 } }));
  assert.equal(loadSettings({ dir }).card.attempts, 3);
  fs.writeFileSync(path.join(dir, 'local.json'), JSON.stringify({ card: { attempts: 1 } }));
  assert.deepEqual(loadSettings({ dir }).card, { attempts: 1, maxSpendUsd: 0.2 });
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/defaults.json'), 'utf8'));
  assert.ok(real.provider.openrouter.endpoint && real.provider.openrouter.model && real.provider.openrouter.keyEnvVar);
  assert.ok(!JSON.stringify(real).match(/sk-or-|sk-[A-Za-z0-9]{20}/), 'в настройках нет ключа');
});

// ---------- the agent command line ----------

test('ccf.mjs: справка, неизвестная команда и неизвестный ключ отклоняются до работы', () => {
  const help = ccf('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /card make/);
  for (const c of [['card', 'make'], ['card', 'check'], ['models'], ['credits']]) {
    assert.equal(ccf(...c, '--help').status, 0, c.join(' '));
    const bad = ccf(...c, ...(c[0] === 'card' ? ['x'] : []), '--no-such-option');
    assert.equal(bad.status, 2, c.join(' '));
    assert.match(bad.stderr, /Unknown option '--no-such-option'/);
  }
  assert.equal(ccf('nope').status, 2);
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c').status, 2, 'без --set');
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c', '--set', 's', '--attempts', '0').status, 2);
  assert.equal(ccf('card', 'check', 'x', '--mask', 'confirmed').status, 2, '--mask без --attempt');
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c', '--set', 's', '--provider', 'dalle').status, 2, 'неизвестный провайдер');
  const missing = ccf('card', 'check', path.join(tmp(), 'none'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Нет карточки/);
});

// ---------- the loop ----------

const loop = hasSharp ? await import('../core/card/make.js') : null;
const sharp = hasSharp ? (await import('sharp')).default : null;

test('цикл: лимит попыток и потолок расходов', { skip: noSharp }, () => {
  const { nextStep } = /** @type {any} */ (loop);
  const limits = { attempts: 3, maxSpendUsd: 0.2 };
  assert.equal(nextStep({ done: 0, spent: 0, limits, priceHint: 0 }), null);
  assert.equal(nextStep({ done: 3, spent: 0, limits, priceHint: 0 }), 'attempts');
  assert.equal(nextStep({ done: 1, spent: 0.16, limits, priceHint: 0.08 }), 'budget');
  assert.equal(nextStep({ done: 1, spent: 0.04 * 4, limits: { attempts: 9, maxSpendUsd: 0.2 }, priceHint: 0.04 }), null, '5 × 0.04 = 0.2 укладывается');
  assert.equal(nextStep({ done: 0, spent: 0, limits: { attempts: 3, maxSpendUsd: 0 }, priceHint: 0 }), 'budget', 'нулевой потолок — ни одного вызова');
});

test('цикл: лучшая попытка — меньше блокирующих FAIL, потом FAIL для глаз, потом WARN, потом раньше', { skip: noSharp }, () => {
  const { pickBest } = /** @type {any} */ (loop);
  const a = (n, blocking, eyes, warns, error) => ({ n, check: { blocking, warns, fails: Array(blocking + eyes).fill({}) }, ...(error ? { error } : {}) });
  assert.equal(pickBest([a(1, 2, 0, 0), a(2, 1, 5, 9), a(3, 1, 1, 9)]), 3);
  assert.equal(pickBest([a(1, 0, 0, 4), a(2, 0, 0, 3), a(3, 0, 0, 3)]), 2);
  assert.equal(pickBest([{ n: 1, error: { stage: 'generate' } }]), null);
});

// a valid order of the Scapes style: an object floating on a rays field (core/style/card-order.js)
const ORDER = {
  id: 'test-card', style: 'scapes', subject: 'a red-and-white fishing bobber with a short antenna', object: 'fishing bobber',
  staging: { category: 1, backdrop: 'field', pattern: 'rays', placement: 'floating_field', support: 'none', camera: 'eye_level', characters: 0, time: 'n/a', sky_top: false, material: 'glossy plastic' },
};
const MODEL = 'google/gemini-nano-banana-2.1';
// the processing search is tested on its own below; the loop tests apply the start settings as they are (faster)
const SETTINGS = { card: { attempts: 3, maxSpendUsd: 0.2, tuneProcessing: false }, processing: {} };
const fakePrompt = async () => ({ prompt: 'PROMPT', references: [{ path: path.join(ROOT, 'styles/scapes/references/card-003.png') }] });
/** A fake provider: answers with the given image and price, records the requests. */
function fakeProvider(bytes, cost, extra = {}) {
  const calls = [];
  return { calls, model: MODEL, generate: async req => { calls.push(req); return { bytes, mime: 'image/png', cost }; }, ...extra };
}
// a flat grey 4:5 image: fails COLOUR.1 (median chroma), a FAIL that does not rest on the hero outline
const grey = async () => sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();

test('цикл: карточка, которая не проходит проверки, перегенерируется до потолка расходов; повторный запуск дописывает попытки', { skip: noSharp }, async () => {
  const { makeCard, recheckCard } = /** @type {any} */ (loop);
  const root = tmp();
  const p = fakeProvider(await grey(), 0.08);
  const r = await makeCard({ order: ORDER, collection: 'c1', set: 's1', settings: SETTINGS, provider: p, buildPrompt: fakePrompt, root });
  assert.equal(r.stop, 'budget', '0.08 + 0.08 = 0.16, третий вызов превысил бы 0.20');
  assert.equal(p.calls.length, 2);
  assert.equal(p.calls[0].prompt, 'PROMPT');
  assert.ok(Math.abs(r.spent - 0.16) < 1e-9);
  assert.equal(r.attempts.length, 2);
  for (const a of r.attempts) {
    assert.ok(a.check.blocking > 0);
    assert.ok(a.check.fails.some(f => f.id === 'COLOUR.1' && !f.needsMask && typeof f.value === 'number'));
    for (const k of ['original', 'prepared', 'card', 'check']) assert.ok(fs.existsSync(a.files[k]), k);
    assert.ok(a.visual.length > 0, 'список для глаз');
  }
  const dir = path.join(root, 'c1/sets/s1/cards/test-card');
  assert.equal(r.dir, dir);
  const meta = await sharp(path.join(dir, 'card.png')).metadata();
  assert.deepEqual([meta.width, meta.height], [430, 480]);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'));
  assert.equal(file.chosen, 1);
  assert.deepEqual(file.attempts.map(a => [a.n, a.cost, a.prompt]), [[1, 0.08, 'PROMPT'], [2, 0.08, 'PROMPT']]);
  assert.equal(file.attempts[0].references[0], 'styles/scapes/references/card-003.png');
  assert.deepEqual(file.attempts[0].processing, JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8')).start[MODEL]);

  // second run: the known price limits it from the first call; attempts continue numbering
  const again = await makeCard({ order: ORDER, collection: 'c1', set: 's1', settings: SETTINGS, provider: p, buildPrompt: fakePrompt, root, limits: { maxSpendUsd: 0.1 } });
  assert.equal(again.stop, 'budget');
  assert.deepEqual(again.attempts.map(a => a.n), [3]);
  assert.equal(p.calls.length, 3);

  // re-check one attempt with what was seen by eye
  await assert.rejects(recheckCard({ dir, review: { mask: 'rejected' } }), /номер/);
  const re = await recheckCard({ dir, n: 2, review: { mask: 'rejected', hero_box: [100, 100, 300, 400] } });
  assert.deepEqual(re.attempts.map(a => a.n), [2]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8')).attempts[1].review, { mask: 'rejected', hero_box: [100, 100, 300, 400] });

  // the same through the command line: the report for a person and JSON for an agent; blocking FAILs → exit 1
  const human = ccf('card', 'check', dir);
  assert.equal(human.status, 1, human.stderr);
  assert.match(human.stdout, /Попытка 3[\s\S]*FAIL COLOUR\.1[\s\S]*Выбрана попытка 1[\s\S]*Проверить глазами/);
  const json = ccf('card', 'check', dir, '--attempt', '1', '--json');
  assert.deepEqual(JSON.parse(json.stdout).attempts.map(a => a.n), [1]);
});

test('цикл: эталонная карточка как «ответ модели» проходит путь до конца; лимит попыток соблюдается', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/checks/reference-spec.json'), 'utf8')).cards.find(c => c.id === 'ref-003');
  const { id, ref, file, set, mask, ...staging } = spec;
  const order = { ...ORDER, staging };
  const p = fakeProvider(fs.readFileSync(path.join(ROOT, 'styles/scapes/references/card-003.png')), 0.04);
  const r = await makeCard({ order, collection: 'c', set: 's', settings: SETTINGS, provider: p, buildPrompt: fakePrompt, root: tmp(), limits: { attempts: 2 } });
  assert.ok(['passed', 'attempts'].includes(r.stop), r.stop);
  assert.ok(p.calls.length <= 2);
  if (r.stop === 'passed') assert.equal(r.attempts.at(-1).check.blocking, 0);
  assert.equal(r.chosen, r.chosenCheck && r.attempts.find(a => a.n === r.chosen)?.n);
  assert.ok(fs.existsSync(r.image));
});

test('цикл: запрос собирает core/style; негодный заказ отклоняется до платного вызова', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { buildPrompt, OrderError } = await import('../core/style/prompt.js');
  const root = tmp();
  const p = fakeProvider(await grey(), 0.04);
  const r = await makeCard({ order: ORDER, collection: 'c', set: 's', settings: SETTINGS, provider: p, root, limits: { attempts: 1 } });
  const built = await buildPrompt(ORDER);
  assert.equal(p.calls[0].prompt, built.prompt);
  assert.deepEqual(p.calls[0].references, built.references.map(x => ({ path: x.path })));
  const file = JSON.parse(fs.readFileSync(path.join(r.dir, 'card.json'), 'utf8'));
  assert.deepEqual(file.attempts[0].references, built.references.map(x => path.relative(ROOT, x.path)));

  const bad = { ...ORDER, staging: { ...ORDER.staging, pattern: 'plain_gradient' } };
  await assert.rejects(makeCard({ order: bad, collection: 'c', set: 's', settings: SETTINGS, provider: p, root }), e => e instanceof OrderError && e.errors.length > 0);
  assert.equal(p.calls.length, 1, 'за негодный заказ не заплачено');
});

test('цикл: ошибка провайдера и неизвестная цена записываются и останавливают запуск', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { ProviderError } = await import('../core/providers/openrouter.js');
  const root = tmp();
  const failing = async () => { throw new ProviderError('Провайдер вернул HTTP 402 (/images): нет средств', { status: 402 }); };
  const r = await makeCard({ order: ORDER, collection: 'c', set: 's', settings: SETTINGS, provider: { model: MODEL, generate: failing }, buildPrompt: fakePrompt, root });
  assert.equal(r.stop, 'provider-error');
  assert.deepEqual(r.attempts[0].error, { stage: 'generate', message: 'Провайдер вернул HTTP 402 (/images): нет средств', status: 402 });
  assert.equal(r.chosen, null);
  assert.equal(r.image, null);

  const p = fakeProvider(await grey(), null);
  const u = await makeCard({ order: ORDER, collection: 'c', set: 's', settings: SETTINGS, provider: p, buildPrompt: fakePrompt, root });
  assert.equal(u.stop, 'cost-unknown');
  assert.equal(p.calls.length, 1);
  assert.deepEqual(u.attempts.map(a => a.n), [2]);
  assert.equal(u.chosen, 2);

  // a provider without payment per image (Codex): cost 0, the cap does not stop it, the attempt limit does
  const free = fakeProvider(await grey(), null, { model: 'codex-cli', free: true });
  const f = await makeCard({ order: ORDER, collection: 'c', set: 'free', settings: SETTINGS, provider: free, buildPrompt: fakePrompt, root, limits: { attempts: 2 } });
  assert.equal(f.stop, 'attempts');
  assert.deepEqual(f.attempts.map(a => a.cost), [0, 0]);
  assert.deepEqual(f.warnings, [], 'у codex-cli свои начальные настройки обработки (нейтральные)');
});

test('цикл: опорный портрет персонажа — свой кадр, без обрезки до карточки, без пиксельных проверок, список для глаз', { skip: noSharp }, async () => {
  const { makeCard, recheckCard } = /** @type {any} */ (loop);
  const assembly = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/prompt-assembly.json'), 'utf8'));
  const rules = assembly.kinds['character-sheet'];
  const order = { kind: 'character-sheet', id: 'sheet-pig', style: 'scapes', character: 'pig' };
  const tall = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();
  const p = fakeProvider(tall, 0.04);
  const r = await makeCard({ order, collection: 'c', set: 's', settings: SETTINGS, provider: p, root: tmp() });
  assert.equal(r.stop, 'passed', 'проверять нечего — повтор не нужен');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].aspectRatio, rules.output.aspectRatio);
  assert.deepEqual(p.calls[0].references.map(x => path.basename(x.path)), assembly.cast.pig.anchor_frames.map(n => `card-${String(n).padStart(3, '0')}.png`), 'эталоны — опорные кадры');
  const meta = await sharp(r.image).metadata();
  assert.deepEqual([meta.width, meta.height], [600, 900], 'кадр модели не обрезан');
  assert.deepEqual(r.chosenCheck, { maskStatus: 'not checked', blocking: 0, warns: 0, fails: [] });
  assert.deepEqual(r.chosenVisual, rules.output.visual);
  assert.deepEqual(JSON.parse(fs.readFileSync(r.attempts[0].files.check, 'utf8')).results, []);
  const re = await recheckCard({ dir: r.dir });
  assert.deepEqual(re.chosenCheck, r.chosenCheck);

  // an ordinary card asks for the provider settings' frame
  const card = fakeProvider(await grey(), 0.04);
  await makeCard({ order: ORDER, collection: 'c', set: 's', settings: SETTINGS, provider: card, buildPrompt: fakePrompt, root: tmp(), limits: { attempts: 1 } });
  assert.ok(!('aspectRatio' in card.calls[0]));
});

test('цикл: провайдер из настроек — неизвестный отклоняется, codex-cli бесплатный и без ключа', { skip: noSharp }, () => {
  const { providerFrom } = /** @type {any} */ (loop);
  const real = loadSettings();
  assert.throws(() => providerFrom({ ...real.provider, use: 'nope' }), /неизвестный провайдер/);
  const codex = providerFrom({ ...real.provider, use: 'codex-cli' });
  assert.equal(codex.free, true);
  assert.equal(codex.model, 'codex-cli');
});

// ---------- per-card processing search ----------

test('подбор обработки: из начальных настроек — в цель с наименьшим сдвигом, не выталкивая то, что уже в цели', { skip: noSharp }, async () => {
  const { tuneProcessing, outside } = await import('../core/card/tune.js');
  assert.equal(outside(5, { min: 0, max: 10 }), 0);
  assert.equal(outside(12, { min: 0, max: 10 }), 0.2);
  assert.equal(outside(4, { min: 8 }), 0.5);
  // fake measures of a 1 × 1 card: C = chroma, L = luma; X stays in its aim only while saturation ≤ 1.2
  const px = Uint8Array.of(150, 100, 50);
  const measure = (rgb, prefix) => {
    const chroma = rgb[0] - rgb[2], luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const all = [
      { id: 'COLOUR.C', value: chroma, aim: { min: 130, max: 160 } },
      { id: 'COLOUR.L', value: luma, aim: { min: 115, max: 130 } }, // luma 109.25 at the start
      { id: 'COLOUR.X', value: chroma, aim: { max: 125 } },
      { id: 'RENDERING.S', value: 1, aim: { max: 2 } },
    ];
    return all.filter(m => !prefix || m.id.startsWith(prefix));
  };
  const neutral = { brightness: 0, saturation: 1, sharpen: { amount: 0, radius: 1 } };
  const bounds = { saturation: { min: 0.8, max: 1.6, step: 0.1, serves: 'COLOUR.' }, brightness: { min: -10, max: 10, step: 2, serves: 'COLOUR.' }, sharpen: { min: 0, max: 0.4, step: 0.1, serves: 'RENDERING.' } };
  const r = tuneProcessing({ pixels: px, width: 1, height: 1, start: neutral, neutral, bounds, measure, basis: 'test' });
  // chroma 100 → needs saturation ≥ 1.3 for C, but X (in its aim at the start) must stay ≤ 125: saturation ≤ 1.2 wins
  assert.ok(r.settings.saturation <= 1.2 + 1e-9, `saturation ${r.settings.saturation}`);
  assert.equal(r.settings.saturation, 1.2, 'as close to C as X allows');
  const L = r.tuning.measures.find(m => m.id === 'COLOUR.L');
  assert.ok(L.start < 115 && L.chosen >= 115 && L.chosen <= 130, 'luma brought into its aim by brightness');
  assert.equal(r.settings.brightness, 6, 'the smallest brightness step that reaches the aim');
  assert.equal(r.settings.sharpen.amount, 0, 'nothing to sharpen for: no change');
  assert.ok(r.tuning.miss.chosen < r.tuning.miss.start);
  assert.deepEqual(r.tuning.start, neutral);
});

test('подбор обработки в цикле: настройки и меры до и после записаны в card.json, card.png — с выбранными настройками', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { adjust } = await import('../core/image/adjust.js');
  // a reference card darkened and greyed as a "model answer": the search has something to bring back
  const bytes = await sharp(path.join(ROOT, 'styles/scapes/references/card-003.png')).modulate({ brightness: 0.7, saturation: 0.6 }).png().toBuffer();
  const p = fakeProvider(bytes, 0.04);
  const r = await makeCard({ order: ORDER, collection: 'c', set: 's', settings: { ...SETTINGS, card: { ...SETTINGS.card, tuneProcessing: true } }, provider: p, buildPrompt: fakePrompt, root: tmp(), limits: { attempts: 1 } });
  const a = JSON.parse(fs.readFileSync(path.join(r.dir, 'card.json'), 'utf8')).attempts[0];
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8'));
  assert.deepEqual(a.tuning.start, own.start[MODEL]);
  assert.equal(a.tuning.basis, 'whole card');
  assert.ok(a.tuning.measures.some(m => m.id === 'COLOUR.1') && !a.tuning.measures.some(m => m.id.startsWith('COLOUR.8')), 'без подтверждённого контура — только меры всей карточки');
  assert.ok(a.tuning.miss.chosen <= a.tuning.miss.start);
  assert.ok(a.processing.saturation >= own.bounds.saturation.min && a.processing.saturation <= own.bounds.saturation.max);
  assert.ok(a.processing.sharpen.amount <= own.sharpen_amount_max);
  const prepared = await sharp(path.join(r.dir, 'attempts/1/prepared.png')).raw().toBuffer({ resolveWithObject: true });
  const card = await sharp(path.join(r.dir, 'attempts/1/card.png')).raw().toBuffer();
  assert.deepEqual(Buffer.from(adjust(prepared.data, prepared.info.width, prepared.info.height, a.processing)), card);
});

// ---------- fallback model ----------

test('запасная модель: только когда основная не справилась; записана в попытке; потолок расходов проверяется и для неё', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { ProviderError } = await import('../core/providers/openrouter.js');
  const root = tmp();
  const FALLBACK = 'openai/gpt-image-2.5-flare';
  const refuse = async () => { throw new ProviderError('Провайдер ответил без картинки.', { status: 200 }); };
  const image = await grey();
  const backup = fakeProvider(image, 0.05, { model: FALLBACK });
  const run = (provider, limits) => makeCard({ order: ORDER, collection: 'c', set: 'fb', settings: SETTINGS, provider, buildPrompt: fakePrompt, root, limits });

  // the main model answers: the fallback is not called
  const ok = await run({ ...fakeProvider(image, 0.04), fallback: backup }, { attempts: 1 });
  assert.equal(backup.calls.length, 0);
  assert.equal(ok.attempts[0].model, MODEL);
  assert.equal(ok.attempts[0].fallbackFrom, undefined);

  // the main model refuses: the fallback makes the attempt, with its own start processing
  const r = await run({ model: MODEL, generate: refuse, fallback: backup }, { attempts: 1 });
  assert.equal(backup.calls.length, 1);
  assert.equal(backup.calls[0].prompt, 'PROMPT');
  const a = JSON.parse(fs.readFileSync(path.join(r.dir, 'card.json'), 'utf8')).attempts.at(-1);
  assert.equal(a.model, FALLBACK);
  assert.deepEqual(a.fallbackFrom, { model: MODEL, error: { message: 'Провайдер ответил без картинки.', status: 200 } });
  assert.equal(a.cost, 0.05);
  assert.deepEqual(a.processing, JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8')).start[FALLBACK]);
  assert.ok(a.check, 'the fallback image went through processing and checks');

  // both fail: the fallback's error is the attempt's error, the run stops
  const failing = { model: FALLBACK, generate: async () => { throw new ProviderError('Провайдер вернул HTTP 402 (/images): нет средств', { status: 402 }); } };
  const both = await run({ model: MODEL, generate: refuse, fallback: failing }, { attempts: 2 });
  assert.equal(both.stop, 'provider-error');
  assert.equal(both.attempts.length, 1);
  assert.equal(both.attempts[0].error.status, 402);
  assert.equal(both.attempts[0].fallbackFrom.model, MODEL);

  // the fallback's known price (0.05) would pass the cap: it is not called
  const before = backup.calls.length;
  const capped = await run({ model: MODEL, generate: refuse, fallback: backup }, { attempts: 1, maxSpendUsd: 0.04 });
  assert.equal(capped.stop, 'budget');
  assert.equal(backup.calls.length, before);
  assert.match(capped.attempts[0].error.message, /без картинки/);
});

test('запасная модель из настроек: fallbackModel у OpenRouter; у codex-cli её нет', { skip: noSharp }, () => {
  const { providerFrom } = /** @type {any} */ (loop);
  const real = loadSettings().provider;
  process.env.CCF_TEST_KEY = 'test-key';
  const p = providerFrom({ ...real, openrouter: { ...real.openrouter, keyEnvVar: 'CCF_TEST_KEY' } });
  assert.equal(p.model, real.openrouter.model);
  assert.equal(p.fallback.model, real.openrouter.fallbackModel);
  assert.equal(providerFrom({ ...real, openrouter: { ...real.openrouter, keyEnvVar: 'CCF_TEST_KEY', fallbackModel: null } }).fallback, undefined);
  assert.equal(providerFrom({ ...real, use: 'codex-cli' }).fallback, undefined);
  delete process.env.CCF_TEST_KEY;
});

