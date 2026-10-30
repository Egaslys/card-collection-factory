// Planning sets and collections with a text model (the editor's path without an agent; an agent writes plans
// itself). The prompt is assembled from the bible's set fragments (SETS.md «10. Для промпта (англ.)», marked
// `set.*`) and the program's glue (set-rules.json `prompt.glue`: the JSON answer format and the collection split);
// the answer becomes a SetPlan, is validated (plan.js), and its errors are sent back for a bounded number of repairs.
import fs from 'node:fs';
import path from 'node:path';
import { fillSlots, parseFragments } from '../style/fragments.js';
import { styleDirOf } from '../style/style.js';
import { normalizePlan, registryOf, validatePlan } from './plan.js';
import { matches } from '../style/assembly.js';
import { expandStaging, loadSetRules, seenPatterns, windowSkeleton } from './rules.js';

/** @typedef {import('./plan.js').SetPlan} SetPlan */
/** @typedef {import('./plan.js').SlotPlan} SlotPlan */
/** @typedef {import('./plan.js').RegistryEntry} RegistryEntry */
/** @typedef {import('../providers/openrouter-text.js').ChatMessage} ChatMessage */

/**
 * The text model of a run: one answer for a conversation, its cost in USD (null = unknown).
 * @typedef {(messages: ChatMessage[]) => Promise<{text: string, cost: number|null}>} TextModel
 */

/**
 * @typedef {object} PlanSettings  settings `set.plan`
 * @property {number} repairs @property {number} maxTokens @property {number} temperature  (the model: provider.<preset>.textModel)
 * @property {Record<string, unknown>|null} reasoning @property {number} timeoutMs @property {number} maxSpendUsd
 * @property {number} retries  an unreadable answer asked for again @property {number} keepVersions  earlier plans a set keeps
 */

/**
 * @typedef {object} PlanReport
 * @property {SetPlan|null} plan  null when no answer of the model could be read as a plan
 * @property {string[]} errors  left after the repairs: the plan cannot be made until they are fixed
 * @property {string[]} warnings
 * @property {number} rounds  model answers spent on this plan
 */

/** @param {string} file @param {string} style */
function fragmentsOf(style, file = 'SETS.md') {
  return new Map(parseFragments(fs.readFileSync(path.join(styleDirOf(style), file), 'utf8'), file).map(f => [f.id, f.text]));
}

/** @param {string} template @param {Record<string, string>} values  glue slots `{name}` */
export const glue = (template, values) => template.replace(/\{([a-z ]+)\}/g, (m, k) => values[k] ?? m);

/**
 * Fills a bible fragment; every slot must get a value.
 * @param {Map<string, string>} frags @param {string} id @param {Record<string, string>} values
 */
function fragment(frags, id, values) {
  const text = frags.get(id);
  if (!text) throw new Error(`В SETS.md нет фрагмента «${id}» (метка <!-- fragment: ${id} --> в разделе «Для промпта (англ.)»).`);
  const { text: out, missing } = fillSlots(text, { named: k => values[k], chosen: new Map() });
  if (missing.length) throw new Error(`Фрагмент «${id}»: нечем заполнить ${missing.map(m => m.raw).join(', ')}.`);
  return out;
}

/**
 * A SETS.md fragment of a style, filled (the text model's prompt for sets and for loose cards).
 * @param {string} style @param {string} id @param {Record<string, string>} values
 */
export const setFragment = (style, id, values) => fragment(fragmentsOf(style), id, values);

/**
 * The end of every planning prompt, for a set and for loose cards: the staging ids with their fields and allowed
 * values, the answer format, and the producer's wishes.
 * @param {{style: string, wishes?: string}} o
 * @returns {string[]}
 */
export function answerParts({ style, wishes }) {
  const { rules, style: st } = loadSetRules(style);
  const g = rules.prompt.glue;
  const seen = seenPatterns(rules, st);
  const stagings = rules.stagings.map(r => {
    const pats = seen.has(r.id) ? `; pattern only: ${(seen.get(r.id) ?? []).join(' | ')}` : '';
    return `${r.id} (${r.fill.join(', ')}${pats})`;
  }).join('; ');
  const fields = /** @type {Record<string, any>} */ (st.assembly.fields);
  const values = [...new Set(rules.stagings.flatMap(r => r.fill))].filter(f => fields[f]).map(f => {
    const v = fields[f].values_from ? (st.fragments.get(fields[f].values_from)?.items || []).flatMap((/** @type {any} */ it) => (it.label ? [it.label] : [])) : fields[f].values;
    return `${f}: ${v.join(' | ')}`;
  }).concat(`stripes (with pattern stripes_straight): ${fields.stripes.values.join(' | ')}`).join('; ');
  return [glue(g.stagings, { stagings, values }), g.answer, ...(wishes ? [glue(g.wishes, { wishes })] : [])];
}

/** @param {RegistryEntry[]} registry */
const registryText = registry => {
  /** @type {Map<string, string>} */
  const kinds = new Map();
  for (const r of registry) if (r.key && !kinds.has(r.key)) kinds.set(r.key, `${r.kind} (${r.set})`);
  return kinds.size ? [...kinds.values()].join('; ') : 'none yet';
};

/**
 * The text-model prompt of one set (the first user message).
 * @param {object} o
 * @param {string} o.style @param {string} o.theme @param {string} [o.wishes] @param {string} [o.collectionTheme]
 * @param {string} [o.angle] @param {boolean} [o.grand] @param {string} o.layout @param {number} o.scenes
 * @param {RegistryEntry[]} o.registry @param {SetPlan[]} o.variants  the variants already planned
 * @param {number} o.n  this variant's number
 * @param {string} [o.language]
 * @returns {ChatMessage[]}
 */
export function setPrompt({ style, theme, wishes, collectionTheme, angle, grand = false, layout, scenes, registry, variants, n, language }) {
  const { rules } = loadSetRules(style);
  const frags = fragmentsOf(style);
  const ids = rules.prompt.fragments;
  const g = rules.prompt.glue;
  const reg = registryText(registry);
  const skeleton = windowSkeleton(rules, layout, scenes);
  /** @type {string[]} */
  const parts = [];
  parts.push(fragment(frags, ids.plan, {
    'set theme': theme, 'collection theme': collectionTheme || theme,
    'one line': angle || 'write it yourself in "angle"', registry: reg,
  }));
  if (variants.length) {
    const used = variants.flatMap(v => registryOf(normalizePlan(v).plan)).filter(e => e.key).map(e => `${e.kind} — ${e.row}`);
    parts.push(fragment(frags, ids.variant, { n: String(n), 'kinds and stagings': [...new Set(used)].join('; ') }));
  }
  if (grand) parts.push(fragment(frags, ids.grand, { 'collection theme': collectionTheme || theme }));
  else parts.push(fragment(frags, ids.staging, {}));
  if (scenes && !grand) parts.push(fragment(frags, ids.scenes, { n: String(scenes), registry: reg }));
  parts.push(fragment(frags, ids.captions, { language: language || rules.captions.language }));
  const slotText = skeleton.map((s, i) => `slot ${i + 1}: ${s.stars} star${s.stars > 1 ? 's' : ''}, ${s.frame} frame, ${s.scene ? 'scene with characters' : 'item card, no characters'}`).join('; ');
  parts.push(glue(g.slots, { slots: slotText, scenes: String(scenes) }));
  parts.push(...answerParts({ style, wishes }));
  return [{ role: 'system', content: g.system }, { role: 'user', content: parts.join('\n\n') }];
}

/**
 * Reads the model's JSON answer (a fenced block or the first {...}).
 * @param {string} text
 * @returns {any}
 */
export function parseAnswer(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(body); } catch (/** @type {any} */ e) { throw new Error(`Ответ модели — не JSON: ${e.message}`); }
}

const ORDER_FIELDS = ['subject', 'object', 'place', 'environment', 'motif', 'palette', 'staging', 'scene', 'promptExtra', 'humanRequest'];

/**
 * One card of the model's answer as a slot without stars and frame: its order (the answer's order fields), kind,
 * facet, sub-kind, hue, wishes and props; hue and palette name a backdrop colour, kept only where the backdrop is
 * abstract (SETS.md 3.7). Shared by set plans and loose cards.
 * @param {any} c @param {string} style
 * @returns {SlotPlan}
 */
export function slotFromAnswer(c, style) {
  const { rules, style: st } = loadSetRules(style);
  /** @type {Record<string, unknown>} */
  const order = { style, title: c?.caption ?? c?.title };
  for (const k of ORDER_FIELDS) if (c?.[k] !== undefined && c[k] !== null && c[k] !== '') order[k] = c[k];
  /** @type {SlotPlan} */
  const slot = { stars: 0, frame: '', kind: c?.kind, order: /** @type {any} */ (order) };
  for (const k of /** @type {const} */ (['facet', 'subkind', 'hue'])) if (typeof c?.[k] === 'string' && c[k]) slot[k] = c[k];
  if (typeof c?.wishes === 'string') slot.wishes = c.wishes;
  if (Array.isArray(c?.props)) slot.props = c.props;
  const staging = expandStaging(/** @type {any} */ (order.staging), rules).staging;
  if (!staging || !matches(rules.abstract_when, /** @type {any} */ ({ staging }), st)) { delete slot.hue; delete order.palette; }
  return slot;
}

/**
 * The model's answer as a SetPlan: the window comes from the skeleton (the model does not choose stars or frames).
 * @param {any} answer
 * @param {{style: string, theme: string, wishes?: string, collectionTheme?: string, grand?: boolean, layout: string, scenes: number, template?: string, number?: number, variant?: {n: number, group: string}, language?: string, place?: string}} o
 * @returns {SetPlan}
 */
export function planFromAnswer(answer, o) {
  const { rules } = loadSetRules(o.style);
  const skeleton = windowSkeleton(rules, o.layout, o.scenes);
  const cards = Array.isArray(answer?.cards) ? answer.cards : [];
  /** @param {number} i */
  const cardFor = i => cards.find((/** @type {any} */ c) => Number(c?.slot) === i + 1) ?? cards[i] ?? {};
  /** @type {SlotPlan[]} */
  const slots = skeleton.map((sk, i) => ({ ...slotFromAnswer(cardFor(i), o.style), stars: sk.stars, frame: sk.frame }));
  /** @type {SetPlan} */
  const plan = {
    style: o.style, title: answer?.title || o.theme, theme: o.theme, angle: answer?.angle || '',
    window: { layout: o.layout, ...(o.template ? { template: o.template } : {}) }, slots,
  };
  if (o.wishes) plan.wishes = o.wishes;
  if (o.collectionTheme) plan.collectionTheme = o.collectionTheme;
  if (o.number) plan.number = o.number;
  if (o.variant) plan.variant = o.variant;
  if (o.language) plan.language = o.language;
  if (o.grand) {
    plan.grand = true;
    plan.place = o.place || answer?.place || slots[0]?.order?.place;
    for (const s of slots) if (plan.place) s.order.place = plan.place;
  }
  return plan;
}

/**
 * A guard for the planning calls: refuses a call once the run is stopped (`signal`) or the spent sum reached the cap,
 * and stops after an answer without a price. `spent` is what the run spent before (a collection's earlier sets), so
 * the message names the whole run's sum against its cap. The caller catches the refusal and keeps what it planned.
 * @param {TextModel} model @param {number} cap @param {{signal?: AbortSignal, spent?: number}} [o]
 */
function guarded(model, cap, { signal, spent = 0 } = {}) {
  const state = { spent, calls: 0, unknown: 0 };
  /** @type {TextModel} */
  const call = async messages => {
    if (signal?.aborted) throw new Error('Планирование остановлено по просьбе: новых вызовов модели нет.');
    if (state.spent >= cap) throw new Error(`Планирование остановлено: потрачено $${state.spent.toFixed(4)} при потолке $${cap} (настройки set.plan.maxSpendUsd).`);
    /** @type {{text: string, cost: number|null}} */
    let answer;
    try { answer = await model(messages); } catch (e) {
      // a call answered and paid but of no use (ProviderError cost): its price still counts
      const cost = /** @type {any} */ (e)?.cost;
      if (typeof cost === 'number' && cost > 0) { state.calls++; state.spent += cost; }
      throw e;
    }
    state.calls++;
    if (answer.cost == null) { state.unknown++; throw new Error('Текстовая модель не сообщила цену — потолок расходов не соблюсти, планирование остановлено.'); }
    state.spent += answer.cost;
    return answer;
  };
  return { call, state };
}

/** @param {unknown} e */
const messageOf = e => String(/** @type {any} */ (e)?.message ?? e);

/**
 * Why a refused or failed call ends planning: its message, or — when the service refused the key or wants money —
 * the key problem (core/card/make.js keyProblemOf; loaded only on this path) and its message for a person.
 * @param {unknown} e
 * @returns {Promise<{stopped: string, keyProblem?: import('../card/make.js').KeyProblem}>}
 */
async function stopOf(e) {
  const keyProblem = (await import('../card/make.js')).keyProblemOf(/** @type {any} */ (e));
  return keyProblem ? { stopped: keyProblem.message, keyProblem } : { stopped: messageOf(e) };
}

/**
 * Plans one set (and its variants) with the text model: prompt from the bible's fragments → answer → plan →
 * validation → the errors back to the model, at most `repairs` times per variant.
 * @param {object} o
 * @param {string} o.style @param {string} o.theme @param {string} [o.wishes] @param {string} [o.collectionTheme]
 * @param {string} [o.angle]
 * @param {number} [o.variants]  how many variants (default 1)
 * @param {string} [o.window]  a layout of set-rules.json `windows` (default: the rules' standalone window, or grand)
 * @param {number} [o.scenes]  scenes in the tail (default: the smallest the window allows)
 * @param {string} [o.template]  the window colour
 * @param {boolean} [o.grand] @param {number} [o.number] @param {string} [o.language]
 * @param {RegistryEntry[]} [o.registry]  the other sets of the collection
 * @param {string[]} [o.titles]  the titles of the other sets
 * @param {string} [o.group]  the variant group id (default: from the theme)
 * @param {SetPlan[]} [o.siblings]  variants of this set the collection already has (same `group`): the new ones are
 *   numbered after them, told their item kinds and checked against them; their kinds are not the registry's
 * @param {TextModel} o.model
 * @param {{repairs: number, maxSpendUsd: number, retries?: number, spent?: number}} o.limits  retries: an answer that
 *   cannot be read as a plan is asked for again, this many times per variant (and per self-check), before it counts as
 *   an error; spent: what the run spent before this set (a collection's), counted against maxSpendUsd
 * @param {AbortSignal} [o.signal]  checked before every call
 * @returns {Promise<{plans: PlanReport[], spent: number, calls: number, unknown: number, stopped?: string, keyProblem?: import('../card/make.js').KeyProblem}>}
 *   stopped: why planning ended early (the signal, the spend cap, an answer without a price, a failed call; keyProblem
 *   when the service refused the key or wants money); the plans before it
 *   are kept, a variant cut in the middle of its repairs comes with its errors (or as the plan that passed before)
 */
export async function planSet(o) {
  const { rules } = loadSetRules(o.style);
  const layout = o.window ?? (o.grand ? 'grand' : rules.standalone.window);
  const w = rules.windows[layout];
  if (!w) throw new Error(`Нет окна «${layout}»; есть: ${Object.keys(rules.windows).join(', ')}.`);
  const scenes = o.scenes ?? Math.min(...w.scenes);
  const count = o.variants ?? 1;
  const siblings = o.siblings ?? [];
  const group = o.group ?? (count > 1 ? `${o.theme}`.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') : undefined);
  const registry = (o.registry ?? []).filter(r => !group || r.group !== group);
  const retries = o.limits.retries ?? 0;
  const g = rules.prompt.glue;
  /** @param {string[]} list */
  const repair = list => ({ role: /** @type {const} */ ('user'), content: glue(g.repair, { errors: list.map(e => `- ${e}`).join('\n') }) });
  const before = o.limits.spent ?? 0;
  const { call, state } = guarded(o.model, o.limits.maxSpendUsd, { signal: o.signal, spent: before });
  /** @type {PlanReport[]} */
  const out = [];
  /** @type {string|undefined} */
  let stopped;
  /** @type {import('../card/make.js').KeyProblem|undefined} */
  let keyProblem;
  for (let k = 1; k <= count && !stopped; k++) {
    const n = siblings.length + k;
    // a variant without a plan (no answer could be read) gives the next ones nothing to differ from
    const variants = [...siblings, ...out.flatMap(r => (r.plan ? [r.plan] : []))];
    const meta = { style: o.style, theme: o.theme, wishes: o.wishes, collectionTheme: o.collectionTheme, grand: o.grand, layout, scenes, template: o.template, number: o.number, language: o.language, ...(group ? { variant: { n, group } } : {}) };
    const messages = setPrompt({ ...meta, angle: o.angle, registry, variants, n });
    const brief = messages[1].content;
    /** @type {PlanReport|undefined} */
    let report;
    /** the plan that passed the program's checks before the self-check sent it back for a repair */
    /** @type {Omit<PlanReport, 'rounds'>|undefined} */
    let passed;
    let reviewed = !g.review, retried = 0, rounds = 0;
    for (let round = 0; round <= o.limits.repairs;) {
      /** @type {{text: string, cost: number|null}} */
      let answer;
      try { answer = await call(messages); } catch (e) { ({ stopped, keyProblem } = await stopOf(e)); break; }
      rounds++;
      /** @type {SetPlan|null} */
      let plan;
      /** @type {string[]} */
      let errors;
      /** @type {string[]} */
      let warnings;
      let unreadable = false;
      try {
        const parsed = parseAnswer(answer.text);
        if (!Array.isArray(parsed?.cards) || !parsed.cards.length) throw new Error('Ответ модели без карточек плана.');
        ({ errors, warnings, plan } = validatePlan(planFromAnswer(parsed, meta), { registry, variants, titles: o.titles ?? [] }));
      } catch (e) {
        unreadable = true;
        plan = report?.plan ?? null;
        errors = [messageOf(e)];
        warnings = [];
      }
      // an empty or cut answer is asked for again as it was; it is not kept in the conversation
      if (unreadable && retried < retries) { retried++; continue; }
      messages.push({ role: 'assistant', content: answer.text });
      if (!errors.length && !reviewed) {
        reviewed = true;
        const r = await selfCheck(call, g, brief, answer.text, retries);
        rounds += r.calls;
        const found = r.problems.map(p => `самопроверка: ${p}`);
        if (r.stopped) { stopped = r.stopped; keyProblem = r.keyProblem; report = { plan, errors, warnings: [...warnings, ...r.warnings], rounds }; break; }
        if (found.length && round < o.limits.repairs) {
          passed = { plan, errors: [], warnings: [...warnings, ...found] };
          messages.push(repair(r.problems));
          round++;
          continue;
        }
        warnings = [...warnings, ...found, ...r.warnings];
      }
      report = { plan, errors, warnings, rounds };
      if (!errors.length || round === o.limits.repairs) break;
      messages.push(repair(errors));
      round++;
    }
    // the repair asked by the self-check broke the rules, or was cut short: the plan that passed stands, with its notes
    if (passed && (!report || report.errors.length)) report = { ...passed, rounds };
    if (report) out.push(report);
  }
  return { plans: out, spent: state.spent - before, calls: state.calls, unknown: state.unknown, ...(stopped ? { stopped } : {}), ...(keyProblem ? { keyProblem } : {}) };
}

/**
 * The self-check of a plan that passed the program's checks: one separate call of the text model reads it against the
 * brief it was written for (the style's prompt.glue.review) and names what the program cannot check. An answer that
 * cannot be read is asked for again `retries` times, then left as a warning.
 * @param {TextModel} call @param {Record<string, string>} g  prompt glue @param {string} brief @param {string} planText
 * @param {number} retries
 * @returns {Promise<{problems: string[], warnings: string[], calls: number, stopped?: string, keyProblem?: import('../card/make.js').KeyProblem}>}
 */
async function selfCheck(call, g, brief, planText, retries) {
  /** @type {ChatMessage[]} */
  const messages = [{ role: 'system', content: g.system }, { role: 'user', content: glue(g.review, { brief, plan: planText }) }];
  let calls = 0;
  for (let i = 0; i <= retries; i++) {
    /** @type {{text: string, cost: number|null}} */
    let answer;
    try { answer = await call(messages); } catch (e) { return { problems: [], warnings: [], calls, ...(await stopOf(e)) }; }
    calls++;
    try {
      const a = parseAnswer(answer.text);
      if (Array.isArray(a?.problems)) return { problems: a.problems.map(String).filter(Boolean), warnings: [], calls };
    } catch { /* asked again */ }
  }
  return { problems: [], warnings: ['самопроверка плана не дала читаемого ответа'], calls };
}

/**
 * Plans a whole collection: the split into set themes (one model answer), then every set in order with the
 * reference window and scene count of its place (set-rules.json collection.reference_positions, SETS.md 1.4), each
 * against the registry of the sets before it.
 * @param {object} o
 * @param {string} o.style @param {string} o.theme  the collection theme @param {string} [o.wishes]
 * @param {number} [o.variants]  variants per set (default 1)
 * @param {number[]} [o.only]  plan only these places (1-based)
 * @param {SetPlan[]} [o.existing]  plans the collection already has (their kinds go to the registry)
 * @param {Record<number, PlaceVariant>} [o.extend]  places that already hold a set: a new variant of it is planned
 *   there (its theme, window and scene count), not a new set; the split into themes is asked only for the other places
 * @param {TextModel} o.model
 * @param {{repairs: number, maxSpendUsd: number, retries?: number}} o.limits  maxSpendUsd: the whole run (the split and
 *   every set); retries: as planSet, also for the split
 * @param {AbortSignal} [o.signal]  checked before every call
 * @param {(msg: string) => void} [o.progress]
 * @returns {Promise<{themes: {title: string, kind: string, angle: string, examples: string[]}[], plans: PlanReport[], spent: number, calls: number, unknown: number, stopped?: string, keyProblem?: import('../card/make.js').KeyProblem}>}
 *   stopped: why planning ended early (as planSet; also a split the model did not get right after the repairs, then
 *   with no themes and no plans); the sets planned before it are kept
 */
export async function planCollection(o) {
  const { rules } = loadSetRules(o.style);
  const count = rules.collection.sets;
  const { call, state } = guarded(o.model, o.limits.maxSpendUsd, { signal: o.signal });
  const g = rules.prompt.glue;
  const retries = o.limits.retries ?? 0;
  const places = Array.from({ length: count }, (_, i) => i + 1).filter(n => !o.only || o.only.includes(n));
  /** @param {{stopped: string, keyProblem?: import('../card/make.js').KeyProblem}} stop */
  const early = stop => ({ themes: [], plans: [], spent: state.spent, calls: state.calls, unknown: state.unknown, ...stop });
  /** @type {any[]} */
  let themes = [];
  if (places.some(n => !o.extend?.[n])) {
    /** @type {ChatMessage[]} */
    const messages = [{ role: 'system', content: g.system }, { role: 'user', content: [glue(g.collection, { 'collection theme': o.theme, count: String(count) }), ...(o.wishes ? [glue(g.wishes, { wishes: o.wishes })] : [])].join('\n\n') }];
    let retried = 0;
    for (let round = 0; round <= o.limits.repairs;) {
      /** @type {{text: string, cost: number|null}} */
      let answer;
      try { answer = await call(messages); } catch (e) { return early(await stopOf(e)); }
      /** @type {string[]} */
      const problems = [];
      try {
        themes = parseAnswer(answer.text).sets ?? [];
        if (themes.length !== count) problems.push(`нужно ровно ${count} наборов, а их ${themes.length}`);
        const titles = themes.map(t => String(t?.title ?? '').toLowerCase());
        if (new Set(titles).size !== titles.length) problems.push('названия наборов повторяются');
        for (const [i, t] of themes.entries()) if (!t?.title || !t?.angle) problems.push(`набор ${i + 1}: нужны title и angle`);
      } catch (e) {
        // an empty or cut answer is asked for again as it was
        if (retried < retries) { retried++; continue; }
        problems.push(messageOf(e));
      }
      messages.push({ role: 'assistant', content: answer.text });
      if (!problems.length) break;
      if (round === o.limits.repairs) return early({ stopped: `Модель не разбила тему коллекции на наборы: ${problems.join('; ')}` });
      messages.push({ role: 'user', content: glue(g.repair, { errors: problems.map(e => `- ${e}`).join('\n') }) });
      round++;
    }
  }
  /** @type {PlanReport[]} */
  const plans = [];
  const done = [...(o.existing ?? [])];
  /** @type {string|undefined} */
  let stopped;
  /** @type {import('../card/make.js').KeyProblem|undefined} */
  let keyProblem;
  for (const number of places) {
    const ext = o.extend?.[number];
    const t = themes[number - 1];
    const pos = rules.collection.reference_positions[number - 1];
    const layout = ext?.layout ?? pos.window, scenes = ext?.scenes ?? pos.scenes;
    const group = ext?.group;
    o.progress?.(`набор ${number} из ${count}: «${ext?.theme ?? t.title}»${ext ? ' — ещё вариант' : ''} (окно ${layout}, сцен ${scenes})`);
    const r = await planSet({
      style: o.style, theme: ext?.theme ?? t.title, angle: ext ? undefined : t.angle, wishes: o.wishes, collectionTheme: o.theme,
      window: layout, scenes, grand: layout === 'grand', number, variants: o.variants, model: o.model, signal: o.signal,
      ...(ext ? { group: ext.group, siblings: ext.siblings } : {}),
      limits: { repairs: o.limits.repairs, maxSpendUsd: o.limits.maxSpendUsd, retries, spent: state.spent },
      registry: done.flatMap(p => registryOf(normalizePlan(p).plan)),
      titles: done.filter(p => !(group && p.variant?.group === group)).map(p => p.title),
    });
    state.spent += r.spent;
    state.calls += r.calls;
    state.unknown += r.unknown;
    for (const p of r.plans) { if (p.plan && t?.kind) p.plan.themeKind ??= t.kind; plans.push(p); }
    done.push(...r.plans.flatMap(p => (p.plan ? [p.plan] : [])));
    if (r.stopped) { stopped = r.stopped; keyProblem = r.keyProblem; break; }
  }
  return { themes, plans, spent: state.spent, calls: state.calls, unknown: state.unknown, ...(stopped ? { stopped } : {}), ...(keyProblem ? { keyProblem } : {}) };
}

/**
 * A place of the collection that already holds a set, for a new variant of it (planCollection `extend`).
 * @typedef {object} PlaceVariant
 * @property {string} group  the variant group: the set's plan's `variant.group`, else the store's `variantGroup`
 * @property {SetPlan[]} siblings  the plans of the place's sets, each with `variant.group` = group
 * @property {string} theme  the set's theme (its plan's, else its title)
 * @property {string} [layout] @property {number} [scenes]  the window and scene count of its plan
 */

/**
 * The text model from the settings: the API preset's endpoint, key and textModel (provider.preset), the limits of
 * set.plan.
 * @param {{settings: import('../settings.js').Settings & {set: SetSettings}, apiKey: string, complete?: typeof import('../providers/gemini.js').complete}} o
 * @returns {Promise<TextModel>}
 */
export async function textModelFrom({ settings, apiKey, complete }) {
  const { apiOf, presetOf } = await import('../providers/preset.js');
  const or = presetOf(settings.provider);
  const run = complete ?? apiOf(or.name).complete;
  const p = settings.set.plan;
  return messages => run({
    endpoint: or.endpoint, apiKey, prices: or.prices, model: or.textModel, messages, maxTokens: p.maxTokens, temperature: p.temperature, json: true,
    ...(p.reasoning ? { reasoning: p.reasoning } : {}), net: { timeoutMs: p.timeoutMs, retries: or.retries, backoffMs: or.backoffMs },
  });
}

/**
 * @typedef {object} SetSettings  settings `set`
 * @property {number} parallel  cards made at the same time
 * @property {number} maxSpendUsd  the spend cap of one set's cards
 * @property {{maxCount: number}} cards  loose cards: the most of one run
 * @property {PlanSettings} plan
 */

