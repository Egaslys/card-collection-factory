// Shared pieces of the editor's page: escaping, icons, card thumbnails, check words, the sheet (a side panel over
// the screen), the confirmation dialog, the «i» hint, the line of a running job, toasts, dragging cards and the text
// help of free-text fields. Texts come in both languages through words() (i18n.js). The look comes only from
// design-system/components.css and editor.css.
import { call } from './api.js';
import { plural as forms, lang, words } from './i18n.js';

const t = words({
  ru: {
    agent: 'своя картинка', fail: 'Ошибка', failText: 'Карточка не получилась: ни одна попытка не дошла до проверки.',
    newText: 'Карточка ещё не сделана.', noChecks: 'Проверок у этой карточки нет.', blocking: '{n} {w} по проверкам.',
    eyes: '{n} {w} от контура предмета — посмотрите глазами.', warns: '{n} {w} — посмотрите глазами.', pass: 'Проверки стиля пройдены.',
    sayFail: 'Есть проблемы', sayWarn: 'Стоит взглянуть', sayFailed: 'Не получилась',
    close: 'Закрыть', more: 'Подробнее', starting: 'Начинаю…', planning: 'Пишу план', generating: 'Генерируется картинка «{title}»',
    generatingMore: 'Генерируется картинка «{title}» и ещё {n}', generatingOne: 'Генерируется картинка', retry: 'Не получилось, пробую ещё раз ({n} из {of})',
    retryCard: '«{title}»: не получилось, пробую ещё раз ({n} из {of})',
    processing: 'Обрабатываю и проверяю картинку', stopping: 'Останавливаю: доделываю начатый шаг', doneOf: 'Готово: {done} из {total}', doneN: 'Готово: {done}',
    jobDone: 'Готово', jobWarn: 'Готово, но есть замечания', jobFailed: 'Не получилось', jobCancelled: 'Остановлено',
    itemStart: 'Генерируется картинка', itemMade: 'Готово', itemKept: 'Уже была готова', itemSkipped: 'Пропущена: потолок расходов',
    itemFailed: 'Не получилось', itemCancelled: 'Не начата',
    op_makeCard: 'Карточка «{title}»', op_regenerateCard: 'Карточка заново', op_editCard: 'Правка картинки', op_planSet: 'План набора «{theme}»',
    op_makeSet: 'Карточки набора', op_planCollection: 'План коллекции', op_makeCollection: 'Карточки всех наборов коллекции', op_makeCards: 'Карточки «{theme}»',
    op_buildSet: 'Набор «{theme}»', op_makeCard_bare: 'Карточка', op_planSet_bare: 'План набора', op_makeCards_bare: 'Карточки', op_buildSet_bare: 'Новый набор',
    op_buildCollection_variants: 'Коллекция: ещё по варианту каждого набора', op_buildCollection: 'Коллекция: недостающие наборы',
    draft: 'Сформулировать', drafting: 'Формулирую…', draftUndo: 'Вернуть как было', draftTitle: 'Модель сделает из ваших мыслей готовый текст; проверьте его перед сохранением',
  },
  en: {
    agent: 'own image', fail: 'Error', failText: 'The card did not work out: no attempt reached the checks.',
    newText: 'The card is not made yet.', noChecks: 'This card has no checks.', blocking: '{n} {w} found by the checks.',
    eyes: '{n} {w} on the object’s outline — have a look.', warns: '{n} {w} — have a look.', pass: 'The style checks passed.',
    sayFail: 'Has problems', sayWarn: 'Worth a look', sayFailed: 'Did not work out',
    close: 'Close', more: 'Details', starting: 'Starting…', planning: 'Writing the plan', generating: 'Drawing “{title}”',
    generatingMore: 'Drawing “{title}” and {n} more', generatingOne: 'Drawing the picture', retry: 'Did not work, trying again ({n} of {of})',
    retryCard: '“{title}”: did not work, trying again ({n} of {of})',
    processing: 'Processing and checking the picture', stopping: 'Stopping: finishing the step under way', doneOf: 'Done: {done} of {total}', doneN: 'Done: {done}',
    jobDone: 'Done', jobWarn: 'Done, with remarks', jobFailed: 'Did not work', jobCancelled: 'Stopped',
    itemStart: 'Drawing', itemMade: 'Done', itemKept: 'Was already done', itemSkipped: 'Skipped: spend cap',
    itemFailed: 'Did not work', itemCancelled: 'Not started',
    op_makeCard: 'Card “{title}”', op_regenerateCard: 'Card anew', op_editCard: 'Editing a picture', op_planSet: 'Set plan “{theme}”',
    op_makeSet: 'Set cards', op_planCollection: 'Collection plan', op_makeCollection: 'Cards of every set', op_makeCards: 'Cards “{theme}”',
    op_buildSet: 'Set “{theme}”', op_makeCard_bare: 'Card', op_planSet_bare: 'Set plan', op_makeCards_bare: 'Cards', op_buildSet_bare: 'New set',
    op_buildCollection_variants: 'Collection: one more variant of every set', op_buildCollection: 'Collection: the missing sets',
    draft: 'Write it for me', drafting: 'Writing…', draftUndo: 'Put mine back', draftTitle: 'The model turns your notes into a finished text; check it before saving',
  },
});

/** @param {unknown} s */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (/** @type {string} */ body) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
export const I = {
  sun: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>'),
  moon: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>'),
  gear: svg('<circle cx="8" cy="8" r="2"/><path d="M6.9 1.75h2.2l.35 1.7 1.2.5 1.45-.95 1.55 1.55-.95 1.45.5 1.2 1.7.35v2.2l-1.7.35-.5 1.2.95 1.45-1.55 1.55-1.45-.95-1.2.5-.35 1.7H6.9l-.35-1.7-1.2-.5-1.45.95-1.55-1.55.95-1.45-.5-1.2-1.7-.35V6.9l1.7-.35.5-1.2-.95-1.45 1.55-1.55 1.45.95 1.2-.5z"/>'),
  spark: svg('<path d="M8 1.75l1.6 4.65L14.25 8 9.6 9.6 8 14.25 6.4 9.6 1.75 8 6.4 6.4z"/>'),
  redo: svg('<path d="M13 3.5v3.25H9.75"/><path d="M12.6 6.6A5 5 0 1 0 13 9.5"/>'),
  reset: svg('<path d="M3 3.5v3.25h3.25"/><path d="M3.4 6.6A5 5 0 1 1 3 9.5"/>'),
  eye: svg('<path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"/><circle cx="8" cy="8" r="2"/>'),
  grip: svg('<circle cx="6" cy="4" r=".9" fill="currentColor"/><circle cx="10" cy="4" r=".9" fill="currentColor"/><circle cx="6" cy="8" r=".9" fill="currentColor"/><circle cx="10" cy="8" r=".9" fill="currentColor"/><circle cx="6" cy="12" r=".9" fill="currentColor"/><circle cx="10" cy="12" r=".9" fill="currentColor"/>'),
  check: svg('<path d="M3.5 8.5l3 3 6-7"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  image: svg('<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2"/><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5"/><circle cx="10.5" cy="6" r="1"/>'),
  alert: svg('<path d="M8 2.25L14.25 13.25H1.75z"/><path d="M8 6.5v3M8 11.25v.01"/>'),
  x: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  folder: svg('<path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"/>'),
  download: svg('<path d="M8 2v8.5M4.75 7.5L8 10.75l3.25-3.25M2.75 13.25h10.5"/>'),
  back: svg('<path d="M10 3.5L5.5 8l4.5 4.5"/>'),
  next: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  more: svg('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
  trash: svg('<path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.75 9h6.5l.75-9"/>'),
  key: svg('<circle cx="5" cy="10.5" r="2.75"/><path d="M7 8.5l6-6M11 4.5l1.5 1.5M9.5 6l1.25 1.25"/>'),
  edit: svg('<path d="M10.5 2.75l2.75 2.75L6 12.75H3.25V10z"/>'),
  stop: svg('<rect x="4" y="4" width="8" height="8" rx="1.5"/>'),
  star: svg('<path d="M8 1.9l1.85 3.8 4.15.6-3 2.9.7 4.1L8 11.35 4.3 13.3l.7-4.1-3-2.9 4.15-.6z" stroke-linejoin="round"/>'),
  power: svg('<path d="M8 1.75v5.5"/><path d="M4.6 3.9a5 5 0 1 0 6.8 0"/>'),
  info: svg('<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.75v.01"/>'),
  chev: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.25 3.25"/>'),
};

/** Switches the theme and remembers it in this browser; the top bar's switch follows. @param {string} theme  light | dark */
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ccf-theme', theme); } catch { /* private mode */ }
  for (const b of document.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.themePick === theme));
}

/** The model that made a card's version, as a person reads it: without its provider prefix; "agent" = an image handed in. @param {string} model */
export const modelName = model => (model === 'agent' ? t('agent') : model.replace(/^[\w.-]+\//, ''));

/** USD with cents, or a dash. @param {number|null|undefined} v */
export const usd = v => (v == null ? '—' : `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`);

/**
 * Russian plural: plural(5, 'карточка', 'карточки', 'карточек'). Russian only: a module with texts in both languages
 * uses plural() of i18n.js.
 * @param {number} n @param {string} one @param {string} few @param {string} many
 */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
/** Russian only (see plural). @param {number} n @param {string} one @param {string} few @param {string} many */
export const count = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;

const W = {
  error: /** @type {const} */ ({ ru: ['ошибка', 'ошибки', 'ошибок'], en: ['problem', 'problems'] }),
  eyes: /** @type {const} */ ({ ru: ['проверка зависит', 'проверки зависят', 'проверок зависят'], en: ['check depends', 'checks depend'] }),
  remark: /** @type {const} */ ({ ru: ['замечание', 'замечания', 'замечаний'], en: ['remark', 'remarks'] }),
};
/** @param {number} n @param {{ru: readonly [string, string, string], en: readonly [string, string]}} f */
const nw = (n, f) => ({ n, w: forms(n, { ru: [...f.ru], en: [...f.en] }) });

/**
 * The verdict of a card's checks in a person's words: PASS / WARN / FAIL and a sentence.
 * @param {{blocking: number, warns: number, needsEyes: number}|null|undefined} c
 * @param {string} [status]  the card's status
 * @returns {{kind: 'pass'|'warn'|'fail'|null, word: string, text: string}}
 */
export function verdict(c, status) {
  if (status === 'failed') return { kind: 'fail', word: t('fail'), text: t('failText') };
  if (status === 'new') return { kind: null, word: '', text: t('newText') };
  if (!c) return { kind: null, word: '', text: t('noChecks') };
  if (c.blocking > 0) return { kind: 'fail', word: 'FAIL', text: t('blocking', nw(c.blocking, W.error)) };
  if (c.needsEyes > 0) return { kind: 'warn', word: 'WARN', text: t('eyes', nw(c.needsEyes, W.eyes)) };
  if (c.warns > 0) return { kind: 'warn', word: 'WARN', text: t('warns', nw(c.warns, W.remark)) };
  return { kind: 'pass', word: 'PASS', text: t('pass') };
}

/**
 * The verdict under a thumbnail in plain words (the approved mockup): problems, worth a look, did not work out;
 * nothing when the card is fine or not made yet. Its sentence is the tooltip.
 * @param {{kind: string|null, word: string, text: string}} v @param {string} [status]
 */
export const say = (v, status) => {
  const word = status === 'failed' ? t('sayFailed') : v.kind === 'fail' ? t('sayFail') : v.kind === 'warn' ? t('sayWarn') : '';
  return word ? `<span class="thumb__say thumb__say--${v.kind}" title="${esc(v.text)}"><i class="dot dot--${v.kind}"></i>${esc(word)}</span>` : '';
};

/** @param {{kind: string|null, word: string, text: string}} v */
export const badge = v => (v.kind ? `<span class="badge badge--${v.kind}" title="${esc(v.text)}">${v.word}</span>` : '');

/**
 * A card thumbnail (design system «Card thumbnail»): the image is never covered; number, name and badge under it.
 * @param {any} c  CardSummary with imageUrl
 * @param {{n?: number|null, drag?: object|null, selected?: boolean, note?: string}} [o]  drag: what the card is dragged
 *   from; note: a quiet line under the name (which model made it, when two cards would otherwise look the same)
 */
export function thumb(c, { n = null, drag = null, selected = false, note = '' } = {}) {
  const v = verdict(c.checks, c.status);
  const img = c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" width="430" height="480" loading="lazy" decoding="async" draggable="false">` : `<span class="thumb__empty">${c.status === 'failed' ? I.alert : I.image}</span>`;
  return `<figure class="thumb" data-card="${esc(c.id)}" aria-selected="${selected}" tabindex="0" ${drag ? `data-drag='${esc(JSON.stringify({ card: c.id, ...drag }))}'` : ''}>
    <div class="thumb__img">${img}</div>
    <figcaption class="thumb__cap"><span class="thumb__line">${n != null ? `<span class="thumb__num">${String(n).padStart(2, '0')}</span>` : ''}<span class="thumb__name" title="${esc(c.title)}">${esc(c.title)}</span></span>${note ? `<span class="thumb__note data ink-3" title="${esc(note)}">${esc(note)}</span>` : ''}
      <span class="thumb__line">${say(v, c.status)}<span class="thumb__check">${I.check}</span>${drag ? `<span class="thumb__grip" data-grip aria-hidden="true">${I.grip}</span>` : ''}</span></figcaption>
  </figure>`;
}

/** One element from HTML. @param {string} html */
export const fromHtml = html => { const tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return /** @type {HTMLElement} */ (tpl.content.firstElementChild); };

// ---------- jobs in plain words (the line on a screen and the queue panel) ----------

/** What a job does, in the page's language, from its op and what it is about (server/jobs.js `about`). @param {any} j */
export function jobTitle(j) {
  const a = j.about ?? {};
  // a title without its theme or card name says what the job is, without empty quotes
  const bare = !a.theme && !a.title && ['makeCard', 'planSet', 'makeCards', 'buildSet'].includes(j.op);
  const key = j.op === 'buildCollection' && a.mode === 'variants' ? 'op_buildCollection_variants' : `op_${j.op}${bare ? '_bare' : ''}`;
  const said = t(/** @type {any} */ (key), { theme: a.theme ?? '', title: a.title ?? '' });
  return said === key ? j.title : said;
}

/** The status of one card row of a job. @param {string} status */
export const itemWords = status => {
  const key = /** @type {const} */ ({ start: 'itemStart', made: 'itemMade', kept: 'itemKept', skipped: 'itemSkipped', failed: 'itemFailed', cancelled: 'itemCancelled' })[/** @type {'start'} */ (status)];
  return key ? t(key) : status;
};

/** A card row being made tries again: its attempt in this run is past the first. @param {any} i */
const retrying = i => i.status === 'start' && i.attempt?.stage === 'generate' && i.attempt.k > 1;

/**
 * The attempt under way in this run, from core/card's progress: `done` attempts are finished, so this is the
 * (done + 1)-th of `of`. Not `n`: that is the card's version number and counts earlier runs (a regenerate's first
 * attempt may be version 4).
 * @param {{done: number}} say
 */
const runAttempt = say => say.done + 1;

/** A card row of a job in words: its status, or its attempt while it is drawn again. @param {any} i */
export const itemSay = i => (retrying(i) ? t('retry', { n: i.attempt.k, of: i.attempt.of }) : i.status === 'start' && i.attempt?.stage === 'process' ? t('processing') : itemWords(i.status));

/** What a running job is doing now, in a sentence. @param {any} j */
export function jobStep(j) {
  const drawing = (j.items ?? []).filter((/** @type {any} */ i) => i.status === 'start');
  const last = [...(j.log ?? [])].reverse().find((/** @type {any} */ l) => l.say)?.say;
  if (last?.k === 'stopping') return t('stopping');
  // a card drawn again says so first: the latest such line, by the card's title
  const again = last?.k === 'attempt' && last.stage === 'generate' && runAttempt(last) > 1 && last.title ? last : null;
  const retry = again ? drawing.find((/** @type {any} */ i) => i.title === again.title && retrying(i)) : drawing.find(retrying);
  if (retry) return t('retryCard', { title: retry.title, n: retry.attempt.k, of: retry.attempt.of });
  if (drawing.length) return drawing.length > 1 ? t('generatingMore', { title: drawing[0].title, n: drawing.length - 1 }) : t('generating', { title: drawing[0].title });
  if (last?.k === 'attempt') {
    if (last.stage === 'process') return t('processing');
    if (last.stage === 'generate') return runAttempt(last) > 1 ? t('retry', { n: runAttempt(last), of: last.of }) : t('generatingOne');
  }
  if (/^(plan|build)/.test(j.op) && !(j.items ?? []).length) return t('planning');
  return t('starting');
}

/** How a job ended, in words. @param {any} j */
export const jobEnd = j => (j.status === 'done' ? t(j.warnings?.length ? 'jobWarn' : 'jobDone') : j.status === 'failed' ? t('jobFailed') : j.status === 'cancelled' ? t('jobCancelled') : jobStep(j));

/** «Готово: 3 из 5» — the cards made so far, of how many when that is known. @param {any} j */
export function jobCount(j) {
  if (!j.items?.length && !j.about?.count) return '';
  const done = (j.items ?? []).filter((/** @type {any} */ i) => i.status === 'made' || i.status === 'kept').length;
  return j.about?.count ? t('doneOf', { done, total: j.about.count }) : t('doneN', { done });
}

/**
 * One running job as a line on the screen it concerns: what is being done and its step, in words; no money.
 * app.js replaces it in place on every progress event.
 * @param {any} j
 */
export function jobline(j) {
  return `<div class="jobline panel" data-jobline="${esc(j.id)}"><i class="dot dot--work"></i><span class="jobline__title">${esc(jobTitle(j))}</span>
    <span class="jobline__last ink-2">${esc(jobStep(j))}</span><span class="jobline__count">${esc(jobCount(j))}</span>
    <button type="button" class="btn btn--text btn--s" data-open-jobs><span>${esc(t('more'))}</span></button></div>`;
}

// ---------- sheet: a panel over the screen, from the right (from the bottom on phones) ----------

const layer = /** @type {HTMLElement} */ (document.getElementById('layer'));
/** @type {{close: () => void}|null} */
let openSheetRef = null;

/**
 * Opens a sheet; returns its body element and a close function. Escape and a click on the scrim close it.
 * @param {{title: string, body: string, foot?: string, wide?: boolean, onClose?: () => void}} o
 */
export function openSheet({ title, body, foot = '', wide = false, onClose }) {
  openSheetRef?.close();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="scrim" data-close></div>
    <section class="sheet${wide ? ' sheet--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet__head"><h2 class="type-headline-sm">${esc(title)}</h2><button type="button" class="btn btn--secondary btn--icon btn--s" data-close aria-label="${esc(t('close'))}">${I.x}</button></header>
      <div class="sheet__body">${body}</div>${foot ? `<footer class="sheet__foot">${foot}</footer>` : ''}
    </section>`;
  const prev = /** @type {HTMLElement|null} */ (document.activeElement);
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('has-sheet');
    openSheetRef = null;
    onClose?.();
    prev?.focus?.();
  };
  wrap.addEventListener('click', e => { if (/** @type {HTMLElement} */ (e.target).closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  layer.append(wrap);
  document.body.classList.add('has-sheet');
  const sheet = /** @type {HTMLElement} */ (wrap.querySelector('.sheet'));
  (/** @type {HTMLElement|null} */ (sheet.querySelector('[autofocus]')) ?? sheet).focus?.();
  openSheetRef = { close };
  return { sheet, body: /** @type {HTMLElement} */ (wrap.querySelector('.sheet__body')), close };
}

export const closeSheet = () => openSheetRef?.close();

// ---------- confirmation: a dialog in the centre, over any sheet ----------

/**
 * Asks before something that cannot be undone. «Да» (destructive, red) stands on the left, «Нет» on the right (the
 * author's note on the mockup); Escape, a click outside and «Нет» answer no. The sheet under it stays open.
 * @param {{title: string, text?: string, yes: string, no: string, icon?: string}} o  icon: an I.* svg (default: trash)
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, text = '', yes, no, icon = I.trash }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `<div class="scrim" data-answer="no"></div><div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <span class="state__icon">${icon}</span><h3 class="type-headline-sm">${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="dialog__acts"><button type="button" class="btn btn--danger" data-answer="yes">${icon}<span>${esc(yes)}</span></button><button type="button" class="btn btn--secondary" data-answer="no">${esc(no)}</button></div></div>`;
    const prev = /** @type {HTMLElement|null} */ (document.activeElement);
    /** @param {boolean} v */
    const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); resolve(v); };
    // capture, so the Escape that answers here does not also close the sheet under the dialog
    const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); done(false); } };
    wrap.addEventListener('click', e => { const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-answer]')); if (b) done(b.dataset.answer === 'yes'); });
    document.addEventListener('keydown', onKey, true);
    layer.append(wrap);
    /** @type {HTMLElement} */ (wrap.querySelector('[data-answer="no"].btn')).focus();
  });
}

// ---------- «i» hint ----------

/**
 * A small round «i» that shows its text on hover and focus, in place of a line of hint text nobody reads.
 * @param {string} text @param {{side?: 'center'|'left'|'right'}} [o]  where the bubble opens
 */
export const tip = (text, { side = 'center' } = {}) => `<span class="tip" tabindex="0" role="note" aria-label="${esc(text)}">i<span class="bubble${side === 'center' ? '' : ` bubble--${side}`}" aria-hidden="true">${esc(text)}</span></span>`;

// ---------- toasts ----------

/**
 * A short message at the bottom; an action is a text button.
 * @param {string} text @param {{kind?: 'fail'|'done'|null, action?: {label: string, run: () => void}, ms?: number}} [o]
 */
export function toast(text, { kind = null, action, ms = 5000 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = `toast glass glass--thick${kind ? ` toast--${kind}` : ''}`;
  el.innerHTML = `${kind ? `<i class="dot dot--${kind}"></i>` : ''}<span class="toast__text">${esc(text)}</span>${action ? `<button type="button" class="btn btn--text btn--s"><span>${esc(action.label)}</span></button>` : ''}`;
  if (action) el.querySelector('button')?.addEventListener('click', () => { action.run(); el.remove(); });
  host.append(el);
  setTimeout(() => el.remove(), kind === 'fail' ? Math.max(ms, 9000) : ms);
}

// ---------- text help: rough notes in a field → a finished text (core/text/draft.js) ----------

/** Sent on the window after a paid call the page made outside a job (the text help): the spend line reads it again. */
export const SPENT_EVENT = 'ccf:spent';

/**
 * The text help of one free-text field, placed in its `.field` after the input: «Сформулировать» sends what is
 * written to the text model and puts the finished text in its place; «Вернуть как было» puts the notes back. Nothing
 * is saved: the form the field belongs to saves it. The kinds: settings text.help.kinds.
 * @param {string} kind
 */
export const textHelp = kind => `<span class="texthelp" data-texthelp="${esc(kind)}"><button type="button" class="btn btn--text btn--s" data-draft title="${esc(t('draftTitle'))}">${I.spark}<span>${esc(t('draft'))}</span></button><button type="button" class="btn btn--text btn--s" data-draft-undo hidden><span>${esc(t('draftUndo'))}</span></button></span>`;

/** The skeleton lines shown over a field while the model writes. */
const DRAFT_SKELETON = '<span class="draft-skel" aria-hidden="true"><span class="skeleton" style="width:92%"></span><span class="skeleton" style="width:78%"></span><span class="skeleton" style="width:54%"></span></span>';

/**
 * Makes the text help under `root` work. While the model writes, the field shows a skeleton and the button a spinner.
 * An empty field gets a text proposed from what it belongs to, in the page's language (core/text/draft.js).
 * @param {HTMLElement} root
 * @param {() => {context?: Record<string, string|undefined>, collectionId?: string|null}} about  what the text belongs
 *   to, read at the moment of the click
 * @param {(o: {kind: string, notes: string}) => Promise<{text: string}>} [ask]  how the text is asked for (default: op
 *   draftText; the card sheet asks proposeCardWish)
 */
export function bindTextHelp(root, about, ask = ({ kind, notes }) => call('draftText', { kind, notes, language: lang(), ...about() })) {
  root.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const box = /** @type {HTMLElement|null} */ (target.closest('[data-texthelp]'));
    if (!box) return;
    e.preventDefault();
    const fieldEl = /** @type {HTMLElement} */ (box.closest('.field'));
    const field = /** @type {HTMLInputElement|HTMLTextAreaElement} */ (fieldEl.querySelector('textarea, input'));
    const go = /** @type {HTMLButtonElement} */ (box.querySelector('[data-draft]'));
    const undo = /** @type {HTMLButtonElement} */ (box.querySelector('[data-draft-undo]'));
    if (target.closest('[data-draft-undo]')) { field.value = box.dataset.before ?? ''; undo.hidden = true; field.focus(); return; }
    if (!target.closest('[data-draft]')) return;
    const notes = field.value.trim();
    const before = go.innerHTML;
    go.disabled = true;
    go.innerHTML = `<span class="spin"></span><span>${esc(t('drafting'))}</span>`;
    const holder = document.createElement('span');
    holder.className = 'drafting';
    field.replaceWith(holder);
    holder.append(field);
    holder.insertAdjacentHTML('beforeend', DRAFT_SKELETON);
    field.readOnly = true;
    try {
      const r = await ask({ kind: /** @type {string} */ (box.dataset.texthelp), notes });
      box.dataset.before = field.value;
      field.value = r.text;
      undo.hidden = false;
      dispatchEvent(new Event(SPENT_EVENT));
    } catch (/** @type {any} */ err) {
      toast(err?.message ?? String(err), { kind: 'fail' });
    } finally {
      field.readOnly = false;
      holder.replaceWith(field);
      go.disabled = false;
      go.innerHTML = before;
    }
  });
}

/** Runs an async action and shows its error as a toast. @param {() => Promise<unknown>} fn */
export async function attempt(fn) {
  try { return await fn(); } catch (/** @type {any} */ e) { toast(e?.message ?? String(e), { kind: 'fail' }); return undefined; }
}

// ---------- dragging cards between set slots and the pool ----------

/**
 * Pointer dragging (mouse anywhere on a card, touch by its grip): elements with data-drag='{"card", "setId"?,
 * "slot"?}' are dragged; elements with data-drop='{"setId", "slot"}' or data-drop='{"pool": true}' receive.
 * @param {HTMLElement} root
 * @param {(drag: any, drop: any) => void} onDrop
 */
export function enableDrag(root, onDrop) {
  /** @type {{src: HTMLElement, data: any, x: number, y: number, ghost?: HTMLElement, over?: HTMLElement|null, id: number}|null} */
  let st = null;
  let scroll = 0;
  let suppressClick = false;

  root.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const src = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-drag]'));
    if (!src || !root.contains(src)) return;
    if (e.pointerType !== 'mouse' && !(/** @type {HTMLElement} */ (e.target).closest('[data-grip]'))) return;
    st = { src, data: JSON.parse(src.dataset.drag ?? '{}'), x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  window.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.ghost) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
      const img = st.src.querySelector('img');
      const r = (img ?? st.src).getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.style.width = `${Math.min(r.width, 172)}px`;
      if (img) ghost.append(/** @type {HTMLElement} */ (img.cloneNode()));
      document.body.append(ghost);
      st.ghost = ghost;
      st.src.classList.add('is-ghost');
      document.body.classList.add('is-dragging');
    }
    e.preventDefault();
    st.ghost.style.transform = `translate(${e.clientX - st.ghost.offsetWidth / 2}px, ${e.clientY - st.ghost.offsetHeight / 2}px)`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const over = /** @type {HTMLElement|null} */ (under?.closest('[data-drop]') ?? null);
    if (over !== st.over) { st.over?.classList.remove('is-over'); over?.classList.add('is-over'); st.over = over; }
    const edge = 64;
    scroll = e.clientY < edge ? -12 : e.clientY > innerHeight - edge ? 12 : 0;
  }, { passive: false });

  const end = (/** @type {PointerEvent} */ e) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    st = null;
    scroll = 0;
    if (!s.ghost) return;
    s.ghost.remove();
    s.src.classList.remove('is-ghost');
    s.over?.classList.remove('is-over');
    document.body.classList.remove('is-dragging');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (e.type === 'pointerup' && s.over) onDrop(s.data, JSON.parse(s.over.dataset.drop ?? '{}'));
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  root.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  const tick = () => { if (scroll) scrollBy(0, scroll); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
