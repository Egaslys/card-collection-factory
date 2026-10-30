// The set shown in the style's window template (design system «Set window preview»), in the window of its kind (set.json
// window.kind: the main window of styles/<style>/windows/windows.json, or one of its `families` — small, grand): the
// card images at the slot rectangles, the template image over them (its picture openings are transparent and its
// frames cover the card edges, as in the game), the frame of each slot whose rarity is not the template's (the set
// plan's `frame`: gold, as in the reference; the image and its rectangle per slot), the stars of each slot when the
// template has none (the small window: the plan's stars), then the set's title, number and captions.
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

/**
 * The geometry of one window kind: the main window, or a family of windows.json laid over it (a family without its own
 * slots, size or texts has the main window's; a family template named like a main one keeps its label and colours).
 * @param {any} g  windows.json @param {string} [kind]  set.json window.kind
 */
export function windowFor(g, kind) {
  const f = kind && kind !== g.kind ? g.families?.[kind] : null;
  if (!f) return g;
  const templates = Object.fromEntries(Object.entries(f.templates ?? g.templates).map(([k, t]) => [k, { ...g.templates[k], ...t }]));
  return { ...g, ...f, kind, templates, slots: f.slots ?? g.slots, families: undefined };
}

/** The frame image of slot i for a frame kind: the family's list by slot number, else the slot's own. @param {any} w @param {number} i @param {string} kind */
const frameOf = (w, i, kind) => (Array.isArray(w.frames?.[kind]) ? w.frames[kind].find((/** @type {any} */ f) => f.n === i + 1) : w.slots[i].frames?.[kind]) ?? null;

/** @param {{x: number, y: number, width: number, height: number}} r @param {{width: number, height: number}} size */
const box = (r, size) => `left:${(r.x / size.width) * 100}%;top:${(r.y / size.height) * 100}%;width:${(r.width / size.width) * 100}%;height:${(r.height / size.height) * 100}%`;
/** font size as a share of the window's width (container query units), from the text box height @param {number} h @param {any} size */
const fontOf = (h, size) => `font-size:${((h * 0.78) / size.width) * 100}cqw`;

/**
 * The window of one set.
 * @param {any} g  windows.json (the window of the set's kind is taken from it)
 * @param {{set: any, cards: Map<string, any>, style: string, total?: number, drop?: boolean, selected?: string|null, caption?: boolean}} o
 *   cards: card id → CardSummary (with imageUrl); total: sets in the collection (for «Набор N/M»); drop: slots receive dragged cards
 */
export function windowHtml(main, { set, cards, style, total, drop = false, selected = null, caption = true }) {
  const g = windowFor(main, set.window?.kind);
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
  // the slot's frame comes from the plan (SETS.md 4: rarity belongs to the slot); a kind without an image stays as drawn
  const img = (/** @type {any} */ f, /** @type {string} */ cls, /** @type {string} */ data) => `<img class="${cls}" src="/styles/${esc(style)}/windows/${esc(f.file)}" style="${box(f, size)}" alt="" draggable="false" ${data}>`;
  const frames = g.slots.map((/** @type {any} */ _, /** @type {number} */ i) => {
    const kind = set.plan?.slots?.[i]?.frame;
    const f = kind ? frameOf(g, i, kind) : null;
    return f ? img(f, 'wnd__frame', `data-frame="${esc(kind)}"`) : '';
  }).join('');
  // a template without stars (the small window): each slot's stars from the plan, else the main window's ladder
  const stars = g.stars ? g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const n = set.plan?.slots?.[i]?.stars ?? s.stars;
    const st = g.stars[n];
    return st ? img({ ...st, x: s.card.x + st.dx, y: s.card.y + st.dy }, 'wnd__stars', `data-stars="${n}"`) : '';
  }).join('') : '';
  const number = set.number ? `Набор ${set.number}${total ? `/${total}` : ''}` : '';
  return `<div class="wnd" data-template="${esc(templateKey)}" style="aspect-ratio:${size.width}/${size.height}">
    ${slots}
    <img class="wnd__tpl" src="/styles/${esc(style)}/windows/${esc(tpl.file)}" alt="" draggable="false">
    ${frames}
    ${stars}
    <span class="wtext wtext--title" style="${box(g.title, size)};${fontOf(g.title.height, size)};--fill:${g.title.color};--stroke:${g.title.stroke}">${esc(set.title)}</span>
    <span class="wtext wtext--progress" style="${box(g.progress, size)};${fontOf(g.progress.height, size)};--fill:${g.progress.color};--stroke:${tpl.progressStroke}">${filled}/${g.slots.length}</span>
    ${number ? `<span class="wtext wtext--number" style="${box(g.number, size)};${fontOf(g.number.height, size)};--fill:${g.number.color}${g.number.stroke ? `;--stroke:${g.number.stroke}` : ''}">${esc(number)}</span>` : ''}
    ${captions}
  </div>`;
}

/**
 * The template colours of a window kind as a segmented switcher (design system: swatch colour from the template);
 * nothing when the window has one colour.
 * @param {any} g  windowFor(…) of the set's kind @param {string} current
 */
export function templateSwitch(g, current) {
  if (Object.keys(g.templates).length < 2) return '';
  return `<div class="seg" role="group" aria-label="Цвет окна">${Object.entries(g.templates).map(([k, t]) =>
    `<button type="button" data-template-pick="${esc(k)}" aria-pressed="${k === current}" style="--swatch:${esc(/** @type {any} */ (t).swatch)}" title="${esc(/** @type {any} */ (t).label)}"><i class="swatch"></i><span class="hide-s">${esc(cap(/** @type {any} */ (t).label))}</span></button>`).join('')}</div>`;
}

/** @param {string} s */
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
