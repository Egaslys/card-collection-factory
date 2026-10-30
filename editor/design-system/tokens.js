// Token loader of the editor's design system. The single source of truth is DESIGN.md next to this file: this
// module fetches it, reads the front matter and the x-tokens blocks (front-matter.js) and writes one stylesheet:
//   - colours: --color-<name> and --color-<name>-rgb; light in :root, the `-dark` twins in :root[data-theme="dark"];
//   - typography: --type-<token>-family|size|line|weight|tracking|variation|feature|case, the `-mobile` tokens in a
//     media query, and one class per token, .type-<token>;
//   - --rounded-<level>, --spacing-<level> (responsive ones in media queries), --motion-<name>,
//     --shadow-<name> and --glass-<name> per theme;
//   - components: --c-<component>-<property> (bg, fg, radius, padding, height, width, size; a typography reference
//     becomes --c-<component>-font-family|size|line|weight|tracking|variation|feature|case);
//   - @font-face for the bundled fonts (no network).
// Nothing here holds a design value of its own: edit DESIGN.md and reload.

import { readDesign } from './front-matter.js';

const DESIGN_URL = new URL('./DESIGN.md', import.meta.url);

/**
 * Loads DESIGN.md, installs the stylesheet (once per document) and returns the parsed values.
 * @param {URL | string} [url]
 */
export async function loadDesign(url = DESIGN_URL) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`DESIGN.md: HTTP ${res.status}`);
  const design = readDesign(await res.text());
  const css = buildCss(design, new URL(url, location.href));
  let style = document.getElementById('ds-tokens');
  if (!style) { style = document.createElement('style'); style.id = 'ds-tokens'; document.head.prepend(style); }
  style.textContent = css;
  return { ...design, css, colors: themeColors(design.tokens.colors) };
}

/** Light and dark hex tables: { light: {name: hex}, dark: {name: hex} }. @param {Record<string,string>} C */
export function themeColors(C) {
  /** @type {{ light: Record<string,string>, dark: Record<string,string> }} */
  const out = { light: {}, dark: {} };
  for (const [name, val] of Object.entries(C)) {
    if (name.endsWith('-dark')) continue;
    out.light[name] = val;
    out.dark[name] = C[name + '-dark'] || val;
  }
  return out;
}

/** @param {{ tokens: Record<string, any>, ext: Record<string, any> }} design @param {URL} base */
export function buildCss({ tokens, ext }, base) {
  const C = tokens.colors, TY = tokens.typography, RD = tokens.rounded, SP = tokens.spacing, CO = tokens.components || {};
  const colors = themeColors(C);
  const rgb = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
  const fam = (/** @type {string} */ f) => `"${f}", ${/mono/i.test(f) ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`;
  const decl = (/** @type {Record<string,string>} */ o) => Object.entries(o).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  /** @type {Record<string,string>} */ const light = {};
  /** @type {Record<string,string>} */ const dark = {};
  /** @type {Record<string,string>} */ const tablet = {};
  /** @type {Record<string,string>} */ const mobile = {};

  for (const [theme, out] of /** @type {const} */ ([['light', light], ['dark', dark]])) {
    out['color-scheme'] = theme;
    for (const [name, val] of Object.entries(colors[theme])) { out[`--color-${name}`] = val; out[`--color-${name}-rgb`] = rgb(val); }
    for (const [name, val] of Object.entries((ext.elevation || {})[theme] || {})) out[`--shadow-${name}`] = String(val);
    for (const [name, val] of Object.entries((ext.glass || {})[theme] || {})) out[`--glass-${name}`] = String(val);
  }
  for (const [name, val] of Object.entries((ext.glass || {}).common || {})) light[`--glass-${name}`] = String(val);

  // typography
  const upper = new Set(ext.uppercase || []);
  const typeVars = (/** @type {string} */ n, /** @type {any} */ t) => ({
    [`--type-${n}-family`]: fam(t.fontFamily),
    [`--type-${n}-size`]: t.fontSize,
    [`--type-${n}-line`]: String(t.lineHeight),
    [`--type-${n}-weight`]: String(t.fontWeight),
    [`--type-${n}-tracking`]: t.letterSpacing || 'normal',
    [`--type-${n}-variation`]: t.fontVariation || 'normal',
    [`--type-${n}-feature`]: t.fontFeature || 'normal',
    [`--type-${n}-case`]: upper.has(n) ? 'uppercase' : 'none',
  });
  const TYPE_PROPS = ['family', 'size', 'line', 'weight', 'tracking', 'variation', 'feature', 'case'];
  const classes = [];
  for (const [n, t] of Object.entries(TY)) {
    if (n.endsWith('-mobile')) { const v = typeVars(n.slice(0, -7), t); delete v[`--type-${n.slice(0, -7)}-case`]; Object.assign(mobile, v); continue; }
    Object.assign(light, typeVars(n, t));
    classes.push(`.type-${n} { font-family: var(--type-${n}-family); font-size: var(--type-${n}-size); line-height: var(--type-${n}-line); ` +
      `font-weight: var(--type-${n}-weight); letter-spacing: var(--type-${n}-tracking); font-variation-settings: var(--type-${n}-variation); ` +
      `font-feature-settings: var(--type-${n}-feature); text-transform: var(--type-${n}-case); }`);
  }

  // shape, space, motion
  for (const [k, v] of Object.entries(RD)) light[`--rounded-${k}`] = String(v);
  for (const [k, v] of Object.entries(SP)) {
    if (k.endsWith('-mobile')) mobile[`--spacing-${k.slice(0, -7)}`] = String(v);
    else if (k.endsWith('-tablet')) tablet[`--spacing-${k.slice(0, -7)}`] = String(v);
    else light[`--spacing-${k}`] = String(v);
  }
  for (const [k, v] of Object.entries(ext.motion || {})) light[`--motion-${k}`] = String(v);

  // components: references become var() of the generated properties
  const PROP = /** @type {Record<string,string>} */ ({ backgroundColor: 'bg', textColor: 'fg', rounded: 'radius', padding: 'padding', height: 'height', width: 'width', size: 'size' });
  const ref = (/** @type {any} */ v) => String(v).replace(/\{(colors|rounded|spacing)\.([A-Za-z0-9-]+)\}/g, (_, g, k) => `var(--${g === 'colors' ? 'color' : g}-${k})`);
  for (const [comp, props] of Object.entries(CO)) {
    for (const [p, v] of Object.entries(/** @type {Record<string, any>} */ (props))) {
      if (p === 'typography') {
        const t = String(v).match(/^\{typography\.([A-Za-z0-9-]+)\}$/);
        if (!t || !TY[t[1]]) throw new Error(`DESIGN.md: components.${comp}.typography must reference a typography token`);
        for (const q of TYPE_PROPS) light[`--c-${comp}-font-${q}`] = `var(--type-${t[1]}-${q})`;
      } else if (PROP[p]) light[`--c-${comp}-${PROP[p]}`] = ref(v);
      else throw new Error(`DESIGN.md: components.${comp}.${p} is not a known component property`);
    }
  }

  // bundled fonts: one face per family and subset, files relative to DESIGN.md
  const faces = [];
  for (const f of ext.fonts || []) {
    for (const [subset, file] of Object.entries(f.files)) {
      const range = (ext.fontSubsets || {})[subset];
      if (!range) throw new Error(`DESIGN.md: fontSubsets has no unicode range for "${subset}"`);
      faces.push(`@font-face { font-family: "${f.family}"; font-style: normal; font-weight: ${f.weight}; ${f.stretch ? `font-stretch: ${f.stretch}; ` : ''}` +
        `font-display: swap; src: url("${new URL(file, base).href}") format("woff2"); unicode-range: ${range}; }`);
    }
  }

  return `/* generated by tokens.js from DESIGN.md — do not edit, edit DESIGN.md */
${faces.join('\n')}
:root {\n${decl(light)}\n}
:root[data-theme="dark"] {\n${decl(dark)}\n}
@media (max-width: 900px) { :root {\n${decl(tablet)}\n} }
@media (max-width: 640px) { :root {\n${decl(mobile)}\n} }
@media (prefers-reduced-motion: reduce) { :root { ${Object.keys(ext.motion || {}).filter((k) => /^t\d$/.test(k)).map((k) => `--motion-${k}: 1ms;`).join(' ')} } }
${classes.join('\n')}`;
}
