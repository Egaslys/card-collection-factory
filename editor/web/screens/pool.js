// The collection's card pool («Хранилище») beside a collection or a set: cards in no set (or all of them), dragged
// into set slots; a card dropped on the pool leaves its set. «Создать карточки» makes loose cards into it.
import { esc, I, modelName, thumb } from '../ui.js';
import { openCreateCards } from '../panels/create.js';

/** whether the pool shows every card or only those in no set (kept between redraws and screens) */
export const poolView = { all: false };

/** Opens «Создать карточки» when the click was on its button. @param {HTMLElement} target @param {any} col */
export function poolClick(target, col) {
  if (!target.closest('[data-make-cards]')) return false;
  openCreateCards(col);
  return true;
}

/** @param {any[]} cards  all cards of the collection */
export function poolHtml(cards) {
  const shown = poolView.all ? cards : cards.filter(c => !c.setId);
  // cards with the same caption (a comparison of models, say) differ by the model that made them: say it under them
  const seen = new Map();
  for (const c of shown) seen.set(c.title, (seen.get(c.title) ?? 0) + 1);
  const note = (/** @type {any} */ c) => (seen.get(c.title) > 1 && c.model ? modelName(c.model) : '');
  return `<aside class="pool" data-drop='{"pool":true}' aria-label="Хранилище карточек">
    <div class="sec-head"><span class="label">Хранилище · ${shown.length}</span>
      <div class="seg" role="group" aria-label="Какие карточки"><button type="button" data-pool="free" aria-pressed="${!poolView.all}">Вне наборов</button><button type="button" data-pool="all" aria-pressed="${poolView.all}">Все</button></div></div>
    <button type="button" class="btn btn--secondary pool__make" data-make-cards>${I.plus}<span>Создать карточки</span></button>
    <div class="panel pool__body">${shown.length ? `<div class="thumb-grid pool__grid">${shown.map(c => thumb(c, { drag: c.setId ? { setId: c.setId, slot: c.slot } : {}, note: note(c) })).join('')}</div>`
      : `<p class="pool__empty ink-2">${esc(cards.length ? 'Все карточки разложены по наборам. Перетащите сюда карточку из окна, чтобы убрать её из набора.' : 'Карточек пока нет: они появятся, когда наборы будут собраны, или создайте их по теме.')}</p>`}</div>
  </aside>`;
}
