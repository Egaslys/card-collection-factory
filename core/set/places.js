// The places of a set window: each place's stars and frame (SETS.md 4: rarity belongs to the place, not to the card)
// and whether a scene with characters stands there. A person sets them on the window (the editor's place panel,
// `ccf.mjs set place`); they are kept in set.json `places` over the plan's, so the plan stays what the model wrote and
// a planned set is still made by it. What the window shows: the place's own, else the plan's slot, else the kind's
// default — the skeleton of its base layout in set-rules.json. A value the window kind cannot show (a crystal frame
// outside the grand window, a gold one in it) is not used, so switching the window kind back brings it back.
import { normalizePlan } from './plan.js';
import { loadSetRules, windowSkeleton } from './rules.js';
import { saidError } from '../say.js';

/**
 * @typedef {object} Place
 * @property {number} stars  1–5
 * @property {string} frame  one of the kind's `frames`
 * @property {boolean} scene  a scene with characters stands here (a generated card for the place is one)
 */

/**
 * @typedef {object} PlaceChoices  what a person may set on a window kind
 * @property {boolean} stars  false: the kind's every layout fixes the stars (the grand window: 5 on every place)
 * @property {string[]} frames  the frames the kind shows, its plain one first
 * @property {number[]} goldScenes  the places (1-based) where a gold frame makes a place without a plan a scene with
 *   characters; gold elsewhere is an item. The small window: set-rules.json `small_scene_slots` (the author's decision,
 *   2026-10-31: its layouts disagree on gold, so the places decide); a kind whose base layout puts gold on scenes: every
 *   place; else none
 */

/** @typedef {{stars: number, frame: string}} OwnPlace  a place as set.json `places` keeps it */

/**
 * The layouts of a window kind (set-rules.json `windows` of that family) and its base layout: the one named as the
 * kind, else its first.
 * @param {import('./rules.js').SetRules} rules @param {string} kind
 */
function layoutsOf(rules, kind) {
  const all = Object.entries(rules.windows).filter(([, w]) => w.family === kind);
  if (!all.length) throw new Error(`В правилах наборов нет окон вида «${kind}»; есть: ${[...new Set(Object.values(rules.windows).map(w => w.family))].join(', ')}.`);
  const base = rules.windows[kind]?.family === kind ? kind : all[0][0];
  return { all: all.map(([, w]) => w), base, w: rules.windows[base] };
}

/** @param {string} style @param {string} kind @returns {PlaceChoices} */
export function placeChoices(style, kind) {
  const { rules } = loadSetRules(style);
  const { all } = layoutsOf(rules, kind);
  const fixed = all.every(w => w.stars && new Set(w.stars).size === 1) && new Set(all.map(w => w.stars?.[0])).size === 1;
  const plain = [...new Set(all.map(w => w.frame))];
  const frames = all.some(w => w.gold !== 'none') ? [...plain, 'gold'] : plain;
  const every = Array.from({ length: rules.set_size }, (_, i) => i + 1);
  const goldScenes = !frames.includes('gold') ? [] : kind === 'small' ? [...rules.small_scene_slots] : layoutsOf(rules, kind).w.gold === 'scenes' ? every : [];
  return { stars: !fixed, frames, goldScenes };
}

/**
 * The places the window of a set shows (see the head of this file).
 * @param {{window: {kind: string}, places?: (OwnPlace|null)[]|null, plan?: any}} set @param {string} style
 * @returns {Place[]}
 */
export function placesOf(set, style) {
  const { rules } = loadSetRules(style);
  const kind = set.window.kind;
  const { base, w } = layoutsOf(rules, kind);
  const choices = placeChoices(style, kind);
  const skeleton = windowSkeleton(rules, base, w.scenes[0]);
  const allScenes = w.scenes[0] === rules.set_size;
  /** @param {any} p */
  const fits = p => p && Number.isInteger(p.stars) && p.stars >= 1 && p.stars <= 5 && choices.frames.includes(p.frame);
  return skeleton.map((d, i) => {
    const own = set.places?.[i];
    const planned = set.plan?.slots?.[i];
    if (fits(own)) {
      const o = /** @type {OwnPlace} */ (own);
      return { stars: choices.stars ? o.stars : d.stars, frame: o.frame, scene: allScenes || (o.frame === 'gold' && choices.goldScenes.includes(i + 1)) };
    }
    if (fits(planned)) return { stars: choices.stars ? planned.stars : d.stars, frame: planned.frame, scene: Number(planned.order?.staging?.characters ?? 0) > 0 };
    return d;
  });
}

/**
 * Sets one place's stars and/or frame (the rest of the window stays as shown) and saves the set's `places`.
 * @param {object} o
 * @param {string} o.collection @param {string} o.set @param {number} o.slot  0-based
 * @param {number} [o.stars] @param {string} [o.frame]
 * @param {Pick<typeof import('../store/index.js'), 'getCollection'|'getSet'|'updateSet'>} [o.store]
 */
export async function setPlace({ collection, set: setId, slot, stars, frame, store }) {
  const st = store ?? await import('../store/index.js');
  const { collection: col } = await st.getCollection(collection);
  const set = await st.getSet(collection, setId);
  if (!Number.isInteger(slot) || slot < 0 || slot >= set.slots.length) throw new Error(`Место — целое от 1 до ${set.slots.length}.`);
  const choices = placeChoices(col.style, set.window.kind);
  if (stars !== undefined) {
    if (!choices.stars) throw new Error('В этом окне звёзды мест заданы окном: их не поменять.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('Звёзды — целое от 1 до 5.');
  }
  if (frame !== undefined && !choices.frames.includes(frame)) throw new Error(`Рамка «${frame}» в этом окне не бывает; есть: ${choices.frames.join(', ')}.`);
  const shown = placesOf(/** @type {any} */ (set), col.style);
  const own = /** @type {any} */ (set).places;
  const old = /** @type {(OwnPlace|null)[]} */ (Array.isArray(own) ? own : []);
  const places = shown.map((p, i) => (i === slot ? { stars: stars ?? p.stars, frame: frame ?? p.frame } : old[i] ?? null));
  return st.updateSet(collection, setId, { places });
}

/**
 * Which order of the set's plan each empty place gets when it is filled: the plan's order of that very slot while no
 * card of the set was made from it; else one of the plan's orders no card of the set was made from (the person moved
 * cards around, or took one out), in the plan's order. A card is known by its order's id (CardSummary `orderId`,
 * kept when its caption changes). Null: a filled place, a set without a plan, or no plan order left — such a place is
 * filled like a set gathered by hand.
 * @param {{slots: (string|null)[], plan?: any}} set @param {Map<string, string|null>} orderIds  card id → its order id
 * @returns {(number|null)[]}  per place, the 0-based plan slot whose order it gets
 */
export function planFor(set, orderIds) {
  const out = /** @type {(number|null)[]} */ (set.slots.map(() => null));
  if (!set.plan?.slots?.length) return out;
  const ids = normalizePlan(set.plan).plan.slots.map((/** @type {any} */ s) => s?.order?.id ?? null);
  const made = new Set(set.slots.flatMap(c => (c ? [orderIds.get(c)] : [])));
  const missing = ids.flatMap((id, j) => (id && !made.has(id) ? [j] : []));
  const empty = set.slots.flatMap((c, i) => (c ? [] : [i]));
  const own = new Set(empty.filter(i => missing.includes(i)));
  for (const i of own) out[i] = i;
  const rest = missing.filter(j => !own.has(j));
  for (const i of empty.filter(i => !own.has(i))) out[i] = rest.shift() ?? null;
  return out;
}

/**
 * Makes one card for an empty place of a set, by the set's rules for that place: a planned set makes the plan's order
 * planFor gives the place (its own slot's: makeSet with that slot only; another's: that order with makeCard into this
 * place); a place no plan order is left for, or a set gathered by hand, has the text model write one order on the set's theme and wishes — or on `about`, what the person wants on the card — a scene
 * with characters when the place is one (placesOf), and makes it into the place (makeCardsInto). The place must be
 * empty.
 * @param {object} o
 * @param {string} o.collection @param {string} o.set @param {number} o.slot  0-based
 * @param {string} [o.about]  what the card shows, in the person's words (a set without a plan for the slot)
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {import('../card/make.js').Provider} o.provider
 * @param {string} [o.apiKey] @param {import('./planner.js').TextModel} [o.model]  the planning model (tests)
 * @param {AbortSignal} [o.signal] @param {any} [o.store] @param {typeof import('../card/make.js').makeCard} [o.makeCard]
 * @param {(msg: string, data?: object) => void} [o.progress]
 * @returns {Promise<{spent: number, card: string|null, warnings: string[], errors: string[]}>}  errors: the order did not
 *   come out (nothing was made)
 */
export async function fillPlace({ collection, set: setId, slot, about, settings, provider, apiKey, model, signal, store, makeCard, progress = () => {} }) {
  const st = store ?? await import('../store/index.js');
  const { collection: col } = await st.getCollection(collection);
  const set = await st.getSet(collection, setId);
  if (!Number.isInteger(slot) || slot < 0 || slot >= set.slots.length) throw new Error(`Место — целое от 1 до ${set.slots.length}.`);
  if (set.slots[slot]) throw saidError(`Место ${slot + 1} занято: сначала уберите карточку из него.`, 'place.taken', { n: slot + 1 });
  const cards = await st.listCards(collection, { setId });
  const j = planFor(set, new Map(cards.map((/** @type {any} */ c) => [c.id, c.orderId ?? null])))[slot];
  if (j === slot) {
    const { makeSet } = await import('./make.js');
    const r = await makeSet({ collection, set: setId, only: [slot + 1], settings, provider, signal, store: st, makeCard, progress });
    const s = r.slots[0];
    return { spent: r.spent, card: s?.card ?? null, warnings: r.warnings, errors: s?.error ? [s.error] : [] };
  }
  if (j != null) {
    const order = normalizePlan(/** @type {any} */ (set.plan)).plan.slots[j].order;
    const make = makeCard ?? (await import('../card/make.js')).makeCard;
    progress(`место ${slot + 1}: «${order.title}» — генерация`, { set: setId, slot: slot + 1, title: order.title, status: 'start', spent: 0 });
    try {
      const { cardSteps, madeRow, rowFacts } = await import('./make.js');
      const r = await make({ order, collection, place: { setId, slot }, settings, provider, store: st, ...(signal ? { signal } : {}), onProgress: cardSteps(progress, { set: setId, slot: slot + 1, cardId: null, title: String(order.title) }) });
      const row = madeRow(r);
      progress(`место ${slot + 1}: «${order.title}» — ${row.text}`, { set: setId, slot: slot + 1, cardId: r.id, title: order.title, status: 'made', spent: r.spent ?? 0, ...rowFacts(row.card) });
      return { spent: r.spent ?? 0, card: r.id, warnings: r.stop === 'key' && r.keyProblem ? [r.keyProblem.message] : [], errors: [] };
    } catch (/** @type {any} */ e) {
      return { spent: 0, card: null, warnings: [], errors: [String(e?.message ?? e)] };
    }
  }
  const { makeCardsInto } = await import('./cards.js');
  const place = placesOf(set, col.style)[slot];
  const r = await makeCardsInto({
    collection, theme: about ? `${about} (${set.brief.theme || set.title})` : set.brief.theme || set.title, wishes: set.brief.wishes, count: 1, scenes: place.scene ? 1 : 0, place: { setId, slot },
    settings, provider, apiKey, model, signal, store: st, makeCard, progress,
  });
  const c = r.cards[0];
  return { spent: r.spent, card: c?.card ?? null, warnings: [...r.plan.warnings, ...r.warnings], errors: [...r.plan.errors, ...(c?.error ? [c.error] : [])] };
}
