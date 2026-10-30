// core/image/segment.js (max-flow, GrabCut) and core/card/hero.js (box → outline, vision models, confidence):
// synthetic images and fake model answers, no network. The checker test needs sharp and a reference card.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { boxIou, boxOf, Graph, outlineInBox } from '../core/image/segment.js';
import { ROOT } from './root.mjs';

const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp/package.json'));
const noSharp = !hasSharp && 'нет node_modules/sharp (сначала npm install)';
const hero = () => import('../core/card/hero.js');
const HERO_SETTINGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/defaults.json'), 'utf8')).hero;

// deterministic pseudo-random numbers
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

test('Graph: максимальный поток равен минимальному разрезу перебором (300 случайных графов)', () => {
  const rand = rng(7);
  for (let t = 0; t < 300; t++) {
    const n = 2 + Math.floor(rand() * 7), tw = [], edges = [];
    for (let i = 0; i < n; i++) tw.push([Math.floor(rand() * 10), Math.floor(rand() * 10)]);
    for (let k = 0; k < 2 * n; k++) { const i = Math.floor(rand() * n), j = Math.floor(rand() * n); if (i !== j) edges.push([i, j, Math.floor(rand() * 6), Math.floor(rand() * 6)]); }
    const g = new Graph(n, edges.length * 2);
    tw.forEach(([s, k], i) => g.addTWeights(i, s, k));
    for (const e of edges) g.addEdge(e[0], e[1], e[2], e[3]);
    const flow = g.maxflow();
    let best = Infinity;
    for (let m = 0; m < 1 << n; m++) {
      let c = 0;
      for (let i = 0; i < n; i++) c += (m >> i) & 1 ? tw[i][1] : tw[i][0];
      for (const [i, j, a, b] of edges) { const si = (m >> i) & 1, sj = (m >> j) & 1; if (si && !sj) c += a; if (!si && sj) c += b; }
      best = Math.min(best, c);
    }
    let cut = 0;
    for (let i = 0; i < n; i++) cut += g.isSource(i) ? tw[i][1] : tw[i][0];
    for (const [i, j, a, b] of edges) { if (g.isSource(i) && !g.isSource(j)) cut += a; if (!g.isSource(i) && g.isSource(j)) cut += b; }
    assert.equal(flow, best, `graph ${t}`);
    assert.equal(cut, best, `graph ${t}: the side labels give the minimum cut`);
  }
});

// A Scapes-like card: blue field with darker rays, a light glow behind the hero, a red-and-white ball with a thin
// antenna, a soft darker shadow under it.
function syntheticCard(W = 120, H = 140) {
  const px = new Uint8Array(W * H * 3), truth = new Uint8Array(W * H);
  const cx = 60, cy = 62, r = 30;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, d = Math.hypot(x - cx, y - cy);
    const ray = Math.floor((Math.atan2(y - cy, x - cx) + Math.PI) / (Math.PI / 6)) % 2;
    const glow = Math.max(0, 1 - d / 70);
    let c = [30 + 120 * glow - 12 * ray, 90 + 120 * glow - 12 * ray, 200 + 40 * glow - 10 * ray];
    { const e = Math.hypot((x - cx) / 28, (y - 104) / 6); if (e < 1.5) c = c.map(v => v * (1 - 0.45 * Math.min(1, 1.5 - e))); } // soft cast shadow
    if (d < r) { c = y < cy ? [215, 30, 40] : [240, 240, 236]; truth[p] = 1; }
    if (Math.abs(x - cx) <= 1 && y >= cy - r - 14 && y < cy - r + 2) { c = [200, 25, 35]; truth[p] = 1; } // antenna
    px.set(c.map(v => Math.max(0, Math.min(255, Math.round(v)))), p * 3);
  }
  return { px, truth, W, H };
}
const iou = (a, b) => { let i = 0, u = 0; for (let p = 0; p < a.length; p++) { if (a[p] && b[p]) i++; if (a[p] || b[p]) u++; } return i / u; };

test('outlineInBox: в свободной рамке герой отделён от свечения, лучей и тени, тонкий отросток остаётся', () => {
  const { px, truth, W, H } = syntheticCard();
  const fg = outlineInBox(px, W, H, [18, 8, 102, 118]);
  assert.ok(iou(fg, truth) > 0.93, `IoU ${iou(fg, truth)}`);
  let shadow = 0; for (let x = 40; x < 80; x++) shadow += fg[104 * W + x];
  assert.equal(shadow, 0, 'the cast shadow is backdrop');
  assert.equal(fg[(62 - 30 - 10) * W + 60], 1, 'the antenna is hero');
  assert.equal(fg[5 * W + 5], 0, 'outside the box is backdrop');
  assert.throws(() => outlineInBox(px, W + 1, H, [0, 0, 10, 10]), /RGB или RGBA/);
});

test('boxOf и boxIou', () => {
  const m = new Uint8Array(20 * 10); m[3 * 20 + 4] = 1; m[7 * 20 + 9] = 1;
  assert.deepEqual(boxOf(m, 20), [4, 3, 9, 7]);
  assert.equal(boxOf(new Uint8Array(4), 2), null);
  assert.equal(boxIou([0, 0, 9, 9], [0, 0, 9, 9]), 1);
  assert.equal(boxIou([0, 0, 9, 9], [10, 10, 19, 19]), 0);
  assert.equal(boxIou(null, [0, 0, 1, 1]), 0);
});

test('parseBox: форматы Gemini, Qwen и пиксели; мусор и вырожденная рамка — null', { skip: noSharp }, async () => {
  const { parseBox, cleanBox } = await hero();
  assert.deepEqual(parseBox('```json\n{"box_2d": [100, 200, 900, 800]}\n```', 'gemini', 430, 480), [86, 48, 344, 432]);
  assert.deepEqual(parseBox('{"bbox_2d": [200, 100, 800, 900]}', 'qwen', 430, 480), [86, 48, 344, 432]);
  assert.deepEqual(parseBox('{"box": [500, -3, 10, 700]}', 'pixels', 430, 480), [10, 0, 429, 479]);
  assert.equal(parseBox('{"box_2d": [0, 0, 0, 0]}', 'gemini', 430, 480), null);
  assert.deepEqual(parseBox('{"box_d": [100, 200, 900, 800]}', 'gemini', 430, 480), [86, 48, 344, 432]);
  assert.deepEqual(parseBox('```json\n{"bounding_box": [100, 200, 900, 800]}\n```', 'gemini', 430, 480), [86, 48, 344, 432]);
  assert.equal(parseBox('{"label": [100, 200, 900, 800]}', 'gemini', 430, 480), null);
  assert.equal(parseBox('no idea', 'gemini', 430, 480), null);
  assert.equal(parseBox('{"box_2d": "x"}', 'gemini', 430, 480), null);
  // answer variants seen from Gemini 3.5 Flash-Lite: a list of boxes (union), a missing bracket, an object of values
  assert.deepEqual(parseBox('```json\n{\n  "box_2d": [\n    [100, 200, 500, 400],\n    [300, 300, 900, 800]\n  ]\n}\n```', 'gemini', 430, 480), [86, 48, 344, 432]);
  assert.deepEqual(parseBox('```json\n{\n  "box_2d": [\n    [100, 200, 900, 800]\n}\n```', 'gemini', 430, 480), [86, 48, 344, 432]);
  assert.deepEqual(parseBox('{"box_2d": {"ymin": 100, "xmin": 200, "ymax": 900, "xmax": 800}}', 'gemini', 430, 480), [86, 48, 344, 432]);
  assert.equal(parseBox('{"box_2d": [1, 2, 3]}', 'gemini', 430, 480), null);
  assert.throws(() => parseBox('{}', 'nope', 430, 480), /Неизвестный формат/);
  assert.equal(cleanBox([1, 2, 3], 10, 10), null);
});

test('визуальный запрос: слова героя для предмета и для сцены, формат ответа модели', { skip: noSharp }, async () => {
  const { visionPrompt } = await hero();
  const obj = visionPrompt({ order: { id: 'c', style: 'scapes', subject: 'a red bobber', staging: /** @type {any} */ ({ characters: 0 }) }, format: 'gemini', width: 430, height: 480, settings: HERO_SETTINGS });
  assert.match(obj, /430 x 480/); assert.match(obj, /«a red bobber»/); assert.match(obj, /box_2d/);
  const scene = visionPrompt({ order: /** @type {any} */ ({ id: 's', style: 'scapes', staging: { characters: 2 }, scene: { action: 'fish', item: 'rods', jokeObject: 'the boot', characters: [{ name: 'man' }, { name: 'pig' }] } }), format: 'gemini', width: 430, height: 480, settings: HERO_SETTINGS });
  assert.match(scene, /characters together/); assert.match(scene, /man and pig; fish; rods; the boot/);
});

test('findHero: рамка агента → контур с высокой уверенностью; негодная рамка → низкая', { skip: noSharp }, async () => {
  const { findHero } = await hero();
  const { px, truth, W, H } = syntheticCard();
  const h = await findHero({ pixels: px, width: W, height: H, box: [24, 12, 96, 100] });
  assert.equal(h.source, 'box'); assert.equal(h.confidence, 'high', h.reasons.join('; ')); assert.equal(h.cost, 0);
  assert.ok(h.fg && iou(h.fg, truth) > 0.93);
  const bad = await findHero({ pixels: px, width: W, height: H, box: [5, 5, 6, 6] });
  assert.equal(bad.confidence, 'low'); assert.equal(bad.fg, null);
  const scene = await findHero({ pixels: px, width: W, height: H, box: [24, 12, 96, 100], outlineFits: false });
  assert.equal(scene.confidence, 'low'); assert.equal(scene.boxConfidence, 'high'); assert.deepEqual(scene.box, [24, 12, 96, 100]);
  const none = await findHero({ pixels: px, width: W, height: H });
  assert.equal(none.confidence, 'low'); assert.match(none.reasons[0], /no box/);
});

test('findHero с моделью: рамки на карточке и на её зеркале совпали → высокая уверенность и цена; нет — низкая', { skip: noSharp }, async () => {
  const { findHero, locateHero, unmirror } = await hero();
  const sharp = (await import('sharp')).default;
  const { px, W, H } = syntheticCard();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-hero-'));
  try {
    const file = path.join(dir, 'card.png');
    await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
    const vision = { model: 'm', format: 'gemini', reasoning: null, timeoutMs: 1000 };
    const order = /** @type {any} */ ({ id: 'c', style: 'scapes', subject: 'ball', staging: { characters: 0 } });
    const g = (/** @type {number[]} */ b) => `{"box_2d": [${Math.round(b[1] / H * 1000)}, ${Math.round(b[0] / W * 1000)}, ${Math.round(b[3] / H * 1000)}, ${Math.round(b[2] / W * 1000)}]}`;
    const box = [26, 14, 100, 96], mirrored = unmirror(/** @type {any} */ (box), W);
    // the card view is sent as given (a path); the mirror view as PNG bytes
    const seen = [];
    const ask = async ({ image }) => { seen.push(image.path ? 'card' : 'mirror'); return { text: image.path ? g(box) : g(mirrored), cost: 0.001 }; };
    const locate = a => () => locateHero({ image: { path: file }, order, width: W, height: H, vision, settings: HERO_SETTINGS, ask: a });
    const agree = await findHero({ pixels: px, width: W, height: H, agreeIou: 0.8, locate: locate(ask) });
    assert.deepEqual(seen.sort(), ['card', 'mirror']);
    assert.equal(agree.source, 'vision'); assert.equal(agree.confidence, 'high', agree.reasons.join('; ')); assert.equal(agree.boxConfidence, 'high');
    assert.equal(agree.cost, 0.002); assert.ok(agree.agreement >= 0.9, String(agree.agreement));
    const askOff = async ({ image }) => ({ text: g(image.path ? box : [0, 0, 40, 40]), cost: 0.001 });
    const dis = await findHero({ pixels: px, width: W, height: H, agreeIou: 0.8, locate: locate(askOff) });
    assert.equal(dis.confidence, 'low'); assert.equal(dis.boxConfidence, 'low'); assert.match(dis.reasons.join(' '), /disagree/); assert.ok(dis.fg, 'the outline is still made, for a person to look at');
    const askFail = async ({ image }) => { if (image.path) throw new Error('HTTP 503'); return { text: g(mirrored), cost: 0.001 }; };
    const fail = await findHero({ pixels: px, width: W, height: H, agreeIou: 0.8, locate: locate(askFail) });
    assert.equal(fail.confidence, 'low'); assert.match(fail.reasons[0], /HTTP 503/); assert.equal(fail.fg, null);
    const single = await findHero({ pixels: px, width: W, height: H, agreeIou: 0.8, locate: () => locateHero({ image: { path: file }, order, width: W, height: H, vision, settings: { ...HERO_SETTINGS, mirrorCheck: false }, ask }) });
    assert.equal(single.confidence, 'low'); assert.match(single.reasons[0], /mirror check off/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('контур: запись в PNG и чтение обратно', { skip: noSharp }, async () => {
  const { writeOutline, readOutline } = await hero();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-hero-'));
  try {
    const fg = new Uint8Array(12 * 8); fg[5] = 1; fg[40] = 1;
    await writeOutline(fg, 12, 8, path.join(dir, 'o.png'));
    const r = await readOutline(path.join(dir, 'o.png'));
    assert.deepEqual([r.width, r.height], [12, 8]); assert.deepEqual(r.fg, fg);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('проверки Scapes с контуром из рамки: статус «auto», цветовые проверки героя измерены и, как на подтверждённом контуре, гонят перегенерацию', { skip: noSharp }, async () => {
  const { findHero, readPixels } = await hero();
  const { checkCard } = await import('../styles/scapes/checks/check-card.mjs');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/checks/reference-spec.json'), 'utf8'));
  // ref-006: the fountain on a wooden patch, whose proposed outline was rejected; the box is the one drawn by eye
  const card = spec.cards.find(c => c.id === 'ref-006');
  const file = path.join(ROOT, 'styles/scapes/references/card-006.png');
  const without = await checkCard({ ...card, file });
  assert.equal(without.results.find(r => r.id === 'COLOUR.7').status, 'NOT_MEASURED');
  const { pixels, width, height } = await readPixels(file);
  const h = await findHero({ pixels, width, height, box: card.hero_box });
  assert.equal(h.confidence, 'high');
  const { hero_box, mask, ...rest } = card;
  const withOutline = await checkCard({ ...rest, file }, { outline: h });
  assert.equal(withOutline.hero.mask_status, 'auto');
  assert.equal(withOutline.hero.box_source, 'given');
  for (const id of ['COLOUR.7', 'COLOUR.8a', 'RENDERING.4']) assert.notEqual(withOutline.results.find(r => r.id === id).status, 'NOT_MEASURED', id);
  const low = await checkCard({ ...rest, file }, { outline: { ...h, confidence: 'low' } });
  assert.equal(low.hero.mask_status, 'proposal');
  const { restsOnUnconfirmedMask, outlineFits } = await import('../styles/scapes/checks/check-card.mjs');
  const fail = id => ({ id, status: 'FAIL' });
  // a trusted automatic outline counts as confirmed (the norms were re-measured with such outlines); a low one does not
  assert.equal(restsOnUnconfirmedMask(fail('COLOUR.7'), withOutline.hero), false, 'a trusted outline: colour FAILs are blocking');
  assert.equal(restsOnUnconfirmedMask(fail('COMPOSITION.11'), withOutline.hero), false);
  assert.equal(restsOnUnconfirmedMask(fail('COLOUR.7'), low.hero), true, 'an outline not trusted: colour FAILs go to eyes');
  assert.equal(restsOnUnconfirmedMask(fail('COMPOSITION.11'), low.hero), true, 'the main mass comes from the outline');
  assert.equal(restsOnUnconfirmedMask(fail('BACKGROUNDS.9'), low.hero), false, 'the floor check reads only the trusted box');
  assert.equal(restsOnUnconfirmedMask(fail('COMPOSITION.4a'), low.hero), false);
  assert.equal(restsOnUnconfirmedMask(fail('COMPOSITION.4a'), { ...low.hero, box_source: 'mask' }), true);
  assert.equal(outlineFits({ backdrop: 'field' }), true); assert.equal(outlineFits({ backdrop: 'environment' }), false);
});
