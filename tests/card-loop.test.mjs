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
  assert.match(help.stdout, /editor --stop/, 'общая справка — все формы команды');
  assert.match(help.stdout, /card adjust CARD_DIR \[--attempt N\] --reset/);
  for (const c of [['card', 'make'], ['card', 'regenerate'], ['card', 'edit'], ['card', 'adjust'], ['card', 'import'], ['card', 'choose'], ['card', 'prompt'], ['card', 'check'], ['models'], ['credits']]) {
    assert.equal(ccf(...c, '--help').status, 0, c.join(' '));
    const bad = ccf(...c, ...(c[0] === 'card' ? ['x'] : []), '--no-such-option');
    assert.equal(bad.status, 2, c.join(' '));
    assert.match(bad.stderr, /Unknown option '--no-such-option'/);
  }
  assert.equal(ccf('nope').status, 2);
  assert.equal(ccf('card', 'make', 'x.json').status, 2, 'без --collection');
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c', '--set', 's').status, 2, '--set без --slot');
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c', '--set', 's', '--slot', '11').status, 2, 'слот вне 1–10');
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c', '--attempts', '0').status, 2);
  assert.equal(ccf('card', 'regenerate', 'x').status, 2, 'без --wish');
  assert.equal(ccf('card', 'edit', 'x', '--wish', ' ').status, 2, 'пустое пожелание');
  assert.equal(ccf('card', 'adjust', 'x').status, 2, 'без значений');
  assert.equal(ccf('card', 'adjust', 'x', '--saturation', '-1').status, 2);
  assert.equal(ccf('card', 'import', 'x').status, 2, 'без картинки');
  assert.equal(ccf('card', 'check', 'x', '--mask', 'confirmed').status, 2, '--mask без --attempt');
  assert.equal(ccf('card', 'make', 'x.json', '--collection', 'c', '--provider', 'dalle').status, 2, 'неизвестный провайдер');
  const missing = ccf('card', 'check', path.join(tmp(), 'none'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Нет карточки/);
});

// ---------- the loop ----------

const loop = hasSharp ? await import('../core/card/make.js') : null;
const sharp = hasSharp ? (await import('sharp')).default : null;
const { createStore } = await import('../core/store/index.js');
/** A store over a temporary folder with one collection: where a test's cards go. */
const pool = async () => { const store = createStore({ root: tmp() }); return { store, collection: (await store.createCollection({ title: 'Тест' })).id }; };

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
  const at = await pool();
  const p = fakeProvider(await grey(), 0.08);
  const r = await makeCard({ order: ORDER, ...at, settings: SETTINGS, provider: p, buildPrompt: fakePrompt });
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
  const dir = at.store.cardDir(at.collection, 'test-card');
  assert.equal(r.dir, dir, 'новая карточка — в хранилище коллекции, id из id заказа');
  assert.equal(r.id, 'test-card');
  const meta = await sharp(path.join(dir, 'card.png')).metadata();
  assert.deepEqual([meta.width, meta.height], [430, 480]);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'));
  assert.equal(file.chosen, 1);
  assert.deepEqual(file.attempts.map(a => [a.n, a.cost, a.prompt]), [[1, 0.08, 'PROMPT'], [2, 0.08, 'PROMPT']]);
  assert.equal(file.attempts[0].references[0], 'styles/scapes/references/card-003.png');
  assert.deepEqual(file.attempts[0].processing, JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8')).start[MODEL]);

  // second run on the same card: the known price limits it from the first call; attempts continue numbering
  const again = await makeCard({ order: ORDER, ...at, card: r.id, settings: SETTINGS, provider: p, buildPrompt: fakePrompt, limits: { maxSpendUsd: 0.1 } });
  assert.equal(again.dir, dir);
  assert.equal(again.stop, 'budget');
  assert.deepEqual(again.attempts.map(a => a.n), [3]);
  assert.equal(p.calls.length, 3);

  // re-check one attempt with what was seen by eye
  await assert.rejects(recheckCard({ dir, review: { mask: 'rejected' } }), /номер/);
  const re = await recheckCard({ dir, n: 2, review: { mask: 'rejected', hero_box: [100, 100, 300, 400] } });
  assert.deepEqual(re.attempts.map(a => a.n), [2]);
  // a new box replaces the verdict on the outline shown before it: the outline is now the one cut in the box
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8')).attempts[1].review, { hero_box: [100, 100, 300, 400] });

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
  const r = await makeCard({ order, ...await pool(), settings: SETTINGS, provider: p, buildPrompt: fakePrompt, limits: { attempts: 2 } });
  assert.ok(['passed', 'attempts'].includes(r.stop), r.stop);
  assert.ok(p.calls.length <= 2);
  if (r.stop === 'passed') assert.equal(r.attempts.at(-1).check.blocking, 0);
  assert.equal(r.chosen, r.chosenCheck && r.attempts.find(a => a.n === r.chosen)?.n);
  assert.ok(fs.existsSync(r.image));
});

test('цикл: запрос собирает core/style; негодный заказ отклоняется до платного вызова', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { buildPrompt, OrderError } = await import('../core/style/prompt.js');
  const at = await pool();
  const p = fakeProvider(await grey(), 0.04);
  const r = await makeCard({ order: ORDER, ...at, settings: SETTINGS, provider: p, limits: { attempts: 1 } });
  const built = await buildPrompt(ORDER);
  assert.equal(p.calls[0].prompt, built.prompt);
  assert.deepEqual(p.calls[0].references, built.references.map(x => ({ path: x.path })));
  const file = JSON.parse(fs.readFileSync(path.join(r.dir, 'card.json'), 'utf8'));
  assert.deepEqual(file.attempts[0].references, built.references.map(x => path.relative(ROOT, x.path)));

  const bad = { ...ORDER, staging: { ...ORDER.staging, pattern: 'plain_gradient' } };
  await assert.rejects(makeCard({ order: bad, ...at, settings: SETTINGS, provider: p }), e => e instanceof OrderError && e.errors.length > 0);
  assert.equal(p.calls.length, 1, 'за негодный заказ не заплачено');
  assert.deepEqual((await at.store.listCards(at.collection)).map(c => c.id), ['test-card'], 'и карточка под него не заведена');
});

test('цикл: ошибка провайдера и неизвестная цена записываются и останавливают запуск', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { ProviderError } = await import('../core/providers/openrouter.js');
  const at = await pool();
  const failing = async () => { throw new ProviderError('Провайдер вернул HTTP 402 (/images): нет средств', { status: 402 }); };
  const r = await makeCard({ order: ORDER, ...at, settings: SETTINGS, provider: { model: MODEL, generate: failing }, buildPrompt: fakePrompt });
  assert.equal(r.stop, 'provider-error');
  assert.deepEqual(r.attempts[0].error, { stage: 'generate', message: 'Провайдер вернул HTTP 402 (/images): нет средств', status: 402 });
  assert.equal(r.chosen, null);
  assert.equal(r.image, null);

  const p = fakeProvider(await grey(), null);
  const u = await makeCard({ order: ORDER, ...at, card: r.id, settings: SETTINGS, provider: p, buildPrompt: fakePrompt });
  assert.equal(u.stop, 'cost-unknown');
  assert.equal(p.calls.length, 1);
  assert.deepEqual(u.attempts.map(a => a.n), [2]);
  assert.equal(u.chosen, 2);

  // a provider without payment per image (Codex): cost 0, the cap does not stop it, the attempt limit does
  const free = fakeProvider(await grey(), null, { model: 'codex-cli', free: true });
  const f = await makeCard({ order: ORDER, ...at, settings: SETTINGS, provider: free, buildPrompt: fakePrompt, limits: { attempts: 2 } });
  assert.equal(f.id, 'test-card-2', 'без --card — новая карточка с незанятым id');
  assert.equal(f.stop, 'attempts');
  assert.deepEqual(f.attempts.map(a => a.cost), [0, 0]);
  assert.deepEqual(f.warnings.filter(w => !/Смотрящая модель не спрошена/.test(w)), [], 'у codex-cli свои начальные настройки обработки (нейтральные)');
});

test('цикл: опорный портрет персонажа — свой кадр, без обрезки до карточки, без пиксельных проверок, список для глаз', { skip: noSharp }, async () => {
  const { makeCard, recheckCard } = /** @type {any} */ (loop);
  const assembly = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/prompt-assembly.json'), 'utf8'));
  const rules = assembly.kinds['character-sheet'];
  const order = { kind: 'character-sheet', id: 'sheet-pig', style: 'scapes', character: 'pig' };
  const tall = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 128, g: 128, b: 128 } } }).png().toBuffer();
  const p = fakeProvider(tall, 0.04);
  const r = await makeCard({ order, ...await pool(), settings: SETTINGS, provider: p });
  assert.equal(r.stop, 'passed', 'проверять нечего — повтор не нужен');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].aspectRatio, rules.output.aspectRatio);
  assert.deepEqual(p.calls[0].references.map(x => path.basename(x.path)), assembly.cast.pig.anchor_frames.map(n => `card-${String(n).padStart(3, '0')}.png`), 'эталоны — опорные кадры');
  const meta = await sharp(r.image).metadata();
  assert.deepEqual([meta.width, meta.height], [600, 900], 'кадр модели не обрезан');
  assert.deepEqual(r.chosenCheck, { maskStatus: 'not checked', blocking: 0, needsEyes: 0, warns: 0, fails: [] });
  assert.deepEqual(r.chosenVisual, rules.output.visual);
  assert.deepEqual(JSON.parse(fs.readFileSync(r.attempts[0].files.check, 'utf8')).results, []);
  const re = await recheckCard({ dir: r.dir });
  assert.deepEqual(re.chosenCheck, r.chosenCheck);

  // an ordinary card asks for the provider settings' frame
  const card = fakeProvider(await grey(), 0.04);
  await makeCard({ order: ORDER, ...await pool(), settings: SETTINGS, provider: card, buildPrompt: fakePrompt, limits: { attempts: 1 } });
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

  // the shadow axis, when the bounds give it: the darkest tone lifted into its aim, brightness not misused for it
  const dark = Uint8Array.of(30, 30, 30, 200, 120, 60);
  const shade = rgb => [{ id: 'COLOUR.D', value: Math.min(rgb[0], rgb[3]), aim: { min: 40, max: 50 } }, { id: 'COLOUR.B', value: rgb[3], aim: { min: 199, max: 201 } }];
  const withShadows = { ...bounds, shadows: { min: 0, max: 40, step: 4, serves: 'COLOUR.' } };
  const s = tuneProcessing({ pixels: dark, width: 2, height: 1, start: neutral, neutral, bounds: withShadows, measure: shade, basis: 'test' });
  assert.equal(s.settings.brightness, 0, 'яркость подняла бы и светлое — его держит его цель');
  assert.ok(s.settings.shadows > 0, `тени ${s.settings.shadows}`);
  assert.ok(s.tuning.measures.find(m => m.id === 'COLOUR.D').chosen >= 40);
  assert.equal(tuneProcessing({ pixels: dark, width: 2, height: 1, start: neutral, neutral, bounds, measure: shade, basis: 'test' }).settings.shadows, undefined, 'без оси теней — их не трогают');
});

test('подъём теней: только для постановок из processing.json (сцены), с целью оттуда', { skip: noSharp }, () => {
  const { shadowLiftFor } = /** @type {any} */ (loop);
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8'));
  assert.deepEqual(shadowLiftFor(own, { characters: 2 }), { check: own.shadows.check, aim: own.shadows.aim });
  assert.equal(shadowLiftFor(own, { characters: 0 }), null);
  assert.equal(shadowLiftFor(own, {}), null);
  assert.equal(shadowLiftFor({ ...own, shadows: undefined }, { characters: 2 }), null);
});

test('подбор обработки в цикле: настройки и меры до и после записаны в card.json, card.png — с выбранными настройками', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { adjust } = await import('../core/image/adjust.js');
  // a reference card darkened and greyed as a "model answer": the search has something to bring back
  const bytes = await sharp(path.join(ROOT, 'styles/scapes/references/card-003.png')).modulate({ brightness: 0.7, saturation: 0.6 }).png().toBuffer();
  const p = fakeProvider(bytes, 0.04);
  const r = await makeCard({ order: ORDER, ...await pool(), settings: { ...SETTINGS, card: { ...SETTINGS.card, tuneProcessing: true } }, provider: p, buildPrompt: fakePrompt, limits: { attempts: 1 } });
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
  const at = await pool();
  const FALLBACK = 'openai/gpt-image-2.5-flare';
  const refuse = async () => { throw new ProviderError('Провайдер ответил без картинки.', { status: 200 }); };
  const image = await grey();
  const backup = fakeProvider(image, 0.05, { model: FALLBACK });
  // every run continues one card: the fallback's price known from an earlier run is what keeps the cap
  let card;
  const run = async (provider, limits) => { const x = await makeCard({ order: ORDER, ...at, card, settings: SETTINGS, provider, buildPrompt: fakePrompt, limits }); card ??= x.id; return x; };

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

test('профиль модели в запросе: GPT Image получает 3:4 вместо 4:5 (1:1 для карточки), Nano Banana — 4:5 и 1K; --model меняет основную', { skip: noSharp }, async t => {
  const { providerFrom } = /** @type {any} */ (loop);
  const real = loadSettings().provider;
  /** @type {any[]} */
  const sent = [];
  const png = Buffer.from('x').toString('base64');
  t.mock.method(globalThis, 'fetch', async (/** @type {any} */ _url, /** @type {any} */ init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: [{ b64_json: png }], usage: { cost: 0.01 } }) };
  });
  const p = providerFrom(real, { apiKey: 'test-key' });
  await p.generate({ prompt: 'p', references: [] });
  await p.fallback.generate({ prompt: 'p', references: [] });
  await p.fallback.generate({ prompt: 'p', references: [], crop: { width: 430, height: 480 } });
  assert.deepEqual([sent[0].model, sent[0].aspect_ratio, sent[0].resolution], [real.openrouter.model, '4:5', '1K']);
  assert.deepEqual([sent[1].model, sent[1].aspect_ratio, 'resolution' in sent[1]], ['openai/gpt-image-2.5-flare', '3:4', false]);
  assert.equal(sent[2].aspect_ratio, '1:1', 'режется до карточки — пропорция с наименьшим срезом');
  const chosen = providerFrom(real, { apiKey: 'test-key', model: real.openrouter.fallbackModel });
  assert.equal(chosen.model, real.openrouter.fallbackModel);
  assert.equal(chosen.fallback, undefined, 'запасная совпала с выбранной — её нет');
  assert.throws(() => providerFrom({ ...real, use: 'codex-cli' }, { model: 'a/b' }), /только у сервиса с ключом/);
  // a model's framing correction ends its own prompt; the fallback model without one gets the prompt as it is
  const models = structuredClone(real.models);
  models[real.openrouter.model] = { ...models[real.openrouter.model], framing: 'Draw it larger.' };
  delete models[real.openrouter.fallbackModel].framing;
  const framed = providerFrom({ ...real, models }, { apiKey: 'test-key' });
  await framed.generate({ prompt: 'p', references: [] });
  await framed.fallback.generate({ prompt: 'p', references: [] });
  assert.deepEqual(sent.slice(-2).map(b => b.prompt), ['p\n\nDraw it larger.', 'p']);
});

// ---------- the collection's pool and a person's requests on a card ----------

const REAL_CARD = loadSettings().card; // the edit prompt and legend as the factory sends them
const OPS = { ...SETTINGS, card: { ...SETTINGS.card, editPrompt: REAL_CARD.editPrompt, editLegend: REAL_CARD.editLegend } };
const reference = () => fs.readFileSync(path.join(ROOT, 'styles/scapes/references/card-003.png'));
/** A prompt that shows what the order asked for: the wish must reach it. */
const echoPrompt = async o => ({ prompt: ['PROMPT', o.promptOverride, o.promptExtra].filter(Boolean).join(' | '), references: [] });
const cardOf = dir => JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'));
const SET = { title: 'Набор', brief: { theme: 'рыбалка', wishes: '', variants: 1 }, window: { kind: 'large', template: 'blue' } };

test('хранилище: новая карточка ложится в слот набора; заказ на занятый id даёт новый id', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const at = await pool();
  const set = await at.store.createSet(at.collection, SET);
  const r = await makeCard({ order: ORDER, ...at, place: { setId: set.id, slot: 2 }, settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt, limits: { attempts: 1 } });
  assert.equal((await at.store.getSet(at.collection, set.id)).slots[2], r.id);
  const second = await makeCard({ order: ORDER, ...at, settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt, limits: { attempts: 1 } });
  assert.equal(second.id, 'test-card-2');
  assert.deepEqual((await at.store.listCards(at.collection, { pool: true })).map(c => c.id), ['test-card-2'], 'без места — в хранилище, вне наборов');
  await assert.rejects(makeCard({ order: ORDER, ...at, card: 'no-such', settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt }), /нет карточки «no-such»/);
});

test('перегенерация с пожеланием: слова человека — в запросе, одна попытка, её результат становится карточкой и остаётся после перепроверки', { skip: noSharp }, async () => {
  const { makeCard, regenerateCard, recheckCard } = /** @type {any} */ (loop);
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/checks/reference-spec.json'), 'utf8')).cards.find(c => c.id === 'ref-003');
  const { id, ref, file, set, mask, ...staging } = spec;
  const order = { ...ORDER, staging };
  const made = await makeCard({ order, ...await pool(), settings: SETTINGS, provider: fakeProvider(reference(), 0.04), buildPrompt: echoPrompt, limits: { attempts: 1 } });
  const before = made.chosenCheck;
  const p = fakeProvider(await grey(), 0.04);
  await assert.rejects(regenerateCard({ dir: made.dir, wish: '  ', settings: OPS, provider: p, buildPrompt: echoPrompt }), /Пожелание пустое/);
  const r = await regenerateCard({ dir: made.dir, wish: 'поплавок синий', settings: OPS, provider: p, buildPrompt: echoPrompt });
  assert.equal(p.calls.length, 1, 'одна попытка по умолчанию');
  assert.equal(p.calls[0].prompt, 'PROMPT | поплавок синий');
  assert.equal(r.limits.attempts, 1);
  const c = cardOf(made.dir);
  assert.equal(c.attempts[1].wish, 'поплавок синий');
  assert.equal(c.order.promptExtra, undefined, 'заказ не меняется: пожелание — в попытке');
  assert.ok(r.chosenCheck.blocking > before.blocking, 'серая попытка хуже эталонной по проверкам…');
  assert.equal(r.chosen, 2, '…но её просил человек — она и есть карточка');
  assert.equal(c.chosenBy, 'request');
  assert.equal((await recheckCard({ dir: made.dir })).chosen, 2, 'перепроверка выбор человека не отменяет');

  // an order with promptOverride: the wish is added to the override (promptExtra would be ignored)
  const over = await makeCard({ order: { ...ORDER, promptOverride: 'MY PROMPT' }, ...await pool(), settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: echoPrompt, limits: { attempts: 1 } });
  const q = fakeProvider(await grey(), 0.04);
  await regenerateCard({ dir: over.dir, wish: 'ярче', settings: OPS, provider: q, buildPrompt: echoPrompt });
  assert.equal(q.calls[0].prompt, 'PROMPT | MY PROMPT ярче');
});

test('правка картинки: картинка модели выбранной попытки уходит входной картинкой с пожеланием; новая попытка проходит обработку и проверки', { skip: noSharp }, async () => {
  const { makeCard, editCard } = /** @type {any} */ (loop);
  const made = await makeCard({ order: ORDER, ...await pool(), settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt, limits: { attempts: 1 } });
  const p = fakeProvider(reference(), 0.05);
  const r = await editCard({ dir: made.dir, wish: 'убери антенну', settings: OPS, provider: p });
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].prompt, REAL_CARD.editPrompt.replace('{wish}', 'убери антенну'));
  assert.deepEqual(p.calls[0].references, [{ path: path.join(made.dir, 'attempts/1/model.png') }]);
  assert.equal(p.calls[0].legend, REAL_CARD.editLegend);
  const a = cardOf(made.dir).attempts[1];
  assert.deepEqual([a.editOf, a.wish, a.cost, a.references], [1, 'убери антенну', 0.05, [path.relative(ROOT, path.join(made.dir, 'attempts/1/model.png'))]]);
  assert.ok(a.check && a.processing);
  assert.equal(r.chosen, 2);
  await assert.rejects(editCard({ dir: made.dir, wish: 'x', n: 9, settings: OPS, provider: p }), /нет попытки 9/);
});

test('ручная обработка: card.png заново из prepared.png с заданными значениями, они помечены как ручные, выбор не меняется', { skip: noSharp }, async () => {
  const { makeCard, adjustCard } = /** @type {any} */ (loop);
  const { adjust } = await import('../core/image/adjust.js');
  const made = await makeCard({ order: ORDER, ...await pool(), settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt, limits: { attempts: 2 } });
  assert.equal(made.chosen, 1);
  await assert.rejects(adjustCard({ dir: made.dir }), /Не задано/);
  const r = await adjustCard({ dir: made.dir, n: 2, saturation: 1.1, sharpen: 0.2 });
  const a = cardOf(made.dir).attempts[1];
  const start = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8')).start[MODEL];
  assert.deepEqual(a.processing, { ...start, saturation: 1.1, sharpen: { ...start.sharpen, amount: 0.2 } });
  assert.equal(a.processingFixed, true);
  assert.equal(r.chosen, 1, 'правили не выбранную попытку — выбор прежний');
  const prepared = await sharp(path.join(made.dir, 'attempts/2/prepared.png')).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(await sharp(path.join(made.dir, 'attempts/2/card.png')).raw().toBuffer(), Buffer.from(adjust(prepared.data, prepared.info.width, prepared.info.height, a.processing)));

  // the chosen attempt: the card itself is drawn again; the same through the command line
  const cli = ccf('card', 'adjust', made.dir, '--brightness', '4', '--json');
  assert.equal(cli.status, 1, 'серая карточка — с блокирующими FAIL');
  assert.equal(JSON.parse(cli.stdout).chosen, 1);
  assert.equal(cardOf(made.dir).attempts[0].processing.brightness, 4);
  assert.deepEqual(fs.readFileSync(path.join(made.dir, 'card.png')), fs.readFileSync(path.join(made.dir, 'attempts/1/card.png')));
});

test('картинка от агента: новая попытка карточки или новая карточка из заказа; модель agent, цена 0, нейтральный старт обработки', { skip: noSharp }, async () => {
  const { makeCard, importImage } = /** @type {any} */ (loop);
  const { OrderError } = await import('../core/style/prompt.js');
  const at = await pool();
  const image = path.join(tmp(), 'drawn.png');
  fs.writeFileSync(image, reference());
  const made = await makeCard({ order: ORDER, ...at, settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt, limits: { attempts: 1 } });
  const r = await importImage({ dir: made.dir, image, settings: SETTINGS });
  const a = cardOf(made.dir).attempts[1];
  assert.deepEqual([a.model, a.cost, a.prompt, a.references], ['agent', 0, '', []]);
  assert.deepEqual(a.processing, JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8')).neutral);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Смотрящая модель не спрошена/, 'без ключа — сказано, что взгляда не было');
  assert.equal(r.chosen, 2);
  assert.match(fs.readdirSync(path.join(made.dir, 'attempts/2')).join(' '), /model\.png/);

  const set = await at.store.createSet(at.collection, SET);
  const fresh = await importImage({ order: { ...ORDER, id: 'drawn' }, collection: at.collection, place: { setId: set.id, slot: 0 }, image, settings: SETTINGS, store: at.store });
  assert.equal(fresh.id, 'drawn');
  assert.equal((await at.store.getSet(at.collection, set.id)).slots[0], 'drawn');
  const bad = { ...ORDER, id: 'bad', staging: { ...ORDER.staging, pattern: 'plain_gradient' } };
  await assert.rejects(importImage({ order: bad, collection: at.collection, image, settings: SETTINGS, store: at.store }), e => e instanceof OrderError);
  assert.ok(!fs.existsSync(at.store.cardDir(at.collection, 'bad')), 'под негодный заказ карточка не заведена');
  await assert.rejects(importImage({ dir: made.dir, image: path.join(ROOT, 'package.json'), settings: SETTINGS }), /PNG, JPEG или WebP/);

  const cli = ccf('card', 'import', made.dir, image, '--json');
  assert.equal(JSON.parse(cli.stdout).chosen, 3, cli.stderr);
  assert.equal(ccf('card', 'import', made.dir, image, '--collection', 'x').status, 1, 'коллекция — только с заказом');
});

test('картинка со стороны проверяется так же строго: рамка героя и взгляд смотрящей модели, их расходы; повторная сдача той же картинки не проходит легче', { skip: noSharp }, async () => {
  const { makeCard, importImage } = /** @type {any} */ (loop);
  const real = loadSettings();
  const settings = { ...real, card: { ...real.card, attempts: 1, tuneProcessing: false } };
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/checks/reference-spec.json'), 'utf8')).cards.find(c => c.id === 'ref-003');
  const { id, ref, file, set, mask, ...staging } = spec;
  const order = { ...ORDER, title: 'Lantern', subject: 'a glowing lantern', object: 'lantern', staging: { ...staging, material: 'metal' } };
  const asked = [];
  const vision = async req => {
    asked.push(req);
    if (/box_2d/.test(req.prompt)) return { text: '{"box_2d": [60, 180, 940, 820]}', cost: 0.001 };
    return { text: JSON.stringify({ subject: { ok: false, why: 'a candle' }, staging: { ok: true }, additions: { ok: true }, costume: { ok: null }, checklist: [] }), cost: 0.002 };
  };
  const bytes = fs.readFileSync(path.join(ROOT, 'styles/scapes/references/card-003.png'));
  // the provider's model has the same processing start as an image handed in (neutral; Codex's is too)
  const made = await makeCard({ order, ...await pool(), settings, provider: fakeProvider(bytes, 0.04, { vision, model: 'codex-cli' }), buildPrompt: fakePrompt });
  const image = path.join(made.dir, 'attempts/1/model.png');
  const before = asked.length;
  const r = await importImage({ dir: made.dir, image, settings, vision });
  assert.equal(asked.length - before, 3, 'две рамки героя (карточка и зеркало) и взгляд — как у сгенерированной');
  assert.deepEqual(r.warnings, []);
  const [gen, imp] = cardOf(made.dir).attempts;
  assert.equal(imp.hero.source, 'vision');
  assert.equal(imp.look.verdict, 'fix');
  assert.deepEqual([imp.check.blocking, imp.check.needsEyes, imp.check.maskStatus], [gen.check.blocking, gen.check.needsEyes, gen.check.maskStatus], 'та же картинка — тот же итог проверок');
  assert.equal(imp.cost, 0, 'картинка не оплачена…');
  const { attemptSpend } = await import('../core/card/card-file.js');
  assert.ok(Math.abs(attemptSpend(imp).vision - 0.004) < 1e-9, '…а взгляд — да');
});

test('версии карточки: любую готовую попытку можно сделать карточкой; выбор остаётся после перепроверки; негодную — нельзя', { skip: noSharp }, async () => {
  const { makeCard, chooseAttempt, recheckCard, regenerateCard } = /** @type {any} */ (loop);
  const p = { ...fakeProvider(reference(), 0.04), generate: async () => { throw Object.assign(new Error('no image'), { status: 500 }); } };
  const made = await makeCard({ order: ORDER, ...await pool(), settings: SETTINGS, provider: fakeProvider(await grey(), 0.04), buildPrompt: fakePrompt, limits: { attempts: 2 } });
  await regenerateCard({ dir: made.dir, wish: 'ярче', settings: OPS, provider: p, buildPrompt: fakePrompt });
  assert.equal(cardOf(made.dir).attempts[2].error.stage, 'generate', 'третья попытка — без картинки');
  const r = await chooseAttempt({ dir: made.dir, n: 2 });
  assert.equal(r.chosen, 2);
  const c = cardOf(made.dir);
  assert.deepEqual([c.chosen, c.chosenBy], [2, 'choice']);
  assert.deepEqual(fs.readFileSync(path.join(made.dir, 'card.png')), fs.readFileSync(path.join(made.dir, 'attempts/2/card.png')));
  assert.equal((await recheckCard({ dir: made.dir })).chosen, 2, 'выбор человека перепроверка не отменяет');
  await assert.rejects(chooseAttempt({ dir: made.dir, n: 3 }), /нет готовой картинки/);
  await assert.rejects(chooseAttempt({ dir: made.dir, n: 9 }), /нет версии 9/);
  const cli = ccf('card', 'choose', made.dir, '--attempt', '1', '--json');
  assert.equal(JSON.parse(cli.stdout).chosen, 1, cli.stderr);
  assert.equal(ccf('card', 'choose', made.dir).status, 2, 'без --attempt');
});

test('сброс обработки: ручные значения заменяются подобранными программой, как после генерации', { skip: noSharp }, async () => {
  const { makeCard, adjustCard } = /** @type {any} */ (loop);
  const real = loadSettings();
  const settings = { ...real, card: { ...real.card, attempts: 1 } };
  const made = await makeCard({ order: ORDER, ...await pool(), settings, provider: fakeProvider(reference(), 0.04), buildPrompt: fakePrompt });
  const auto = cardOf(made.dir).attempts[0];
  const card = fs.readFileSync(path.join(made.dir, 'card.png'));
  await adjustCard({ dir: made.dir, saturation: 0.8, brightness: -12 });
  assert.equal(cardOf(made.dir).attempts[0].processingFixed, true);
  await assert.rejects(adjustCard({ dir: made.dir, reset: true }), /нужны настройки/);
  await assert.rejects(adjustCard({ dir: made.dir, reset: true, saturation: 1, settings }), /либо значения, либо сброс/);
  const r = await adjustCard({ dir: made.dir, reset: true, settings });
  const a = cardOf(made.dir).attempts[0];
  assert.equal(a.processingFixed, undefined);
  assert.deepEqual(a.processing, auto.processing, 'те же настройки, что подобрал цикл');
  assert.deepEqual(fs.readFileSync(path.join(made.dir, 'card.png')), card, 'та же карточка');
  assert.equal(r.chosenCheck.blocking, auto.check.blocking);
  assert.equal(ccf('card', 'adjust', made.dir, '--reset', '--saturation', '1').status, 2);
  assert.equal(ccf('card', 'adjust', made.dir, '--reset', '--json').status === 2, false);
});

test('отмена и ход запуска: сигнал проверяется перед каждым вызовом, ход сообщается; ключ редактора вместо окружения', { skip: noSharp }, async () => {
  const { makeCard, providerFrom } = /** @type {any} */ (loop);
  const p = fakeProvider(await grey(), 0.04);
  const stop = new AbortController();
  const seen = [];
  const onProgress = e => { seen.push(e); if (e.stage === 'process') stop.abort(); };
  const r = await makeCard({ order: ORDER, ...await pool(), settings: SETTINGS, provider: p, buildPrompt: fakePrompt, signal: stop.signal, onProgress });
  assert.equal(r.stop, 'cancelled');
  assert.equal(p.calls.length, 1, 'после отмены не заплачено');
  assert.deepEqual(seen.map(e => [e.stage, e.n, e.done, e.of]), [['generate', 1, 0, 3], ['process', 1, 0, 3], ['done', null, 1, 3]]);
  assert.ok(Math.abs(seen.at(-1).spent - 0.04) < 1e-9);

  const real = loadSettings().provider;
  const held = providerFrom({ ...real, openrouter: { ...real.openrouter, keyEnvVar: 'CCF_NO_SUCH_KEY' } }, { apiKey: 'from-editor' });
  assert.equal(held.model, real.openrouter.model, 'ключ из памяти редактора — окружение не нужно');
});

test('запрос для агента: собранный запрос, образцы, пропорция и следующий шаг; ничего не генерируется', { skip: noSharp }, async () => {
  const { orderPrompt } = /** @type {any} */ (loop);
  const { buildPrompt } = await import('../core/style/prompt.js');
  const built = await buildPrompt(ORDER);
  const r = await orderPrompt({ order: ORDER, settings: loadSettings() });
  assert.equal(r.prompt, built.prompt);
  assert.deepEqual(r.references, built.references.map(x => x.path));
  assert.equal(r.aspectRatio, loadSettings().provider.openrouter.aspectRatio);
  assert.match(r.next, /card import/);
  const file = path.join(tmp(), 'order.json');
  fs.writeFileSync(file, JSON.stringify(ORDER));
  const cli = ccf('card', 'prompt', file, '--json');
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).prompt, built.prompt);
});

// ---------- the vision model in the loop: the hero's box and the look ----------

test('смотрящая модель: вопросы взгляда из заказа и списка для глаз; ответ разбирается в проблемы, блокирующие — по настройкам', () => {
  return import('../core/card/look.js').then(({ lookPrompt, issuesOf, parseAnswer }) => {
    const look = loadSettings().look;
    const visual = [{ id: 'RENDERING.12-14', what: 'no fine texture' }, { id: 'COMPOSITION.1', what: 'one hero object' }];
    const p = lookPrompt({ title: 'Rowboat', order: 'Subject: a wooden rowing boat.', visual, settings: look });
    for (const t of ['«Rowboat»', 'Subject: a wooden rowing boat.', 'RENDERING.12-14: no fine texture', ...Object.keys(look.prompt.questions).map(k => `${k}: `)]) assert.ok(p.includes(t), t);
    assert.ok(!/\{(title|order|questions|checklist|answer|json)\}/.test(p), 'все слоты заполнены');
    const kinds = Object.keys(look.prompt.questions);
    const ok = { seen: 'a lantern', subject: { ok: true }, caption: { ok: true }, staging: { ok: true }, additions: { ok: true }, checklist: [] };
    assert.deepEqual(issuesOf(ok, visual, look), { verdict: 'ok', issues: [], seen: 'a lantern' }, 'вопрос без ответа (костюм без персонажей) — не проблема');
    const bad = parseAnswer('```json\n' + JSON.stringify({ ...ok, subject: { ok: false, why: 'a candle, not a lantern' }, caption: { ok: false, why: 'reads as a candle' }, checklist: [{ id: 'RENDERING.12-14', why: 'mesh' }, { id: 'NOT.ON.LIST', why: 'x' }] }) + '\n```', kinds);
    const r = issuesOf(bad, visual, look);
    assert.equal(r.verdict, 'fix');
    assert.deepEqual(r.issues, [
      { kind: 'subject', what: 'a candle, not a lantern', blocking: true },
      { kind: 'caption', what: 'reads as a candle', blocking: false },
      { kind: 'checklist', id: 'RENDERING.12-14', what: 'mesh', blocking: false },
    ]);
    // the model was seen to drop a brace: the fields are then read one by one
    const broken = '{"seen": "a thermos", "staging": {"ok": false, "why": "a plain blue wall, not planks"}, "subject": {"ok": true, "why": ""}, "checklist": [{"id": "BACKGROUNDS.2", "why": "no texture"}, "id": "RENDERING.12-14", "why": "x"}]}';
    const b = issuesOf(parseAnswer(broken, kinds), visual, look);
    assert.deepEqual(b.issues.map(i => [i.kind, i.id, i.blocking]), [['staging', undefined, true], ['checklist', 'RENDERING.12-14', false]]);
    assert.equal(issuesOf(parseAnswer('no json here', kinds), visual, look).verdict, 'unknown');
    assert.equal(issuesOf({ seen: 'x', checklist: [] }, visual, look).verdict, 'unknown', 'ни на один вопрос нет ответа');
  });
});

test('смотрящая модель в цикле: рамка героя → доверенный контур, взгляд «не тот предмет» гонит перегенерацию, расходы учтены; перепроверка модель не спрашивает', { skip: noSharp }, async () => {
  const { makeCard, recheckCard } = /** @type {any} */ (loop);
  const real = loadSettings();
  const settings = { ...real, card: { ...real.card, attempts: 2, tuneProcessing: false } };
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/checks/reference-spec.json'), 'utf8')).cards.find(c => c.id === 'ref-003');
  const { id, ref, file, set, mask, ...staging } = spec;
  const order = { ...ORDER, title: 'Lantern', subject: 'a glowing lantern', object: 'lantern', staging: { ...staging, material: 'metal' } };
  const asked = [];
  let looks = 0;
  // the box is centred left to right, so it is the same on the card and on its mirror image: the two looks agree
  const vision = async req => {
    asked.push(req);
    if (/box_2d/.test(req.prompt)) return { text: '{"box_2d": [60, 180, 940, 820]}', cost: 0.001 };
    looks++;
    const subject = looks === 1 ? { ok: false, why: 'a candle, not a lantern' } : { ok: true, why: '' };
    return { text: JSON.stringify({ subject, staging: { ok: true }, additions: { ok: true }, costume: { ok: null }, checklist: [] }), cost: 0.002 };
  };
  const p = fakeProvider(fs.readFileSync(path.join(ROOT, 'styles/scapes/references/card-003.png')), 0.04, { vision });
  const r = await makeCard({ order, ...await pool(), settings, provider: p, buildPrompt: fakePrompt });
  assert.equal(p.calls.length, 2, 'первая попытка — «не тот предмет»: перегенерация');
  assert.equal(asked[0].model, real.provider.openrouter.visionModel);
  const card = JSON.parse(fs.readFileSync(path.join(r.dir, 'card.json'), 'utf8'));
  const [a1, a2] = card.attempts;
  assert.equal(a1.hero.source, 'vision');
  assert.equal(a1.hero.confidence, 'high', a1.hero.reasons.join('; '));
  assert.equal(a1.check.maskStatus, 'auto');
  assert.ok(fs.existsSync(path.join(r.dir, 'attempts/1/card.hero.png')));
  assert.equal(a1.look.verdict, 'fix');
  assert.deepEqual(a1.check.look.issues, [{ kind: 'subject', what: 'a candle, not a lantern', blocking: true }]);
  assert.equal(a1.check.blocking, a1.check.fails.filter(f => !f.needsMask).length + 1);
  assert.equal(a2.look.verdict, 'ok');
  const lookFile = JSON.parse(fs.readFileSync(path.join(r.dir, 'attempts/1/look.json'), 'utf8'));
  assert.match(lookFile.prompt, /«Lantern»/);
  assert.ok(Math.abs(r.spent - 2 * (0.04 + 0.001 * 2 + 0.002)) < 1e-9, `расходы ${r.spent}`);
  const before = asked.length;
  const re = await recheckCard({ dir: r.dir });
  assert.equal(asked.length, before, 'перепроверка бесплатна: контур из card.hero.png, взгляд из попытки');
  assert.deepEqual(re.attempts.find(a => a.n === 1).check.look, a1.check.look);
  assert.equal(re.attempts.find(a => a.n === 1).check.maskStatus, 'auto');
});

test('запрос Codex: подпись к образцам из собранного запроса не повторяется и не заменяется общей', { skip: noSharp }, async () => {
  const { makeCard } = /** @type {any} */ (loop);
  const { buildPrompt } = await import('../core/style/prompt.js');
  const built = await buildPrompt(ORDER);
  assert.ok(built.legend && built.prompt.includes(built.legend), 'подпись — часть запроса');
  const p = fakeProvider(await grey(), 0, { model: 'codex-cli', free: true });
  await makeCard({ order: ORDER, ...await pool(), settings: SETTINGS, provider: p, limits: { attempts: 1 } });
  assert.equal(p.calls[0].legend, built.legend, 'подпись передана провайдеру');
});
