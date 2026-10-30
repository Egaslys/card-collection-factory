// The set shown in the style's window template (design system «Set window preview»): the card images at the slot
// rectangles of styles/<style>/windows/windows.json, the template image over them (its picture openings are
// transparent and its frames cover the card edges, as in the game), then the set's title, number and captions.
// All positions are fractions of the template, so the window scales with its frame.
import { esc, I } from './ui.js';

/** @type {Map<string, Promise<any>>} */
const geometry = new Map();

/** The style's window geometry (one fetch per style). @param {string} style @returns {Promise<any>} */
export function windowsOf(style) {
  if (!geometry.has(style)) {
    geometry.set(style, fetch(`/styles/${encodeURIComponent(style)}/windows/windows.json`).then(r => {
      if (!r.ok) throw new Error(`У стиля «${style}» нет шаблонов окна.`);
      return r.json();
    }));
  }
  return /** @type {Promise<any>} */ (geometry.get(style));
}

/** @param {{x: number, y: number, width: number, height: number}} r @param {{width: number, height: number}} size */
const box = (r, size) => `left:${(r.x / size.width) * 100}%;top:${(r.y / size.height) * 100}%;width:${(r.width / size.width) * 100}%;height:${(r.height / size.height) * 100}%`;
/** font size as a share of the window's width (container query units), from the text box height @param {number} h @param {any} size */
const fontOf = (h, size) => `font-size:${((h * 0.78) / size.width) * 100}cqw`;

/**
 * The window of one set.
 * @param {any} g  windows.json
 * @param {{set: any, cards: Map<string, any>, style: string, total?: number, drop?: boolean, selected?: string|null, caption?: boolean}} o
 *   cards: card id → CardSummary (with imageUrl); total: sets in the collection (for «Набор N/M»); drop: slots receive dragged cards
 */
export function windowHtml(g, { set, cards, style, total, drop = false, selected = null, caption = true }) {
  const tpl = g.templates[set.window?.template] ?? Object.values(g.templates)[0];
  const templateKey = Object.keys(g.templates).find(k => g.templates[k] === tpl);
  const size = g.size;
  const filled = set.slots.filter((/** @type {string|null} */ id) => id && cards.get(id)).length;
  const slots = g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const id = set.slots[i];
    const c = id ? cards.get(id) : null;
    const dropAttr = drop ? `data-drop='${esc(JSON.stringify({ setId: set.id, slot: i }))}'` : '';
    const dragAttr = c && drop ? `data-drag='${esc(JSON.stringify({ card: c.id, setId: set.id, slot: i }))}'` : '';
    const inner = c?.imageUrl
      ? `<img src="${esc(c.imageUrl)}" alt="${esc(c.title)}" draggable="false" loading="lazy" decoding="async">`
      : c ? `<span class="wslot__state">${c.status === 'failed' ? I.alert : I.image}</span>` : '';
    return `<div class="wslot${c ? '' : ' is-empty'}${selected && c?.id === selected ? ' is-selected' : ''}" style="${box(s.card, size)}" ${dropAttr} ${dragAttr} ${c ? `data-card="${esc(c.id)}" role="button" tabindex="0" aria-label="${esc(`Место ${i + 1}: ${c.title}`)}"` : `aria-label="Место ${i + 1}: пусто"`}>${inner}</div>`;
  }).join('');
  const captions = caption ? g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const c = set.slots[i] ? cards.get(set.slots[i]) : null;
    return c ? `<span class="wtext wtext--caption" style="${box(s.caption, size)};${fontOf(s.caption.height, size)};--fill:${g.caption.color};--stroke:${tpl.captionStroke}">${esc(c.title)}</span>` : '';
  }).join('') : '';
  const number = set.number ? `Набор ${set.number}${total ? `/${total}` : ''}` : '';
  return `<div class="wnd" data-template="${esc(templateKey)}" style="aspect-ratio:${size.width}/${size.height}">
    ${slots}
    <img class="wnd__tpl" src="/styles/${esc(style)}/windows/${esc(tpl.file)}" alt="" draggable="false">
    <span class="wtext wtext--title" style="${box(g.title, size)};${fontOf(g.title.height, size)};--fill:${g.title.color};--stroke:${g.title.stroke}">${esc(set.title)}</span>
    <span class="wtext wtext--progress" style="${box(g.progress, size)};${fontOf(g.progress.height, size)};--fill:${g.progress.color};--stroke:${tpl.progressStroke}">${filled}/${g.slots.length}</span>
    ${number ? `<span class="wtext wtext--number" style="${box(g.number, size)};${fontOf(g.number.height, size)};--fill:${g.number.color}">${esc(number)}</span>` : ''}
    ${captions}
  </div>`;
}

/**
 * The four template colours as a segmented switcher (design system: swatch colour from the template).
 * @param {any} g @param {string} current
 */
export function templateSwitch(g, current) {
  return `<div class="seg" role="group" aria-label="Цвет окна">${Object.entries(g.templates).map(([k, t]) =>
    `<button type="button" data-template-pick="${esc(k)}" aria-pressed="${k === current}" style="--swatch:${esc(/** @type {any} */ (t).swatch)}" title="${esc(/** @type {any} */ (t).label)}"><i class="swatch"></i><span class="hide-s">${esc(cap(/** @type {any} */ (t).label))}</span></button>`).join('')}</div>`;
}

/** @param {string} s */
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
