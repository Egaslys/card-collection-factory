// Post-processing of a card: brightness, saturation, sharpening. Pure functions over 8-bit RGB or RGBA pixels,
// with no Node or library imports, so the same code runs in Node and on the editor page and the editor's preview
// equals the final card. The settings come from the caller; a style keeps its values in its own folder
// (styles/<style>/processing.json).
//
// Every operation works on luma and keeps the colour difference, as an editor's luma sharpening does:
//   luma Y = 0.299 R + 0.587 G + 0.114 B (BT.601, the luma the style checks measure);
//   adding the same d to R, G and B shifts Y by d and keeps Cb / Cr; R - Y, G - Y, B - Y scaled by s scale Cb / Cr by s.
// Order: brightness, then saturation, then sharpening; values stay floating-point until the one rounding at the end.

/**
 * @typedef {object} AdjustSettings
 * @property {number} brightness  levels (0..255 scale) added to luma; 0 = unchanged
 * @property {number} saturation  multiplier of the colour difference from luma; 1 = unchanged, 0 = grey
 * @property {{amount: number, radius: number}} sharpen  unsharp mask on luma: Y + amount * (Y - blur(Y)),
 *   blur = Gaussian with sigma = radius px (truncated at 3 sigma); amount 0 = unchanged
 */

/**
 * Applies the settings to a copy of the pixels; alpha, if any, is copied unchanged.
 * @param {ArrayLike<number>} pixels  RGB or RGBA, row by row, 8 bits per channel
 * @param {number} width
 * @param {number} height
 * @param {AdjustSettings} settings
 * @returns {Uint8ClampedArray} new pixels with the same channel count
 */
export function adjust(pixels, width, height, settings) {
  const n = width * height, channels = pixels.length / n;
  if (!Number.isInteger(width) || !Number.isInteger(height) || n <= 0 || (channels !== 3 && channels !== 4)) {
    throw new Error(`adjust: ожидались пиксели RGB или RGBA ${width} × ${height}, а длина массива ${pixels.length}`);
  }
  checkSettings(settings);
  const { brightness, saturation, sharpen } = settings;
  const rgb = new Float32Array(n * 3), Y = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * channels;
    const r = pixels[i] + brightness, g = pixels[i + 1] + brightness, b = pixels[i + 2] + brightness;
    const y = luma(r, g, b);
    const r1 = clamp(y + saturation * (r - y)), g1 = clamp(y + saturation * (g - y)), b1 = clamp(y + saturation * (b - y));
    rgb[p * 3] = r1; rgb[p * 3 + 1] = g1; rgb[p * 3 + 2] = b1;
    // sharpening works on the luma of the colour as it will be shown: a colour pushed out of range is clipped first
    Y[p] = luma(r1, g1, b1);
  }
  if (sharpen.amount !== 0) {
    const blurred = gaussianBlur(Y, width, height, sharpen.radius);
    for (let p = 0; p < n; p++) {
      const d = sharpen.amount * (Y[p] - blurred[p]);
      rgb[p * 3] += d; rgb[p * 3 + 1] += d; rgb[p * 3 + 2] += d;
    }
  }
  const out = new Uint8ClampedArray(pixels.length);
  for (let p = 0; p < n; p++) {
    const i = p * channels;
    out[i] = rgb[p * 3]; out[i + 1] = rgb[p * 3 + 1]; out[i + 2] = rgb[p * 3 + 2];
    if (channels === 4) out[i + 3] = pixels[i + 3];
  }
  return out;
}

/** @param {number} r @param {number} g @param {number} b */
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** @param {number} v */
const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Separable Gaussian blur of one float plane; pixels beyond the border repeat the edge pixel.
 * @param {Float32Array} plane
 * @param {number} width
 * @param {number} height
 * @param {number} sigma  px, > 0
 * @returns {Float32Array}
 */
export function gaussianBlur(plane, width, height, sigma) {
  const k = gaussianKernel(sigma), half = (k.length - 1) / 2;
  const tmp = new Float32Array(plane.length), out = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let j = -half; j <= half; j++) s += k[j + half] * plane[row + Math.min(width - 1, Math.max(0, x + j))];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let j = -half; j <= half; j++) s += k[j + half] * tmp[Math.min(height - 1, Math.max(0, y + j)) * width + x];
      out[y * width + x] = s;
    }
  }
  return out;
}

/** @param {number} sigma @returns {Float64Array} normalised weights, length 2 * ceil(3 sigma) + 1 */
function gaussianKernel(sigma) {
  const half = Math.max(1, Math.ceil(3 * sigma)), k = new Float64Array(2 * half + 1);
  let sum = 0;
  for (let j = -half; j <= half; j++) sum += k[j + half] = Math.exp(-(j * j) / (2 * sigma * sigma));
  return k.map(v => v / sum);
}

/** @param {AdjustSettings} s */
function checkSettings(s) {
  const bad = [];
  if (!Number.isFinite(s?.brightness)) bad.push('brightness');
  if (!Number.isFinite(s?.saturation) || s.saturation < 0) bad.push('saturation');
  if (!Number.isFinite(s?.sharpen?.amount) || s.sharpen.amount < 0) bad.push('sharpen.amount');
  if (!Number.isFinite(s?.sharpen?.radius) || s.sharpen.radius <= 0) bad.push('sharpen.radius');
  if (bad.length) throw new Error(`adjust: неверные настройки: ${bad.join(', ')}`);
}
