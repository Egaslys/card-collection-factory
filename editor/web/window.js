// The set shown in the style's window template (design system «Set window preview»), in the window of its kind (set.json
// window.kind: the main window of styles/<style>/windows/windows.json, or one of its `families` — small, grand): the
// card images at the slot rectangles, the template image over them (its picture openings are transparent and its
// frames cover the card edges, as in the game), the frame and the stars of each place, then the set's title, number
// and captions. What each place shows (its stars and frame) comes from the server with the set (`set.shown.places`,
// core/set/places.js). The main window bakes its stars into its templates; a family with star images and the same
// colours (windows.json: «drawn over this template they give the large window back») draws it instead, so a place's
// stars can be changed. All positions are fractions of the template, so the window scales with its frame.
import { esc, I } from './ui.js';
import { lang, words } from './i18n.js';

const t = words({
  ru: { place: 'Место {n}: {title}', empty: 'Место {n}: пусто', number: 'Набор {n}', of: 'Набор {n}/{total}', colour: 'Цвет окна', noWindow: 'У стиля «{style}» нет шаблонов окна.' },
  en: { place: 'Place {n}: {title}', empty: 'Place {n}: empty', number: 'Set {n}', of: 'Set {n}/{total}', colour: 'Window colour', noWindow: 'The style «{style}» has no window templates.' },
});

/** Colour names of the window templates in English; Russian comes from windows.json (`label`). */
const COLOUR_EN = /** @type {Record<string, string>} */ ({ blue: 'blue', violet: 'violet', crimson: 'crimson', orange: 'orange', crystal: 'crystal' });

/** @type {Map<string, Promise<any>>} */
const geometry = new Map();

/** The style's window geometry (one fetch per style). @param {string} style @returns {Promise<any>} */
export function windowsOf(style) {
  if (!geometry.has(style)) {
    geometry.set(style, fetch(`/styles/${encodeURIComponent(style)}/windows/windows.json`).then(r => {
      if (!r.ok) throw new Error(t('noWindow', { style }));
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
  const templates = Object.fromEntries(Object.entries(f.templates ?? g.templates).map(([k, x]) => [k, { ...g.templates[k], ...x }]));
  return { ...g, ...f, kind, templates, slots: f.slots ?? g.slots, families: undefined };
}

/**
 * What draws a window kind: the main window is drawn by its family with star images (its templates without stars),
 * so every place shows its own stars; any other kind by itself.
 * @param {any} g @param {string} [kind]
 */
function drawnFor(g, kind) {
  const k = kind ?? g.kind;
  if (k !== g.kind) return windowFor(g, k);
  const starred = Object.entries(g.families ?? {}).find(([, f]) => /** @type {any} */ (f).stars && Object.keys(/** @type {any} */ (f).templates ?? {}).every(x => x in g.templates));
  return starred ? { ...windowFor(g, starred[0]), kind: k } : g;
}

/** The frame image of slot i for a frame kind: the family's list by slot number, else the slot's own. @param {any} w @param {number} i @param {string} kind */
const frameOf = (w, i, kind) => (Array.isArray(w.frames?.[kind]) ? w.frames[kind].find((/** @type {any} */ f) => f.n === i + 1) : w.slots[i].frames?.[kind]) ?? null;

/** @param {{x: number, y: number, width: number, height: number}} r @param {{width: number, height: number}} size */
const box = (r, size) => `left:${(r.x / size.width) * 100}%;top:${(r.y / size.height) * 100}%;width:${(r.width / size.width) * 100}%;height:${(r.height / size.height) * 100}%`;
/** font size as a share of the window's width (container query units), from the text box height @param {number} h @param {any} size */
const fontOf = (h, size) => `font-size:${((h * 0.78) / size.width) * 100}cqw`;

/**
 * The window of one set.
 * @param {any} main  windows.json (the window of the set's kind is taken from it)
 * @param {{set: any, cards: Map<string, any>, style: string, total?: number, drop?: boolean, selected?: number|null, caption?: boolean, edit?: boolean, picked?: (id: string) => boolean}} o
 *   cards: card id → CardSummary (with imageUrl); total: sets in the collection (for «Набор N/M»); drop: slots receive
 *   dragged cards; selected: the place whose panel is open; edit: every place is a button (the set screen: a click opens
 *   the place's panel, an empty place shows «+»); picked: cards chosen for export
 */
export function windowHtml(main, { set, cards, style, total, drop = false, selected = null, caption = true, edit = false, picked = () => false }) {
  const g = drawnFor(main, set.window?.kind);
  const tpl = g.templates[set.window?.template] ?? Object.values(g.templates)[0];
  const templateKey = Object.keys(g.templates).find(k => g.templates[k] === tpl);
  const size = g.size;
  const places = /** @type {{stars: number, frame: string}[]} */ (set.shown?.places ?? []);
  const filled = set.slots.filter((/** @type {string|null} */ id) => id && cards.get(id)).length;
  const slots = g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const id = set.slots[i];
    const c = id ? cards.get(id) : null;
    const dropAttr = drop ? `data-drop='${esc(JSON.stringify({ setId: set.id, slot: i }))}'` : '';
    const dragAttr = c && drop ? `data-drag='${esc(JSON.stringify({ card: c.id, setId: set.id, slot: i }))}'` : '';
    const inner = c?.imageUrl
      ? `<img src="${esc(c.imageUrl)}" alt="${esc(c.title)}" draggable="false" loading="lazy" decoding="async">`
      : c ? `<span class="wslot__state">${c.status === 'failed' ? I.alert : I.image}</span>` : edit ? `<span class="wslot__plus">${I.plus}</span>` : '';
    const label = c ? t('place', { n: i + 1, title: c.title }) : t('empty', { n: i + 1 });
    const button = c || edit ? `role="button" tabindex="0" aria-label="${esc(label)}"` : `aria-label="${esc(label)}"`;
    const cls = `wslot${c ? '' : ' is-empty'}${c && picked(c.id) ? ' is-picked' : ''}`;
    return `<div class="${cls}" style="${box(s.card, size)}" data-slot="${i}" ${dropAttr} ${dragAttr} ${c ? `data-card="${esc(c.id)}"` : ''} ${button}>${inner}</div>`;
  }).join('');
  const captions = caption ? g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const c = set.slots[i] ? cards.get(set.slots[i]) : null;
    return c ? `<span class="wtext wtext--caption" data-caption-of="${i}" style="${box(s.caption, size)};${fontOf(s.caption.height, size)};--fill:${g.caption.color};--stroke:${tpl.captionStroke}">${esc(c.title)}</span>` : '';
  }).join('') : '';
  const img = (/** @type {any} */ f, /** @type {string} */ cls, /** @type {string} */ data) => `<img class="${cls}" src="/styles/${esc(style)}/windows/${esc(f.file)}" style="${box(f, size)}" alt="" draggable="false" ${data}>`;
  // a place's frame: an image where the window has one for it (gold); the plain frame is the template's own
  const frames = g.slots.map((/** @type {any} */ _, /** @type {number} */ i) => {
    const kind = places[i]?.frame;
    const f = kind ? frameOf(g, i, kind) : null;
    return f ? img(f, 'wnd__frame', `data-frame="${esc(kind)}"`) : '';
  }).join('');
  // a window drawn with star images: each place's stars (a window with its stars baked in, the grand one, has none)
  const stars = g.stars ? g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const n = places[i]?.stars ?? s.stars;
    const st = g.stars[n];
    return st ? img({ ...st, x: s.card.x + st.dx, y: s.card.y + st.dy }, 'wnd__stars', `data-stars="${n}"`) : '';
  }).join('') : '';
  // the open place and the cards picked for the export: a ring over the template, so its frame does not hide it
  const rings = g.slots.map((/** @type {any} */ s, /** @type {number} */ i) => {
    const c = set.slots[i] ? cards.get(set.slots[i]) : null;
    const cls = [selected === i && 'is-selected', c && picked(c.id) && 'is-picked'].filter(Boolean).join(' ');
    return cls ? `<span class="wnd__ring ${cls}" style="${box(s.card, size)}"></span>` : '';
  }).join('');
  const number = set.number ? (total ? t('of', { n: set.number, total }) : t('number', { n: set.number })) : '';
  return `<div class="wnd" data-template="${esc(templateKey)}" style="aspect-ratio:${size.width}/${size.height}">
    ${slots}
    <img class="wnd__tpl" src="/styles/${esc(style)}/windows/${esc(tpl.file)}" alt="" draggable="false">
    ${frames}
    ${stars}
    ${rings}
    <span class="wtext wtext--title" style="${box(g.title, size)};${fontOf(g.title.height, size)};--fill:${g.title.color};--stroke:${g.title.stroke}">${esc(set.title)}</span>
    <span class="wtext wtext--progress" style="${box(g.progress, size)};${fontOf(g.progress.height, size)};--fill:${g.progress.color};--stroke:${tpl.progressStroke}">${filled}/${g.slots.length}</span>
    ${number ? `<span class="wtext wtext--number" style="${box(g.number, size)};${fontOf(g.number.height, size)};--fill:${g.number.color}${g.number.stroke ? `;--stroke:${g.number.stroke}` : ''}">${esc(number)}</span>` : ''}
    ${captions}
  </div>`;
}

/** A template's colour name in the page's language. @param {string} key @param {any} tpl */
export const colourName = (key, tpl) => (lang() === 'en' ? COLOUR_EN[key] ?? key : tpl.label ?? key);

/**
 * The template colours of a window kind as round swatches (the chosen one ringed); nothing when the window has one
 * colour.
 * @param {any} g  windowFor(…) of the set's kind @param {string} current @param {string} [name]  the group's data name
 */
export function colourSwatches(g, current, name = 'colour') {
  if (Object.keys(g.templates).length < 2) return '';
  return `<div class="swatches" role="group" aria-label="${esc(t('colour'))}" data-seg="${esc(name)}">${Object.entries(g.templates).map(([k, x]) =>
    `<button type="button" data-v="${esc(k)}" aria-pressed="${k === current}" aria-label="${esc(colourName(k, x))}" title="${esc(colourName(k, x))}" style="--swatch:${esc(/** @type {any} */ (x).swatch)}"></button>`).join('')}</div>`;
}
