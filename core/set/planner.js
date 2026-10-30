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
 * @property {string} model @property {number} repairs @property {number} maxTokens @property {number} temperature
 * @property {Record<string, unknown>|null} reasoning @property {number} timeoutMs @property {number} maxSpendUsd
 */

/**
 * @typedef {object} PlanReport
 * @property {SetPlan} plan
 * @property {string[]} errors  left after the repairs: the plan cannot be made until they are fixed
 * @property {string[]} warnings
 * @property {number} rounds  model answers spent on this plan
 */

/** @param {string} file @param {string} style */
function fragmentsOf(style, file = 'SETS.md') {
  return new Map(parseFragments(fs.readFileSync(path.join(styleDirOf(style), file), 'utf8'), file).map(f => [f.id, f.text]));
}

/** @param {string} template @param {Record<string, string>} values  glue slots `{name}` */
const glue = (template, values) => template.replace(/\{([a-z ]+)\}/g, (m, k) => values[k] ?? m);

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
  const { rules, style: st } = loadSetRules(style);
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
  const seen = seenPatterns(rules, st);
  const stagings = rules.stagings.map(r => {
    const pats = seen.has(r.id) ? `; pattern only: ${(seen.get(r.id) ?? []).join(' | ')}` : '';
    return `${r.id} (${r.fill.join(', ')}${pats})`;
  }).join('; ');
  const fields = /** @type {Record<string, any>} */ (st.assembly.fields);
  const values = [...new Set(rules.stagings.flatMap(r => r.fill))].filter(f => fields[f]).map(f => {
    const v = fields[f].values_from ? (st.fragments.get(fields[f].values_from)?.items || []).flatMap(it => (it.label ? [it.label] : [])) : fields[f].values;
    return `${f}: ${v.join(' | ')}`;
  }).concat(`stripes (with pattern stripes_straight): ${fields.stripes.values.join(' | ')}`).join('; ');
  parts.push(glue(g.stagings, { stagings, values }));
  parts.push(g.answer);
  if (wishes) parts.push(glue(g.wishes, { wishes }));
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
 * The model's answer as a SetPlan: the window comes from the skeleton (the model does not choose stars or frames).
 * @param {any} answer
 * @param {{style: string, theme: string, wishes?: string, collectionTheme?: string, grand?: boolean, layout: string, scenes: number, template?: string, number?: number, variant?: {n: number, group: string}, language?: string, place?: string}} o
 * @returns {SetPlan}
 */
export function planFromAnswer(answer, o) {
  const { rules, style: st } = loadSetRules(o.style);
  const skeleton = windowSkeleton(rules, o.layout, o.scenes);
  const cards = Array.isArray(answer?.cards) ? answer.cards : [];
  /** @param {number} i */
  const cardFor = i => cards.find((/** @type {any} */ c) => Number(c?.slot) === i + 1) ?? cards[i] ?? {};
  /** @type {SlotPlan[]} */
  const slots = skeleton.map((sk, i) => {
    const c = cardFor(i);
    /** @type {Record<string, unknown>} */
    const order = { style: o.style, title: c.caption ?? c.title };
    for (const k of ORDER_FIELDS) if (c[k] !== undefined && c[k] !== null && c[k] !== '') order[k] = c[k];
    /** @type {SlotPlan} */
    const slot = { stars: sk.stars, frame: sk.frame, kind: c.kind, order: /** @type {any} */ (order) };
    for (const k of /** @type {const} */ (['facet', 'subkind', 'hue'])) if (typeof c[k] === 'string' && c[k]) slot[k] = c[k];
    if (Array.isArray(c.props)) slot.props = c.props;
    // hue and palette name a backdrop colour: kept only where the backdrop is abstract (SETS.md 3.7)
    const staging = expandStaging(/** @type {any} */ (order.staging), rules).staging;
    if (!staging || !matches(rules.abstract_when, /** @type {any} */ ({ staging }), st)) { delete slot.hue; delete order.palette; }
    return slot;
  });
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
 * A spend guard for the planning calls: refuses a call once the spent sum reached the cap or a price is unknown.
 * @param {TextModel} model @param {number} cap
 */
function guarded(model, cap) {
  const state = { spent: 0, calls: 0 };
  /** @type {TextModel} */
  const call = async messages => {
    if (state.spent >= cap) throw new Error(`Планирование остановлено: потрачено $${state.spent.toFixed(4)} при потолке $${cap} (настройки set.plan.maxSpendUsd).`);
    const answer = await model(messages);
    state.calls++;
    if (answer.cost == null) throw new Error('Текстовая модель не сообщила цену — потолок расходов не соблюсти, планирование остановлено.');
    state.spent += answer.cost;
    return answer;
  };
  return { call, state };
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
 * @param {TextModel} o.model
 * @param {{repairs: number, maxSpendUsd: number}} o.limits
 * @returns {Promise<{plans: PlanReport[], spent: number, calls: number}>}
 */
export async function planSet(o) {
  const { rules } = loadSetRules(o.style);
  const layout = o.window ?? (o.grand ? 'grand' : rules.standalone.window);
  const w = rules.windows[layout];
  if (!w) throw new Error(`Нет окна «${layout}»; есть: ${Object.keys(rules.windows).join(', ')}.`);
  const scenes = o.scenes ?? Math.min(...w.scenes);
  const count = o.variants ?? 1;
  const group = o.group ?? (count > 1 ? `${o.theme}`.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') : undefined);
  const { call, state } = guarded(o.model, o.limits.maxSpendUsd);
  /** @type {PlanReport[]} */
  const out = [];
  for (let n = 1; n <= count; n++) {
    const variants = out.map(r => r.plan);
    const meta = { style: o.style, theme: o.theme, wishes: o.wishes, collectionTheme: o.collectionTheme, grand: o.grand, layout, scenes, template: o.template, number: o.number, language: o.language, ...(group ? { variant: { n, group } } : {}) };
    const messages = setPrompt({ ...meta, angle: o.angle, registry: o.registry ?? [], variants, n });
    /** @type {PlanReport|undefined} */
    let report;
    for (let round = 0; round <= o.limits.repairs; round++) {
      const answer = await call(messages);
      messages.push({ role: 'assistant', content: answer.text });
      /** @type {SetPlan} */
      let plan;
      /** @type {string[]} */
      let errors;
      /** @type {string[]} */
      let warnings;
      try {
        plan = planFromAnswer(parseAnswer(answer.text), meta);
        ({ errors, warnings, plan } = validatePlan(plan, { registry: o.registry ?? [], variants, titles: o.titles ?? [] }));
      } catch (/** @type {any} */ e) {
        plan = /** @type {any} */ (report?.plan ?? null);
        errors = [String(e?.message ?? e)];
        warnings = [];
      }
      report = { plan, errors, warnings, rounds: round + 1 };
      if (!errors.length || round === o.limits.repairs) break;
      messages.push({ role: 'user', content: glue(rules.prompt.glue.repair, { errors: errors.map(e => `- ${e}`).join('\n') }) });
    }
    out.push(/** @type {PlanReport} */ (report));
  }
  return { plans: out, spent: state.spent, calls: state.calls };
}

/**
 * Plans a whole collection: the split into set themes (one model answer), then every set in order with the
 * reference window and scene count of its place (set-rules.json collection.reference_positions, SETS.md 1.4), each
 * against the registry of the sets before it.
 * @param {object} o
 * @param {string} o.style @param {string} o.theme  the collection theme @param {string} [o.wishes]
 * @param {number} [o.variants]  variants per set (default 1)
 * @param {number[]} [o.only]  plan only these places (1-based); the themes are still split for all
 * @param {SetPlan[]} [o.existing]  plans the collection already has (their kinds go to the registry)
 * @param {TextModel} o.model
 * @param {{repairs: number, maxSpendUsd: number}} o.limits
 * @param {(msg: string) => void} [o.progress]
 * @returns {Promise<{themes: {title: string, kind: string, angle: string, examples: string[]}[], plans: PlanReport[], spent: number, calls: number}>}
 */
export async function planCollection(o) {
  const { rules } = loadSetRules(o.style);
  const count = rules.collection.sets;
  const { call, state } = guarded(o.model, o.limits.maxSpendUsd);
  const g = rules.prompt.glue;
  /** @type {ChatMessage[]} */
  const messages = [{ role: 'system', content: g.system }, { role: 'user', content: [glue(g.collection, { 'collection theme': o.theme, count: String(count) }), ...(o.wishes ? [glue(g.wishes, { wishes: o.wishes })] : [])].join('\n\n') }];
  /** @type {any[]} */
  let themes = [];
  for (let round = 0; round <= o.limits.repairs; round++) {
    const answer = await call(messages);
    messages.push({ role: 'assistant', content: answer.text });
    /** @type {string[]} */
    const problems = [];
    try {
      themes = parseAnswer(answer.text).sets ?? [];
      if (themes.length !== count) problems.push(`нужно ровно ${count} наборов, а их ${themes.length}`);
      const titles = themes.map(t => String(t?.title ?? '').toLowerCase());
      if (new Set(titles).size !== titles.length) problems.push('названия наборов повторяются');
      for (const [i, t] of themes.entries()) if (!t?.title || !t?.angle) problems.push(`набор ${i + 1}: нужны title и angle`);
    } catch (/** @type {any} */ e) { problems.push(String(e?.message ?? e)); }
    if (!problems.length) break;
    if (round === o.limits.repairs) throw new Error(`Модель не разбила тему коллекции на наборы: ${problems.join('; ')}`);
    messages.push({ role: 'user', content: glue(g.repair, { errors: problems.map(e => `- ${e}`).join('\n') }) });
  }
  /** @type {PlanReport[]} */
  const plans = [];
  const done = [...(o.existing ?? [])];
  for (const [i, t] of themes.entries()) {
    const number = i + 1;
    if (o.only && !o.only.includes(number)) continue;
    const pos = rules.collection.reference_positions[i];
    o.progress?.(`набор ${number} из ${count}: «${t.title}» (окно ${pos.window}, сцен ${pos.scenes})`);
    const left = o.limits.maxSpendUsd - state.spent;
    const r = await planSet({
      style: o.style, theme: t.title, angle: t.angle, wishes: o.wishes, collectionTheme: o.theme, window: pos.window, scenes: pos.scenes,
      grand: pos.window === 'grand', number, variants: o.variants, model: o.model, limits: { repairs: o.limits.repairs, maxSpendUsd: left },
      registry: done.flatMap(p => registryOf(normalizePlan(p).plan)), titles: done.map(p => p.title),
    });
    state.spent += r.spent;
    state.calls += r.calls;
    for (const p of r.plans) { p.plan.themeKind ??= t.kind; plans.push(p); }
    done.push(...r.plans.filter(p => p.plan).map(p => p.plan));
  }
  return { themes, plans, spent: state.spent, calls: state.calls };
}

/**
 * The text model from the settings: the OpenRouter-compatible endpoint and key of provider.openrouter, the model
 * and limits of set.plan.
 * @param {{settings: import('../settings.js').Settings & {set: SetSettings}, apiKey: string, complete?: typeof import('../providers/openrouter-text.js').complete}} o
 * @returns {Promise<TextModel>}
 */
export async function textModelFrom({ settings, apiKey, complete }) {
  const run = complete ?? (await import('../providers/openrouter-text.js')).complete;
  const or = settings.provider.openrouter;
  const p = settings.set.plan;
  return messages => run({
    endpoint: or.endpoint, apiKey, model: p.model, messages, maxTokens: p.maxTokens, temperature: p.temperature, json: true,
    ...(p.reasoning ? { reasoning: p.reasoning } : {}), net: { timeoutMs: p.timeoutMs, retries: or.retries, backoffMs: or.backoffMs },
  });
}

/**
 * @typedef {object} SetSettings  settings `set`
 * @property {number} parallel  cards made at the same time
 * @property {number} maxSpendUsd  the spend cap of one set's cards
 * @property {PlanSettings} plan
 */

