// The card panel (the approved mockup, screens 25–27): the card big with its versions (every attempt is a version;
// arrows and the strip of thumbnails flip them without drawing the panel again, «Сделать карточкой» makes the version
// shown the card), what was found in the version shown — a verdict in words, what the program's checks found and what
// the vision model found, each check explained in the style's own words (styles/<style>/checks/explain.json) — the
// vision model's reason when it picked the card among the versions, «Сделать заново» (draw again: no wish needed, the
// findings are corrected; or edit the version with a wish), moving the card to a set, the processing sliders of the
// version with a live preview — computed here by core/image/adjust.js over the version's prepared.png, the same code
// that writes the final card — and, under «Ещё», an own image, the folder, export and delete.
import { adjust } from '/core/image/adjust.js';
import { call, jobs, onEvent } from '../api.js';
import { attempt, bindTextHelp, confirmDialog, esc, fromHtml, I, jobline, modelName, openSheet, textHelp, tip, toast, usd, verdict } from '../ui.js';
import { lang, plural, words } from '../i18n.js';
import { app } from '../state.js';
import { openExport } from './export.js';

const t = words({
  ru: {
    sharpen: 'Резкость', saturation: 'Насыщенность', brightness: 'Яркость', shadows: 'Тени',
    busy_make: 'генерация', busy_regenerate: 'перегенерация', busy_edit: 'правка картинки', busy_import: 'проверка своей картинки',
    image: 'картинка {v}', vision: 'взгляд {v}', text: 'текст {v}', priceUnknown: 'цена неизвестна', free: 'по подписке',
    prev: 'Предыдущая версия', next: 'Следующая версия', version: 'Версия {n}', of: 'из {total}', theCard: 'карточка', makeCard: 'Сделать карточкой',
    versionN: 'Версия {n}', isCard: 'это карточка', picked: 'Смотрящая модель выбрала эту версию из версий {ns}:', pickedNoReason: 'Смотрящая модель выбрала эту версию из версий {ns}.',
    ok: 'Всё в порядке', look: 'Стоит взглянуть', problem: 'Есть проблемы', failed: 'Не получилась',
    okSub: 'Программа измерила картинку, смотрящая модель сверила её с заказом — замечаний нет.', okSubNoLook: 'Программа измерила картинку — замечаний нет.',
    lookSub: 'Ничего не сломано, но есть места, которые лучше проверить глазами.', problemSub: 'Версия не прошла проверки. «Нарисовать заново» учтёт эти проблемы.',
    failedSub: 'Эта версия не дошла до проверки.', noChecks: 'Проверок у этой версии нет.',
    byChecks: 'Выявлено автопроверкой', byLook: 'Нашла смотрящая модель', tagFail: 'проблема', tagEyes: 'контур — взглянуть', tagWarn: 'взглянуть',
    lookNone: 'Модель посмотрела на картинку и проблем не нашла.', lookUnknown: 'Смотрящая модель не дала ответа{why}.', lookOff: 'Смотрящая модель на эту версию не смотрела.',
    kind_subject: 'Предмет', kind_staging: 'Постановка', kind_additions: 'Лишнее', kind_costume: 'Костюм', kind_drawing: 'Рисунок', kind_caption: 'Подпись',
    how: 'Как проверяли', inNorm: 'в норме', groupFail: '{n} {w}', groupWarn: '{n} — взглянуть', drawn: 'Что нарисовано', drawnOk: 'модель сверила с заказом: совпадает',
    drawnIssues: '{n} {w} — см. выше', drawnNone: 'модель не смотрела', all: 'Все измерения', eyes: 'Проверить глазами', notMeasured: 'не измерено',
    busyTitle: 'Карточка занята', busyText: 'идёт {what} — действия с карточкой подождут её конца',
    redo: 'Сделать заново', regen: 'Нарисовать заново', edit: 'Отредактировать',
    wishPh: 'Необязательно: ваше пожелание, например «поплавок крупнее, фон теплее»', editPh: 'Что поправить на картинке, например «убрать лампу сверху»',
    regenHintFix: 'Карточка будет нарисована заново и учтёт найденные проблемы; ваше пожелание — тоже, если напишете. Результат станет новой версией.',
    regenHint: 'Карточка будет нарисована заново по своему заказу и станет новой версией; пожелание — если напишете.',
    editHint: 'Картинка версии {n} уйдёт модели с вашим пожеланием: она поправит только то, о чём вы просите. Результат станет новой версией.',
    editNeedsWish: 'Напишите, что поправить на картинке.', redoGo: 'Сделать заново', editGo: 'Отредактировать',
    move: 'Переместить в набор', pool: 'Хранилище', place: 'Место {n}', moveGo: 'Переместить',
    nowPool: 'Сейчас: в хранилище, вне наборов.', nowSet: 'Сейчас: набор «{set}», место {n}.', swap: 'Если место занято, карточки поменяются местами.',
    moved: 'Карточка перемещена.', movedPool: 'Карточка убрана в хранилище.',
    proc: 'Обработка версии {n}', procTip: 'Предпросмотр считает тот же код, что пишет итоговую картинку. «Применить» сохранит обработку и проверит версию заново.',
    procByHand: 'Обработку этой версии задали вручную.', procAuto: 'Обработку подобрала программа.', procNone: 'У этой версии нет подготовленной картинки — обработку менять не на чем.',
    reset: 'Сбросить', resetOne: 'Вернуть: {what}', apply: 'Применить обработку', auto: 'Вернуть обработку программы',
    more: 'Ещё', own: 'Своя картинка', ownPick: 'Выбрать файл…', ownHint: 'PNG, JPEG или WebP. Станет новой версией: программа обрежет её до карточки, найдёт контур, подберёт обработку и проверит так же строго, как сгенерированную.',
    folder: 'Открыть картинку в папке', export: 'Экспорт', del: 'Удалить карточку',
    delQ: 'Удалить карточку «{title}»?', delText: 'Удалятся все её версии. Папка уйдёт в корзину системы — оттуда её можно вернуть.', delYes: 'Да, удалить', delNo: 'Нет, оставить',
    leaveQ: 'Обработка не применена', leaveText: 'Обработка версии {n} изменена, но не применена. Перейти к другой версии без неё?', leaveYes: 'Перейти без неё', leaveNo: 'Остаться',
    chosen: 'Версия {n} — теперь карточка.', applied: 'Обработка применена, версия проверена заново.', autoDone: 'Обработка снова подобрана программой, версия проверена заново.',
    readFail: 'Не получилось прочитать подготовленную картинку версии.', importing: 'Проверяю картинку: обрезка, контур, обработка, проверки…', imported: 'Картинка добавлена новой версией.',
  },
  en: {
    sharpen: 'Sharpness', saturation: 'Saturation', brightness: 'Brightness', shadows: 'Shadows',
    busy_make: 'generation', busy_regenerate: 'drawing again', busy_edit: 'editing the picture', busy_import: 'checking an own image',
    image: 'image {v}', vision: 'look {v}', text: 'text {v}', priceUnknown: 'price unknown', free: 'by subscription',
    prev: 'Previous version', next: 'Next version', version: 'Version {n}', of: 'of {total}', theCard: 'the card', makeCard: 'Make it the card',
    versionN: 'Version {n}', isCard: 'the card', picked: 'The vision model picked this version among versions {ns}:', pickedNoReason: 'The vision model picked this version among versions {ns}.',
    ok: 'All is well', look: 'Worth a look', problem: 'Has problems', failed: 'Did not work out',
    okSub: 'The program measured the picture and the vision model compared it with the order: nothing to remark.', okSubNoLook: 'The program measured the picture: nothing to remark.',
    lookSub: 'Nothing is broken, but some places are better checked by eye.', problemSub: 'The version did not pass the checks. «Draw again» corrects these problems.',
    failedSub: 'This version did not reach the checks.', noChecks: 'This version has no checks.',
    byChecks: 'Found by the automatic checks', byLook: 'Found by the vision model', tagFail: 'problem', tagEyes: 'outline — have a look', tagWarn: 'have a look',
    lookNone: 'The model looked at the picture and found no problems.', lookUnknown: 'The vision model gave no answer{why}.', lookOff: 'The vision model did not look at this version.',
    kind_subject: 'Subject', kind_staging: 'Staging', kind_additions: 'Extra', kind_costume: 'Costume', kind_drawing: 'Drawing', kind_caption: 'Caption',
    how: 'How it was checked', inNorm: 'fine', groupFail: '{n} {w}', groupWarn: '{n} — have a look', drawn: 'What is drawn', drawnOk: 'the model compared it with the order: it matches',
    drawnIssues: '{n} {w} — see above', drawnNone: 'the model did not look', all: 'All measurements', eyes: 'Check by eye', notMeasured: 'not measured',
    busyTitle: 'The card is busy', busyText: '{what} is under way — the card’s actions wait for it to end',
    redo: 'Make it again', regen: 'Draw again', edit: 'Edit',
    wishPh: 'Optional: your wish, for example “a bigger float, a warmer backdrop”', editPh: 'What to change in the picture, for example “remove the lamp at the top”',
    regenHintFix: 'The card is drawn again and the problems found are corrected; your wish too, if you write one. The result becomes a new version.',
    regenHint: 'The card is drawn again from its order and becomes a new version; your wish too, if you write one.',
    editHint: 'The picture of version {n} goes to the model with your wish: it changes only what you ask. The result becomes a new version.',
    editNeedsWish: 'Write what to change in the picture.', redoGo: 'Make it again', editGo: 'Edit',
    move: 'Move to a set', pool: 'Pool', place: 'Place {n}', moveGo: 'Move',
    nowPool: 'Now: in the pool, outside the sets.', nowSet: 'Now: set «{set}», place {n}.', swap: 'If the place is taken, the cards swap places.',
    moved: 'The card was moved.', movedPool: 'The card is back in the pool.',
    proc: 'Processing of version {n}', procTip: 'The preview is computed by the same code that writes the final picture. «Apply» saves the processing and checks the version again.',
    procByHand: 'This version’s processing was set by hand.', procAuto: 'The program found this processing.', procNone: 'This version has no prepared picture: there is nothing to process.',
    reset: 'Reset', resetOne: 'Put back: {what}', apply: 'Apply processing', auto: 'Back to the program’s processing',
    more: 'More', own: 'Own image', ownPick: 'Choose a file…', ownHint: 'PNG, JPEG or WebP. It becomes a new version: the program crops it to the card, finds the outline, tunes the processing and checks it as strictly as a generated one.',
    folder: 'Show the picture in its folder', export: 'Export', del: 'Delete the card',
    delQ: 'Delete the card «{title}»?', delText: 'All its versions go. The folder goes to the system trash, where it can be restored from.', delYes: 'Yes, delete', delNo: 'No, keep it',
    leaveQ: 'Processing not applied', leaveText: 'The processing of version {n} was changed but not applied. Go to another version without it?', leaveYes: 'Go without it', leaveNo: 'Stay',
    chosen: 'Version {n} is the card now.', applied: 'Processing applied, the version checked again.', autoDone: 'The program’s processing is back, the version checked again.',
    readFail: 'Could not read the version’s prepared picture.', importing: 'Checking the picture: crop, outline, processing, checks…', imported: 'The picture was added as a new version.',
  },
});

const W = {
  problem: { ru: /** @type {[string, string, string]} */ (['проблема', 'проблемы', 'проблем']), en: /** @type {[string, string]} */ (['problem', 'problems']) },
  remark: { ru: /** @type {[string, string, string]} */ (['замечание', 'замечания', 'замечаний']), en: /** @type {[string, string]} */ (['remark', 'remarks']) },
};

/** The sliders: key, how the value reads, and where it sits in the settings object of adjust.js. */
const SLIDERS = /** @type {const} */ ([
  { key: 'sharpen', fmt: (/** @type {number} */ v) => v.toFixed(2), step: 0.01 },
  { key: 'saturation', fmt: (/** @type {number} */ v) => `×${v.toFixed(2)}`, step: 0.01 },
  { key: 'brightness', fmt: (/** @type {number} */ v) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)), step: 1 },
  { key: 'shadows', fmt: (/** @type {number} */ v) => (v > 0 ? `+${v.toFixed(0)}` : '0'), step: 1 },
]);

/** @param {any} p  AdjustSettings @returns {Record<string, number>} */
const flat = p => ({ sharpen: p.sharpen.amount, saturation: p.saturation, brightness: p.brightness, shadows: p.shadows ?? 0 });
/** @param {Record<string, number>} v @param {any} base */
const settingsOf = (v, base) => ({ ...base, brightness: v.brightness, saturation: v.saturation, shadows: v.shadows, sharpen: { ...base.sharpen, amount: v.sharpen } });

/** What a version cost, for a person: the image and, when they were asked, the vision and text models. @param {any} a */
function spendText(a) {
  if (a.cost == null) return t('priceUnknown');
  if (a.model === 'codex-cli' && !a.spend.vision && !a.spend.text) return t('free');
  const sp = a.spend;
  return [t('image', { v: usd(sp.images) }), ...(sp.vision ? [t('vision', { v: usd(sp.vision) })] : []), ...(sp.text ? [t('text', { v: usd(sp.text) })] : [])].join(' · ');
}

/**
 * Pixels of an image file exactly as stored (no colour management, no premultiplication), as RGBA.
 * @param {string} url @returns {Promise<{pixels: Uint8ClampedArray, width: number, height: number}>}
 */
async function pixelsOf(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }));
  ctx.drawImage(bmp, 0, 0);
  return { pixels: ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: 'srgb' }).data, width: bmp.width, height: bmp.height };
}

/**
 * The verdict of one version in words (ui.js verdict, from its summary in card.json): problem, worth a look, all is
 * well — a version whose vision model named something that blocks nothing is worth a look too.
 * @param {any} a @returns {'problem'|'look'|'ok'|'failed'|'none'}
 */
function stateOf(a) {
  if (a.error) return 'failed';
  if (!a.check) return 'none';
  const v = verdict({ ...a.check, needsEyes: a.check.needsEyes ?? a.check.fails.length - a.check.blocking });
  return v.kind === 'fail' ? 'problem' : v.kind === 'warn' || a.look?.issues?.length ? 'look' : 'ok';
}

/**
 * @param {string} collectionId @param {string} cardId
 * @param {{version?: number, wish?: string}} [o]  the version to show first (default: the card); the wish typed so far
 */
export async function openCard(collectionId, cardId, { version, wish: typed = '' } = {}) {
  const load = () => Promise.all([attempt(() => call('getCard', { collectionId, cardId })), attempt(() => call('getCollection', { collectionId }))]);
  const first = await load();
  if (!first[0] || !first[1]) return;
  // what the panel shows, read again in place by reload() after an action or a live change
  /** @type {any} */ let data, /** @type {any} */ col, /** @type {any} */ s, /** @type {any} */ set, /** @type {any[]} */ versions = [], /** @type {any} */ proc;
  /** @type {any} */ let running;
  /** @type {string[]} */ let busy = [];
  let blocked = false;
  /**
   * @param {any[]} got  [getCard, getCollection]
   * @param {any} [job]  a job of this card just started here, until its first live event arrives
   */
  const take = ([d, c], job) => {
    data = d; col = c;
    s = data.summary ?? { id: cardId, title: data.order.title ?? cardId, status: 'new' };
    set = s.setId ? col.sets.find((/** @type {any} */ x) => x.id === s.setId) : null;
    versions = data.attempts;
    proc = data.processing;
    const started = job ? jobs.get(job.id) ?? job : null;
    running = [...jobs.values()].find(j => j.status === 'running' && j.scope?.cardId === cardId) ?? (started?.status === 'running' ? started : undefined);
    // a long operation on this card from anywhere — a set's job, an agent's ccf.mjs — holds the card's actions too: the
    // core keeps every result either way, but a person's choice or processing made meanwhile would be overtaken by it
    busy = s.busy ?? [];
    blocked = !!running || busy.length > 0;
  };
  take(first);
  let wish = typed;
  /** an action's call is under way: further clicks wait for it (no double sends) */
  let pending = false;
  /** how «Сделать заново» goes: regenerate | edit (kept while the panel is drawn over) */
  let wishMode = 'regenerate';

  /** @type {number|null} the version shown */
  let cur = versions.some(a => a.n === version) ? /** @type {number} */ (version) : data.chosen ?? versions.at(-1)?.n ?? null;
  const shown = () => versions.find(a => a.n === cur) ?? null;
  /** the explanation of a check id in the page's language @param {string} id */
  const explain = id => data.explain.checks[id]?.[lang()] ?? data.explain.checks[id]?.ru ?? id;

  const { sheet, body, close } = openSheet({ title: s.title, wide: true, body: '', onClose: () => off() });

  // ---------- the parts of the panel that belong to the version shown ----------

  /** The vision model's pick among the versions that made the shown version the card, when it did. @param {any} a */
  function pickHtml(a) {
    if (!a || data.chosenBy !== 'look' || a.n !== data.chosen) return '';
    const holder = [...versions].reverse().find(x => x.pick?.best === a.n);
    if (!holder) return '';
    const ns = holder.pick.ns.join(', ');
    return `<p class="pickline">${I.eye}<span>${esc(holder.pick.reason ? t('picked', { ns }) : t('pickedNoReason', { ns }))}${holder.pick.reason ? ` <span class="pickline__why">${esc(holder.pick.reason)}</span>` : ''}</span></p>`;
  }

  /** The verdict in words and what was found, grouped: the automatic checks, then the vision model. @param {any} a */
  function summaryHtml(a) {
    if (!a) return '';
    const state = stateOf(a);
    if (state === 'failed') return `<section class="csum csum--problem"><div class="csum__head"><span class="csum__icon">${I.alert}</span><div><p class="csum__title">${esc(t('failed'))}</p><p class="csum__sub">${esc(t('failedSub'))}</p></div></div>
      <ul class="reasons"><li><span>${esc(a.error.message)}</span></li></ul></section>`;
    if (state === 'none') return `<p class="ink-3">${esc(t('noChecks'))}</p>`;
    const kind = state === 'problem' ? 'problem' : state === 'look' ? 'look' : 'ok';
    const icon = { problem: I.alert, look: I.eye, ok: I.check }[kind];
    const sub = kind === 'ok' ? (a.look && a.look.verdict !== 'unknown' ? t('okSub') : t('okSubNoLook')) : t(kind === 'look' ? 'lookSub' : 'problemSub');
    const results = /** @type {any[]} */ (a.details?.results ?? []);
    const outline = new Set((a.check?.fails ?? []).filter((/** @type {any} */ f) => f.needsMask).map((/** @type {any} */ f) => f.id));
    const found = [...results.filter(r => r.status === 'FAIL'), ...results.filter(r => r.status === 'WARN')];
    const checksList = found.map(r => {
      const tag = r.status === 'WARN' ? t('tagWarn') : outline.has(r.id) ? t('tagEyes') : t('tagFail');
      return `<li><span>${esc(explain(r.id))}</span><span class="reasons__tag reasons__tag--${r.status === 'FAIL' && !outline.has(r.id) ? 'fail' : 'warn'}">${esc(tag)}</span></li>`;
    }).join('');
    const look = a.look;
    const issues = /** @type {any[]} */ (look?.issues ?? []);
    const lookList = issues.map(i => {
      const what = i.kind === 'checklist' ? explain(i.id) : t(/** @type {any} */ (`kind_${i.kind}`));
      return `<li><span><b>${esc(what.replace(/[.\s]+$/, ''))}.</b> ${esc(i.what)}</span><span class="reasons__tag reasons__tag--${i.blocking ? 'fail' : 'warn'}">${esc(i.blocking ? t('tagFail') : t('tagWarn'))}</span></li>`;
    }).join('');
    const lookLine = !look ? t('lookOff') : look.verdict === 'unknown' ? t('lookUnknown', { why: look.error ? `: ${look.error}` : '' }) : issues.length ? '' : t('lookNone');
    return `<section class="csum csum--${kind}"><div class="csum__head"><span class="csum__icon">${icon}</span><div><p class="csum__title">${esc(t(kind))}</p><p class="csum__sub">${esc(sub)}</p></div></div>
      ${checksList ? `<div class="csum__group"><p class="csum__label">${esc(t('byChecks'))}</p><ul class="reasons">${checksList}</ul></div>` : ''}
      <div class="csum__group"><p class="csum__label">${esc(t('byLook'))}</p>${lookList ? `<ul class="reasons">${lookList}</ul>` : `<p class="csum__sub">${esc(lookLine)}</p>`}</div>
      ${howHtml(a)}</section>`;
  }

  /** «Как проверяли»: the bible's areas in words, then every measurement and the checklist for eyes. @param {any} a */
  function howHtml(a) {
    const results = /** @type {any[]} */ (a.details?.results ?? []);
    const visual = /** @type {any[]} */ (a.details?.visual ?? []);
    const groups = /** @type {Record<string, any>} */ (data.explain.groups);
    const rows = Object.entries(groups).map(([g, name]) => {
      const mine = results.filter(r => r.id.split('.')[0] === g && r.status !== 'N/A');
      if (!mine.length) return '';
      const fails = mine.filter(r => r.status === 'FAIL').length, warns = mine.filter(r => r.status === 'WARN').length;
      const [dot, said] = fails ? ['fail', t('groupFail', { n: fails, w: plural(fails, W.problem) })] : warns ? ['warn', t('groupWarn', { n: warns })] : ['done', t('inNorm')];
      return `<li><i class="dot dot--${dot}"></i><span>${esc(name[lang()] ?? name.ru)}</span><span class="ink-3">${esc(said)}</span></li>`;
    }).join('');
    const issues = a.look?.issues ?? [];
    const drawn = !a.look || a.look.verdict === 'unknown' ? ['warn', t('drawnNone')] : issues.length ? [issues.some((/** @type {any} */ i) => i.blocking) ? 'fail' : 'warn', t('drawnIssues', { n: issues.length, w: plural(issues.length, W.remark) })] : ['done', t('drawnOk')];
    const shownResults = results.filter(r => r.status !== 'PASS' && r.status !== 'N/A');
    const all = shownResults.length || visual.length ? `<details class="disclose"><summary>${I.chev}<span>${esc(t('all'))}</span></summary>
        ${shownResults.length ? `<ul class="checks">${shownResults.map(r => `<li><span class="badge badge--${r.status === 'FAIL' ? 'fail' : 'warn'}">${esc(r.status === 'NOT_MEASURED' ? '—' : r.status)}</span><span>${esc(explain(r.id))}<br><span class="data ink-3">${esc(r.id)} · ${r.status === 'NOT_MEASURED' ? esc(t('notMeasured')) : `${esc(typeof r.value === 'object' ? JSON.stringify(r.value) : r.value)}${r.threshold ? ` · ${esc(r.threshold)}` : ''}`}</span></span></li>`).join('')}</ul>` : ''}
        ${visual.length ? `<p class="csum__label">${esc(t('eyes'))}</p><ul class="checks checks--eyes">${visual.map(x => `<li><span class="ink-3 data">${esc(x.id ?? `${x.doc} #${x.check}`)}</span><span>${esc(explain(x.id ?? ''))}</span></li>`).join('')}</ul>` : ''}
      </details>` : '';
    return `<details class="disclose csum__how"><summary>${I.chev}<span>${esc(t('how'))}</span></summary><div class="csum__howbody"><ul class="howchecked">${rows}
      <li><i class="dot dot--${drawn[0]}"></i><span>${esc(t('drawn'))}</span><span class="ink-3">${esc(drawn[1])}</span></li></ul>${all}</div></details>`;
  }

  /** The processing sliders of the version, with their actions. @param {any} a */
  function procHtml(a) {
    const canAdjust = !!a?.files?.preparedUrl;
    const head = `<div class="cardp__sec-head"><span class="sec-head__l"><span class="label">${esc(t('proc', { n: a?.n ?? '' }))}</span>${tip(t('procTip'))}</span></div>`;
    if (!canAdjust) return `${head}<p class="ink-3">${esc(t('procNone'))}</p>`;
    const sat = proc.manual?.saturation ?? proc.bounds.saturation;
    const ranges = {
      sharpen: [0, Math.max(proc.sharpenMax, applied.sharpen)],
      saturation: [Math.min(sat.min, applied.saturation), Math.max(sat.max, applied.saturation)],
      brightness: [Math.min(proc.bounds.brightness.min, applied.brightness), Math.max(proc.bounds.brightness.max, applied.brightness)],
      shadows: [0, Math.max(proc.bounds.shadows?.max ?? 0, applied.shadows)],
    };
    const sliders = SLIDERS.filter(sl => sl.key !== 'shadows' || ranges.shadows[1] > 0).map(sl => `<div class="slider" data-slider="${sl.key}"><span class="slider__label">${esc(t(sl.key))}<i class="slider__changed"></i></span><span class="slider__value" data-value>${sl.fmt(applied[sl.key])}</span>
        <button type="button" class="btn btn--text btn--icon btn--s" data-reset="${sl.key}" aria-label="${esc(t('resetOne', { what: t(sl.key).toLowerCase() }))}" disabled>${I.reset}</button>
        <input type="range" min="${ranges[sl.key][0]}" max="${ranges[sl.key][1]}" step="${sl.step}" value="${applied[sl.key]}" aria-label="${esc(t(sl.key))}"></div>`).join('');
    return `${head}${sliders}<span class="field__hint">${esc(a.processingFixed ? t('procByHand') : t('procAuto'))}</span>
      <div class="procacts"><span class="procacts__l"><button type="button" class="btn btn--text btn--s" data-reset-all disabled><span>${esc(t('reset'))}</span></button>${a.processingFixed ? `<button type="button" class="btn btn--text btn--s" data-auto ${blocked ? 'disabled' : ''}><span>${esc(t('auto'))}</span></button>` : ''}</span>
        <button type="button" class="btn btn--secondary btn--s" data-apply disabled>${esc(t('apply'))}</button></div>`;
  }

  /** «Сделать заново»: its hint, placeholder and button follow the mode and whether the version has findings. */
  function syncWish() {
    const a = shown();
    const edit = wishMode === 'edit' && !!a?.files?.original;
    const box = /** @type {HTMLTextAreaElement|null} */ (body.querySelector('[data-wish]'));
    if (!box) return;
    for (const b of body.querySelectorAll('[data-wish-mode] > button')) {
      const v = /** @type {HTMLElement} */ (b).dataset.v;
      b.setAttribute('aria-pressed', String(v === (edit ? 'edit' : 'regenerate')));
      if (v === 'edit') /** @type {HTMLButtonElement} */ (b).disabled = !a?.files?.original;
    }
    box.placeholder = edit ? t('editPh') : t('wishPh');
    const fix = a?.check && (a.check.fails?.some((/** @type {any} */ f) => !f.needsMask) || a.look?.issues?.length);
    /** @type {HTMLElement} */ (body.querySelector('[data-wish-hint]')).textContent = edit ? t('editHint', { n: a?.n }) : fix ? t('regenHintFix') : t('regenHint');
    const go = /** @type {HTMLElement} */ (body.querySelector('[data-wish-go]'));
    go.innerHTML = `${edit ? I.edit : I.redo}<span>${esc(edit ? t('editGo') : t('redoGo'))}</span>`;
  }

  // ---------- the image and the live preview ----------
  /** @type {Record<string, number>} */
  let applied = {};
  /** @type {Record<string, number>} */
  const values = {};
  /** @type {{pixels: Uint8ClampedArray, width: number, height: number}|null} */
  let src = null;
  /** @type {CanvasRenderingContext2D|null} */
  let ctx = null;
  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  /** the fill whose images may still be drawn: a slower image of an earlier fill must not cover a newer one */
  let fills = 0;
  /** Decoded images of this panel by URL (a rewritten file gets a new URL), so flipping versions draws at once. */
  /** @type {Map<string, Promise<{pixels: Uint8ClampedArray, width: number, height: number}>>} */
  const decoded = new Map();
  /** @param {string} url */
  const pixels = url => {
    let p = decoded.get(url);
    if (!p) { p = pixelsOf(url); decoded.set(url, p); p.catch(() => decoded.delete(url)); }
    return p;
  };
  /** @param {{pixels: Uint8ClampedArray, width: number, height: number}} p */
  const paint = p => {
    if (!canvas || !ctx) return;
    canvas.width = p.width; canvas.height = p.height;
    ctx.putImageData(new ImageData(p.pixels, p.width, p.height), 0, 0);
  };

  /** @param {string} name @param {string} html */
  const part = (name, html) => { const el = body.querySelector(`[data-part="${name}"]`); if (el) el.innerHTML = html; };

  /**
   * Fills the parts of the panel that belong to the version shown — the image, the version bar and strip, the summary,
   * the processing — in place: the rest of the panel (the wish typed, the move, the scroll) is not drawn again.
   */
  function fill() {
    const a = shown();
    const i = versions.indexOf(a);
    const isCard = !!a && a.n === data.chosen;
    applied = a?.processing ? flat(a.processing) : flat(proc.neutral);
    Object.assign(values, applied);
    part('vbar', versions.length ? `<button type="button" class="btn btn--secondary btn--icon btn--s" data-ver="-1" aria-label="${esc(t('prev'))}" ${i <= 0 ? 'disabled' : ''}>${I.back}</button>
        <span class="vbar__text"><b>${esc(t('version', { n: a?.n ?? '—' }))}</b><span class="ink-3"> ${esc(t('of', { total: versions.length }))}</span>${isCard ? `<span class="vbar__card">${I.check}${esc(t('theCard'))}</span>` : ''}</span>
        <button type="button" class="btn btn--secondary btn--icon btn--s" data-ver="1" aria-label="${esc(t('next'))}" ${i >= versions.length - 1 ? 'disabled' : ''}>${I.next}</button>` : '');
    for (const b of body.querySelectorAll('[data-show]')) {
      const on = Number(/** @type {HTMLElement} */ (b).dataset.show) === cur;
      b.classList.toggle('is-current', on);
      b.setAttribute('aria-pressed', String(on));
    }
    part('meta', a ? esc(`${modelName(a.model)} · ${spendText(a)}`) : '');
    part('choose', a && !isCard && a.files?.cardUrl ? `<button type="button" class="btn btn--secondary" data-choose ${blocked ? 'disabled' : ''}>${I.check}<span>${esc(t('makeCard'))}</span></button>` : '');
    part('pick', pickHtml(a));
    part('summary', summaryHtml(a));
    part('proc', procHtml(a));
    syncWish();

    // the card's own image, until a slider moves; the preview is computed over the prepared image. The canvas keeps the
    // image drawn so far until the next one is decoded, so flipping does not blink.
    if (!canvas) { canvas = /** @type {HTMLCanvasElement} */ (body.querySelector('[data-canvas]')); ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { colorSpace: 'srgb' })); }
    /** @type {HTMLElement} */ (body.querySelector('[data-empty]')).hidden = !!a?.files?.cardUrl;
    src = null;
    const my = ++fills;
    if (a?.files?.cardUrl) pixels(a.files.cardUrl).then(p => { if (my === fills && !changed()) paint(p); }).catch(() => {});
    if (a?.files?.preparedUrl) pixels(a.files.preparedUrl).then(p => { if (my !== fills) return; src = p; if (changed()) draw(); }).catch(() => toast(t('readFail'), { kind: 'fail' }));
    syncSliders();
  }

  /** The panel whole, drawn over in place: at opening, and after an action or a live change (reload). */
  function build() {
    const busyLine = running ? jobline(running) : busy.length ? `<div class="jobline panel"><i class="dot dot--work"></i><span class="jobline__title">${esc(t('busyTitle'))}</span><span class="lookline ink-2">${esc(t('busyText', { what: busy.map(w => t(/** @type {any} */ (`busy_${w}`))).join(', ') }))}</span></div>` : '';
    const strip = versions.length > 1 ? `<div class="vstrip">${versions.map(x => `<button type="button" data-show="${x.n}" aria-pressed="false" aria-label="${esc(t('versionN', { n: x.n }))}${x.n === data.chosen ? ` · ${esc(t('isCard'))}` : ''}">
        <span class="thumb__img">${x.files.cardUrl ? `<img src="${esc(x.files.cardUrl)}" alt="" loading="lazy">` : `<span class="thumb__empty">${I.alert}</span>`}</span>
        <span class="vstrip__n">${x.n === data.chosen ? I.check : ''}${x.n}</span></button>`).join('')}</div>` : '';
    const now = set ? t('nowSet', { set: set.title, n: s.slot + 1 }) : t('nowPool');
    const off_ = blocked ? 'disabled' : '';
    body.innerHTML = `<div class="cardp">
      <div class="cardp__figure"><div class="cardp__img thumb__img"><canvas data-canvas aria-label="${esc(s.title)}"></canvas><span class="thumb__empty" data-empty hidden>${I.image}</span></div>
        <div class="vbar" data-part="vbar"></div>
        ${strip}
        <p class="vbar__meta data ink-3" data-part="meta"></p>
        <div class="vbar__act" data-part="choose"></div>
        <div data-part="pick"></div></div>
      <div class="cardp__side">
        <div data-part="summary"></div>
        ${busyLine}
        <section class="cardp__sec" aria-label="${esc(t('redo'))}"><div class="field"><span class="label">${esc(t('redo'))}</span>
          <span class="seg" role="group" data-wish-mode><button type="button" data-v="regenerate" aria-pressed="true">${esc(t('regen'))}</button><button type="button" data-v="edit" aria-pressed="false">${esc(t('edit'))}</button></span>
          <textarea class="input" rows="2" data-wish>${esc(wish)}</textarea>
          ${textHelp('cardWish')}
          <span class="field__hint" data-wish-hint></span></div>
          <div class="row"><button type="button" class="btn btn--primary" data-wish-go ${off_}></button></div></section>
        <section class="cardp__sec" aria-label="${esc(t('move'))}"><div class="field"><span class="label">${esc(t('move'))}</span>
          <div class="move"><span class="select"><select class="input" data-move-set><option value="">${esc(t('pool'))}</option>${col.sets.map((/** @type {any} */ x) => `<option value="${esc(x.id)}" ${x.id === s.setId ? 'selected' : ''}>${esc(`${x.number != null ? `${String(x.number).padStart(2, '0')} · ` : ''}${x.title}`)}</option>`).join('')}</select></span>
            <span class="select"><select class="input" data-move-slot ${s.setId ? '' : 'disabled'}>${Array.from({ length: 10 }, (_, k) => `<option value="${k}" ${k === s.slot ? 'selected' : ''}>${esc(t('place', { n: k + 1 }))}</option>`).join('')}</select></span>
            <button type="button" class="btn btn--secondary" data-move>${esc(t('moveGo'))}</button></div>
          <span class="field__hint">${esc(`${now} ${t('swap')}`)}</span></div></section>
        <section class="cardp__sec" aria-label="${esc(t('proc', { n: '' }))}" data-part="proc"></section>
        <details class="disclose cardp__sec"><summary>${I.chev}<span>${esc(t('more'))}</span></summary><div class="cardp__more">
          <div class="field"><span class="field__label">${esc(t('own'))}</span>
            <label class="btn btn--secondary filepick${blocked ? ' is-disabled' : ''}">${I.image}<span>${esc(t('ownPick'))}</span><input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" data-import ${off_}></label>
            <span class="field__hint">${esc(t('ownHint'))}</span></div>
          <div class="row"><button type="button" class="btn btn--secondary" data-folder>${I.folder}<span>${esc(t('folder'))}</span></button><button type="button" class="btn btn--secondary" data-export>${I.download}<span>${esc(t('export'))}</span></button></div>
          <div class="danger-zone"><button type="button" class="btn btn--danger" data-delete>${I.trash}<span>${esc(t('del'))}</span></button></div>
        </div></details>
      </div></div>`;
    canvas = null;
    fill();
    // the other versions' images, ready for the arrows
    for (const x of versions) if (x.files?.cardUrl) pixels(x.files.cardUrl).catch(() => {});
  }

  let loads = 0;
  /** what a reload overtaken by a newer one asked for, carried over to it @type {{version?: number|null, job?: any}} */
  let asked = {};
  /**
   * Reads the card again and draws the panel over in place (it is not closed and opened again), keeping the wish
   * typed, the mode, the scroll and the focus.
   * @param {{version?: number|null, job?: any}} [o]  the version to show (null: the card; default: the one shown);
   *   job: a job of this card just started here
   */
  async function reload(o = {}) {
    asked = { ...asked, ...o };
    const my = ++loads;
    const got = await load();
    if (my !== loads || !body.isConnected || !got[0] || !got[1]) return;
    const { version: v, job } = asked;
    asked = {};
    wish = /** @type {HTMLTextAreaElement|null} */ (body.querySelector('[data-wish]'))?.value ?? wish;
    take(got, job);
    if (v !== undefined) cur = v;
    if (!versions.some(a => a.n === cur)) cur = data.chosen ?? versions.at(-1)?.n ?? null;
    const y = body.scrollTop;
    const typing = /** @type {HTMLTextAreaElement|null} */ (body.querySelector('[data-wish]:focus'));
    const caret = typing ? [typing.selectionStart, typing.selectionEnd] : null;
    const opened = [...body.querySelectorAll('details')].map(d => d.open);
    build();
    [...body.querySelectorAll('details')].forEach((d, k) => { if (opened[k] !== undefined) d.open = opened[k]; });
    body.scrollTop = y;
    if (caret) { const w = /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-wish]')); w.focus({ preventScroll: true }); w.setSelectionRange(caret[0], caret[1]); }
  }

  let frame = 0;
  const draw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const a = shown();
      if (!src || !canvas || !ctx || !a) return;
      const out = adjust(src.pixels, src.width, src.height, settingsOf(values, a.processing ?? proc.neutral));
      canvas.width = src.width; canvas.height = src.height;
      ctx.putImageData(new ImageData(out, src.width, src.height), 0, 0);
    });
  };
  const changed = () => SLIDERS.some(sl => values[sl.key] !== applied[sl.key]);
  function syncSliders() {
    for (const sl of SLIDERS) {
      const el = /** @type {HTMLElement|null} */ (body.querySelector(`[data-slider="${sl.key}"]`));
      if (!el) continue;
      const input = /** @type {HTMLInputElement} */ (el.querySelector('input'));
      input.value = String(values[sl.key]);
      const p = ((values[sl.key] - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
      input.style.setProperty('--p', `${p}%`);
      /** @type {HTMLElement} */ (el.querySelector('[data-value]')).textContent = sl.fmt(values[sl.key]);
      const diff = values[sl.key] !== applied[sl.key];
      el.classList.toggle('is-changed', diff);
      /** @type {HTMLButtonElement} */ (el.querySelector('[data-reset]')).disabled = !diff;
    }
    for (const b of body.querySelectorAll('[data-reset-all]')) /** @type {HTMLButtonElement} */ (b).disabled = !changed();
    for (const b of body.querySelectorAll('[data-apply]')) /** @type {HTMLButtonElement} */ (b).disabled = !changed() || blocked || pending;
  }
  build();
  bindTextHelp(body, () => ({ collectionId, context: { collection: col.collection.title, card: s.title } }),
    ({ notes }) => call('proposeCardWish', { collectionId, cardId, n: cur, notes, language: lang() }));

  sheet.addEventListener('input', e => {
    const tg = /** @type {HTMLElement} */ (e.target);
    if (tg.matches('[data-wish]')) { wish = /** @type {HTMLTextAreaElement} */ (tg).value; return; }
    const el = tg.closest('[data-slider]');
    if (!el) return;
    values[/** @type {string} */ (/** @type {HTMLElement} */ (el).dataset.slider)] = Number(/** @type {HTMLInputElement} */ (tg).value);
    syncSliders();
    draw();
  });

  // ---------- actions ----------
  /**
   * Runs one action on the card: refused while the card is busy or another action's call is under way, its buttons
   * held meanwhile.
   * @template T @param {() => Promise<T>} fn @returns {Promise<T|undefined>}
   */
  const act = async fn => {
    if (blocked || pending) return undefined;
    pending = true;
    const held = [...sheet.querySelectorAll('[data-choose], [data-apply], [data-auto], [data-wish-go], [data-import], [data-move], [data-delete]')].filter(b => !(/** @type {HTMLButtonElement} */ (b).disabled));
    for (const b of held) /** @type {HTMLButtonElement} */ (b).disabled = true;
    try { return await fn(); } finally {
      pending = false;
      if (body.isConnected) { for (const b of held) /** @type {HTMLButtonElement} */ (b).disabled = false; syncSliders(); }
    }
  };
  /** @param {number|null} n */
  const show = async n => {
    if (n == null || n === cur) return;
    if (changed() && !(await confirmDialog({ title: t('leaveQ'), text: t('leaveText', { n: cur }), yes: t('leaveYes'), no: t('leaveNo'), icon: I.alert }))) return;
    cur = n;
    fill();
  };
  sheet.addEventListener('keydown', e => {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/** @type {HTMLElement} */ (e.target).closest('input, textarea, select')) {
      const i = versions.findIndex(a => a.n === cur) + (e.key === 'ArrowLeft' ? -1 : 1);
      if (versions[i]) show(versions[i].n);
    }
  });
  sheet.addEventListener('change', e => {
    const tg = /** @type {HTMLElement} */ (e.target);
    if (tg.matches('[data-move-set]')) /** @type {HTMLSelectElement} */ (body.querySelector('[data-move-slot]')).disabled = !(/** @type {HTMLSelectElement} */ (tg).value);
  });
  sheet.addEventListener('click', async e => {
    const tg = /** @type {HTMLElement} */ (e.target);
    const step = /** @type {HTMLElement|null} */ (tg.closest('[data-ver]'));
    if (step) { const i = versions.findIndex(a => a.n === cur) + Number(step.dataset.ver); if (versions[i]) show(versions[i].n); return; }
    const pick = /** @type {HTMLElement|null} */ (tg.closest('[data-show]'));
    if (pick) { show(Number(pick.dataset.show)); return; }
    if (tg.closest('[data-choose]')) {
      const n = cur;
      const r = await act(() => attempt(() => call('chooseAttempt', { collectionId, cardId, n })));
      if (r) { toast(t('chosen', { n }), { kind: 'done' }); app.refresh(); reload(); }
      return;
    }
    const mode = /** @type {HTMLElement|null} */ (tg.closest('[data-wish-mode] > button'));
    if (mode) { e.preventDefault(); wishMode = /** @type {string} */ (mode.dataset.v); syncWish(); return; }
    const reset = /** @type {HTMLElement|null} */ (tg.closest('[data-reset]'));
    if (reset) { values[/** @type {string} */ (reset.dataset.reset)] = applied[/** @type {string} */ (reset.dataset.reset)]; syncSliders(); draw(); return; }
    if (tg.closest('[data-reset-all]')) { Object.assign(values, applied); syncSliders(); draw(); return; }
    if (tg.closest('[data-apply]')) {
      const r = await act(() => attempt(() => call('adjustCard', { collectionId, cardId, n: cur, saturation: values.saturation, brightness: values.brightness, sharpen: values.sharpen, shadows: values.shadows })));
      if (r) { toast(t('applied'), { kind: 'done' }); reload(); }
      return;
    }
    if (tg.closest('[data-auto]')) {
      const r = await act(() => attempt(() => call('adjustCard', { collectionId, cardId, n: cur, reset: true })));
      if (r) { toast(t('autoDone'), { kind: 'done' }); reload(); }
      return;
    }
    if (tg.closest('[data-wish-go]')) {
      const text = /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-wish]')).value.trim();
      const edit = wishMode === 'edit' && !!shown()?.files?.original;
      if (edit && !text) { toast(t('editNeedsWish'), { kind: 'fail' }); return; }
      // draw again needs no wish: the version's findings are corrected (core regenerateCard, n = the version shown)
      const r = await act(() => attempt(() => call(edit ? 'editCard' : 'regenerateCard', { collectionId, cardId, n: cur, ...(text ? { wish: text } : {}) })));
      if (r) { /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-wish]')).value = ''; wish = ''; reload({ job: r.job }); }
      return;
    }
    if (tg.closest('[data-move]')) {
      const setId = /** @type {HTMLSelectElement} */ (body.querySelector('[data-move-set]')).value;
      const slot = Number(/** @type {HTMLSelectElement} */ (body.querySelector('[data-move-slot]')).value);
      const r = await act(() => attempt(() => call('moveCard', setId ? { collectionId, cardId, setId, slot } : { collectionId, cardId, pool: true })));
      if (r !== undefined) { toast(setId ? t('moved') : t('movedPool'), { kind: 'done' }); app.refresh(); reload(); }
      return;
    }
    if (tg.closest('[data-export]')) { close(); openExport({ collection: col.collection, sets: col.sets, set: set ?? undefined, cardId, cardTitle: s.title }); return; }
    if (tg.closest('[data-folder]')) {
      // the version shown: the card's own image when it is the card, else the version's folder
      const a = shown();
      const target = a && a.n !== data.chosen && a.files?.card ? a.files.card : data.dir;
      await attempt(() => call('openFolder', { collectionId, path: target }));
      return;
    }
    if (tg.closest('[data-delete]')) {
      if (!(await confirmDialog({ title: t('delQ', { title: s.title }), text: t('delText'), yes: t('delYes'), no: t('delNo') }))) return;
      if (await attempt(() => call('deleteCard', { collectionId, cardId })) !== undefined) { close(); app.refresh(); }
    }
  });
  body.addEventListener('change', async e => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!input.matches('[data-import]')) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file || blocked || pending) return;
    const r = await act(async () => {
      const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
      toast(t('importing'));
      return attempt(() => call('importImage', { collectionId, cardId, data: dataUrl }));
    });
    if (r) { toast(t('imported'), { kind: 'done' }); reload({ version: r.chosen }); }
  });

  // ---------- live: the card changed elsewhere, or its job moved on ----------
  const off = onEvent(e => {
    if (!body.isConnected) return;
    if (e.type === 'job' && e.job.scope?.cardId === cardId) {
      if (e.job.status !== 'running') reload({ version: null });
      else body.querySelector(`[data-jobline="${e.job.id}"]`)?.replaceWith(fromHtml(jobline(e.job)));
    }
    // a job of this editor reloads the panel when it ends (above); a busy card reloads on its changes, so it frees itself
    if (e.type === 'store' && e.entity === 'card' && e.id === cardId && !changed() && !running && !pending) reload();
  });
}
