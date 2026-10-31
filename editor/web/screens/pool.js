// The collection's card pool («Хранилище») beside a collection or a set: all its cards, those in no set, or those in
// sets; cards are dragged into set places, and a card dropped on the pool leaves its set. «Создать карточки» makes
// loose cards into it. ⌘/Ctrl-click picks cards for the export (app.selection, the shell's), here and in a window.
import { esc, I, modelName, thumb, tip } from '../ui.js';
import { plural, words } from '../i18n.js';
import { openCreateCards } from '../panels/create.js';
import { app } from '../state.js';
import { drawn, keyed, patchHtml, patchList } from './patch.js';

const t = words({
  ru: {
    title: 'Хранилище', aria: 'Хранилище карточек', which: 'Какие карточки показать', all: 'Все', free: 'Вне наборов', in: 'В наборах',
    tip: 'Все карточки коллекции. Перетащите карточку в окно набора — она займёт место. Перетащите обратно — она уйдёт из набора. ⌘ или Ctrl + щелчок — выбрать карточку для экспорта.',
    make: 'Создать карточки', where: 'Набор {n} · место {slot}', none: 'Карточек пока нет. Создайте карточки по теме — они лягут сюда, а отсюда их можно разложить по наборам.',
    allPlaced: 'Все карточки разложены по наборам. Перетащите сюда карточку из окна, чтобы убрать её из набора.', noneInSets: 'В наборах карточек пока нет.',
  },
  en: {
    title: 'Pool', aria: 'Card pool', which: 'Which cards to show', all: 'All', free: 'Not in sets', in: 'In sets',
    tip: 'Every card of the collection. Drag a card into a set window and it takes the place. Drag it back and it leaves the set. ⌘ or Ctrl + click picks a card for the export.',
    make: 'Create cards', where: 'Set {n} · place {slot}', none: 'No cards yet. Create cards on a theme: they land here, and from here you lay them out into sets.',
    allPlaced: 'Every card is in a set. Drag a card here from a window to take it out of its set.', noneInSets: 'No cards in sets yet.',
  },
});

/** which cards the pool shows: every card, those in no set, or those in sets (kept between redraws and screens) */
export const poolView = { show: /** @type {'all'|'free'|'in'} */ ('free') };

/** the data the pool was last drawn with: a filter click redraws it without asking the server */
let last = { cards: /** @type {any[]} */ ([]), sets: /** @type {any[]} */ ([]) };

/** @param {any[]} cards @param {'all'|'free'|'in'} show */
const pick = (cards, show) => (show === 'all' ? cards : show === 'in' ? cards.filter(c => c.setId) : cards.filter(c => !c.setId));

/** The thumbs of the pool, keyed by card. @param {any[]} cards @param {any[]} sets */
function items(cards, sets) {
  const shown = pick(cards, poolView.show);
  const numbers = new Map(sets.map(s => [s.id, s.number]));
  // cards with the same caption (a comparison of models, say) differ by the model that made them: say it under them
  const seen = new Map();
  for (const c of shown) seen.set(c.title, (seen.get(c.title) ?? 0) + 1);
  const note = (/** @type {any} */ c) => (c.setId ? t('where', { n: numbers.get(c.setId) ?? '?', slot: c.slot + 1 }) : seen.get(c.title) > 1 && c.model ? modelName(c.model) : '');
  return shown.map(c => ({ key: c.id, html: thumb(c, { drag: c.setId ? { setId: c.setId, slot: c.slot } : {}, note: note(c), selected: app.selection.has(c.id) }) }));
}

/** @param {any[]} cards */
function filterHtml(cards) {
  const n = { all: cards.length, free: pick(cards, 'free').length, in: pick(cards, 'in').length };
  return /** @type {const} */ (['all', 'free', 'in']).map(k => `<button type="button" data-pool="${k}" aria-pressed="${poolView.show === k}">${t(k)} <span class="n">${n[k]}</span></button>`).join('');
}

/** @param {any[]} cards @param {any[]} sets */
function bodyHtml(cards, sets) {
  const list = items(cards, sets);
  if (list.length) return `<div class="thumb-grid pool__grid">${keyed(list)}</div>`;
  return `<p class="pool__empty ink-2">${esc(!cards.length ? t('none') : poolView.show === 'in' ? t('noneInSets') : t('allPlaced'))}</p>`;
}

/** @param {any[]} cards  all cards of the collection @param {any[]} sets  its sets (for «Набор N · место M») */
export function poolHtml(cards, sets) {
  last = { cards, sets };
  const filter = filterHtml(cards);
  const body = bodyHtml(cards, sets);
  return `<aside class="pool" data-drop='{"pool":true}' aria-label="${esc(t('aria'))}">
    <div class="sec-head"><span class="sec-head__l"><span class="label">${esc(t('title'))}</span>${tip(t('tip'), { side: 'right' })}</span></div>
    <div class="seg pool__filter" role="group" aria-label="${esc(t('which'))}" data-pool-filter ${drawn(filter)}>${filter}</div>
    <button type="button" class="btn btn--secondary pool__make" data-make-cards>${I.plus}<span>${esc(t('make'))}</span></button>
    <div class="panel pool__body" data-pool-body ${drawn(body)}>${body}</div>
  </aside>`;
}

/** Redraws the pool in place: only the thumbs that changed. @param {HTMLElement} el  the screen @param {any[]} cards @param {any[]} sets */
export function poolUpdate(el, cards, sets) {
  last = { cards, sets };
  patchHtml(el.querySelector('[data-pool-filter]'), filterHtml(cards));
  const grid = el.querySelector('.pool__grid');
  const list = items(cards, sets);
  if (grid && list.length) patchList(grid, list);
  else patchHtml(el.querySelector('[data-pool-body]'), bodyHtml(cards, sets));
}

/**
 * The pool's own clicks: its filter and «Создать карточки». @param {HTMLElement} target @param {HTMLElement} el  the
 * screen @param {any} col @returns {boolean} handled
 */
export function poolClick(target, el, col) {
  const f = /** @type {HTMLElement|null} */ (target.closest('[data-pool]'));
  if (f) { poolView.show = /** @type {any} */ (f.dataset.pool); poolUpdate(el, last.cards, last.sets); return true; }
  if (target.closest('[data-make-cards]')) { openCreateCards(col); return true; }
  return false;
}

/**
 * ⌘/Ctrl-click on a card (a pool thumb or a window place) picks it for the export instead of opening it.
 * @param {MouseEvent} e @param {string} collectionId @returns {boolean} handled
 */
export function pickClick(e, collectionId) {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const card = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-card]'));
  if (!card) return false;
  e.preventDefault();
  app.selection.toggle(collectionId, /** @type {string} */ (card.dataset.card));
  return true;
}

/**
 * Marks the picked cards of a drawn screen and keeps them marked while it is shown: the pool's thumbs here, the
 * windows by the screen's `redraw` (their rings are drawn with them).
 * @param {HTMLElement} el @param {() => void} redraw
 */
export function bindPicked(el, redraw) {
  const mark = () => {
    for (const c of /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('.thumb[data-card]'))) c.setAttribute('aria-selected', String(app.selection.has(/** @type {string} */ (c.dataset.card))));
    redraw();
  };
  const off = app.selection.onChange(() => { if (el.isConnected) mark(); else off(); });
}

/** A count of cards in the page's language. @param {number} n */
export const cardsCount = n => `${n} ${plural(n, { ru: ['карточка', 'карточки', 'карточек'], en: ['card', 'cards'] })}`;
