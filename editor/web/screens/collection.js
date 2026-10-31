// A collection: what it is (its description sheet holds the fields, the cover and deleting), its sets shown in their
// windows (one per variant group) with a tile to create one more, and the card pool («Хранилище») — cards are dragged
// from the pool into set places and back. Live events redraw only what changed (patch.js).
import { call, jobs } from '../api.js';
import { esc, I, jobline, tip } from '../ui.js';
import { plural, words } from '../i18n.js';
import { windowHtml, windowsOf } from '../window.js';
import { openCreateSet, openBuildCollection, openEditCollection, PLACES } from '../panels/create.js';
import { app } from '../state.js';
import { bindPicked, pickClick, poolClick, poolHtml, poolUpdate } from './pool.js';
import { drawn, keyed, patchHtml, patchList } from './patch.js';

const t = words({
  ru: {
    collections: 'Коллекции', desc: 'Описание', createSet: 'Создать набор', buildAll: 'Сгенерировать все {n} наборов', buildRest: 'Сгенерировать все наборы',
    noDesc: 'Описания пока нет: расскажите, что это за коллекция.', sets: 'Наборы · {n}',
    setsTip: 'Набор — 10 карточек в окне. В коллекции {n} мест для наборов. Нажмите на окно, чтобы открыть набор.',
    noSets: 'Наборов пока нет', noSetsText: 'Набор — 10 карточек в окне. Сгенерируйте его по теме или соберите сами из карточек хранилища.',
    newTile: 'Сгенерируйте набор по теме или соберите сами из хранилища.', aria: 'Наборы',
  },
  en: {
    collections: 'Collections', desc: 'Description', createSet: 'Create a set', buildAll: 'Generate all {n} sets', buildRest: 'Generate all sets',
    noDesc: 'No description yet: tell what this collection is.', sets: 'Sets · {n}',
    setsTip: 'A set is 10 cards in a window. A collection has {n} places for sets. Click a window to open its set.',
    noSets: 'No sets yet', noSetsText: 'A set is 10 cards in a window. Generate one on a theme, or gather it yourself from the pool’s cards.',
    newTile: 'Generate a set on a theme, or gather one yourself from the pool.', aria: 'Sets',
  },
});

/** @param {number} n */
const variantsCount = n => `${n} ${plural(n, { ru: ['вариант', 'варианта', 'вариантов'], en: ['variant', 'variants'] })}`;

/** Everything the screen is drawn from. @param {string} id */
async function read(id) {
  const [{ collection: col, sets }, cards] = await Promise.all([call('getCollection', { collectionId: id }), call('listCards', { collectionId: id })]);
  return { col, sets: /** @type {any[]} */ (sets), cards: /** @type {any[]} */ (cards), g: await windowsOf(col.style) };
}

/** @typedef {Awaited<ReturnType<typeof read>>} Data */

/** places of the collection its sets hold (variants of a set share its number) @param {any[]} sets */
const placesHeld = sets => new Set(sets.map(s => s.number).filter(n => n >= 1 && n <= PLACES)).size;

/** @param {Data} d */
function headHtml({ col, sets }) {
  const fields = Object.entries(col.fields ?? {}).filter(([, v]) => v !== '' && v != null);
  return `<div class="head2__main">
      <h1 class="type-headline-md">${esc(col.title)}</h1>
      ${col.description ? `<p class="head__desc type-body-lg ink-2">${esc(col.description)}</p>` : `<p class="head__desc ink-3">${esc(t('noDesc'))}</p>`}
      ${fields.length ? `<dl class="fields">${fields.map(([k, v]) => `<div><dt class="label">${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    </div>
    <div class="head2__actions">
      <button type="button" class="btn btn--secondary" data-edit>${I.edit}<span>${esc(t('desc'))}</span></button>
      <button type="button" class="btn btn--secondary" data-create-set>${I.plus}<span>${esc(t('createSet'))}</span></button>
      <button type="button" class="btn btn--secondary" data-build>${I.spark}<span>${esc(sets.length ? t('buildRest') : t('buildAll', { n: PLACES }))}</span></button>
    </div>`;
}

/** @param {string} id */
const joblinesHtml = id => [...jobs.values()].filter(j => j.status === 'running' && j.scope?.collectionId === id).map(jobline).join('');

/** One tile per variant group: the chosen variant, else the first; the others are compared on the set screen. @param {Data} d */
function tiles({ col, sets, cards, g }) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const total = Math.max(PLACES, ...sets.map(s => s.number ?? 0));
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const s of sets) groups.set(s.variantGroup ?? s.id, [...(groups.get(s.variantGroup ?? s.id) ?? []), s]);
  const list = [...groups.entries()].map(([key, vs]) => {
    const s = vs.find(v => v.chosen) ?? vs[0];
    const filled = s.slots.filter((/** @type {string|null} */ c) => c && byId.get(c)?.status === 'made').length;
    const href = `#/c/${encodeURIComponent(col.id)}/s/${encodeURIComponent(s.id)}`;
    return {
      key,
      html: `<article class="setcard">
      <div class="window window--compact" data-open-set="${esc(href)}"><div class="window__stage">${windowHtml(g, { set: s, cards: byId, total, drop: true, style: col.style, picked: id => app.selection.has(id) })}</div></div>
      <a class="setcard__head" href="${href}"><span class="data ink-3">${String(s.number ?? '').padStart(2, '0')}</span><span class="setcard__title">${esc(s.title)}</span>${vs.length > 1 ? `<span class="ink-3">${esc(variantsCount(vs.length))}</span>` : ''}<span class="setcard__meta data ink-3">${filled}/10</span></a>
    </article>`,
    };
  });
  list.push({
    key: 'new',
    html: `<article class="setcard"><div class="window window--compact"><div class="window__stage newtile" style="aspect-ratio:${g.size.width}/${g.size.height}">
      <span class="state__icon">${I.plus}</span><p>${esc(t('newTile'))}</p>
      <button type="button" class="btn btn--primary" data-create-set>${I.plus}<span>${esc(t('createSet'))}</span></button></div></div></article>`,
  });
  return list;
}

/** @param {Data} d */
function mainHtml(d) {
  const groups = new Set(d.sets.map(s => s.variantGroup ?? s.id)).size;
  const head = `<div class="sec-head"><span class="sec-head__l"><span class="label">${esc(t('sets', { n: groups }))}</span>${tip(t('setsTip', { n: PLACES }))}</span></div>`;
  if (!d.sets.length) {
    return `${head}<div class="panel empty-sets"><div class="state"><span class="state__icon">${I.spark}</span><h3 class="type-headline-sm">${esc(t('noSets'))}</h3>
      <p>${esc(t('noSetsText'))}</p>
      <button type="button" class="btn btn--primary" data-create-set>${I.plus}<span>${esc(t('createSet'))}</span></button></div></div>`;
  }
  return `${head}<div class="setgrid setgrid--tiles">${keyed(tiles(d))}</div>`;
}

/** @param {string} id */
export async function load(id) {
  let d = await read(id);
  /** @type {HTMLElement|null} */
  let root = null;
  const head = headHtml(d), lines = joblinesHtml(id), main = mainHtml(d);
  return {
    where: [{ label: t('collections'), href: '#/' }, { label: d.col.title, href: `#/c/${encodeURIComponent(id)}` }],
    html: `<header class="head2" data-head ${drawn(head)}>${head}</header>
      <div class="joblines" data-joblines ${drawn(lines)}>${lines}</div>
      <div class="cols"><section class="cols__main" aria-label="${esc(t('aria'))}" data-main ${drawn(main)}>${main}</section>${poolHtml(d.cards, d.sets)}</div>`,
    mount: (/** @type {HTMLElement} */ el) => {
      root = el;
      bindPicked(el, () => patchList(el.querySelector('.setgrid--tiles'), tiles(d)));
      el.addEventListener('click', e => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (pickClick(e, id)) return;
        if (poolClick(target, el, d.col)) return;
        if (target.closest('[data-edit]')) { openEditCollection(d.col, d.cards, d.sets); return; }
        if (target.closest('[data-create-set]')) { openCreateSet(d.col, d.sets); return; }
        if (target.closest('[data-build]')) { openBuildCollection(d.col, placesHeld(d.sets)); return; }
        const card = /** @type {HTMLElement|null} */ (target.closest('.pool [data-card]'));
        if (card) { app.openCard(id, /** @type {string} */ (card.dataset.card)); return; }
        const win = /** @type {HTMLElement|null} */ (target.closest('[data-open-set]'));
        if (win) location.hash = /** @type {string} */ (win.dataset.openSet);
      });
      el.addEventListener('keydown', e => {
        const card = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.pool [data-card]'));
        if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); app.openCard(id, /** @type {string} */ (card.dataset.card)); }
      });
    },
    affects: (/** @type {any} */ e) => e.collectionId === id,
    update: async () => {
      const el = root;
      if (!el?.isConnected) return false;
      d = await read(id);
      patchHtml(el.querySelector('[data-head]'), headHtml(d));
      patchHtml(el.querySelector('[data-joblines]'), joblinesHtml(id));
      const grid = el.querySelector('.setgrid--tiles');
      if (grid && d.sets.length) patchList(grid, tiles(d));
      else patchHtml(el.querySelector('[data-main]'), mainHtml(d));
      poolUpdate(el, d.cards, d.sets);
      return true;
    },
  };
}
