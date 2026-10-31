// A set: its window (the window of its kind, in the template colour of the set), its places — a click opens the
// place's panel (stars, frame, caption; an empty place can be generated) —, cards dragged between places and from the
// pool, the set's variants switched like a card's versions, «Настройки набора» for the rest. The window's header row
// carries the screen's hint (hints.js). Live events redraw only what changed (patch.js), so an open place panel and a
// caption being typed stay as they are.
import { call, jobs } from '../api.js';
import { attempt, esc, I, jobline, tip, toast, verdict } from '../ui.js';
import { words } from '../i18n.js';
import { keepWhole, windowHtml, windowsOf } from '../window.js';
import { openSetSettings, PLACES } from '../panels/create.js';
import { app } from '../state.js';
import { bindPicked, pickClick, poolClick, poolHtml, poolUpdate } from './pool.js';
import { drawn, patchHtml } from './patch.js';
import { hintDone, setHint } from '../hints.js';
import { hintHtml, onHints } from '../hints-ui.js';

const t = words({
  ru: {
    collections: 'Коллекции', gone: 'Такого набора в коллекции нет: возможно, его удалили.', label: 'Набор {n} из {total}', theme: 'Тема: {theme}',
    byHand: 'Собран вручную · пустые места можно заполнить из хранилища или сгенерировать', settings: 'Настройки набора',
    make: 'Сделать карточки', finish: 'Доделать карточки', makeTitle: 'Сделать по плану набора карточки для пустых мест и для тех, что не получились',
    window: 'Окно · {n}/10', windowTip: 'Нажмите на место, чтобы настроить звёзды, рамку и подпись. Перетащите карточку, чтобы поменять местами или убрать в хранилище. ⌘ или Ctrl + щелчок — выбрать карточку для экспорта.',
    variant: 'Вариант {n}', of: 'из {total}', chosen: 'выбран', choose: 'Сделать выбранным', prev: 'Предыдущий вариант', next: 'Следующий вариант',
    variantsTip: 'Варианты — разные наборы на одну тему. В экспорт коллекции идёт выбранный.', aria: 'Окно набора',
    place: 'Место {n}', empty: 'пусто', close: 'Закрыть', stars: 'Звёзды', frame: 'Рамка', silver: 'Серебряная', gold: 'Золотая', crystal: 'Кристальная',
    crystalHint: 'Кристальная рамка — только у гранд-окна.', grandHint: 'В гранд-окне у каждого места пять звёзд и кристальная рамка.',
    caption: 'Подпись', captionHint: 'Пишется под картинкой в окне; это и название карточки.', captionLong: 'Длиннее 15 знаков: в окне может не поместиться.',
    open: 'Открыть карточку', toPool: 'Убрать в хранилище', emptyLead: 'Перетащите сюда карточку из хранилища — или сгенерируйте новую для этого места.',
    about: 'Что на карточке', aboutHint: 'Необязательно: без этого модель выберет предмет по теме набора.', aboutPh: 'Например, марсианская картошка фри',
    planned: 'По плану набора здесь — «{title}».', generate: 'Сгенерировать карточку', generating: 'Карточка для места {n} генерируется — она появится здесь сама.',
    scene: 'Здесь будет сцена с персонажами.', saved: 'Подпись сохранена.',
    frameTipAll: 'Золотая рамка — сцена с персонажами, серебряная — предмет. Так генерируется пустое место; у набора по плану — как в плане.',
    frameTipSome: 'Золотая рамка на местах {places} — сцена с персонажами; золото на других местах и серебро — предмет. Так генерируется пустое место; у набора по плану — как в плане.',
    frameTipNone: 'Рамка не меняет, что на карточке: пустое место генерируется предметом.',
  },
  en: {
    collections: 'Collections', gone: 'The collection has no such set: perhaps it was deleted.', label: 'Set {n} of {total}', theme: 'Theme: {theme}',
    byHand: 'Gathered by hand · fill empty places from the pool or generate them', settings: 'Set settings',
    make: 'Make the cards', finish: 'Finish the cards', makeTitle: 'Make by the set plan the cards of the empty places and those that failed',
    window: 'Window · {n}/10', windowTip: 'Click a place to set its stars, frame and caption. Drag a card to swap places or take it back to the pool. ⌘ or Ctrl + click picks a card for the export.',
    variant: 'Variant {n}', of: 'of {total}', chosen: 'chosen', choose: 'Make it the chosen one', prev: 'Previous variant', next: 'Next variant',
    variantsTip: 'Variants are different sets on one theme. The collection’s export takes the chosen one.', aria: 'Set window',
    place: 'Place {n}', empty: 'empty', close: 'Close', stars: 'Stars', frame: 'Frame', silver: 'Silver', gold: 'Gold', crystal: 'Crystal',
    crystalHint: 'Only the grand window has crystal frames.', grandHint: 'In the grand window every place has five stars and a crystal frame.',
    caption: 'Caption', captionHint: 'Printed under the picture in the window; it is also the card’s name.', captionLong: 'Longer than 15 characters: it may not fit in the window.',
    open: 'Open the card', toPool: 'Back to the pool', emptyLead: 'Drag a card here from the pool, or generate a new one for this place.',
    about: 'What the card shows', aboutHint: 'Optional: without it the model picks an item by the set’s theme.', aboutPh: 'For example, Martian potato fries',
    planned: 'The set plan puts «{title}» here.', generate: 'Generate a card', generating: 'The card for place {n} is being generated: it appears here by itself.',
    scene: 'A scene with characters goes here.', saved: 'Caption saved.',
    frameTipAll: 'A gold frame is a scene with characters, a silver one an item. An empty place is generated so; a planned set follows its plan.',
    frameTipSome: 'A gold frame on places {places} is a scene with characters; gold on other places and silver are items. An empty place is generated so; a planned set follows its plan.',
    frameTipNone: 'The frame does not change what the card shows: an empty place is generated as an item.',
  },
});

/** The caption length SETS.md asks for (3–15 characters); the person's word wins, the panel only warns. */
const CAPTION_MAX = 15;
/** Every frame kind of the style's sets (set-rules.json `frames`); the place panel greys out those its window lacks. */
const FRAMES = ['silver', 'gold', 'crystal'];

/** Everything the screen is drawn from. @param {string} collectionId @param {string} setId */
async function read(collectionId, setId) {
  const [{ collection: col, sets }, cards] = await Promise.all([call('getCollection', { collectionId }), call('listCards', { collectionId })]);
  const set = /** @type {any[]} */ (sets).find(s => s.id === setId);
  if (!set) throw new Error(t('gone'));
  const g = await windowsOf(col.style);
  const variants = /** @type {any[]} */ (sets).filter(s => (s.variantGroup ?? s.id) === (set.variantGroup ?? set.id));
  return { col, sets: /** @type {any[]} */ (sets), set, cards: /** @type {any[]} */ (cards), byId: new Map(cards.map((/** @type {any} */ c) => [c.id, c])), g, variants };
}
/** @typedef {Awaited<ReturnType<typeof read>>} Data */

/** @param {string} c @param {string} s */
const href = (c, s) => `#/c/${encodeURIComponent(c)}/s/${encodeURIComponent(s)}`;
/** @param {Data} d */
const madeOf = d => d.set.slots.filter((/** @type {string|null} */ c) => c && d.byId.get(c)?.status === 'made').length;
/** @param {Data} d */
const runningOf = d => [...jobs.values()].filter(j => j.status === 'running' && j.scope?.collectionId === d.col.id && (!j.scope.setId || j.scope.setId === d.set.id));

/** @param {Data} d */
function headHtml(d) {
  const { set, sets } = d;
  const total = Math.max(PLACES, ...sets.map(s => s.number ?? 0));
  const made = madeOf(d);
  const canMake = !!set.plan && made < 10 && !runningOf(d).length;
  const sub = set.plan ? (set.brief?.theme ? t('theme', { theme: set.brief.theme }) : '') : t('byHand');
  return `<div class="head2__main">
      <p class="label">${esc(t('label', { n: set.number ?? '', total }))}</p>
      <h1 class="type-headline-md">${esc(set.title)}</h1>
      ${sub ? `<p class="head__desc ink-2">${esc(sub)}</p>` : ''}
    </div>
    <div class="head2__actions">
      ${canMake ? `<button type="button" class="btn btn--secondary" data-make title="${esc(t('makeTitle'))}">${I.spark}<span>${esc(made ? t('finish') : t('make'))}</span></button>` : ''}
      <button type="button" class="btn btn--secondary" data-settings>${I.edit}<span>${esc(t('settings'))}</span></button>
    </div>`;
}

/** @param {Data} d */
function switchHtml(d) {
  const { variants, set } = d;
  if (variants.length < 2) return '';
  const i = variants.indexOf(set);
  const chosen = set.chosen === true;
  return `<div class="vswitch">
      <button type="button" class="btn btn--secondary btn--icon btn--s" data-variant="${i - 1}" aria-label="${esc(t('prev'))}" ${i === 0 ? 'disabled' : ''}>${I.back}</button>
      <span class="vswitch__text"><b>${esc(t('variant', { n: i + 1 }))}</b><span class="ink-3">${esc(t('of', { total: variants.length }))}</span>${chosen ? `<span class="vswitch__chosen">${I.check}${esc(t('chosen'))}</span>` : ''}</span>
      <button type="button" class="btn btn--secondary btn--icon btn--s" data-variant="${i + 1}" aria-label="${esc(t('next'))}" ${i === variants.length - 1 ? 'disabled' : ''}>${I.next}</button>
      ${chosen ? '' : `<button type="button" class="btn btn--secondary btn--s" data-choose>${esc(t('choose'))}</button>`}
      ${tip(t('variantsTip'), { side: 'right' })}
    </div>`;
}

/** What the set screen's hint depends on (hints.js setHint). @param {Data} d */
function hintFacts(d) {
  const inWindow = d.set.slots.map((/** @type {string|null} */ id) => (id ? d.byId.get(id) : null)).filter(Boolean);
  return {
    places: d.set.slots.length, filled: inWindow.length, made: madeOf(d),
    problems: inWindow.filter(c => verdict(c.checks, c.status).kind === 'fail').length,
    freeCards: d.cards.filter(c => !c.setId).length,
  };
}

/** @param {Data} d */
const secHtml = d => `<span class="sec-head__l"><span class="label">${esc(t('window', { n: madeOf(d) }))}</span>${tip(t('windowTip'))}</span>${switchHtml(d)}${hintHtml(setHint(hintFacts(d)))}`;

/** @param {Data} d @param {number|null} place */
const windowOf = (d, place) => windowHtml(d.g, {
  set: d.set, cards: d.byId, style: d.col.style, total: Math.max(PLACES, ...d.sets.map(s => s.number ?? 0)), drop: true, edit: true, selected: place,
  picked: id => app.selection.has(id),
});

/** The panel of one place: its stars and frame, and the card's caption, or how to fill it. @param {Data} d @param {number} i */
/** What a gold frame means on this window kind (core/set/places.js `goldScenes`). @param {{goldScenes: number[]}} choices @param {number} places  of the window */
function frameTip({ goldScenes }, places) {
  if (!goldScenes.length) return t('frameTipNone');
  return goldScenes.length === places ? t('frameTipAll') : t('frameTipSome', { places: goldScenes.join(', ') });
}

function popHtml(d, i) {
  const { set } = d;
  const p = set.shown.places[i];
  const choices = set.shown.choices;
  const id = set.slots[i];
  const c = id ? d.byId.get(id) : null;
  const stars = choices.stars
    ? `<div class="field"><span class="field__label">${esc(t('stars'))}</span><div class="stars" role="group" aria-label="${esc(t('stars'))}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-stars="${n}" class="${n <= p.stars ? 'is-on' : ''}" aria-label="${n}" aria-pressed="${n === p.stars}">${I.star}</button>`).join('')}</div></div>`
    : '';
  const frame = choices.frames.length > 1
    ? `<div class="field"><span class="field__label field__label--tip">${esc(t('frame'))}${tip(frameTip(choices, set.slots.length), { side: 'right' })}</span><div class="seg" role="group" aria-label="${esc(t('frame'))}">${FRAMES.map(k => `<button type="button" data-frame="${k}" aria-pressed="${p.frame === k}" ${choices.frames.includes(k) ? '' : 'disabled'}>${esc(t(/** @type {'silver'} */ (k)))}</button>`).join('')}</div>
      ${choices.frames.includes('crystal') ? '' : `<span class="field__hint">${esc(t('crystalHint'))}</span>`}</div>`
    : `<p class="lead">${esc(t('grandHint'))}</p>`;
  const busy = runningOf(d).some(j => j.op === 'fillPlace' && j.scope?.slot === i);
  const planned = set.shown.planned?.[i];
  const body = c
    ? `${stars}${frame}<label class="field"><span class="field__label">${esc(t('caption'))}</span><input class="input" data-caption value="${esc(c.title)}" maxlength="80">
        <span class="field__hint" data-caption-hint>${esc(c.title.length > CAPTION_MAX ? t('captionLong') : t('captionHint'))}</span></label>
        <div class="pop__acts"><button type="button" class="btn btn--secondary btn--s" data-card-open>${esc(t('open'))}</button><button type="button" class="btn btn--text btn--s" data-to-pool><span>${esc(t('toPool'))}</span></button></div>`
    : `<p class="lead">${esc(t('emptyLead'))}</p>
        ${planned ? `<p class="lead">${esc(t('planned', { title: planned }))}</p>` : `<label class="field"><span class="field__label">${esc(t('about'))}</span><input class="input" data-about placeholder="${esc(t('aboutPh'))}"><span class="field__hint">${esc(p.scene ? t('scene') : t('aboutHint'))}</span></label>`}
        ${stars}${frame}<div class="pop__acts"><button type="button" class="btn btn--primary btn--s" data-fill ${busy ? 'disabled' : ''}>${I.spark}<span>${esc(t('generate'))}</span></button></div>`;
  return `<div class="pop" data-pop="${i}" role="dialog" aria-label="${esc(t('place', { n: i + 1 }))}"><div class="pop__head"><h3>${esc(t('place', { n: i + 1 }))} · ${esc(c ? c.title : t('empty'))}</h3>
    <button type="button" class="btn btn--secondary btn--icon btn--s" data-pop-close aria-label="${esc(t('close'))}">${I.x}</button></div>${body}</div>`;
}

/** Puts the place panel beside its place, so the place and its neighbours stay visible: right of the three left columns,
 * left of the others; vertically centred on the place, inside the window. @param {HTMLElement} el */
function placePop(el) {
  const pop = /** @type {HTMLElement|null} */ (el.querySelector('[data-pop]'));
  if (!pop) return;
  const host = /** @type {HTMLElement} */ (pop.closest('.cols__main'));
  const i = Number(pop.dataset.pop);
  const slot = host.querySelector(`.window [data-slot="${i}"]`);
  const win = host.querySelector('.window');
  if (!slot || !win) return;
  const h = host.getBoundingClientRect(), r = slot.getBoundingClientRect(), w = win.getBoundingClientRect();
  const left = i % 5 < 3 ? r.right - h.left + 12 : r.left - h.left - pop.offsetWidth - 12;
  const top = Math.max(w.top - h.top, Math.min(r.top - h.top + r.height / 2 - pop.offsetHeight / 2, w.bottom - h.top - pop.offsetHeight));
  pop.style.left = `${Math.max(0, Math.min(left, h.width - pop.offsetWidth))}px`;
  pop.style.top = `${top}px`;
}

/** @param {string} collectionId @param {string} setId */
export async function load(collectionId, setId) {
  let d = await read(collectionId, setId);
  /** @type {HTMLElement|null} */
  let root = null;
  /** keeps the window whole on the screen (window.js keepWhole) */
  let fit = () => {};
  /** the place whose panel is open */
  let place = /** @type {number|null} */ (null);
  const head = headHtml(d), sec = secHtml(d), win = windowOf(d, null);
  const lines = runningOf(d).map(jobline).join('');

  /** Redraws what the open place changes: the window's selection and the panel. */
  const drawPlace = () => {
    if (!root) return;
    patchHtml(root.querySelector('[data-window]'), windowOf(d, place));
    const pop = root.querySelector('[data-pop-host]');
    const typing = pop?.contains(document.activeElement) && document.activeElement?.matches('input');
    if (!typing) patchHtml(pop, place == null ? '' : popHtml(d, place));
    placePop(root);
  };
  const refreshHere = async () => { d = await read(collectionId, setId); drawAll(); };
  const drawAll = () => {
    const el = root;
    if (!el) return;
    patchHtml(el.querySelector('[data-head]'), headHtml(d));
    patchHtml(el.querySelector('[data-joblines]'), runningOf(d).map(jobline).join(''));
    patchHtml(el.querySelector('[data-sec]'), secHtml(d));
    fit();
    drawPlace();
    poolUpdate(el, d.cards, d.sets);
  };
  /** @param {Record<string, unknown>} patch */
  const savePlace = async patch => { if (place == null) return; if (await attempt(() => call('setPlace', { collectionId, setId, slot: place, ...patch }))) await refreshHere(); };

  return {
    where: [{ label: t('collections'), href: '#/' }, { label: d.col.title, href: `#/c/${encodeURIComponent(collectionId)}` }, { label: d.set.title, href: href(collectionId, setId) }],
    html: `<header class="head2" data-head ${drawn(head)}>${head}</header>
      <div class="joblines" data-joblines ${drawn(lines)}>${lines}</div>
      <div class="cols">
        <section class="cols__main" aria-label="${esc(t('aria'))}">
          <div class="sec-head" data-sec ${drawn(sec)}>${sec}</div>
          <div class="window"><div class="window__stage" data-window ${drawn(win)}>${win}</div></div>
          <div data-pop-host ${drawn('')}></div>
        </section>
        ${poolHtml(d.cards, d.sets)}
      </div>`,
    mount: (/** @type {HTMLElement} */ el) => {
      root = el;
      fit = keepWhole(el, '.cols__main > .window');
      fit();
      bindPicked(el, drawPlace);
      onHints(el, () => { patchHtml(el.querySelector('[data-sec]'), secHtml(d)); fit(); });
      addEventListener('resize', () => { if (el.isConnected) placePop(el); });
      el.addEventListener('click', async e => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (pickClick(e, collectionId)) return;
        if (poolClick(target, el, d.col)) return;
        if (target.closest('[data-settings]')) { openSetSettings(d.col, d.set, d.variants, d.sets); return; }
        if (target.closest('[data-make]')) { if (await attempt(() => call('makeSet', { collectionId, setId }))) await refreshHere(); return; }
        const v = /** @type {HTMLElement|null} */ (target.closest('[data-variant]'));
        if (v) { const to = d.variants[Number(v.dataset.variant)]; if (to) app.go(href(collectionId, to.id)); return; }
        if (target.closest('[data-choose]')) {
          await attempt(async () => { for (const x of d.variants) await call('updateSet', { collectionId, setId: x.id, patch: { chosen: x.id === setId } }); });
          await refreshHere();
          return;
        }
        // the place panel
        if (target.closest('[data-pop-close]')) { place = null; drawPlace(); return; }
        const st = /** @type {HTMLElement|null} */ (target.closest('[data-stars]'));
        if (st) { await savePlace({ stars: Number(st.dataset.stars) }); return; }
        const fr = /** @type {HTMLElement|null} */ (target.closest('[data-frame]'));
        if (fr) { await savePlace({ frame: fr.dataset.frame }); return; }
        if (target.closest('[data-card-open]') && place != null) { app.openCard(collectionId, d.set.slots[place]); return; }
        if (target.closest('[data-to-pool]') && place != null) {
          const id = d.set.slots[place];
          if (id && await attempt(() => call('moveCard', { collectionId, cardId: id, pool: true }))) await refreshHere();
          return;
        }
        if (target.closest('[data-fill]') && place != null) {
          const about = /** @type {HTMLInputElement|null} */ (el.querySelector('[data-about]'))?.value.trim();
          const n = place;
          if (await attempt(() => call('fillPlace', { collectionId, setId, slot: n, ...(about ? { about } : {}) }))) { toast(t('generating', { n: n + 1 })); await refreshHere(); }
          return;
        }
        const slot = /** @type {HTMLElement|null} */ (target.closest('.window [data-slot]'));
        if (slot) {
          const i = Number(slot.dataset.slot);
          place = place === i ? null : i;
          // the first click on a card in the window: the hint that says what it opens is done
          if (d.set.slots[i]) hintDone('set.place');
          drawPlace();
          return;
        }
        const card = /** @type {HTMLElement|null} */ (target.closest('.pool [data-card]'));
        if (card) app.openCard(collectionId, /** @type {string} */ (card.dataset.card));
      });
      // the caption: saved on Enter or when the field is left
      el.addEventListener('input', e => {
        const f = /** @type {HTMLInputElement} */ (e.target);
        if (f.matches('[data-caption]')) /** @type {HTMLElement} */ (el.querySelector('[data-caption-hint]')).textContent = f.value.trim().length > CAPTION_MAX ? t('captionLong') : t('captionHint');
      });
      el.addEventListener('change', async e => {
        const f = /** @type {HTMLInputElement} */ (e.target);
        if (!f.matches('[data-caption]') || place == null) return;
        const id = d.set.slots[place];
        const title = f.value.trim();
        if (!id || title === d.byId.get(id)?.title) return;
        if (await attempt(() => call('setCardTitle', { collectionId, cardId: id, title }))) { toast(t('saved'), { kind: 'done' }); f.blur(); await refreshHere(); }
      });
      el.addEventListener('keydown', e => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.matches('[data-caption]') && e.key === 'Enter') { e.preventDefault(); target.blur(); return; }
        if (e.key === 'Escape' && place != null) { place = null; drawPlace(); return; }
        const slot = /** @type {HTMLElement|null} */ (target.closest('.window [data-slot]'));
        if (slot && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); slot.click(); return; }
        const card = /** @type {HTMLElement|null} */ (target.closest('.pool [data-card]'));
        if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); app.openCard(collectionId, /** @type {string} */ (card.dataset.card)); }
      });
    },
    affects: (/** @type {any} */ e) => e.collectionId === collectionId,
    update: async () => {
      if (!root?.isConnected) return false;
      try { d = await read(collectionId, setId); } catch { return false; }
      drawAll();
      return true;
    },
  };
}
