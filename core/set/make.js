// Making sets and collections from their plans: the plan goes into the store (set.json `plan`), then the set's ten
// cards are made with core/card makeCard — a few at a time, under one spend cap for the whole set — and each card is
// put into its slot as soon as it is made, so an open editor sees the set fill up. A collection is its sets in order.
import { validatePlan, registryOf, normalizePlan } from './plan.js';
import { loadSetRules } from './rules.js';

/** @typedef {import('./plan.js').SetPlan} SetPlan */
/** @typedef {import('../card/make.js').CardReport} CardReport */
/** @typedef {import('../card/make.js').Provider} Provider */
/** @typedef {import('../store/index.js').CardSet} CardSet */
/**
 * The Store API core/set uses (core/README.md).
 * @typedef {Pick<typeof import('../store/index.js'), 'getCollection'|'createCollection'|'createSet'|'getSet'|'updateSet'|'listCards'|'cardDir'|'newCardId'|'moveCard'>} SetStore
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
 * @property {string[]} warnings  the plan's warnings
 */

const defaultStore = async () => /** @type {SetStore} */ (await import('../store/index.js'));
const defaultMakeCard = async () => (await import('../card/make.js')).makeCard;

/**
 * What the collection already holds for a plan's validation: registry, titles and variants of the other sets.
 * @param {SetStore} store @param {string} collection @param {SetPlan} plan @param {string} [self]  the plan's own set id
 */
export async function collectionContext(store, collection, plan, self) {
  const { sets } = await store.getCollection(collection);
  const others = sets.filter(s => s.id !== self);
  const group = plan.variant?.group;
  /** @param {CardSet} s */
  const planOf = s => /** @type {SetPlan|undefined} */ (s.plan);
  const variants = others.filter(s => group && planOf(s)?.variant?.group === group).map(s => /** @type {SetPlan} */ (planOf(s)));
  const rest = others.filter(s => !(group && planOf(s)?.variant?.group === group));
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
 * existing one). Variants of one group share the store's variant group and number. Throws on errors.
 * @param {{collection: string, plan: SetPlan, set?: string, store?: SetStore}} o
 * @returns {Promise<{set: CardSet, warnings: string[]}>}
 */
export async function saveSetPlan({ collection, plan: input, set, store }) {
  const st = store ?? await defaultStore();
  const ctx = await collectionContext(st, collection, input, set);
  const { errors, warnings, plan } = validatePlan(input, ctx);
  if (errors.length) throw new Error(`План набора «${input.title}» не прошёл проверку (${errors.length}):\n- ${errors.join('\n- ')}`);
  const { rules } = loadSetRules(plan.style);
  const family = rules.windows[plan.window.layout].family;
  const window = { kind: family, ...(plan.window.template ? { template: plan.window.template } : {}) };
  const brief = { theme: plan.theme, wishes: plan.wishes ?? '' };
  if (set) return { set: await st.updateSet(collection, set, { title: plan.title, window, plan }), warnings: [...ctx.warnings, ...warnings] };
  const sibling = plan.variant && ctx.sets.find(s => /** @type {SetPlan|undefined} */ (s.plan)?.variant?.group === plan.variant?.group);
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
/** @typedef {(text: string, event?: SetProgressEvent|PlanProgressEvent) => void} Progress */

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
  const budget = { spent: 0, reserved: 0, price: 0 };
  /** @param {number} i */
  const one = async i => {
    const s = plan.slots[i];
    const title = String(s.order.title);
    const existing = set.slots[i] ?? null;
    const capHere = Math.min(settings.card.maxSpendUsd, cap - budget.spent - budget.reserved);
    const free = provider.free && !provider.fallback;
    // a new card's first call has no price of its own yet: the highest price seen in this set stands for it
    if (!free && (capHere <= 0 || capHere < budget.price)) {
      report({ slot: i + 1, title, card: existing, result: 'skipped', spent: 0 }, 'пропущена: потолок расходов набора');
      return;
    }
    budget.reserved += Math.max(0, capHere);
    progress(`слот ${i + 1}: «${title}» — генерация`, { set: set.id, slot: i + 1, cardId: existing, title, status: 'start', spent: 0 });
    try {
      const r = await make({
        order: s.order, collection, ...(existing ? { card: existing } : {}), place: { setId: set.id, slot: i },
        settings, provider, store: st, limits: { maxSpendUsd: Math.max(0, capHere), ...(limits.attempts ? { attempts: limits.attempts } : {}) },
        ...(signal ? { signal } : {}),
      });
      budget.spent += r.spent ?? 0;
      budget.price = Math.max(budget.price, ...r.attempts.map(x => x.cost ?? 0));
      const blocking = r.chosenCheck?.blocking ?? null;
      report({ slot: i + 1, title, card: r.id, result: 'made', stop: r.stop, spent: r.spent ?? 0, blocking, image: r.image },
        `${r.image ? `готово (блокирующих FAIL ${blocking ?? '—'})` : 'картинки нет'}, $${(r.spent ?? 0).toFixed(4)}`);
    } catch (/** @type {any} */ e) {
      report({ slot: i + 1, title, card: existing, result: 'failed', spent: 0, error: String(e?.message ?? e) }, `ошибка: ${e?.message ?? e}`);
    } finally {
      budget.reserved -= Math.max(0, capHere);
    }
  };
  const workers = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      if (signal?.aborted) {
        const s = plan.slots[i];
        report({ slot: i + 1, title: String(s.order.title), card: set.slots[i] ?? null, result: 'cancelled', spent: 0 }, 'отменена');
        continue;
      }
      await one(i);
    }
  });
  await Promise.all(workers);
  reports.sort((a, b) => a.slot - b.slot);
  return { collection, set: set.id, title: set.title, slots: reports, spent: budget.spent, maxSpendUsd: cap, warnings };
}

/**
 * Makes the sets of a collection in their order (by number; variants of one number one after another), or only the
 * given numbers. Every set has its own spend cap (settings set.maxSpendUsd); `maxSpendUsd` caps the whole run.
 * `signal`: once aborted, no new card and no new set starts.
 * @param {object} o
 * @param {string} o.collection
 * @param {number[]} [o.numbers]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {Provider} o.provider
 * @param {{parallel?: number, maxSpendUsd?: number, attempts?: number}} [o.limits]  maxSpendUsd: the whole run
 * @param {AbortSignal} [o.signal]
 * @param {SetStore} [o.store] @param {MakeCard} [o.makeCard]
 * @param {Progress} [o.progress]
 * @returns {Promise<{sets: SetReport[], spent: number, skipped: string[], cancelled: boolean}>}
 */
export async function makeCollection({ collection, numbers, settings, provider, limits = {}, signal, store, makeCard, progress = () => {} }) {
  const st = store ?? await defaultStore();
  const { collection: col, sets } = await st.getCollection(collection);
  const order = [...sets].sort((a, b) => a.number - b.number || col.sets.indexOf(a.id) - col.sets.indexOf(b.id));
  const chosen = order.filter(s => !numbers || numbers.includes(s.number));
  /** @type {SetReport[]} */
  const out = [];
  /** @type {string[]} */
  const skipped = [];
  let spent = 0;
  for (const s of chosen) {
    if (signal?.aborted) { skipped.push(`«${s.title}» (№${s.number}): отменено`); continue; }
    if (!s.plan) { skipped.push(`«${s.title}» (№${s.number}): нет плана`); continue; }
    const left = limits.maxSpendUsd === undefined ? undefined : limits.maxSpendUsd - spent;
    if (left !== undefined && left <= 0 && !(provider.free && !provider.fallback)) { skipped.push(`«${s.title}» (№${s.number}): исчерпан потолок расходов коллекции`); continue; }
    progress(`набор №${s.number} «${s.title}»`);
    const r = await makeSet({
      collection, set: s.id, settings, provider, store: st, makeCard, progress, signal,
      limits: { ...limits, maxSpendUsd: left === undefined ? undefined : Math.min(left, settings.set.maxSpendUsd) },
    });
    spent += r.spent;
    out.push(r);
  }
  return { sets: out, spent, skipped, cancelled: !!signal?.aborted };
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
  const key = apiKey ?? (await import('../providers/openrouter.js')).loadApiKey({ envVar: settings.provider.openrouter.keyEnvVar });
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
 * @param {Progress} [o.progress]
 * @returns {Promise<{plans: PlannedSet[], spent: number, calls: number}>}
 */
export async function planSetInto({ collection, theme, wishes, variants, window, scenes, template, save = !!collection, settings, apiKey, model, maxSpendUsd, store, progress = () => {} }) {
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
    model: await planningModel({ settings, apiKey, model }),
    limits: { repairs: settings.set.plan.repairs, maxSpendUsd: maxSpendUsd ?? settings.set.plan.maxSpendUsd },
  });
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
  return { plans, spent: r.spent, calls: r.calls };
}

/**
 * Plans a whole collection with the text model (planner.js planCollection) and saves every plan without errors into
 * it as a set without cards; without `collection` a new collection is created (title, description = the theme).
 * Then the collection's plans are checked together (validateCollection).
 * @param {object} o
 * @param {string} [o.collection] @param {string} [o.title]
 * @param {string} o.theme @param {string} [o.wishes] @param {number} [o.variants] @param {number[]} [o.only]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {string} [o.apiKey] @param {import('./planner.js').TextModel} [o.model] @param {number} [o.maxSpendUsd]
 * @param {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} [o.store]
 * @param {Progress} [o.progress]
 * @returns {Promise<{collection: string, themes: {title: string, kind: string, angle: string, examples: string[]}[], sets: (PlannedSet & {number?: number})[], errors: string[], warnings: string[], spent: number, calls: number}>}
 */
export async function planCollectionInto({ collection, title, theme, wishes, variants, only, settings, apiKey, model, maxSpendUsd, store, progress = () => {} }) {
  const st = /** @type {SetStore & Pick<typeof import('../store/index.js'), 'createCollection'>} */ (store ?? await defaultStore());
  const { planCollection } = await import('./planner.js');
  const { validateCollection } = await import('./plan.js');
  const id = collection ?? (await st.createCollection({ title: title ?? theme, description: theme })).id;
  const { collection: col, sets } = await st.getCollection(id);
  const existing = /** @type {SetPlan[]} */ (sets.map(s => s.plan).filter(Boolean));
  const r = await planCollection({
    style: col.style, theme, wishes, variants, only, existing,
    model: await planningModel({ settings, apiKey, model }),
    limits: { repairs: settings.set.plan.repairs, maxSpendUsd: maxSpendUsd ?? settings.set.plan.maxSpendUsd },
    progress: text => progress(text),
  });
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
  const plans = /** @type {SetPlan[]} */ ((await st.getCollection(id)).sets.map(s => s.plan).filter(Boolean));
  const whole = validateCollection(plans, { complete: !only });
  return { collection: id, themes: r.themes, sets: out, errors: whole.errors, warnings: whole.warnings, spent: r.spent, calls: r.calls };
}
