// Prompt fragments of a style bible: parsing the marked fragments out of the Markdown documents
// and filling their slots. Browser-safe (no Node imports): the caller reads the files.
//
// Marker: `<!-- fragment: <id> -->`, invisible in rendered Markdown.
// - Inline, followed on the same line by a code span: the marker names that code span.
// - Alone on its line: the marker names the next fenced block or blockquote.
// A fenced block whose lines start with `[label]` is a list of items, one per line; a line
// without a label is always used, a labelled line only when the assembly rules ask for it.
// A blockquote or a plain fenced block is one text; its hard line breaks become spaces.
// A leading `[label]` of a blockquote is its condition, kept as `label` and cut from the text.
//
// Slots inside a fragment: `{name}` / `[name]` is filled with a value, and
// `{a | b}` / `[a / b]` is a choice: one of the options is kept.

/** @typedef {{label: string|null, text: string, line: number}} FragmentItem */
/**
 * @typedef {object} Fragment
 * @property {string} id
 * @property {string} file    document name, relative to the style folder
 * @property {number} line    1-based line of the fragment text
 * @property {string} text    the whole text (items joined by newlines)
 * @property {string|null} label  condition label of a single-text fragment
 * @property {FragmentItem[]|null} items  items of a labelled fenced block
 */
/** @typedef {{raw: string, inner: string, options: string[]|null, start: number, end: number}} Slot */

const MARKER = /<!--\s*fragment:\s*([A-Za-z0-9_.-]+)\s*-->/;
const LABEL = /^\[([^\]]+)\]\s+/;
const SLOT = /\{([^{}]+)\}|\[([^[\]]+)\]/g;
const CHOICE_SPLIT = /\s+[|/]\s+/;

/**
 * Parses every marked fragment of one Markdown document.
 * @param {string} markdown
 * @param {string} file  document name used in `source`
 * @returns {Fragment[]}
 */
export function parseFragments(markdown, file) {
  const lines = markdown.split('\n');
  /** @type {Fragment[]} */
  const out = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = line.match(MARKER);
    if (!m) continue;
    const id = m[1];
    if (line.trim() !== m[0]) {
      for (const inline of line.matchAll(new RegExp(MARKER.source, 'g'))) {
        const code = line.slice((inline.index ?? 0) + inline[0].length).match(/^\s*`([^`]+)`/);
        if (!code) throw new Error(`${file}:${i + 1}: метка «${inline[1]}» в строке должна стоять прямо перед фрагментом в обратных кавычках`);
        out.push(single(inline[1], file, i + 1, code[1]));
      }
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length) throw new Error(`${file}:${i + 1}: после метки «${id}» нет фрагмента`);
    if (/^\s*```/.test(lines[j])) {
      const body = [];
      let k = j + 1;
      for (; k < lines.length && !/^\s*```/.test(lines[k]); k++) body.push(lines[k]);
      if (k >= lines.length) throw new Error(`${file}:${j + 1}: блок фрагмента «${id}» не закрыт`);
      out.push(fencedFragment(id, file, j + 2, body));
      i = k;
      fenced = false;
    } else if (/^\s*>/.test(lines[j])) {
      const body = [];
      let k = j;
      for (; k < lines.length && /^\s*>/.test(lines[k]); k++) body.push(lines[k].replace(/^\s*>\s?/, ''));
      out.push(single(id, file, j + 1, body.join(' ')));
      i = k - 1;
    } else {
      throw new Error(`${file}:${i + 1}: после метки «${id}» ожидается блок в тройных обратных кавычках или цитата (>)`);
    }
  }
  return out;
}

/** @param {string} text */
const squash = text => text.replace(/\s+/g, ' ').trim();

/** @param {string} id @param {string} file @param {number} line @param {string} raw @returns {Fragment} */
function single(id, file, line, raw) {
  let text = squash(raw);
  const m = text.match(LABEL);
  const label = m ? m[1] : null;
  if (m) text = text.slice(m[0].length);
  return { id, file, line, text, label, items: null };
}

/** @param {string} id @param {string} file @param {number} firstLine @param {string[]} body @returns {Fragment} */
function fencedFragment(id, file, firstLine, body) {
  const labelled = body.some(l => LABEL.test(l.trim()));
  if (!labelled) return { id, file, line: firstLine, text: squash(body.join(' ')), label: null, items: null };
  /** @type {FragmentItem[]} */
  const items = [];
  body.forEach((raw, n) => {
    const l = raw.trim();
    if (!l) return;
    const m = l.match(LABEL);
    items.push({ label: m ? m[1] : null, text: squash(m ? l.slice(m[0].length) : l), line: firstLine + n });
  });
  return { id, file, line: firstLine, text: items.map(it => it.text).join('\n'), label: null, items };
}

/**
 * The slots of a fragment text, in order.
 * @param {string} text
 * @returns {Slot[]}
 */
export function slotsOf(text) {
  /** @type {Slot[]} */
  const out = [];
  for (const m of text.matchAll(SLOT)) {
    const inner = (m[1] ?? m[2]).trim();
    const parts = inner.split(CHOICE_SPLIT).map(s => s.trim());
    out.push({ raw: m[0], inner, options: parts.length > 1 ? parts : null, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/**
 * Finds the option a pick names: an exact option first, else the one option that starts with it.
 * @param {Slot[]} slots
 * @param {string} pick
 * @returns {{slot: number, option: string}[]}  every match (the caller treats 0 or 2+ as an error)
 */
export function findOption(slots, pick) {
  /** @type {{slot: number, option: string}[]} */
  const exact = [];
  /** @type {{slot: number, option: string}[]} */
  const prefix = [];
  slots.forEach((s, n) => {
    for (const o of s.options || []) {
      if (o === pick) exact.push({ slot: n, option: o });
      else if (o.startsWith(pick)) prefix.push({ slot: n, option: o });
    }
  });
  return exact.length ? exact : prefix;
}

/**
 * Fills the slots of a text. `named(key)` returns the value of a named slot (key is the slot
 * name in lower case) or undefined; `chosen` maps a choice slot's index to the option kept.
 * A value for a slot whose name starts with a capital letter is capitalised.
 * With `dropUnfilled`, an unfilled choice slot is cut out together with the brackets around it.
 * @param {string} text
 * @param {{named: (key: string) => string|undefined, chosen: Map<number, string>, dropUnfilled?: boolean}} how
 * @returns {{text: string, missing: Slot[]}}
 */
export function fillSlots(text, { named, chosen, dropUnfilled = false }) {
  const slots = slotsOf(text);
  /** @type {Slot[]} */
  const missing = [];
  let out = '';
  let pos = 0;
  slots.forEach((s, n) => {
    let value;
    if (s.options) value = chosen.get(n);
    else {
      value = named(s.inner.toLowerCase());
      if (value !== undefined && /^[A-Z]/.test(s.inner)) value = value.charAt(0).toUpperCase() + value.slice(1);
    }
    let before = text.slice(pos, s.start);
    let skip = 0;
    if (value === undefined) {
      if (s.options && dropUnfilled) {
        // Cut "(" … ")" around the slot and the space before it: "backdrop ([a / b]) in" → "backdrop in".
        if (before.endsWith('(') && text[s.end] === ')') { before = before.slice(0, -1); skip = 1; }
        before = before.replace(/\s+$/, '');
        out += before;
        pos = s.end + skip;
        return;
      }
      missing.push(s);
      value = s.raw;
    }
    out += before + value;
    pos = s.end + skip;
  });
  out += text.slice(pos);
  return { text: out, missing };
}

/**
 * Makes a fragment read as a sentence: capital first letter (unless told not to) and a final full stop.
 * @param {string} text
 * @param {{capitalise?: boolean}} [opts]
 */
export function sentence(text, { capitalise = true } = {}) {
  let t = text.trim();
  if (capitalise) t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : t + '.';
}
