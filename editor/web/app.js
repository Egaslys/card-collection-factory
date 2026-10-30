// The editor's page: the top bar (where you are, key status, jobs, theme, settings, the screen's one primary
// action), the router over the nesting collections → collection → set (the card opens as a panel over the
// screen), and live updates: whatever an agent or another window writes appears here by itself.
import { loadDesign } from '/design-system/tokens.js';
import { call, connect, jobs, onEvent } from './api.js';
import { attempt, closeSheet, enableDrag, esc, fromHtml, I, jobline, setTheme, SPENT_EVENT, toast, usd } from './ui.js';
import * as collections from './screens/collections.js';
import * as collection from './screens/collection.js';
import * as setScreen from './screens/set.js';
import { openSettings } from './panels/settings.js';
import { openJobs } from './panels/jobs.js';
import { openCard } from './panels/card.js';
import { app } from './state.js';

await loadDesign();

const appEl = /** @type {HTMLElement} */ (document.getElementById('app'));

/**
 * What a screen gives the shell.
 * @typedef {object} Screen
 * @property {{label: string, href?: string}[]} where  the path shown in the top bar
 * @property {string} html
 * @property {{label: string, icon?: string, run: () => void}|null} [primary]  the screen's one green action
 * @property {(el: HTMLElement) => void} [mount]
 * @property {(e: any) => boolean} [affects]  a live event that changes this screen
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
  /** @type {Screen} */
  let screen;
  try {
    if (route[0] === 'c' && route[1] && route[2] === 's' && route[3]) screen = await setScreen.load(route[1], route[3]);
    else if (route[0] === 'c' && route[1]) screen = await collection.load(route[1]);
    else screen = await collections.load();
  } catch (/** @type {any} */ e) {
    screen = {
      where: [{ label: 'Коллекции', href: '#/' }],
      html: `<div class="state state--error"><span class="state__icon">${I.alert}</span><h3 class="type-headline-sm">Не получилось открыть</h3><p>${esc(e?.message ?? e)}</p><a class="btn btn--secondary" href="#/">К коллекциям</a></div>`,
    };
  }
  if (my !== seq) return;
  const y = scrollY;
  app.screen = screen;
  appEl.innerHTML = `${topbar(screen)}<main class="screen">${screen.html}</main>`;
  screen.mount?.(/** @type {HTMLElement} */ (appEl.querySelector('.screen')));
  if (same) scrollTo(0, y); else scrollTo(0, 0);
  readSpend();
}

// ---------- what has been spent: the open collection's, or the factory's on the collections screen ----------

/** @type {{scope: string, spend: any}|null} */
let spent = null;
/** Asks for the spend of what the screen shows and redraws its line. */
async function readSpend() {
  const scope = spendScope();
  const r = await call('spend', scope ? { collectionId: scope } : {}).catch(() => null);
  if (!r || scope !== spendScope()) return;
  spent = { scope, spend: r };
  const bar = appEl.querySelector('.topbar');
  const fresh = fromHtml(spendLine());
  const old = bar?.querySelector('[data-spend]');
  if (old) old.replaceWith(fresh); else bar?.querySelector('[data-open-settings="key"]')?.before(fresh);
}

/** The scope of the spend the current screen shows: its collection, or '' for the factory. */
const spendScope = () => (app.route[0] === 'c' ? app.route[1] ?? '' : '');

function spendLine() {
  const sp = spent?.scope === spendScope() ? spent.spend : null;
  if (!sp) return '<span class="spend" data-spend hidden></span>';
  const whose = spent?.scope ? 'на эту коллекцию' : 'всей фабрикой';
  const title = `Потрачено ${whose}: картинки ${usd(sp.images)}, текст ${usd(sp.text)}, взгляд смотрящей модели ${usd(sp.vision)}${sp.unknown ? `; ещё ${sp.unknown} — цена неизвестна` : ''}`;
  return `<span class="spend data" data-spend role="status" title="${esc(title)}" aria-label="${esc(title)}">
    <span class="spend__part hide-m">Картинки ${usd(sp.images)}</span><span class="spend__part hide-m">Текст ${usd(sp.text)}</span><span class="spend__part hide-m">Взгляд ${usd(sp.vision)}</span><span>${spent?.scope ? 'Всего' : 'Фабрика'} ${usd(sp.total)}</span></span>`;
}
let spendTimer = /** @type {number|undefined} */ (undefined);
const spendSoon = () => { clearTimeout(spendTimer); spendTimer = setTimeout(readSpend, 600); };
addEventListener(SPENT_EVENT, spendSoon);

/** @param {Screen} s */
function topbar(s) {
  const where = s.where.map((w, i) => {
    const last = i === s.where.length - 1;
    const label = last ? `<b>${esc(w.label)}</b>` : esc(w.label);
    return `${i ? '<span class="topbar__sep">/</span>' : ''}${w.href && !last ? `<a class="topbar__link" href="${esc(w.href)}">${label}</a>` : `<span>${label}</span>`}`;
  }).join('');
  const back = s.where.length > 1 ? `<a class="btn btn--secondary btn--icon btn--s topbar__back" href="${esc(s.where[s.where.length - 2].href ?? '#/')}" aria-label="Назад">${I.back}</a>` : '';
  return `<div class="bar"><div class="topbar glass">
    ${back}<nav class="topbar__where" aria-label="Где вы">${where}</nav>
    ${spendLine()}${keyChip()}${jobsChip()}
    <div class="seg seg--icon hide-s" role="group" aria-label="Тема"><button type="button" data-theme-pick="light" aria-pressed="${document.documentElement.dataset.theme !== 'dark'}" aria-label="Светлая тема">${I.sun}</button><button type="button" data-theme-pick="dark" aria-pressed="${document.documentElement.dataset.theme === 'dark'}" aria-label="Тёмная тема">${I.moon}</button></div>
    <button type="button" class="btn btn--secondary btn--icon" data-open-settings aria-label="Настройки">${I.gear}</button>
    ${s.primary ? `<button type="button" class="btn btn--primary" data-primary>${s.primary.icon ?? ''}<span class="hide-s">${esc(s.primary.label)}</span></button>` : ''}
  </div></div>`;
}

function keyChip() {
  const k = app.key;
  const word = !app.online ? 'Редактор не отвечает' : k.source === 'none' ? 'Нет ключа' : k.source === 'temporary' ? 'Временный ключ' : 'Ключ';
  const bad = !app.online || k.source === 'none';
  return `<button type="button" class="chip${bad ? ' chip--fail' : ''}" data-open-settings="key" title="${esc(bad ? `Нет ключа сервиса (${k.envVar}): генерация через сервис, план набора и взгляд на карточки не работают. Нажмите, чтобы ввести ключ.` : k.source === 'temporary' ? `Временный ключ (${k.envVar}): живёт, пока запущен редактор` : `Постоянный ключ из файла .env (${k.envVar})`)}"><i class="dot ${bad ? 'dot--fail' : 'dot--done'}"></i><span class="chip__text">${word}</span></button>`;
}

function jobsChip() {
  const running = [...jobs.values()].filter(j => j.status === 'running').length;
  const failed = [...jobs.values()].filter(j => j.status === 'failed' && !j.seen).length;
  if (!running && !jobs.size) return '';
  return `<button type="button" class="chip" data-open-jobs aria-label="Очередь задач"><i class="dot ${running ? 'dot--work' : failed ? 'dot--fail' : 'dot--done'}"></i><span class="chip__text hide-s">${running ? `Идёт: ${running}` : 'Очередь'}</span></button>`;
}

/** Redraws only the chips of the top bar (key, jobs) without touching the screen. */
function redrawChips() {
  const bar = appEl.querySelector('.topbar');
  if (!bar) return;
  bar.querySelector('[data-open-settings="key"]')?.replaceWith(fromHtml(keyChip()));
  const jc = bar.querySelector('[data-open-jobs]');
  const fresh = jobsChip();
  if (jc) { if (fresh) jc.replaceWith(fromHtml(fresh)); else jc.remove(); }
  else if (fresh) bar.querySelector('[data-open-settings="key"]')?.after(fromHtml(fresh));
}

// ---------- events of the shell ----------

appEl.addEventListener('click', e => {
  const t = /** @type {HTMLElement} */ (e.target);
  const theme = /** @type {HTMLElement|null} */ (t.closest('[data-theme-pick]'));
  if (theme) { setTheme(/** @type {string} */ (theme.dataset.themePick)); return; }
  const settings = /** @type {HTMLElement|null} */ (t.closest('[data-open-settings]'));
  if (settings) { openSettings(); return; }
  if (t.closest('[data-open-jobs]')) { openJobs(); return; }
  if (t.closest('[data-primary]')) { app.screen?.primary?.run(); }
});

enableDrag(appEl, async (drag, drop) => {
  if (!app.screen) return;
  const collectionId = app.route[1];
  if (drop.pool) {
    if (!drag.setId) return;
    await attempt(() => call('moveCard', { collectionId, cardId: drag.card, pool: true }));
  } else {
    if (drag.setId === drop.setId && drag.slot === drop.slot) return;
    await attempt(() => call('moveCard', { collectionId, cardId: drag.card, setId: drop.setId, slot: drop.slot }));
  }
  refresh();
});

/** live: refresh the screen when an event touches it, at most every 250 ms */
let pending = /** @type {number|undefined} */ (undefined);
onEvent(e => {
  if (e.type === 'hello') { app.key = e.key; app.online = true; redrawChips(); return; }
  if (e.type === 'offline') { if (app.online) { app.online = false; redrawChips(); } return; }
  if (e.type === 'online') { if (!app.online) { app.online = true; redrawChips(); refresh(); } return; }
  if (e.type === 'key') { app.key = e.key; redrawChips(); return; }
  if (e.type === 'job') {
    const j = e.job;
    redrawChips();
    if (j.status !== 'running') spendSoon();
    if (j.status === 'done' && !j.warnings?.length) toast(`Готово: ${j.title}`, { kind: 'done' });
    if (j.status === 'done' && j.warnings?.length) toast(`Готово с оговорками: ${j.title}. ${j.warnings[0]}`, { kind: 'fail', action: { label: 'Подробности', run: openJobs } });
    if (j.status === 'failed') toast(`Не получилось: ${j.title}. ${j.error ?? ''}`, { kind: 'fail', action: { label: 'Подробности', run: openJobs } });
    if (j.status === 'cancelled') toast(`Остановлено: ${j.title}`);
    const line = appEl.querySelector(`[data-jobline="${j.id}"]`);
    if (line && j.status === 'running') line.replaceWith(fromHtml(jobline(j)));
    else if (app.screen?.affects?.({ type: 'job', ...j.scope })) schedule();
    return;
  }
  if (e.type === 'store') spendSoon();
  if (e.type === 'store' && app.screen?.affects?.(e)) schedule();
});
function schedule() {
  if (document.body.classList.contains('is-dragging')) { setTimeout(schedule, 300); return; }
  clearTimeout(pending);
  pending = setTimeout(refresh, 250);
}

window.addEventListener('hashchange', () => { closeSheet(); refresh(); });
connect();
app.key = (await attempt(() => call('health')))?.key ?? app.key;
refresh();
