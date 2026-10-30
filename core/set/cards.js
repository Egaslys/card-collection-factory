// Loose cards: N cards on a theme for a collection's pool, outside any set (the editor's «Создать карточки» and
// `ccf.mjs cards plan` / `cards make`). The text model writes their orders from the same bible fragments and glue a
// set plan uses (SETS.md «Для промпта (англ.)», set-rules.json `prompt.glue`), without the window: no stars, no
// frames, no slot rules. Each order is checked by the style as in a set (checkOrder, category by staging, one item
// kind once); the mix of categories is only a warning, as loose cards are not a set. Then each card is made into the
// pool with core/card makeCard under one spend cap.
import { fillSlots, parseFragments } from '../style/fragments.js';
import { styleDirOf } from '../style/style.js';
import { checkOrder } from '../style/card-order.js';
import { matches } from '../style/assembly.js';
import { normalizePlan, wishWarnings } from './plan.js';
import { parseAnswer } from './planner.js';
import { expandStaging, kindKey, loadSetRules, rowCategories, seenPatterns, stagingRow } from './rules.js';
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('./plan.js').SlotPlan} LooseCard  a planned card: kind, wishes, props, hue, order (no stars or frame) */
/** @typedef {import('./planner.js').TextModel} TextModel */
/** @typedef {import('../providers/openrouter-text.js').ChatMessage} ChatMessage */
/** @typedef {import('../card/make.js').Provider} Provider */

/**
 * @typedef {object} CardsPlan
 * @property {string} style @property {string} theme @property {string} [wishes]
 * @property {number} count @property {number} scenes  how many of them are scenes with characters
 * @property {LooseCard[]} cards  orders normalized (presets expanded, wishes in promptExtra, ids)
 * @property {string[]} errors  left after the repairs: these cards cannot be made until they are fixed
 * @property {string[]} warnings
 * @property {number} rounds  model answers spent
 */

/** @param {LooseCard} c */
const isScene = c => Number(c.order?.staging?.characters ?? 0) > 0;
/** @param {number} i @param {LooseCard} c */
const where = (i, c) => `карточка ${i + 1}${c?.order?.title ? ` («${c.order.title}»)` : ''}`;
/** @param {string} s */
const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** @param {string} template @param {Record<string, string>} values  glue slots `{name}` */
const glue = (template, values) => template.replace(/\{([a-z ]+)\}/g, (m, k) => values[k] ?? m);

/** @param {string} style @param {string} id @param {Record<string, string>} values */
function fragment(style, id, values) {
  const text = parseFragments(fs.readFileSync(path.join(styleDirOf(style), 'SETS.md'), 'utf8'), 'SETS.md').find(f => f.id === id)?.text;
  if (!text) throw new Error(`В SETS.md нет фрагмента «${id}» (метка <!-- fragment: ${id} --> в разделе «Для промпта (англ.)»).`);
  const { text: out, missing } = fillSlots(text, { named: k => values[k], chosen: new Map() });
  if (missing.length) throw new Error(`Фрагмент «${id}»: нечем заполнить ${missing.map(m => m.raw).join(', ')}.`);
  return out;
}

/**
 * The text-model prompt for loose cards.
 * @param {object} o
 * @param {string} o.style @param {string} o.theme @param {string} [o.wishes] @param {string} [o.collectionTheme]
 * @param {number} o.count @param {number} o.scenes @param {string} [o.language]
 * @returns {ChatMessage[]}
 */
export function cardsPrompt({ style, theme, wishes, collectionTheme, count, scenes, language }) {
  const { rules, style: st } = loadSetRules(style);
  const ids = rules.prompt.fragments, g = rules.prompt.glue;
  if (!g.cards) throw new Error(`В ${style}/set-rules.json нет prompt.glue.cards: нечем просить отдельные карточки.`);
  const items = count - scenes;
  /** @type {string[]} */
  const parts = [glue(g.cards, { theme, 'collection theme': collectionTheme || theme, count: String(count), items: String(items), scenes: String(scenes) })];
  // the staging fragment asks for every category 1–4: only when there are enough item cards to hold them
  if (items >= rules.categories.regular.length) parts.push(fragment(style, ids.staging, {}));
  if (scenes) parts.push(fragment(style, ids.scenes, { n: String(scenes), registry: 'none yet' }));
  parts.push(fragment(style, ids.captions, { language: language || rules.captions.language }));
  const seen = seenPatterns(rules, st);
  const stagings = rules.stagings.map(r => `${r.id} (${r.fill.join(', ')}${seen.has(r.id) ? `; pattern only: ${(seen.get(r.id) ?? []).join(' | ')}` : ''})`).join('; ');
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

const ORDER_FIELDS = ['subject', 'object', 'place', 'environment', 'motif', 'palette', 'staging', 'scene', 'promptExtra', 'humanRequest'];

/**
 * The model's answer as loose cards (not yet normalized or checked).
 * @param {any} answer @param {{style: string}} o
 * @returns {LooseCard[]}
 */
export function cardsFromAnswer(answer, { style }) {
  const { rules, style: st } = loadSetRules(style);
  const list = Array.isArray(answer?.cards) ? answer.cards : [];
  return list.map((/** @type {any} */ c) => {
    /** @type {Record<string, unknown>} */
    const order = { style, title: c?.caption ?? c?.title };
    for (const k of ORDER_FIELDS) if (c?.[k] !== undefined && c[k] !== null && c[k] !== '') order[k] = c[k];
    const id = slug(c?.object ?? c?.kind);
    if (id) order.id = id;
    /** @type {LooseCard} */
    const card = { stars: 0, frame: '', kind: c?.kind, order: /** @type {any} */ (order) };
    for (const k of /** @type {const} */ (['facet', 'subkind', 'hue'])) if (typeof c?.[k] === 'string' && c[k]) card[k] = c[k];
    if (typeof c?.wishes === 'string') card.wishes = c.wishes;
    if (Array.isArray(c?.props)) card.props = c.props;
    // hue and palette name a backdrop colour: kept only where the backdrop is abstract (SETS.md 3.7)
    const staging = expandStaging(/** @type {any} */ (order.staging), rules).staging;
    if (!staging || !matches(rules.abstract_when, /** @type {any} */ ({ staging }), st)) { delete card.hue; delete order.palette; }
    return card;
  });
}

/**
 * Checks loose cards by the style: every order (checkOrder), its category by its staging, no item kind twice, the
 * asked count and number of scenes; the mix of categories (SETS.md 3.5) and the wishes reaching each card are warnings.
 * @param {LooseCard[]} input
 * @param {{style: string, count: number, scenes: number, wishes?: string}} o
 * @returns {{cards: LooseCard[], errors: string[], warnings: string[]}}  cards: normalized
 */
export function validateCards(input, { style, count, scenes, wishes }) {
  const { rules, style: st } = loadSetRules(style);
  const norm = normalizePlan(/** @type {any} */ ({ style, title: 'card', slots: input }));
  const cards = /** @type {LooseCard[]} */ (norm.plan.slots);
  const errors = norm.errors.map(e => e.replace(/^слот (\d+)/, 'карточка $1'));
  /** @type {string[]} */
  const warnings = [];
  if (cards.length !== count) errors.push(`нужно ровно ${count} карточек, а их ${cards.length}`);
  const sceneCount = cards.filter(isScene).length;
  if (sceneCount !== scenes) errors.push(`сцен с персонажами нужно ${scenes}, а их ${sceneCount}`);
  /** @type {Map<string, number[]>} */
  const kinds = new Map();
  cards.forEach((c, i) => {
    if (!c?.order || typeof c.order !== 'object') { errors.push(`${where(i, c)}: нет заказа`); return; }
    for (const e of checkOrder(c.order, st)) errors.push(`${where(i, c)}: ${e}`);
    if (typeof c.kind !== 'string' || !c.kind.trim()) errors.push(`${where(i, c)}: нет поля kind — вид предмета по-английски (для сцены — её ситуация)`);
    if (c.props?.length && !isScene(c)) errors.push(`${where(i, c)}: props — только у сцены с персонажами`);
    const row = rules.stagings.find(r => r.id === stagingRow(c.order, rules, st));
    if (row && c.order.staging) {
      const allowed = rowCategories(c.order, row, st);
      const cat = Number(c.order.staging.category);
      if (allowed.length && !allowed.includes(cat)) errors.push(`${where(i, c)}: постановка «${row.title}» даёт категорию ${allowed.join(' или ')}, а в заказе ${cat} (BACKGROUNDS.md «Категория как следствие постановки»)`);
    }
    if (!isScene(c) && matches(rules.abstract_when, c.order, st) && [undefined, 'n/a'].includes(/** @type {any} */ (c.order.staging)?.pattern)) errors.push(`${where(i, c)}: у абстрактного фона нужен узор или градиент (staging.pattern), а не n/a (SETS.md 3.7)`);
    if (!isScene(c) && c.kind) { const k = kindKey(c.kind); kinds.set(k, [...(kinds.get(k) ?? []), i + 1]); }
  });
  for (const [k, at] of kinds) if (at.length > 1) errors.push(`вид предмета «${k}» повторяется: карточки ${at.join(', ')} (SETS.md 3.8)`);
  const items = cards.filter(c => c?.order && !isScene(c));
  if (items.length >= rules.categories.regular.length) {
    const have = new Set(items.map(c => Number(c.order.staging?.category)));
    const missing = rules.categories.regular.filter(c => !have.has(c));
    if (missing.length) warnings.push(`нет категори${missing.length > 1 ? 'й' : 'и'} ${missing.join(', ')}: в хорошей смеси каждая из 1–4 есть хотя бы раз (SETS.md 3.5)`);
  }
  warnings.push(...wishWarnings(/** @type {any} */ ({ wishes, slots: cards })).map(w => w.replace(/слот/g, 'карточк')));
  return { cards, errors, warnings };
}

/**
 * Plans loose cards with the text model: prompt → answer → cards → check → the errors back to the model, at most
 * `repairs` times. Refuses a call once `maxSpendUsd` is spent or when the model gives no price.
 * @param {object} o
 * @param {string} o.style @param {string} o.theme @param {string} [o.wishes] @param {string} [o.collectionTheme]
 * @param {number} o.count @param {number} [o.scenes]  default 0 @param {string} [o.language]
 * @param {TextModel} o.model
 * @param {{repairs: number, maxSpendUsd: number}} o.limits
 * @returns {Promise<CardsPlan & {spent: number, calls: number}>}
 */
export async function planCards({ style, theme, wishes, collectionTheme, count, scenes = 0, language, model, limits }) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Сколько карточек: целое число от 1.');
  if (!Number.isInteger(scenes) || scenes < 0 || scenes > count) throw new Error(`Сцен с персонажами: целое от 0 до ${count}.`);
  const { rules } = loadSetRules(style);
  const messages = cardsPrompt({ style, theme, wishes, collectionTheme, count, scenes, language });
  let spent = 0, calls = 0;
  /** @type {CardsPlan} */
  let out = { style, theme, ...(wishes ? { wishes } : {}), count, scenes, cards: [], errors: [], warnings: [], rounds: 0 };
  for (let round = 0; round <= limits.repairs; round++) {
    if (spent >= limits.maxSpendUsd) { out.errors.push(`планирование остановлено: потрачено $${spent.toFixed(4)} при потолке $${limits.maxSpendUsd}`); break; }
    const answer = await model(messages);
    calls++;
    if (answer.cost == null) throw new Error('Текстовая модель не сообщила цену — потолок расходов не соблюсти, планирование остановлено.');
    spent += answer.cost;
    messages.push({ role: 'assistant', content: answer.text });
    try {
      const v = validateCards(cardsFromAnswer(parseAnswer(answer.text), { style }), { style, count, scenes, wishes });
      out = { ...out, ...v, rounds: round + 1 };
    } catch (/** @type {any} */ e) {
      out = { ...out, errors: [String(e?.message ?? e)], warnings: [], rounds: round + 1 };
    }
    if (!out.errors.length || round === limits.repairs) break;
    messages.push({ role: 'user', content: glue(rules.prompt.glue.repair, { errors: out.errors.map(e => `- ${e}`).join('\n') }) });
  }
  return { ...out, spent, calls };
}

/**
 * @typedef {object} LooseReport  one card of a loose-card run
 * @property {string} title
 * @property {string|null} card  the card id (null when not made)
 * @property {'made'|'skipped'|'failed'|'cancelled'} result
 * @property {import('../card/make.js').CardReport['stop']} [stop]
 * @property {number} spent @property {number|null} [blocking] @property {string|null} [image] @property {string} [error]
 */

/**
 * Loose cards into a collection's pool, one button: plans them (planCards, the collection's description as the
 * collection theme; the planning spend recorded as text), then makes each card that the plan holds with makeCard,
 * a few at a time (settings set.parallel), under one spend cap for the cards (maxSpendUsd, default set.maxSpendUsd).
 * With plan errors nothing is made: the plan comes back with them.
 * @param {object} o
 * @param {string} o.collection @param {string} o.theme @param {string} [o.wishes] @param {number} o.count @param {number} [o.scenes]
 * @param {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} o.settings
 * @param {Provider} o.provider
 * @param {string} [o.apiKey] @param {TextModel} [o.model]  the planning model (tests), else the settings' with the key
 * @param {number} [o.maxSpendUsd]  the cards' cap
 * @param {AbortSignal} [o.signal]
 * @param {any} [o.store] @param {typeof import('../card/make.js').makeCard} [o.makeCard]
 * @param {(msg: string, data?: object) => void} [o.progress]
 * @returns {Promise<{plan: CardsPlan, cards: LooseReport[], spent: number, planSpent: number}>}
 */
export async function makeCardsInto({ collection, theme, wishes, count, scenes = 0, settings, provider, apiKey, model, maxSpendUsd, signal, store, makeCard, progress = () => {} }) {
  const st = store ?? await import('../store/index.js');
  const make = makeCard ?? (await import('../card/make.js')).makeCard;
  const col = (await st.getCollection(collection)).collection;
  let text = model;
  if (!text) {
    const { textModelFrom } = await import('./planner.js');
    const key = apiKey ?? (await import('../providers/openrouter.js')).loadApiKey({ envVar: settings.provider.openrouter.keyEnvVar });
    text = await textModelFrom({ settings, apiKey: /** @type {string} */ (key) });
  }
  const n10 = count % 10, n100 = count % 100;
  const word = n10 === 1 && n100 !== 11 ? 'карточка' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'карточки' : 'карточек';
  progress(`план: ${count} ${word} «${theme}»`, { status: 'planning' });
  const p = await planCards({
    style: col.style, theme, wishes, collectionTheme: col.description || col.title, count, scenes, model: text,
    limits: { repairs: settings.set.plan.repairs, maxSpendUsd: settings.set.plan.maxSpendUsd },
  });
  const { spent: planSpent, calls, ...plan } = p;
  if (calls) await st.recordSpend(collection, { kind: 'text', what: 'plan', model: settings.set.plan.model, usd: planSpent });
  if (plan.errors.length) {
    progress(`план не прошёл проверку (${plan.errors.length}): ${plan.errors[0]}`, { status: 'invalid' });
    return { plan, cards: [], spent: planSpent, planSpent };
  }
  progress('план готов — делаю карточки', { status: 'planned' });
  const cap = maxSpendUsd ?? settings.set.maxSpendUsd;
  const budget = { spent: 0, reserved: 0, price: 0 };
  /** @type {LooseReport[]} */
  const reports = [];
  /** @param {LooseReport} r @param {string} msg */
  const report = (r, msg) => { reports.push(r); progress(`«${r.title}» — ${msg}`, { cardId: r.card, title: r.title, status: r.result, spent: r.spent }); };
  const queue = plan.cards.map((_, i) => i);
  /** @param {number} i */
  const one = async i => {
    const order = plan.cards[i].order, title = String(order.title);
    const capHere = Math.min(settings.card.maxSpendUsd, cap - budget.spent - budget.reserved);
    // a card's first call has no price of its own yet: the highest price seen in this run stands for it
    if (!(provider.free && !provider.fallback) && (capHere <= 0 || capHere < budget.price)) { report({ title, card: null, result: 'skipped', spent: 0 }, 'пропущена: потолок расходов'); return; }
    budget.reserved += Math.max(0, capHere);
    progress(`«${title}» — генерация`, { title, status: 'start', spent: 0 });
    try {
      const r = await make({ order, collection, settings, provider, store: st, limits: { maxSpendUsd: Math.max(0, capHere) }, ...(signal ? { signal } : {}) });
      budget.spent += r.spent ?? 0;
      budget.price = Math.max(budget.price, ...r.attempts.map(x => x.cost ?? 0));
      const blocking = r.chosenCheck?.blocking ?? null;
      report({ title, card: r.id, result: 'made', stop: r.stop, spent: r.spent ?? 0, blocking, image: r.image },
        `${r.image ? `готово (блокирующих FAIL ${blocking ?? '—'})` : 'картинки нет'}, $${(r.spent ?? 0).toFixed(4)}`);
    } catch (/** @type {any} */ e) {
      report({ title, card: null, result: 'failed', spent: 0, error: String(e?.message ?? e) }, `ошибка: ${e?.message ?? e}`);
    } finally {
      budget.reserved -= Math.max(0, capHere);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, settings.set.parallel), queue.length) }, async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      if (signal?.aborted) report({ title: String(plan.cards[i].order.title), card: null, result: 'cancelled', spent: 0 }, 'отменена');
      else await one(i);
    }
  }));
  return { plan, cards: reports, spent: planSpent + budget.spent, planSpent };
}
