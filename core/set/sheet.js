// A contact sheet of a set: its ten cards in window order (2 × 5), each with its stars, frame colour and caption
// under it (the places the window shows: places.js), so the agent (or a person) sees the set as a whole and checks it against SETS.md by eye. It is a
// working view, not the set window of the style (frames and plates of the real window are the editor's).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { styleChecker } from '../card/check.js';
import { DEFAULT_STYLE } from '../store/layout.js';
import { placesOf } from './places.js';
import { loadSetRules } from './rules.js';

/** Frame colours of the sheet's slot borders (a working view: only to tell the frames apart). */
const FRAME_COLOURS = /** @type {Record<string, string>} */ ({ silver: '#b8bec6', gold: '#e2b23a', crystal: '#9a6ad8' });
const EMPTY = '#d9d9d9';

/** @param {string} s */
const xml = s => s.replace(/[&<>"]/g, c => (/** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }))[c]);

/**
 * Writes the sheet PNG of a set.
 * @param {object} o
 * @param {string} o.collection @param {string} o.set
 * @param {string} o.out  the PNG to write
 * @param {Pick<typeof import('../store/index.js'), 'getSet'|'listCards'>} [o.store]
 * @returns {Promise<{path: string, missing: number[]}>}  missing: slots (1-based) without a card image
 */
export async function setSheet({ collection, set: setId, out, store }) {
  const st = store ?? await import('../store/index.js');
  const set = await st.getSet(collection, setId);
  const plan = /** @type {import('./plan.js').SetPlan|undefined} */ (set.plan);
  const images = new Map((await st.listCards(collection, { setId: set.id })).map(c => [c.id, c.image]));
  const style = plan?.style ?? DEFAULT_STYLE;
  const { rules } = loadSetRules(style);
  const { width: W, height: H } = (await styleChecker(style)).CARD_SIZE;
  const places = placesOf(/** @type {any} */ (set), style);
  const cols = rules.grid.columns;
  const rows = Math.ceil(set.slots.length / cols);
  const B = 8, LABEL = 70, GAP = 24, HEAD = 64;
  const cellW = W + 2 * B, cellH = H + 2 * B + LABEL;
  const width = GAP + cols * (cellW + GAP), height = HEAD + rows * (cellH + GAP) + GAP;
  /** @type {import('sharp').OverlayOptions[]} */
  const layers = [];
  /** @type {string[]} */
  const svg = [`<text x="${GAP}" y="42" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="bold" fill="#222">${xml(`${set.title} — ${plan?.window.layout ?? set.window.kind}`)}</text>`];
  /** @type {number[]} */
  const missing = [];
  for (const [i, id] of set.slots.entries()) {
    const x = GAP + (i % cols) * (cellW + GAP), y = HEAD + Math.floor(i / cols) * (cellH + GAP);
    const slot = plan?.slots?.[i];
    const place = places[i];
    svg.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${H + 2 * B}" rx="10" fill="${FRAME_COLOURS[place.frame] ?? EMPTY}"/>`);
    const img = id ? images.get(id) : null;
    if (img && fs.existsSync(img)) layers.push({ input: await sharp(img).resize(W, H, { fit: 'cover' }).png().toBuffer(), left: x + B, top: y + B });
    else missing.push(i + 1);
    const caption = slot?.order?.title ?? '—';
    const stars = '★'.repeat(place.stars);
    svg.push(`<text x="${x + cellW / 2}" y="${y + H + 2 * B + 28}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#222">${xml(`${i + 1}. ${caption}`)}</text>`);
    svg.push(`<text x="${x + cellW / 2}" y="${y + H + 2 * B + 58}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#a07800">${xml(`${stars} ${place.frame}`)}</text>`);
  }
  const base = sharp({ create: { width, height, channels: 3, background: '#f2f2f2' } });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg.join('')}</svg>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await base.composite([{ input: overlay, left: 0, top: 0 }, ...layers]).png().toFile(out);
  return { path: out, missing };
}
