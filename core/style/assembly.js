// Assembles the sections of a card prompt from the bible fragments by the style's rules
// (prompt-assembly.json `sections`, in the order of the bible's PROMPTS.md). No text is written
// here: fragments come from the bible, glue templates from the rules file, values from the order.
import { fillSlots, findOption, sentence, slotsOf } from './fragments.js';

/** @typedef {import('./style.js').Style} Style */
/** @typedef {import('./style.js').Condition} Condition */
/** @typedef {import('./style.js').PartRule} PartRule */
/** @typedef {import('./card-order.js').CardOrder} CardOrder */
/** @typedef {{id: string, source: string}} UsedFragment */
/** @typedef {{name: string, text: string, fragments: UsedFragment[]}} Section */

/**
 * A staging field of the order, or its default from the rules.
 * @param {CardOrder} order
 * @param {Style} style
 * @param {string} field
 * @returns {unknown}
 */
export function stagingValue(order, style, field) {
  const v = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (order.staging || {}))[field];
  return v === undefined ? style.assembly.fields[field]?.default : v;
}

/**
 * A value of the order by a dotted path ("scene.time"); empty strings count as missing.
 * @param {CardOrder} order
 * @param {string} path
 * @returns {unknown}
 */
export function orderValue(order, path) {
  /** @type {any} */
  let v = order;
  for (const k of path.split('.')) v = v == null ? undefined : v[k];
  return typeof v === 'string' && !v.trim() ? undefined : v;
}

/**
 * Does the order's staging satisfy a condition? An object needs every key to match (a key lists the
 * allowed values; `not` lists values none of which may match); a list needs any of its objects.
 * @param {Condition|undefined} cond
 * @param {CardOrder} order
 * @param {Style} style
 * @returns {boolean}
 */
export function matches(cond, order, style) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.some(c => matches(c, order, style));
  return Object.entries(cond).every(([k, allowed]) => {
    if (k === 'not') return !Object.entries(/** @type {Record<string, unknown[]>} */ (/** @type {unknown} */ (allowed))).some(([nk, nv]) => nv.includes(stagingValue(order, style, nk)));
    return allowed.includes(stagingValue(order, style, k));
  });
}

/**
 * Display names of the scene's characters, taken from their bible descriptions ("The Man: …").
 * @param {CardOrder} order
 * @param {Style} style
 * @returns {string[]}  e.g. ["the Man", "the Pig"]
 */
export function castNames(order, style) {
  return (order.scene?.characters || []).map(c => {
    const f = style.fragments.get(style.assembly.cast[c.name]?.fragment);
    const name = f ? f.text.split(':')[0].trim() : c.name;
    return name.charAt(0).toLowerCase() + name.slice(1);
  });
}

/** @param {string[]} names */
export const joinNames = names => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);

/**
 * Value of a named slot by the rules' `slots` map.
 * @param {string} key  slot name in lower case
 * @param {CardOrder} order
 * @param {Style} style
 * @returns {string|undefined}
 */
function namedValue(key, order, style) {
  const src = style.assembly.slots[key];
  if (src === undefined) return undefined;
  if (src === '$cast') return order.scene?.characters?.length ? joinNames(castNames(order, style)) : undefined;
  if (typeof src === 'string') {
    const v = orderValue(order, src);
    return v === undefined ? undefined : String(v);
  }
  return src.map[String(stagingValue(order, style, src.field))];
}

/** Where the value of a named slot comes from, for an error message. @param {string} key @param {Style} style */
function slotSourceText(key, style) {
  const src = style.assembly.slots[key];
  if (src === undefined) return `правила стиля не говорят, чем заполнить слот (prompt-assembly.json, slots)`;
  if (src === '$cast') return 'нужно поле scene.characters';
  if (typeof src === 'string') return `нужно поле ${src}`;
  return `нужно поле staging.${src.field} со значением из: ${Object.keys(src.map).join(', ')}`;
}

/**
 * Assembles the prompt sections for an order. Errors are readable (Russian) and name the order
 * field to add or fix; with errors the text may still contain unfilled slots.
 * @param {CardOrder} order
 * @param {Style} style
 * @returns {{sections: Section[], errors: string[]}}
 */
export function assemble(order, style) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Section[]} */
  const sections = [];
  for (const rule of style.assembly.sections) {
    /** @type {string[]} */
    const texts = [];
    /** @type {UsedFragment[]} */
    const used = [];
    for (const part of rule.parts) {
      if (!matches(part.when, order, style)) continue;
      const r = renderPart(part, order, style, errors);
      if (!r) continue;
      if (part.attach && texts.length) texts[texts.length - 1] += ' ' + r.text;
      else texts.push(r.text);
      used.push(...r.used);
    }
    if (!texts.length) {
      if (rule.required && !order.promptExtra) errors.push(`для этой постановки в библии нет фрагмента раздела «${rule.name}» (${stagingSummary(order, style)}); опишите постановку словами в promptExtra или выберите другую постановку`);
      continue;
    }
    sections.push({ name: rule.name, text: texts.join(rule.join ?? '\n\n'), fragments: used });
  }
  return { sections, errors };
}

/** @param {CardOrder} order @param {Style} style */
function stagingSummary(order, style) {
  return ['category', 'backdrop', 'placement', 'support', 'pattern'].map(k => `${k} ${stagingValue(order, style, k)}`).join(', ');
}

/**
 * @param {PartRule} part
 * @param {CardOrder} order
 * @param {Style} style
 * @param {string[]} errors
 * @returns {{text: string, used: UsedFragment[]}|null}
 */
function renderPart(part, order, style, errors) {
  const named = (/** @type {string} */ key) => namedValue(key, order, style);
  if (part.template !== undefined) {
    const { text, missing } = fillSlots(part.template, { named, chosen: new Map() });
    if (missing.length) {
      if (!part.optional) for (const s of missing) errors.push(`шаблон «${part.template}»: слот ${s.raw} — ${slotSourceText(s.inner.toLowerCase(), style)}`);
      return null;
    }
    return { text: sentence(text), used: [{ id: 'template', source: part.template }] };
  }
  if (part.cast) return renderCast(order, style, errors);

  const id = part.fragment || '';
  const f = style.fragments.get(id);
  if (!f) {
    errors.push(`в библии нет фрагмента «${id}» (prompt-assembly.json ссылается на него)`);
    return null;
  }
  const source = `${f.file}:${f.line}`;
  if (f.items) return renderItems(part, f, order, style, errors);

  const slots = slotsOf(f.text);
  /** @type {Map<number, string>} */
  const chosen = new Map();
  for (const pick of part.pick || []) {
    if (!matches(pick.when, order, style)) continue;
    const value = pick.field ? stagingValue(order, style, pick.field) : orderValue(order, pick.path || '');
    if (value === undefined) continue;
    const option = pick.map ? pick.map[String(value)] : String(value);
    if (option === undefined) continue;
    const found = findOption(slots, option);
    if (found.length !== 1) {
      errors.push(`фрагмент «${id}» (${source}): вариант «${option}» ${found.length ? 'подходит к нескольким вариантам' : 'не найден среди вариантов'} (prompt-assembly.json, pick ${pick.field || pick.path})`);
      continue;
    }
    chosen.set(found[0].slot, found[0].option);
  }
  const { text, missing } = fillSlots(f.text, { named, chosen, dropUnfilled: part.drop_unfilled });
  for (const s of missing) {
    if (s.options) {
      const by = (part.pick || []).filter(p => matches(p.when, order, style)).map(p => (p.field ? `staging.${p.field}` : p.path));
      const value = by.map(b => `${b} = ${JSON.stringify(b && b.startsWith('staging.') ? stagingValue(order, style, b.slice(8)) : orderValue(order, b || ''))}`).join(', ');
      errors.push(`фрагмент «${id}» (${source}): не выбран вариант ${s.raw}${value ? ` (${value} не даёт варианта этого фрагмента)` : ''}`);
    } else errors.push(`фрагмент «${id}» (${source}): слот ${s.raw} — ${slotSourceText(s.inner.toLowerCase(), style)}`);
  }
  const body = part.prefix ? part.prefix + text : text;
  return { text: sentence(body, { capitalise: !part.prefix }), used: [{ id, source }] };
}

/**
 * A labelled fragment: its unlabelled items (the base), then the labelled items the rules select,
 * in the document's order (PROMPTS.md, rendering: the whole style block, then the bracketed lines that apply).
 * @param {PartRule} part
 * @param {import('./fragments.js').Fragment} f
 * @param {CardOrder} order
 * @param {Style} style
 * @param {string[]} errors
 */
function renderItems(part, f, order, style, errors) {
  /** @type {Set<string>} */
  const wanted = new Set();
  for (const it of part.items || []) if (matches(it.when, order, style)) wanted.add(it.label);
  if (part.items_from) {
    const v = stagingValue(order, style, part.items_from);
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) wanted.add(String(x));
  }
  const labels = new Set(f.items?.map(it => it.label));
  for (const l of [...(part.items || []).map(it => it.label), ...wanted]) {
    if (!labels.has(l)) errors.push(`во фрагменте «${f.id}» (${f.file}:${f.line}) нет пункта [${l}]`);
  }
  const items = f.items || [];
  const base = items.filter(it => it.label === null);
  const extra = items.filter(it => it.label !== null && wanted.has(it.label));
  const all = [...base, ...extra];
  if (!all.length) return null;
  /** @type {UsedFragment[]} */
  const used = [];
  if (base.length) used.push({ id: f.id, source: `${f.file}:${base[0].line}` });
  for (const it of extra) used.push({ id: `${f.id}[${it.label}]`, source: `${f.file}:${it.line}` });
  return { text: all.map(it => sentence(it.text)).join('\n'), used };
}

/**
 * The full description of every scene character, word for word, then its costume.
 * @param {CardOrder} order
 * @param {Style} style
 * @param {string[]} errors
 */
function renderCast(order, style, errors) {
  /** @type {string[]} */
  const texts = [];
  /** @type {UsedFragment[]} */
  const used = [];
  for (const c of order.scene?.characters || []) {
    const id = style.assembly.cast[c.name]?.fragment;
    const f = id ? style.fragments.get(id) : undefined;
    if (!f) {
      errors.push(`нет описания персонажа «${c.name}» в библии`);
      continue;
    }
    texts.push(sentence(f.text) + (c.costume ? ' ' + sentence(c.costume) : ''));
    used.push({ id: f.id, source: `${f.file}:${f.line}` });
  }
  return texts.length ? { text: texts.join('\n\n'), used } : null;
}
