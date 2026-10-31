// The first screen: the collections, each with its cover, what it is and how much is in it; «Новая коллекция» next to
// the title; above them the setup card when the service key or Codex is not ready (hints.js).
import { call } from '../api.js';
import { esc, I } from '../ui.js';
import { plural, words } from '../i18n.js';
import { openCreateCollection } from '../panels/create.js';
import { cardsCount } from './pool.js';
import { drawn, keyed, patchHtml, patchList } from './patch.js';
import { app } from '../state.js';
import { setupHints } from '../hints.js';
import { onHints, setupHtml } from '../hints-ui.js';

const t = words({
  ru: {
    title: 'Коллекции', create: 'Новая коллекция', none: 'Начните с первой коллекции',
    noneText: 'Коллекция — это 16 наборов по 10 карточек на одну большую тему. Для начала хватит названия.',
  },
  en: {
    title: 'Collections', create: 'New collection', none: 'Start with your first collection',
    noneText: 'A collection is 16 sets of 10 cards on one big theme. A title is enough to begin.',
  },
});

/** @param {number} n */
const setsCount = n => `${n} ${plural(n, { ru: ['набор', 'набора', 'наборов'], en: ['set', 'sets'] })}`;

/** @param {any[]} list */
const tiles = list => list.map(c => ({
  key: c.id,
  html: `<a class="ctile panel" href="#/c/${encodeURIComponent(c.id)}">
      <span class="ctile__cover">${c.coverUrl ? `<img src="${esc(c.coverUrl)}" alt="" width="430" height="480" decoding="async">` : `<span class="ctile__empty">${I.image}</span>`}</span>
      <span class="ctile__text">
        <span class="type-headline-sm ctile__title">${esc(c.title)}</span>
        ${c.description ? `<span class="ctile__desc ink-2">${esc(c.description)}</span>` : ''}
        <span class="ctile__meta data ink-3">${setsCount(c.setCount)} · ${cardsCount(c.cardCount)}</span>
      </span>
    </a>`,
}));

const empty = () => `<div class="state panel"><span class="state__icon">${I.image}</span><h3 class="type-headline-sm">${esc(t('none'))}</h3>
    <p>${esc(t('noneText'))}</p>
    <button type="button" class="btn btn--secondary" data-create>${I.plus}<span>${esc(t('create'))}</span></button></div>`;

/** The setup card: what is not ready yet (the key, Codex). */
const setup = () => setupHtml(setupHints({ key: app.key.source, codex: app.codex }), app.codex);

/** @param {any[]} list */
const bodyHtml = list => (list.length ? `<div class="ctiles">${keyed(tiles(list))}</div>` : empty());

export async function load() {
  const list = /** @type {any[]} */ (await call('listCollections'));
  const body = bodyHtml(list);
  const top = setup();
  /** @type {HTMLElement|null} */
  let root = null;
  return {
    where: [{ label: t('title'), href: '#/' }],
    html: `<header class="head2"><div class="titlerow"><h1 class="type-headline-md">${esc(t('title'))}</h1>
        <button type="button" class="btn btn--primary" data-create>${I.plus}<span>${esc(t('create'))}</span></button></div></header>
      <div data-setup ${drawn(top)}>${top}</div>
      <div data-body ${drawn(body)}>${body}</div>`,
    mount: (/** @type {HTMLElement} */ el) => {
      root = el;
      onHints(el, () => patchHtml(el.querySelector('[data-setup]'), setup()));
      el.addEventListener('click', e => { if (/** @type {HTMLElement} */ (e.target).closest('[data-create]')) openCreateCollection(); });
    },
    affects: () => true,
    update: async () => {
      const el = root;
      if (!el) return false;
      const fresh = /** @type {any[]} */ (await call('listCollections'));
      const grid = el.querySelector('.ctiles');
      if (grid && fresh.length) patchList(grid, tiles(fresh));
      else patchHtml(el.querySelector('[data-body]'), bodyHtml(fresh));
      return true;
    },
  };
}
