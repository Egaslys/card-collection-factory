// Making sets and collections from their plans: the plan goes into the store (set.json `plan`), then the set's ten
// cards are made with core/card makeCard — a few at a time, under one spend cap for the whole set — and each card is
// put into its slot as soon as it is made, so an open editor sees the set fill up. A collection is its sets in order.
import { presetOf } from '../providers/preset.js';
import { validatePlan, registryOf, normalizePlan } from './plan.js';
import { cardBudget, loadSetRules } from './rules.js';

/** @typedef {import('./plan.js').SetPlan} SetPlan */
/** @typedef {import('../card/make.js').CardReport} CardReport */
/** @typedef {import('../card/make.js').Provider} Provider */
/** @typedef {import('../store/index.js').CardSet} CardSet */
/**
 * The Store API core/set uses (core/README.md).
 * @typedef {Pick<typeof import('../store/index.js'), 'getCollection'|'createCollection'|'createSet'|'getSet'|'updateSet'|'listCards'|'cardDir'|'newCardId'|'moveCard'|'recordSpend'>} SetStore
 */
/** @typedef {typeof import('../card/make.js').makeCard} MakeCard */

/**
 * @typedef {object} SlotReport
 * @property {number} slot  1-based
 * @property {string} title
 * @property {string|null} card  the card id (null when not made)
 * @property {'made'|'kept'|'skipped'|'failed'|'cancelled'} result  made = this run made it; kept = already made, left
 *   as is; skipped = the set's spend cap left nothing for it; failed = the card loop threw; cancelled = the signal
 *   stopped the queue before it
 * @property {CardReport['stop']} [stop]
 * @property {number} spent
 * @property {number|null} [blocking]  blocking FAILs of the chosen attempt
 * @property {string|null} [image]
 * @property {string} [error]
 */

/**
 * @typedef {object} SetReport
 * @property {string} collection @property {string} set @property {string} title
 * @property {SlotReport[]} slots
 * @property {number} spent  USD this run spent (known costs)
 * @property {number} maxSpendUsd
 * @property {string[]} warnings  the plan's warnings (after a key stop, its message first)
 * @property {import('../card/make.js').KeyProblem} [keyProblem]  the service refused the key or wants money: the set
 *   stopped starting cards (the rest are `cancelled`), what was made is kept
 */

const defaultStore = async () => /** @type {SetStore} */ (await import('../store/index.js'));
const defaultMakeCard = async () => (await import('../card/make.js')).makeCard;

/**
 * A set's stored plan as one of its place: its number (the store's when the plan has none) and its variant group
 * (the store's `variantGroup` when the plan has none, so a variant added later to a set planned alone is known as
 * one). Undefined for a set without a plan.
 * @param {CardSet} s
 * @returns {SetPlan|undefined}
 */
export function storedPlan(s) {
  const p = /** @type {SetPlan|undefined} */ (s.plan);
  return p && { ...p, number: p.number ?? s.number, variant: p.variant ?? { n: 1, group: s.variantGroup } };
}

/**
 * What the collection already holds for a plan's validation: registry, titles and variants of the other sets. The
 * plan's variant group is its `variant.group`, else the store's group of its own set (`self`); a set is of the
 * group by its plan's group or by the store's.
 * @param {SetStore} store @param {string} collection @param {SetPlan} plan @param {string} [self]  the plan's own set id
 */
export async function collectionContext(store, collection, plan, self) {
  const { sets } = await store.getCollection(collection);
  const others = sets.filter(s => s.id !== self);
  const own = self ? sets.find(s => s.id === self) : undefined;
  const group = plan.variant?.group ?? own?.variantGroup;
  const storeGroup = own?.variantGroup ?? sets.find(s => /** @type {SetPlan|undefined} */ (s.plan)?.variant?.group === group || s.variantGroup === group)?.variantGroup;
  /** @param {CardSet} s */
  const inGroup = s => !!group && (storedPlan(s)?.variant?.group === group || s.variantGroup === group || (!!storeGroup && s.variantGroup === storeGroup));
  /** @param {CardSet} s */
  const planOf = s => storedPlan(s);
  const variants = others.filter(s => inGroup(s) && planOf(s)).map(s => /** @type {SetPlan} */ (planOf(s)));
  const rest = others.filter(s => !inGroup(s));
  /** @type {string[]} */
  const warnings = rest.filter(s => !planOf(s)).map(s => `набор «${s.title}» без плана: его предметы не учтены в реестре коллекции`);
  return {
    registry: rest.flatMap(s => (planOf(s) ? registryOf(normalizePlan(/** @type {SetPlan} */ (planOf(s))).plan) : [])),
    titles: rest.map(s => s.title),
    variants, warnings, sets,
  };
}

/**
 * Validates the plan against the collection and puts it into the store: a new set (or, with `set`, the plan of an
 * existing one, whose earlier plan goes to the set's `planVersions`, newest first, the last `keepVersions` kept).
 * Variants of one group share the store's variant group and number (the group named by a plan's `variant.group` or
 * by the store's `variantGroup`). Throws on errors.
 * @param {{collection: string, plan: SetPlan, set?: string, store?: SetStore, keepVersions?: number}} o  keepVersions:
 *   default settings set.plan.keepVersions
 * @returns {Promise<{set: CardSet, warnings: string[]}>}
 */
export async function saveSetPlan({ collection, plan: input, set, store, keepVersions }) {
  const st = store ?? await defaultStore();
  const ctx = await collectionContext(st, collection, input, set);
  const { errors, warnings, plan } = validatePlan(input, ctx);
  if (errors.length) throw new Error(`План набора «${input.title}» не прошёл проверку (${errors.length}):\n- ${errors.join('\n- ')}`);
  const { rules } = loadSetRules(plan.style);
  const family = rules.windows[plan.window.layout].family;
  const window = { kind: family, ...(plan.window.template ? { template: plan.window.template } : {}) };
  const brief = { theme: plan.theme, wishes: plan.wishes ?? '' };
  if (set) {
    const old = ctx.sets.find(s => s.id === set);
    const keep = keepVersions ?? /** @type {any} */ ((await import('../settings.js')).loadSettings()).set.plan.keepVersions;
    const stored = /** @type {any} */ (old)?.planVersions;
    const earlier = /** @type {{at: string, plan: unknown}[]} */ (Array.isArray(stored) ? stored : []);
    const planVersions = old?.plan ? [{ at: new Date().toISOString(), plan: old.plan }, ...earlier].slice(0, keep) : earlier;
    return { set: await st.updateSet(collection, set, { title: plan.title, window, plan, planVersions }), warnings: [...ctx.warnings, ...warnings] };
  }
  const group = plan.variant?.group;
  const sibling = group && ctx.sets.find(s => /** @type {SetPlan|undefined} */ (s.plan)?.variant?.group === group || s.variantGroup === group);
  const created = await st.createSet(collection, {
    title: plan.title, brief, window, plan,
    ...(sibling ? { variantGroup: sibling.variantGroup, number: sibling.number } : plan.number ? { number: plan.number } : {}),
  });
  return { set: created, warnings: [...ctx.warnings, ...warnings] };
}

/**
 * A progress event of making a set, next to its text. status: start = the card loop began on the slot; made / failed
 * / skipped (the set's spend cap) / kept (already made) / cancelled (the signal stopped the queue before the slot).
 * @typedef {{set: string, slot: number, cardId: string|null, title: string, status: 'start'|'made'|'failed'|'skipped'|'kept'|'cancelled', spent: number}} SetProgressEvent
 */
/**
 * A progress event of planning. status: planning = the model is asked for the set; planned = its plan has no
 * errors (saved when `set` is given); invalid = errors left after the repairs.
 * @typedef {{number?: number, title: string, status: 'planning'|'planned'|'invalid', set?: string}} PlanProgressEvent
 */
/** The spend of a run outside its cards (the planning), once it is known. @typedef {{total: number}} RunSpendEvent */
/** @typedef {(text: string, event?: SetProgressEvent|PlanProgressEvent|RunSpendEvent) => void} Progress */

/**
 * Makes the cards of a set from its plan. With `plan`, the plan is saved as a new set first (saveSetPlan); with
 * `set`, the set's stored plan is used. A slot that already holds a made card is kept (unless `redo`); a slot whose
 * card failed is continued. At most `parallel` cards are made at the same time; the set's spend cap is shared: a card
 * gets the smaller of its own cap (settings card.maxSpendUsd) and what the set has left after the cards in progress,
 * and is skipped once that is below the highest price per image seen in the set. `signal`: once aborted, no new card
 * starts (the remaining slots are reported as cancelled); the cards in progress finish.
 * @param {object} o
 * @param {string} o.collection
 * @param {SetPlan} [o.plan] @param {string} [o.set]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {Provider} o.provider
 * @param {{parallel?: number, maxSpendUsd?: number, attempts?: number}} [o.limits]  overrides of settings set / card
 * @param {number[]} [o.only]  only these slots (1-based)
 * @param {boolean} [o.redo]  make again the slots that already hold a made card (as new attempts of that card)
 * @param {AbortSignal} [o.signal]
 * @param {SetStore} [o.store] @param {MakeCard} [o.makeCard]
 * @param {Progress} [o.progress]
 * @returns {Promise<SetReport>}
 */
export async function makeSet({ collection, plan: input, set: setId, settings, provider, limits = {}, only, redo = false, signal, store, makeCard, progress = () => {} }) {
  const st = store ?? await defaultStore();
  const make = makeCard ?? await defaultMakeCard();
  /** @type {string[]} */
  let warnings = [];
  /** @type {CardSet} */
  let set;
  if (input) ({ set, warnings } = await saveSetPlan({ collection, plan: input, store: st }));
  else {
    if (!setId) throw new Error('Нужен план набора или набор коллекции.');
    set = await st.getSet(collection, setId);
    if (!set.plan) throw new Error(`У набора «${set.title}» нет плана: сначала план (set plan / set save).`);
    const ctx = await collectionContext(st, collection, /** @type {SetPlan} */ (set.plan), set.id);
    const v = validatePlan(/** @type {SetPlan} */ (set.plan), ctx);
    if (v.errors.length) throw new Error(`План набора «${set.title}» не прошёл проверку (${v.errors.length}):\n- ${v.errors.join('\n- ')}`);
    warnings = [...ctx.warnings, ...v.warnings];
  }
  const plan = normalizePlan(/** @type {SetPlan} */ (set.plan)).plan;
  const cap = limits.maxSpendUsd ?? settings.set.maxSpendUsd;
  const parallel = Math.max(1, limits.parallel ?? settings.set.parallel);
  const cards = new Map((await st.listCards(collection, { setId: set.id })).map(c => [c.id, c]));
  /** @type {SlotReport[]} */
  const reports = [];
  /** @param {SlotReport} r @param {string} text @param {SetProgressEvent['status']} [status] */
  const report = (r, text, status = /** @type {any} */ (r.result)) => {
    reports.push(r);
    progress(`слот ${r.slot}: «${r.title}» — ${text}`, { set: set.id, slot: r.slot, cardId: r.card, title: r.title, status, spent: r.spent });
  };
  /** @type {number[]} */
  const queue = [];
  plan.slots.forEach((s, i) => {
    if (only && !only.includes(i + 1)) return;
    const id = set.slots[i];
    const made = id && cards.get(id)?.status === 'made';
    if (made && !redo) report({ slot: i + 1, title: String(s.order.title), card: id, result: 'kept', spent: 0 }, 'уже сделана');
    else queue.push(i);
  });
  const budget = cardBudget(cap, settings.card.maxSpendUsd);
  /** the service refused the key or wants money: no new card starts, the ones in flight finish */
  /** @type {KeyProblem|undefined} */
  let keyProblem;
  /** @param {number} i */
  const one = async i => {
    const s = plan.slots[i];
    const title = String(s.order.title);
    const existing = set.slots[i] ?? null;
    const capHere = await budget.take();
    const free = provider.free && !provider.fallback;
    // a new card's first call has no price of its own yet: the highest price seen in this set stands for it
    if (capHere <= 0 || (!free && capHere < budget.price)) {
      budget.done(capHere);
      report({ slot: i + 1, title, card: existing, result: 'skipped', spent: 0 }, 'пропущена: потолок расходов набора');
      return;
    }
    /** @type {{spent: number, prices: number[]}} */
    const used = { spent: 0, prices: [] };
    progress(`слот ${i + 1}: «${title}» — генерация`, { set: set.id, slot: i + 1, cardId: existing, title, status: 'start', spent: 0 });
    try {
      const r = await make({
        order: s.order, collection, ...(existing ? { card: existing } : {}), place: { setId: set.id, slot: i },
        settings, provider, store: st, limits: { maxSpendUsd: capHere, ...(limits.attempts ? { attempts: limits.attempts } : {}) },
        ...(signal ? { signal } : {}),
      });
      used.spent = r.spent ?? 0;
      used.prices = r.attempts.map(x => x.cost ?? 0);
      if (r.stop === 'key' && r.keyProblem) keyProblem ??= r.keyProblem;
      const blocking = r.chosenCheck?.blocking ?? null;
      report({ slot: i + 1, title, card: r.id, result: 'made', stop: r.stop, spent: r.spent ?? 0, blocking, image: r.image },
        `${r.image ? `готово (блокирующих FAIL ${blocking ?? '—'})` : r.stop === 'key' ? 'картинки нет: проблема с ключом' : 'картинки нет'}, $${(r.spent ?? 0).toFixed(4)}`);
    } catch (/** @type {any} */ e) {
      keyProblem ??= await keyProblemOf(e);
      report({ slot: i + 1, title, card: existing, result: 'failed', spent: 0, error: String(e?.message ?? e) }, `ошибка: ${e?.message ?? e}`);
    } finally {
      budget.done(capHere, used.spent, used.prices);
    }
  };
  const workers = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      if (signal?.aborted || keyProblem) {
        const s = plan.slots[i];
        report({ slot: i + 1, title: String(s.order.title), card: set.slots[i] ?? null, result: 'cancelled', spent: 0 }, keyProblem ? 'не начата: проблема с ключом' : 'отменена');
        continue;
      }
      await one(i);
    }
  });
  await Promise.all(workers);
  reports.sort((a, b) => a.slot - b.slot);
  return {
    collection, set: set.id, title: set.title, slots: reports, spent: budget.spent, maxSpendUsd: cap,
    warnings: keyProblem ? [keyStopText(keyProblem), ...warnings] : warnings, ...(keyProblem ? { keyProblem } : {}),
  };
}

/** @typedef {import('../card/make.js').KeyProblem} KeyProblem */

/**
 * The key problem of a thrown error (core/card/make.js keyProblemOf, loaded only on this path), or undefined.
 * @param {unknown} e @returns {Promise<KeyProblem|undefined>}
 */
const keyProblemOf = async e => (await import('../card/make.js')).keyProblemOf(/** @type {any} */ (e)) ?? undefined;

/** The one message a run stopped on the key ends with. @param {KeyProblem} k */
export const keyStopText = k => `${k.message} Готовое сохранено.`;

/**
 * Makes the sets of a collection in their order (by number; variants of one number one after another), or only the
 * given numbers, or only the given sets. Every set — each variant is a set — has its own spend cap (settings
 * set.maxSpendUsd); `limits.maxSpendUsd` caps the whole run. `signal`: once aborted, no new card and no new set starts.
 * @param {object} o
 * @param {string} o.collection
 * @param {number[]} [o.numbers]
 * @param {string[]} [o.sets]  only these set ids
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {Provider} o.provider
 * @param {{parallel?: number, maxSpendUsd?: number, attempts?: number}} [o.limits]  maxSpendUsd: the whole run
 * @param {AbortSignal} [o.signal]
 * @param {SetStore} [o.store] @param {MakeCard} [o.makeCard]
 * @param {Progress} [o.progress]
 * @returns {Promise<{sets: SetReport[], spent: number, skipped: string[], cancelled: boolean, warnings: string[], keyProblem?: KeyProblem}>}
 *   keyProblem: a set stopped on the key, and no later set started; `warnings` then holds its one message
 */
export async function makeCollection({ collection, numbers, sets: only, settings, provider, limits = {}, signal, store, makeCard, progress = () => {} }) {
  const st = store ?? await defaultStore();
  const { collection: col, sets } = await st.getCollection(collection);
  const order = [...sets].sort((a, b) => a.number - b.number || col.sets.indexOf(a.id) - col.sets.indexOf(b.id));
  const chosen = order.filter(s => (!numbers || numbers.includes(s.number)) && (!only || only.includes(s.id)));
  /** @type {SetReport[]} */
  const out = [];
  /** @type {string[]} */
  const skipped = [];
  let spent = 0;
  /** @type {KeyProblem|undefined} */
  let keyProblem;
  for (const s of chosen) {
    if (signal?.aborted) { skipped.push(`«${s.title}» (№${s.number}): отменено`); continue; }
    if (keyProblem) { skipped.push(`«${s.title}» (№${s.number}): не начат — проблема с ключом`); continue; }
    if (!s.plan) { skipped.push(`«${s.title}» (№${s.number}): нет плана`); continue; }
    const left = limits.maxSpendUsd === undefined ? undefined : limits.maxSpendUsd - spent;
    if (left !== undefined && left <= 0 && !(provider.free && !provider.fallback)) { skipped.push(`«${s.title}» (№${s.number}): исчерпан общий потолок расходов запуска`); continue; }
    progress(`набор №${s.number} «${s.title}»`);
    const r = await makeSet({
      collection, set: s.id, settings, provider, store: st, makeCard, progress, signal,
      limits: { ...limits, maxSpendUsd: left === undefined ? undefined : Math.min(left, settings.set.maxSpendUsd) },
    });
    spent += r.spent;
    out.push(r);
    keyProblem ??= r.keyProblem;
  }
  return { sets: out, spent, skipped, cancelled: !!signal?.aborted, warnings: keyProblem ? [keyStopText(keyProblem)] : [], ...(keyProblem ? { keyProblem } : {}) };
}

/**
 * @typedef {object} PlannedSet  one plan of a planning run, and where it went
 * @property {SetPlan|null} plan
 * @property {string[]} errors  left after the repairs (and from saving): the plan was not saved
 * @property {string[]} warnings
 * @property {number} rounds
 * @property {string} [set]  the set it was saved as
 */

/**
 * The text model for a planning run: the given one (tests), else the settings' (set.plan) with the key from the
 * environment / .env, or the key a running editor holds.
 * @param {{settings: import('../settings.js').Settings & {set: import('./planner.js').SetSettings}, apiKey?: string, model?: import('./planner.js').TextModel}} o
 */
async function planningModel({ settings, apiKey, model }) {
  if (model) return model;
  const { textModelFrom } = await import('./planner.js');
  const key = apiKey ?? (await import('../providers/openrouter.js')).loadApiKey({ envVar: presetOf(settings.provider).keyEnvVar });
  return textModelFrom({ settings, apiKey: key });
}

/**
 * Plans a set (and its variants) with the text model and saves every plan without errors into the collection as a
 * set without cards (the editor's «create set» and `ccf.mjs set plan`). Without `collection` (or with save: false)
 * nothing is saved: the plans are returned.
 * @param {object} o
 * @param {string} [o.collection]
 * @param {string} o.theme @param {string} [o.wishes] @param {number} [o.variants]
 * @param {string} [o.window]  a layout of set-rules.json @param {number} [o.scenes] @param {string} [o.template]
 * @param {boolean} [o.save]  default true when `collection` is given
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {string} [o.apiKey]  default: from the environment / .env
 * @param {import('./planner.js').TextModel} [o.model]  replaces the settings' model (tests)
 * @param {number} [o.maxSpendUsd]  default settings set.plan.maxSpendUsd
 * @param {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} [o.store]
 * @param {AbortSignal} [o.signal]  once aborted, no new call of the model
 * @param {Progress} [o.progress]
 * @returns {Promise<{plans: PlannedSet[], spent: number, calls: number, stopped?: string, keyProblem?: KeyProblem}>}  stopped: why planning
 *   ended early (planner.js planSet); the plans finished before it are saved and the spend is recorded all the same
 */
export async function planSetInto({ collection, theme, wishes, variants, window, scenes, template, save = !!collection, settings, apiKey, model, maxSpendUsd, store, signal, progress = () => {} }) {
  const st = collection ? store ?? await defaultStore() : null;
  const { planSet } = await import('./planner.js');
  const { DEFAULT_STYLE } = await import('../store/layout.js');
  let style = DEFAULT_STYLE, collectionTheme, registry, titles;
  if (st && collection) {
    const col = (await st.getCollection(collection)).collection;
    style = col.style;
    collectionTheme = col.description || col.title;
    ({ registry, titles } = await collectionContext(st, collection, /** @type {any} */ ({ style })));
  }
  progress(`план набора «${theme}»`, { title: theme, status: 'planning' });
  const r = await planSet({
    style, theme, wishes, collectionTheme, variants, window, scenes, template, registry, titles,
    model: await planningModel({ settings, apiKey, model }), signal,
    limits: { repairs: settings.set.plan.repairs, retries: settings.set.plan.retries, maxSpendUsd: maxSpendUsd ?? settings.set.plan.maxSpendUsd },
  });
  // the planning calls are in no card: the factory's spend ledger keeps them (the collection's, or the factory's)
  await recordPlanSpend(st ?? store ?? await defaultStore(), collection ?? null, settings, r);
  /** @type {PlannedSet[]} */
  const plans = [];
  for (const p of r.plans) {
    /** @type {PlannedSet} */
    const item = { plan: p.plan ?? null, errors: [...p.errors], warnings: p.warnings, rounds: p.rounds };
    if (save && st && collection && p.plan && !p.errors.length) {
      try { item.set = (await saveSetPlan({ collection, plan: p.plan, store: st })).set.id; } catch (/** @type {any} */ e) { item.errors.push(String(e?.message ?? e)); }
    }
    const title = p.plan?.title ?? theme;
    progress(`«${title}»: ${item.errors.length ? `ошибок ${item.errors.length}` : item.set ? `план сохранён (${item.set})` : 'план готов'}`, { title, status: item.errors.length ? 'invalid' : 'planned', ...(item.set ? { set: item.set } : {}) });
    plans.push(item);
  }
  if (r.stopped) progress(r.stopped);
  return { plans, spent: r.spent, calls: r.calls, ...(r.stopped ? { stopped: r.stopped } : {}), ...(r.keyProblem ? { keyProblem: r.keyProblem } : {}) };
}

/**
 * Records a planning run's text-model calls in the spend ledger: the known sum, and one entry without a price per
 * call whose price the model did not report. Nothing when no call was made.
 * @param {SetStore} st @param {string|null} collection @param {import('../settings.js').Settings} settings
 * @param {{spent: number, calls: number, unknown?: number}} r
 */
async function recordPlanSpend(st, collection, settings, r) {
  if (!r.calls) return;
  const model = presetOf(settings.provider).textModel;
  await st.recordSpend(collection, { kind: 'text', what: 'plan', model, usd: r.spent });
  for (let i = 0; i < (r.unknown ?? 0); i++) await st.recordSpend(collection, { kind: 'text', what: 'plan', model, usd: null });
}

/**
 * The places (1-based numbers) of a collection that no set holds yet; variants of a set share its place.
 * @param {{number: number}[]} sets @param {number} count  places in a collection (set-rules.json collection.sets)
 */
export const missingPlaces = (sets, count) => {
  const taken = new Set(sets.map(s => s.number));
  return Array.from({ length: count }, (_, i) => i + 1).filter(n => !taken.has(n));
};

/**
 * Plans a whole collection with the text model (planner.js planCollection) and saves every plan without errors into
 * it as a set without cards; without `collection` a new collection is created (title, description = the theme).
 * In a collection that already has sets (the author's decision, 2026-10-31: the person chooses), `mode` "missing"
 * (the default) plans only its missing places (missingPlaces), with their own numbers, against the registry of the
 * sets it has; "variants" plans one more variant of every place's set (its theme, window and scene count, numbered and
 * grouped with it, checked by the variant rules; nothing is replaced) and a new set on every empty place. `only`
 * narrows the places. Then the collection's plans are checked together (validateCollection). When planning stops
 * early (`stopped`), the plans finished before are saved and the spend is recorded all the same; a split the model did
 * not get right throws, after the spend is recorded.
 * @param {object} o
 * @param {string} [o.collection] @param {string} [o.title]
 * @param {string} o.theme @param {string} [o.wishes] @param {number} [o.variants] @param {number[]} [o.only]
 * @param {'missing'|'variants'} [o.mode]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {string} [o.apiKey] @param {import('./planner.js').TextModel} [o.model] @param {number} [o.maxSpendUsd]
 * @param {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} [o.store]
 * @param {AbortSignal} [o.signal]  once aborted, no new call of the model
 * @param {Progress} [o.progress]
 * @returns {Promise<{collection: string, themes: {title: string, kind: string, angle: string, examples: string[]}[], sets: (PlannedSet & {number?: number})[], errors: string[], warnings: string[], spent: number, calls: number, stopped?: string, keyProblem?: KeyProblem}>}
 */
export async function planCollectionInto({ collection, title, theme, wishes, variants, only, mode = 'missing', settings, apiKey, model, maxSpendUsd, store, signal, progress = () => {} }) {
  const st = /** @type {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} */ (store ?? await defaultStore());
  const { planCollection } = await import('./planner.js');
  const { validateCollection } = await import('./plan.js');
  if (mode !== 'missing' && mode !== 'variants') throw new Error(`Что собрать: «missing» (только недостающие) или «variants» (ещё по варианту каждого места), а не «${mode}».`);
  const id = collection ?? (await st.createCollection({ title: title ?? theme, description: theme })).id;
  const { collection: col, sets } = await st.getCollection(id);
  const count = loadSetRules(col.style).rules.collection.sets;
  const places = only ?? (sets.length && mode === 'missing' ? missingPlaces(sets, count) : undefined);
  if (places && !places.length) throw new Error(`В коллекции уже все ${count} наборов: планировать нечего.`);
  const existing = /** @type {SetPlan[]} */ (sets.flatMap(s => storedPlan(s) ?? []));
  /** @type {Record<number, import('./planner.js').PlaceVariant>} */
  const extend = {};
  if (mode === 'variants') {
    for (const s of sets) {
      if (extend[s.number] || s.number < 1 || s.number > count) continue;
      const own = sets.filter(x => x.number === s.number);
      const first = own.find(x => x.plan) ?? s;
      const group = /** @type {string} */ (storedPlan(first)?.variant?.group ?? first.variantGroup);
      const siblings = own.flatMap(x => { const p = storedPlan(x); return p ? [{ ...p, variant: { n: p.variant?.n ?? 1, group } }] : []; });
      const p = siblings[0];
      extend[s.number] = {
        group, siblings, theme: p?.theme ?? first.title,
        ...(p ? { layout: p.window.layout, scenes: p.slots.filter(x => Number(x.order?.staging?.characters ?? 0) > 0).length } : {}),
      };
    }
  }
  const r = await planCollection({
    style: col.style, theme, wishes, variants, only: places, existing, extend, signal,
    model: await planningModel({ settings, apiKey, model }),
    limits: { repairs: settings.set.plan.repairs, retries: settings.set.plan.retries, maxSpendUsd: maxSpendUsd ?? settings.set.plan.maxSpendUsd },
    progress: text => progress(text),
  });
  await recordPlanSpend(st, id, settings, r);
  if (r.stopped && !r.plans.length) throw new Error(r.stopped);
  /** @type {(PlannedSet & {number?: number})[]} */
  const out = [];
  for (const p of r.plans) {
    /** @type {PlannedSet & {number?: number}} */
    const item = { number: p.plan?.number, plan: p.plan ?? null, errors: [...p.errors], warnings: p.warnings, rounds: p.rounds };
    if (p.plan && !p.errors.length) {
      try { item.set = (await saveSetPlan({ collection: id, plan: p.plan, store: st })).set.id; } catch (/** @type {any} */ e) { item.errors.push(String(e?.message ?? e)); }
    }
    const t = p.plan?.title ?? `№${item.number}`;
    progress(`№${item.number} «${t}»: ${item.set ? `план сохранён (${item.set})` : `ошибок ${item.errors.length}`}`, { number: item.number, title: t, status: item.set ? 'planned' : 'invalid', ...(item.set ? { set: item.set } : {}) });
    out.push(item);
  }
  if (r.stopped) progress(r.stopped);
  // a set made one by one has no number or group in its plan: its place and group are the store's
  const plans = (await st.getCollection(id)).sets.flatMap(s => storedPlan(s) ?? []);
  const whole = validateCollection(plans, { complete: !only });
  return { collection: id, themes: r.themes, sets: out, errors: whole.errors, warnings: whole.warnings, spent: r.spent, calls: r.calls, ...(r.stopped ? { stopped: r.stopped } : {}), ...(r.keyProblem ? { keyProblem: r.keyProblem } : {}) };
}

/**
 * The caps of a one-button run (buildSet, buildCollection): every set — each variant is a set of its own — keeps the
 * set cap (settings set.maxSpendUsd, each card in it card.maxSpendUsd); the cards of the whole run are capped by
 * `maxSpendUsd`, by default the set cap × the sets planned, so the sum never exceeds what the per-set cap promises.
 * The planning has its own cap (`planMaxSpendUsd`, default settings set.plan.maxSpendUsd).
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} settings
 * @param {number} sets @param {number} [maxSpendUsd]
 */
export const runCap = (settings, sets, maxSpendUsd) => maxSpendUsd ?? Math.round(settings.set.maxSpendUsd * sets * 1e6) / 1e6;

/**
 * One button «Собрать набор»: plans the set and its variants (planSetInto: each saved as a set without cards), then
 * makes the cards of every plan that came out (makeCollection over those sets), under the caps of runCap. A variant
 * whose plan did not come out is not made and is named in `warnings`; no plan at all throws (after the planning's
 * spend is recorded).
 * @param {object} o
 * @param {string} o.collection @param {string} o.theme @param {string} [o.wishes] @param {number} [o.variants]
 * @param {string} [o.window] @param {number} [o.scenes] @param {string} [o.template]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {Provider} o.provider
 * @param {string} [o.apiKey] @param {import('./planner.js').TextModel} [o.model]  the planning model (tests)
 * @param {number} [o.maxSpendUsd]  the cards of the whole run (default: runCap)
 * @param {number} [o.planMaxSpendUsd]  the planning (default settings set.plan.maxSpendUsd)
 * @param {{parallel?: number, attempts?: number}} [o.limits]
 * @param {AbortSignal} [o.signal] @param {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} [o.store]
 * @param {MakeCard} [o.makeCard] @param {Progress} [o.progress]
 */
export async function buildSet({ collection, theme, wishes, variants, window, scenes, template, settings, provider, apiKey, model, maxSpendUsd, planMaxSpendUsd, limits = {}, signal, store, makeCard, progress = () => {} }) {
  const plan = await planSetInto({ collection, theme, wishes, variants, window, scenes, template, settings, apiKey, model, maxSpendUsd: planMaxSpendUsd, store, signal, progress });
  const ids = plan.plans.flatMap(p => (p.set ? [p.set] : []));
  if (plan.keyProblem && !ids.length) throw new Error(plan.keyProblem.message);
  if (!ids.length) throw new Error(`План не получился: ${plan.plans.flatMap(p => p.errors).slice(0, 3).join('; ') || plan.stopped || 'модель не дала плана'}`);
  // a variant whose plan kept failing the rules is not made: say so, not only in the journal
  const warnings = [
    ...plan.plans.filter(p => !p.set).map(p => `Вариант «${p.plan?.title ?? theme}» не получился: ${p.errors[0] ?? 'модель не дала плана'}`),
    ...(plan.stopped && !plan.keyProblem ? [`Планирование прервано (вариантов с планом ${ids.length} из ${variants ?? 1}): ${plan.stopped}`] : []),
  ];
  for (const w of warnings) progress(w);
  const cap = runCap(settings, ids.length, maxSpendUsd);
  // the key failed while planning: no card is started on it; the plans are saved
  if (plan.keyProblem) return { plan, sets: [], skipped: [], spent: plan.spent, maxSpendUsd: cap, warnings: [keyStopText(plan.keyProblem), ...warnings], keyProblem: plan.keyProblem };
  progress('План готов — делаю карточки', { total: plan.spent });
  const made = await makeCollection({ collection, sets: ids, settings, provider, limits: { ...limits, maxSpendUsd: cap }, signal, store, makeCard, progress });
  // after a key stop its one message says it all; the sets it left are in `skipped`
  if (!made.keyProblem) warnings.push(...made.skipped.map(s => `Пропущен набор ${s}`));
  return { plan, sets: made.sets, skipped: made.skipped, spent: plan.spent + made.spent, maxSpendUsd: cap, warnings: [...made.warnings, ...warnings], ...(made.keyProblem ? { keyProblem: made.keyProblem } : {}) };
}

/**
 * One button «Собрать все наборы» / «Сразу все 16»: plans the collection (planCollectionInto: all 16 places in a new
 * or empty collection; else by `mode`, its missing places or one more variant of every place), then makes the cards
 * of the sets this run planned — never those the collection had —, under the caps of runCap.
 * @param {object} o
 * @param {string} [o.collection] @param {string} [o.title]
 * @param {string} o.theme @param {string} [o.wishes] @param {number} [o.variants] @param {number[]} [o.only]
 * @param {'missing'|'variants'} [o.mode]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {Provider} o.provider
 * @param {string} [o.apiKey] @param {import('./planner.js').TextModel} [o.model]
 * @param {number} [o.maxSpendUsd]  the cards of the whole run (default: runCap)
 * @param {number} [o.planMaxSpendUsd]  the planning (default settings set.plan.maxSpendUsd)
 * @param {{parallel?: number, attempts?: number}} [o.limits]
 * @param {AbortSignal} [o.signal] @param {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} [o.store]
 * @param {MakeCard} [o.makeCard] @param {Progress} [o.progress]
 */
export async function buildCollection({ collection, title, theme, wishes, variants, only, mode, settings, provider, apiKey, model, maxSpendUsd, planMaxSpendUsd, limits = {}, signal, store, makeCard, progress = () => {} }) {
  const plan = await planCollectionInto({ collection, title, theme, wishes, variants, only, mode, settings, apiKey, model, maxSpendUsd: planMaxSpendUsd, store, signal, progress });
  const ids = plan.sets.flatMap(s => (s.set ? [s.set] : []));
  const cap = runCap(settings, ids.length, maxSpendUsd);
  // the key failed while planning: no card is started on it; the plans are saved
  if (!plan.keyProblem) progress('План коллекции готов — делаю карточки', { total: plan.spent });
  /** @type {Awaited<ReturnType<typeof makeCollection>>} */
  const made = ids.length && !plan.keyProblem
    ? await makeCollection({ collection: plan.collection, sets: ids, settings, provider, limits: { ...limits, maxSpendUsd: cap }, signal, store, makeCard, progress })
    : { sets: [], spent: 0, skipped: [], cancelled: !!signal?.aborted, warnings: [] };
  const keyProblem = plan.keyProblem ?? made.keyProblem;
  const warnings = [
    ...(keyProblem ? [keyStopText(keyProblem)] : []),
    ...plan.sets.filter(s => !s.set).map(s => `Набор №${s.number ?? '?'} «${s.plan?.title ?? ''}» не спланирован: ${s.errors[0] ?? 'модель не дала плана'}`),
    ...(plan.stopped && !plan.keyProblem ? [`Планирование прервано: ${plan.stopped}`] : []),
    ...plan.errors, ...(keyProblem ? [] : made.skipped.map(s => `Пропущен набор ${s}`)),
  ];
  return { collection: plan.collection, plan, made, spent: plan.spent + made.spent, maxSpendUsd: cap, warnings, ...(keyProblem ? { keyProblem } : {}) };
}
