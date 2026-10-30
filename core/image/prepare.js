// Turns an image returned by a model into a card: any format sharp reads (JPEG, PNG, WebP, …) → opaque sRGB pixels
// of the card size, and those pixels → PNG. The card size comes from the caller (for Scapes: the style's format
// rule, styles/scapes/checks/thresholds.json → BASE_RULES.1.size).
//
// The rule (Scapes BASE_RULES.md «Формат карточки»): scale so the image covers the card whole, then cut the excess
// equally from both sides (centre crop). Any aspect ratio follows the same rule; resampling is Lanczos-3 from the
// full image (no JPEG shrink-on-load), as in the first generation trials.
import sharp from 'sharp';

/**
 * @typedef {object} Card
 * @property {Uint8Array} pixels  RGB, row by row, 8 bits per channel
 * @property {number} width
 * @property {number} height
 */

/**
 * @param {string | Uint8Array} input  file path or encoded image
 * @param {{width: number, height: number}} [size]  the card size of the style; without it the image keeps its own
 *   size (an order whose output is not a card, e.g. a character sheet)
 * @returns {Promise<Card>}
 */
export async function prepareCard(input, size) {
  let image = sharp(input).autoOrient();
  const meta = await image.metadata();
  if (meta.hasAlpha && !(await sharp(input).stats()).isOpaque) {
    throw new Error('prepareCard: у картинки есть прозрачные пиксели, а карточка — непрозрачный прямоугольник');
  }
  if (size) image = image.resize(size.width, size.height, { fit: 'cover', position: 'centre', kernel: 'lanczos3', fastShrinkOnLoad: false });
  const { data, info } = await image
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

/**
 * Encodes RGB or RGBA pixels as PNG.
 * @param {Uint8Array | Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8Array>}
 */
export function encodePng(pixels, width, height) {
  const channels = /** @type {3 | 4} */ (pixels.byteLength / (width * height));
  return sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
}
