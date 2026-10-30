// core/image: post-processing (adjust.js, pure functions) and turning a model image into a card (prepare.js, sharp).
// The prepare tests need the installed packages (node tools/setup.mjs); without node_modules/sharp they are skipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { adjust, luma } from '../core/image/adjust.js';

const neutral = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/processing.json'), 'utf8')).neutral;
const withSettings = over => ({ ...neutral(), ...over });
const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp'));
const noSharp = !hasSharp && 'пакеты не установлены (node tools/setup.mjs): нет node_modules/sharp';

/** w × h RGB image from a function (x, y) → [r, g, b] */
function image(w, h, f) {
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 3);
  return px;
}

test('adjust: нейтральные настройки возвращают те же пиксели, альфа копируется', () => {
  const rgb = image(7, 5, (x, y) => [x * 30, y * 50, (x * y * 13) % 256]);
  assert.deepEqual([...adjust(rgb, 7, 5, neutral())], [...rgb]);
  const rgba = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 37) % 256);
  assert.deepEqual([...adjust(rgba, 4, 4, neutral())], [...rgba]);
});

test('adjust: насыщенность меняет отличие цвета от яркости и не трогает яркость', () => {
  const px = Uint8Array.of(200, 100, 50);
  const grey = adjust(px, 1, 1, withSettings({ saturation: 0 }));
  const y = Math.round(luma(200, 100, 50));
  assert.deepEqual([...grey], [y, y, y]);
  const more = adjust(px, 1, 1, withSettings({ saturation: 1.3 }));
  assert.ok(more[0] - more[2] > 200 - 50, 'разница каналов выросла');
  assert.ok(Math.abs(luma(more[0], more[1], more[2]) - luma(200, 100, 50)) <= 1, 'яркость та же');
});

test('adjust: яркость прибавляется ко всем каналам и упирается в 0 и 255', () => {
  assert.deepEqual([...adjust(Uint8Array.of(100, 120, 250), 1, 1, withSettings({ brightness: 10 }))], [110, 130, 255]);
  assert.deepEqual([...adjust(Uint8Array.of(5, 120, 250), 1, 1, withSettings({ brightness: -10 }))], [0, 110, 240]);
});

test('adjust: резкость не трогает ровное поле, на перепаде даёт перехлёст с обеих сторон и не меняет цвет', () => {
  const sharpen = withSettings({ sharpen: { amount: 0.5, radius: 1 } });
  const flat = image(9, 9, () => [90, 140, 60]);
  assert.deepEqual([...adjust(flat, 9, 9, sharpen)], [...flat]);
  // vertical step: dark blue-ish left half, light right half; the same colour difference on both sides
  const w = 20, h = 6, step = image(w, h, x => (x < 10 ? [60, 80, 100] : [160, 180, 200]));
  const out = adjust(step, w, h, sharpen), at = (x, k) => out[(3 * w + x) * 3 + k];
  assert.ok(at(9, 0) < 60 && at(10, 0) > 160, 'тёмная сторона темнее, светлая светлее');
  assert.equal(at(0, 0), 60, 'далеко от перепада без изменений');
  assert.equal(at(19, 2), 200, 'далеко от перепада без изменений');
  for (const x of [8, 9, 10, 11]) assert.equal(at(x, 2) - at(x, 0), 40, 'разница каналов (цвет) сохранена');
});

test('adjust: неверные настройки и размер отклоняются', () => {
  assert.throws(() => adjust(new Uint8Array(12), 2, 2, withSettings({ saturation: -1 })), /saturation/);
  assert.throws(() => adjust(new Uint8Array(12), 2, 2, { brightness: 0, saturation: 1 }), /sharpen/);
  assert.throws(() => adjust(new Uint8Array(10), 2, 2, neutral()), /RGB или RGBA/);
});

test('prepareCard: картинка другой формы масштабируется до покрытия и обрезается по центру', { skip: noSharp }, async () => {
  const { default: sharp } = await import('sharp');
  const { prepareCard, encodePng } = await import('../core/image/prepare.js');
  const size = { width: 430, height: 480 }; // a reference card's own size: the test checks the rule, not the style
  const ref = path.join(ROOT, 'styles/scapes/references/card-001.png');
  const card = await sharp(ref).removeAlpha().raw().toBuffer();
  const big = sharp(ref).removeAlpha().resize(2 * size.width, 2 * size.height, { kernel: 'lanczos3' });
  const mean = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  // the twice-as-large card comes back close to the card (only resampling loses a little)
  const plain = await prepareCard(await big.clone().png().toBuffer(), size);
  assert.ok(mean(card, plain.pixels) < 3, `после увеличения и уменьшения отличие ${mean(card, plain.pixels).toFixed(2)}`);
  // magenta bands that the cover scale and centre crop must cut away exactly: the result equals the unpadded one
  for (const pad of [{ top: 100, bottom: 100 }, { left: 80, right: 80 }]) {
    const master = await big.clone().extend({ top: 0, bottom: 0, left: 0, right: 0, ...pad, background: '#ff00ff' }).png().toBuffer();
    const out = await prepareCard(master, size);
    assert.equal(out.width, size.width); assert.equal(out.height, size.height);
    assert.equal(out.pixels.length, size.width * size.height * 3);
    assert.ok(mean(plain.pixels, out.pixels) < 0.1, `полосы срезаны не точно: отличие ${mean(plain.pixels, out.pixels).toFixed(3)}`);
    const png = await encodePng(out.pixels, out.width, out.height);
    assert.deepEqual(await sharp(png).raw().toBuffer(), out.pixels, 'PNG без потерь');
  }
});

test('prepareCard без размера: картинка остаётся своего размера, без обрезки', { skip: noSharp }, async () => {
  const { default: sharp } = await import('sharp');
  const { prepareCard } = await import('../core/image/prepare.js');
  const img = await sharp({ create: { width: 30, height: 50, channels: 3, background: { r: 10, g: 200, b: 90 } } }).png().toBuffer();
  const out = await prepareCard(img);
  assert.equal(out.width, 30); assert.equal(out.height, 50);
  assert.deepEqual([...out.pixels.slice(0, 3)], [10, 200, 90]);
});

test('prepareCard: прозрачная картинка не становится карточкой', { skip: noSharp }, async () => {
  const { default: sharp } = await import('sharp');
  const { prepareCard } = await import('../core/image/prepare.js');
  const clear = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  await assert.rejects(prepareCard(clear, { width: 10, height: 10 }), /прозрачн/);
});
