// The first screen: the collections, each with its cover, what it is and how much is in it.
import { call } from '../api.js';
import { count, esc, I } from '../ui.js';
import { openCreateCollection } from '../panels/create.js';

export async function load() {
  const list = /** @type {any[]} */ (await call('listCollections'));
  const tiles = list.map(c => `<a class="ctile panel" href="#/c/${encodeURIComponent(c.id)}">
      <span class="ctile__cover">${c.coverUrl ? `<img src="${esc(c.coverUrl)}" alt="" width="430" height="480" decoding="async">` : `<span class="ctile__empty">${I.image}</span>`}</span>
      <span class="ctile__text">
        <span class="type-headline-sm ctile__title">${esc(c.title)}</span>
        ${c.description ? `<span class="ctile__desc ink-2">${esc(c.description)}</span>` : ''}
        <span class="ctile__meta data ink-3">${count(c.setCount, 'набор', 'набора', 'наборов')} · ${count(c.cardCount, 'карточка', 'карточки', 'карточек')}</span>
      </span>
    </a>`).join('');
  const empty = `<div class="state panel"><span class="state__icon">${I.image}</span><h3 class="type-headline-sm">Коллекций пока нет</h3>
    <p>Коллекция — это 16 наборов по 10 карточек на одну большую тему. Начните с описания: о чём она.</p>
    <button type="button" class="btn btn--secondary" data-create>${I.plus}Новая коллекция</button></div>`;
  return {
    where: [{ label: 'Коллекции', href: '#/' }],
    primary: { label: 'Новая коллекция', icon: I.plus, run: openCreateCollection },
    html: `<header class="head"><h1 class="type-headline-md">Коллекции</h1></header>${list.length ? `<div class="ctiles">${tiles}</div>` : empty}`,
    mount: (/** @type {HTMLElement} */ el) => el.querySelector('[data-create]')?.addEventListener('click', openCreateCollection),
    affects: () => true,
  };
}
