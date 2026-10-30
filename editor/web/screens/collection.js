// A collection: what it is (description and fields, editable), its sets shown in their windows, and the card pool
// («Хранилище») — cards are dragged from the pool into set slots and back.
import { call, jobs } from '../api.js';
import { count, esc, I, jobline } from '../ui.js';
import { windowHtml, windowsOf } from '../window.js';
import { openCreateSet, openBuildCollection, openEditCollection, PLACES } from '../panels/create.js';
import { openExport } from '../panels/export.js';
import { app } from '../state.js';
import { poolClick, poolHtml, poolView } from './pool.js';

/** @param {string} id */
export async function load(id) {
  const [{ collection: col, sets }, cards] = await Promise.all([call('getCollection', { collectionId: id }), call('listCards', { collectionId: id })]);
  const g = await windowsOf(col.style);
  const byId = new Map(cards.map((/** @type {any} */ c) => [c.id, c]));
  const total = Math.max(PLACES, ...sets.map((/** @type {any} */ s) => s.number ?? 0));
  // places of the collection its sets hold (variants of a set share its number): «Собрать все наборы» offers the
  // missing ones, or one more variant of every place even when all are taken
  const places = new Set(sets.map((/** @type {any} */ s) => s.number).filter((/** @type {number} */ n) => n >= 1 && n <= PLACES)).size;

  // one window per variant group: the chosen variant, else the first; the others are compared on the set screen
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const s of sets) groups.set(s.variantGroup ?? s.id, [...(groups.get(s.variantGroup ?? s.id) ?? []), s]);
  const shown = [...groups.values()].map(vs => ({ set: vs.find(v => v.chosen) ?? vs[0], variants: vs.length }));

  const running = [...jobs.values()].filter(j => j.status === 'running' && j.scope?.collectionId === id);
  const progress = running.map(jobline).join('');

  const setTiles = shown.map(({ set: s, variants }) => {
    const filled = s.slots.filter((/** @type {string|null} */ c) => c && byId.get(c)?.status === 'made').length;
    const href = `#/c/${encodeURIComponent(id)}/s/${encodeURIComponent(s.id)}`;
    return `<article class="setcard">
      <div class="window window--compact"><div class="window__stage">${windowHtml(g, { set: s, cards: byId, total, drop: true, style: col.style, caption: true })}</div></div>
      <a class="setcard__head" href="${href}"><span class="data ink-3">${String(s.number ?? '').padStart(2, '0')}</span><span class="setcard__title">${esc(s.title)}</span>${variants > 1 ? `<span class="ink-3">${count(variants, 'вариант', 'варианта', 'вариантов')}</span>` : ''}<span class="setcard__meta data ink-3">${filled}/10</span></a>
    </article>`;
  }).join('');

  const pool = poolHtml(cards);

  const fields = Object.entries(col.fields ?? {}).filter(([, v]) => v !== '' && v != null);
  const head = `<header class="head head--collection">
    <div class="head__main">
      <h1 class="type-headline-md">${esc(col.title)}</h1>
      ${col.description ? `<p class="head__desc type-body-lg ink-2">${esc(col.description)}</p>` : '<p class="head__desc ink-3">Описания пока нет: расскажите, что это за коллекция.</p>'}
      ${fields.length ? `<dl class="fields">${fields.map(([k, v]) => `<div><dt class="label">${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    </div>
    <div class="head__actions">
      <button type="button" class="btn btn--secondary" data-edit>${I.edit}<span>Описание</span></button>
      <button type="button" class="btn btn--secondary" data-build>${I.spark}<span>Собрать все наборы</span></button>
      <button type="button" class="btn btn--secondary" data-export ${cards.length ? '' : 'disabled'}>${I.download}<span>Экспорт</span></button>
    </div>
  </header>`;

  const emptySets = `<div class="state panel"><span class="state__icon">${I.spark}</span><h3 class="type-headline-sm">Наборов пока нет</h3>
    <p>Соберите набор по теме и пожеланиям — или всю коллекцию из 16 наборов одной кнопкой.</p>
    <div class="row"><button type="button" class="btn btn--secondary" data-build>${I.spark}Собрать все 16 наборов</button></div></div>`;

  // while the first set is being planned: the shape of what is coming
  const skeleton = `<div class="setgrid"><article class="setcard"><div class="window window--compact"><div class="skeleton" style="aspect-ratio:${g.size.width}/${g.size.height}"></div></div></article></div>`;

  return {
    where: [{ label: 'Коллекции', href: '#/' }, { label: col.title, href: `#/c/${encodeURIComponent(id)}` }],
    primary: { label: 'Создать набор', icon: I.plus, run: () => openCreateSet(col) },
    html: `${head}${progress ? `<div class="joblines">${progress}</div>` : ''}<div class="cols">
      <section class="cols__main" aria-label="Наборы"><div class="sec-head"><span class="label">Наборы · ${shown.length}</span></div>${sets.length ? `<div class="setgrid">${setTiles}</div>` : running.length ? skeleton : emptySets}</section>
      ${pool}</div>`,
    mount: (/** @type {HTMLElement} */ el) => {
      el.addEventListener('click', e => {
        const t = /** @type {HTMLElement} */ (e.target);
        const pick = /** @type {HTMLElement|null} */ (t.closest('[data-pool]'));
        if (pick) { poolView.all = pick.dataset.pool === 'all'; app.refresh(); return; }
        if (poolClick(t, col)) return;
        if (t.closest('[data-edit]')) { openEditCollection(col); return; }
        if (t.closest('[data-build]')) { openBuildCollection(col, places); return; }
        if (t.closest('[data-export]')) { openExport({ collection: col, sets }); return; }
        const card = /** @type {HTMLElement|null} */ (t.closest('[data-card]'));
        if (card) { openCard(id, /** @type {string} */ (card.dataset.card)); return; }
        const win = t.closest('.setcard .window');
        if (win) { const a = /** @type {HTMLAnchorElement|null} */ (win.closest('.setcard')?.querySelector('.setcard__head') ?? null); if (a) location.hash = a.hash; }
      });
      el.addEventListener('keydown', e => {
        const card = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-card]'));
        if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCard(id, /** @type {string} */ (card.dataset.card)); }
      });
    },
    affects: (/** @type {any} */ e) => e.collectionId === id,
  };
}

/** @param {string} collectionId @param {string} cardId */
const openCard = (collectionId, cardId) => app.openCard(collectionId, cardId);
