// The page's two languages, Russian and English (the author's decision, 2026-10-31): the person switches them in the
// top bar; the first time the browser's language decides, then the choice is remembered in this browser. Every text
// the person reads comes from a module's own dictionary through words(), so each module keeps its texts next to its
// code and no shared file grows into a merge point. What the models are sent stays English, and what a model wrote
// (card captions, plans, its findings) is shown as written.

/** @typedef {'ru'|'en'} Lang */

export const LANGS = /** @type {const} */ (['ru', 'en']);
const KEY = 'ccf-lang';

/** @returns {Lang} */
function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch { /* private mode */ }
  const nav = typeof navigator === 'undefined' ? '' : String(navigator.language ?? '');
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** @type {Lang} */
let current = initial();
if (typeof document !== 'undefined') document.documentElement.lang = current;

/** @returns {Lang} the page's language */
export const lang = () => current;

/**
 * Switches the language and remembers it; the page is loaded again, so every screen and open panel is drawn in it.
 * @param {Lang} l
 */
export function setLang(l) {
  if (!LANGS.includes(l) || l === current) return;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  current = l;
  if (typeof location !== 'undefined') location.reload();
}

/**
 * Fills {name} slots of a text.
 * @param {string} text
 * @param {Record<string, unknown>} [vars]
 */
export const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/**
 * A module's texts in both languages → its lookup function. A key missing in the page's language falls back to
 * Russian and then to the key itself, so a gap shows as a visible key, never as an empty place.
 * @template {Record<string, string>} T
 * @param {{ru: T, en: {[K in keyof T]?: string}}} dict
 * @returns {(key: keyof T & string, vars?: Record<string, unknown>) => string}
 */
export function words(dict) {
  return (key, vars) => fill(/** @type {Record<string, string|undefined>} */ (dict[current])[key] ?? dict.ru[key] ?? key, vars);
}

/**
 * The word form for a count: Russian has three (1 карточка, 2 карточки, 5 карточек), English two.
 * @param {number} n
 * @param {{ru: [string, string, string], en: [string, string]}} forms
 */
export function plural(n, forms) {
  const a = Math.abs(n);
  if (current === 'en') return a === 1 ? forms.en[0] : forms.en[1];
  const d10 = a % 10, d100 = a % 100;
  if (d10 === 1 && d100 !== 11) return forms.ru[0];
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return forms.ru[1];
  return forms.ru[2];
}
