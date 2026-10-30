// The collection's card pool («Хранилище») beside a collection or a set: cards in no set (or all of them), dragged
// into set slots; a card dropped on the pool leaves its set.
import { esc, thumb } from '../ui.js';

/** whether the pool shows every card or only those in no set (kept between redraws and screens) */
export const poolView = { all: false };

/** @param {any[]} cards  all cards of the collection */
export function poolHtml(cards) {
  const shown = poolView.all ? cards : cards.filter(c => !c.setId);
  return `<aside class="pool" data-drop='{"pool":true}' aria-label="Хранилище карточек">
    <div class="sec-head"><span class="label">Хранилище · ${shown.length}</span>
      <div class="seg" role="group" aria-label="Какие карточки"><button type="button" data-pool="free" aria-pressed="${!poolView.all}">Вне наборов</button><button type="button" data-pool="all" aria-pressed="${poolView.all}">Все</button></div></div>
    <div class="panel pool__body">${shown.length ? `<div class="thumb-grid pool__grid">${shown.map(c => thumb(c, { drag: c.setId ? { setId: c.setId, slot: c.slot } : {} })).join('')}</div>`
      : `<p class="pool__empty ink-2">${esc(cards.length ? 'Все карточки разложены по наборам. Перетащите сюда карточку из окна, чтобы убрать её из набора.' : 'Карточек пока нет: они появятся, когда наборы будут собраны.')}</p>`}</div>
  </aside>`;
}
