// The editor's page: the top bar (export on the left; on the right what has been spent, the key, the generation under
// way, theme, language and settings), the breadcrumbs above the screen, the router over the nesting collections →
// collection → set (the card opens as a panel over the screen), and live updates: whatever an agent or another window
// writes appears here by itself. Screens draw their own title and its actions; the bar has no green button.
import { loadDesign } from '/design-system/tokens.js';
import { call, connect, jobs, onEvent } from './api.js';
import { LANGS, lang, setLang, words } from './i18n.js';
import { attempt, closeSheet, enableDrag, esc, fromHtml, I, jobline, jobTitle, setTheme, SPENT_EVENT, toast, usd } from './ui.js';
import * as collections from './screens/collections.js';
import * as collection from './screens/collection.js';
import * as setScreen from './screens/set.js';
import { openSettings } from './panels/settings.js';
import { openJobs } from './panels/jobs.js';
import { openCard } from './panels/card.js';
import { openExport } from './panels/export.js';
import { app } from './state.js';

const t = words({
  ru: {
    app: 'Фабрика карточек', collections: 'Коллекции', failedOpen: 'Не получилось открыть', toCollections: 'К коллекциям', where: 'Где вы',
    export: 'Экспорт', settings: 'Настройки', theme: 'Тема', light: 'Светлая тема', dark: 'Тёмная тема', language: 'Язык',
    spent: 'Потрачено', spentFactory: 'Потрачено всей фабрикой', spentCollection: 'Потрачено на эту коллекцию', images: 'Картинки', text: 'Текст',
    vision: 'Взгляд модели', unknown: 'Ещё {n} — цена неизвестна',
    offline: 'Редактор не отвечает', noKey: 'Нет ключа', tempKey: 'Временный ключ', key: 'Ключ',
    offlineTip: 'Редактор не отвечает: возможно, его остановили. Запустите его снова — страница подключится сама.',
    noKeyTip: 'Нет ключа сервиса ({envVar}): генерация через сервис, план набора и взгляд на карточки не работают. Нажмите, чтобы ввести ключ.',
    tempKeyTip: 'Временный ключ ({envVar}): живёт, пока запущен редактор. Нажмите, чтобы открыть настройки сервиса.',
    keyTip: 'Постоянный ключ из файла .env ({envVar}). Нажмите, чтобы открыть настройки сервиса.',
    generation: 'Генерация', generationN: 'Генерация: {n}', queue: 'Очередь генерации',
    done: 'Готово: {title}', doneWarn: 'Готово с оговорками: {title}. {warning}', failed: 'Не получилось: {title}. {error}', cancelled: 'Остановлено: {title}',
    details: 'Подробности', stopped: 'Редактор выключен', stoppedText: 'Чтобы продолжить, запустите фабрику снова (файл запуска или node editor/server.mjs) — страница подключится сама.',
  },
  en: {
    app: 'Card Factory', collections: 'Collections', failedOpen: 'Could not open this', toCollections: 'To collections', where: 'You are here',
    export: 'Export', settings: 'Settings', theme: 'Theme', light: 'Light theme', dark: 'Dark theme', language: 'Language',
    spent: 'Spent', spentFactory: 'Spent by the whole factory', spentCollection: 'Spent on this collection', images: 'Pictures', text: 'Text',
    vision: 'Model’s look', unknown: '{n} more — price unknown',
    offline: 'Editor not responding', noKey: 'No key', tempKey: 'Temporary key', key: 'Key',
    offlineTip: 'The editor is not responding: it may have been stopped. Start it again and the page reconnects by itself.',
    noKeyTip: 'No service key ({envVar}): generating through the service, set plans and the model’s look do not work. Click to enter a key.',
    tempKeyTip: 'Temporary key ({envVar}): lives while the editor runs. Click to open the service settings.',
    keyTip: 'Permanent key from the .env file ({envVar}). Click to open the service settings.',
    generation: 'Generation', generationN: 'Generation: {n}', queue: 'Generation queue',
    done: 'Done: {title}', doneWarn: 'Done with remarks: {title}. {warning}', failed: 'Did not work: {title}. {error}', cancelled: 'Stopped: {title}',
    details: 'Details', stopped: 'The editor is off', stoppedText: 'To go on, start the factory again (its launcher or node editor/server.mjs) — the page reconnects by itself.',
  },
});

await loadDesign();

const appEl = /** @type {HTMLElement} */ (document.getElementById('app'));

/**
 * What a screen gives the shell.
 * @typedef {object} Screen
 * @property {{label: string, href?: string}[]} where  the breadcrumbs, the last one being the screen itself (no link)
 * @property {string} html  the screen with its own title and the actions next to it
 * @property {(el: HTMLElement) => void} [mount]
 * @property {(e: any) => boolean} [affects]  a live event that changes this screen
 * @property {(e: any) => Promise<boolean>} [update]  applies such an event in place; false (or a throw) = draw it anew
 */

Object.assign(app, { go, refresh, openCard });

/** @param {string} hash */
function go(hash) { if (location.hash !== hash) location.hash = hash; else refresh(); }

let seq = 0;
/** Loads and draws the screen of the current address; keeps the scroll position when it is the same screen. */
async function refresh() {
  const my = ++seq;
  const route = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const same = route.join('/') === app.route.join('/');
  app.route = route;
  if (app.selection.collectionId && app.selection.collectionId !== (route[0] === 'c' ? route[1] : null)) app.selection.clear();
  /** @type {Screen} */
  let screen;
  try {
    if (route[0] === 'c' && route[1] && route[2] === 's' && route[3]) screen = await setScreen.load(route[1], route[3]);
    else if (route[0] === 'c' && route[1]) screen = await collection.load(route[1]);
    else screen = await collections.load();
  } catch (/** @type {any} */ e) {
    screen = {
      where: [{ label: t('collections'), href: '#/' }, { label: t('failedOpen') }],
      html: `<div class="state state--error"><span class="state__icon">${I.alert}</span><h3 class="type-headline-sm">${esc(t('failedOpen'))}</h3><p>${esc(e?.message ?? e)}</p><a class="btn btn--secondary" href="#/">${esc(t('toCollections'))}</a></div>`,
    };
  }
  if (my !== seq) return;
  const y = scrollY;
  app.screen = screen;
  document.title = screen.where.length > 1 ? `${screen.where.at(-1)?.label} — ${t('app')}` : t('app');
  appEl.innerHTML = `${topbar()}<main class="screen">${crumbs(screen.where)}${screen.html}</main>`;
  screen.mount?.(/** @type {HTMLElement} */ (appEl.querySelector('.screen')));
  if (same) scrollTo(0, y); else scrollTo(0, 0);
  readSpend();
}

/** The breadcrumbs: their own row above the screen's title; none on the root screen. @param {Screen['where']} where */
function crumbs(where) {
  if (where.length < 2) return '';
  return `<nav class="crumbs" aria-label="${esc(t('where'))}">${where.map((w, i) => {
    const last = i === where.length - 1;
    return `${i ? '<span class="crumbs__sep" aria-hidden="true">/</span>' : ''}${w.href && !last ? `<a href="${esc(w.href)}">${esc(w.label)}</a>` : `<span class="crumbs__here" ${last ? 'aria-current="page"' : ''}>${esc(w.label)}</span>`}`;
  }).join('')}</nav>`;
}

// ---------- what has been spent: the open collection's, or the factory's on the collections screen ----------

/** @type {{scope: string, spend: any}|null} */
let spent = null;
/** Asks for the spend of what the screen shows and redraws its status. */
async function readSpend() {
  const scope = spendScope();
  const r = await call('spend', scope ? { collectionId: scope } : {}).catch(() => null);
  if (!r || scope !== spendScope()) return;
  spent = { scope, spend: r };
  appEl.querySelector('[data-spend]')?.replaceWith(fromHtml(spendStatus()));
}

/** The scope of the spend the current screen shows: its collection, or '' for the factory. */
const spendScope = () => (app.route[0] === 'c' ? app.route[1] ?? '' : '');

/** «Потрачено $x», each kind in its bubble. */
function spendStatus() {
  const sp = spent?.scope === spendScope() ? spent.spend : null;
  if (!sp) return '<span class="tb__text" data-spend hidden></span>';
  const whose = spent?.scope ? t('spentCollection') : t('spentFactory');
  const label = `${whose}: ${t('images')} ${usd(sp.images)}, ${t('text')} ${usd(sp.text)}, ${t('vision')} ${usd(sp.vision)}`;
  return `<span class="tb__text has-bubble" data-spend tabindex="0" role="status" aria-label="${esc(label)}"><span class="tb__word">${esc(t('spent'))}</span> <span class="data">${usd(sp.total)}</span>
    <span class="bubble bubble--right" aria-hidden="true"><b>${esc(whose)}</b><dl><dt>${esc(t('images'))}</dt><dd>${usd(sp.images)}</dd><dt>${esc(t('text'))}</dt><dd>${usd(sp.text)}</dd><dt>${esc(t('vision'))}</dt><dd>${usd(sp.vision)}</dd></dl>${sp.unknown ? `<span class="ink-3">${esc(t('unknown', { n: sp.unknown }))}</span>` : ''}</span></span>`;
}
let spendTimer = /** @type {number|undefined} */ (undefined);
const spendSoon = () => { clearTimeout(spendTimer); spendTimer = setTimeout(readSpend, 600); };
addEventListener(SPENT_EVENT, spendSoon);

// ---------- the top bar ----------

function topbar() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  return `<header class="bar">
    <div class="bar__side"><div class="tb glass"><button type="button" class="btn btn--export" data-shell-export aria-label="${esc(t('export'))}">${I.download}<span>${esc(t('export'))}</span></button></div></div>
    <div class="bar__side">
      <div class="tb glass" data-status>${statusBlock()}</div>
      <div class="tb glass tb--view">
        <div class="seg seg--icon" role="group" aria-label="${esc(t('theme'))}"><button type="button" data-theme-pick="light" aria-pressed="${theme === 'light'}" aria-label="${esc(t('light'))}">${I.sun}</button><button type="button" data-theme-pick="dark" aria-pressed="${theme === 'dark'}" aria-label="${esc(t('dark'))}">${I.moon}</button></div>
        <div class="seg seg--lang" role="group" aria-label="${esc(t('language'))}">${LANGS.map(l => `<button type="button" data-lang="${l}" aria-pressed="${lang() === l}" lang="${l}">${l.toUpperCase()}</button>`).join('')}</div>
      </div>
      <div class="tb glass"><button type="button" class="btn btn--secondary" data-open-settings aria-label="${esc(t('settings'))}">${I.gear}<span class="hide-s">${esc(t('settings'))}</span></button></div>
    </div></header>`;
}

/** The status block: the generation under way, what has been spent, the key. */
function statusBlock() {
  const running = [...jobs.values()].filter(j => j.status === 'running').length;
  const failed = [...jobs.values()].some(j => j.status === 'failed' && !j.seen);
  const gen = running || jobs.size
    ? `<button type="button" class="tb__text${running ? ' tb__text--work' : ''}" data-open-jobs aria-label="${esc(t('queue'))}"><i class="dot ${running ? 'dot--work' : failed ? 'dot--fail' : 'dot--done'}"></i><span class="tb__long">${esc(running ? t('generationN', { n: running }) : t('generation'))}</span>${running ? `<span class="tb__short data">${running}</span>` : ''}</button><span class="tb__sep"></span>`
    : '';
  return `${gen}${spendStatus()}${keyStatus()}`;
}

function keyStatus() {
  const k = app.key;
  const word = !app.online ? t('offline') : k.source === 'none' ? t('noKey') : k.source === 'temporary' ? t('tempKey') : t('key');
  const bad = !app.online || k.source === 'none';
  const tip = !app.online ? t('offlineTip') : k.source === 'none' ? t('noKeyTip', { envVar: k.envVar }) : k.source === 'temporary' ? t('tempKeyTip', { envVar: k.envVar }) : t('keyTip', { envVar: k.envVar });
  return `<button type="button" class="tb__text has-bubble${bad ? ' tb__text--fail' : ''}" data-open-settings="key" aria-label="${esc(tip)}"><i class="dot ${bad ? 'dot--fail' : 'dot--done'}"></i><span${bad ? '' : ' class="tb__long"'}>${esc(word)}</span><span class="bubble bubble--right" aria-hidden="true">${esc(tip)}</span></button>`;
}

/** Redraws only the status block of the top bar (generation, spend, key) without touching the screen. */
function redrawStatus() {
  const el = appEl.querySelector('[data-status]');
  if (el) el.innerHTML = statusBlock();
}

// ---------- events of the shell ----------

appEl.addEventListener('click', e => {
  const target = /** @type {HTMLElement} */ (e.target);
  const theme = /** @type {HTMLElement|null} */ (target.closest('[data-theme-pick]'));
  if (theme) { setTheme(/** @type {string} */ (theme.dataset.themePick)); return; }
  const l = /** @type {HTMLElement|null} */ (target.closest('[data-lang]'));
  if (l) { setLang(/** @type {import('./i18n.js').Lang} */ (l.dataset.lang)); return; }
  if (target.closest('[data-open-settings]')) { openSettings(); return; }
  if (target.closest('[data-open-jobs]')) { openJobs(); return; }
  if (target.closest('[data-shell-export]')) openExport();
});

enableDrag(appEl, async (drag, drop) => {
  if (!app.screen) return;
  const collectionId = app.route[1];
  let moved;
  if (drop.pool) {
    if (!drag.setId) return;
    moved = await attempt(() => call('moveCard', { collectionId, cardId: drag.card, pool: true }));
  } else {
    if (drag.setId === drop.setId && drag.slot === drop.slot) return;
    moved = await attempt(() => call('moveCard', { collectionId, cardId: drag.card, setId: drop.setId, slot: drop.slot }));
  }
  // a screen that updates in place gets the move from the store's event; a failed move is drawn back as it was
  if (!moved || !app.screen?.update) refresh();
});

/** The editor was switched off from its settings: the page says so instead of a screen that no longer answers. */
function showStopped() {
  closeSheet();
  appEl.innerHTML = `<main class="screen"><div class="state"><span class="state__icon">${I.power}</span><h3 class="type-headline-sm">${esc(t('stopped'))}</h3><p>${esc(t('stoppedText'))}</p></div></main>`;
}

/** live: refresh the screen when an event touches it, at most every 250 ms */
let pending = /** @type {number|undefined} */ (undefined);
let stopped = false;
onEvent(e => {
  if (e.type === 'hello') { app.key = e.key; app.online = true; if (stopped) { stopped = false; refresh(); } else redrawStatus(); return; }
  if (e.type === 'bye') { stopped = true; showStopped(); return; }
  if (e.type === 'offline') { if (app.online) { app.online = false; redrawStatus(); } return; }
  if (e.type === 'online') { if (!app.online) { app.online = true; redrawStatus(); if (!stopped) refresh(); } return; }
  if (e.type === 'key') { app.key = e.key; redrawStatus(); return; }
  if (e.type === 'job') {
    const j = e.job;
    redrawStatus();
    if (j.status !== 'running') spendSoon();
    const title = jobTitle(j);
    if (j.status === 'done' && !j.warnings?.length) toast(t('done', { title }), { kind: 'done' });
    if (j.status === 'done' && j.warnings?.length) toast(t('doneWarn', { title, warning: j.warnings[0] }), { kind: 'fail', action: { label: t('details'), run: openJobs } });
    if (j.status === 'failed') toast(t('failed', { title, error: j.error ?? '' }), { kind: 'fail', action: { label: t('details'), run: openJobs } });
    if (j.status === 'cancelled') toast(t('cancelled', { title }));
    const line = appEl.querySelector(`[data-jobline="${j.id}"]`);
    if (line && j.status === 'running') line.replaceWith(fromHtml(jobline(j)));
    else if (app.screen?.affects?.({ type: 'job', ...j.scope })) touch({ type: 'job', ...j.scope, job: j });
    return;
  }
  if (e.type === 'store') spendSoon();
  if (e.type === 'store' && app.screen?.affects?.(e)) touch(e);
});
/**
 * A live event that changes the screen: the screen applies it in place when it has `update` and manages, else the
 * screen is drawn anew (at most every 250 ms). Never in the middle of a drag.
 * @param {any} e
 */
async function touch(e) {
  if (document.body.classList.contains('is-dragging')) { setTimeout(() => touch(e), 300); return; }
  const screen = app.screen;
  if (screen?.update) {
    const done = await screen.update(e).catch(() => false);
    if (done || screen !== app.screen) return;
  }
  clearTimeout(pending);
  pending = setTimeout(refresh, 250);
}

window.addEventListener('hashchange', () => { closeSheet(); refresh(); });
connect();
app.key = (await attempt(() => call('health')))?.key ?? app.key;
refresh();
