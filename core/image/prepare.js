// Turns an image returned by a model into a card: any format sharp reads (JPEG, PNG, WebP, …) → opaque sRGB pixels
// of the card size, and those pixels → PNG. The card size comes from the caller (for Scapes: the style's format
// rule, styles/scapes/checks/thresholds.json → BASE_RULES.1.size).
//
// The rule (Scapes BASE_RULES.md «Формат карточки», the author's decision, clarified 2026-10-31): scale the image down
// to the card and cut only its sides, equally; nothing is cut from the top or the bottom. Every model is therefore
// asked for a frame no taller than the card (core/providers/models.js). An image that still comes back taller is
// scaled to cover and cut from the bottom only, so the air above the hero stays; the caller records that as a
// warning (the model's profile is wrong then). Resampling is Lanczos-3 from the full image (no JPEG shrink-on-load).
import sharp from 'sharp';

/**
 * @typedef {object} Card
 * @property {Uint8Array} pixels  RGB, row by row, 8 bits per channel
 * @property {number} width
 * @property {number} height
 * @property {number} [cutBottom]  card pixels cut from the bottom because the image was taller than the card
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
  let cutBottom = 0;
  if (size) {
    // EXIF orientations 5–8 turn the image a quarter: its width and height swap
    const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
    const taller = h * size.width > w * size.height;
    if (taller) cutBottom = Math.round(h * size.width / w) - size.height;
    image = image.resize(size.width, size.height, { fit: 'cover', position: taller ? 'top' : 'centre', kernel: 'lanczos3', fastShrinkOnLoad: false });
  }
  const { data, info } = await image
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height, ...(cutBottom > 0 ? { cutBottom } : {}) };
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
