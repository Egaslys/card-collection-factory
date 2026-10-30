// The card panel: the card big with its versions (every attempt is a version; arrows flip them, «Сделать карточкой»
// makes the version shown the card), what the style's checks and the vision model say about the version shown, a
// wish to generate the card again or edit the version, the processing sliders of the version with a live preview —
// computed here by core/image/adjust.js over the version's prepared.png, the same code that writes the final card —
// and the list of versions with what each cost. Rare things (move, own image, export, delete) sit under «Ещё».
import { adjust } from '/core/image/adjust.js';
import { call, jobs, onEvent } from '../api.js';
import { attempt, badge, bindTextHelp, esc, fromHtml, I, jobline, modelName, openSheet, textHelp, toast, usd, verdict } from '../ui.js';
import { app } from '../state.js';
import { openExport } from './export.js';

/** The sliders: key, label, how the value reads, and where it sits in the settings object of adjust.js. */
const SLIDERS = [
  { key: 'sharpen', label: 'Резкость', fmt: (/** @type {number} */ v) => v.toFixed(2), step: 0.01 },
  { key: 'saturation', label: 'Насыщенность', fmt: (/** @type {number} */ v) => `×${v.toFixed(2)}`, step: 0.01 },
  { key: 'brightness', label: 'Яркость', fmt: (/** @type {number} */ v) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)), step: 1 },
  { key: 'shadows', label: 'Тени', fmt: (/** @type {number} */ v) => (v > 0 ? `+${v.toFixed(0)}` : '0'), step: 1 },
];

/** @param {any} p  AdjustSettings @returns {Record<string, number>} */
const flat = p => ({ sharpen: p.sharpen.amount, saturation: p.saturation, brightness: p.brightness, shadows: p.shadows ?? 0 });
/** @param {Record<string, number>} v @param {any} base */
const settingsOf = (v, base) => ({ ...base, brightness: v.brightness, saturation: v.saturation, shadows: v.shadows, sharpen: { ...base.sharpen, amount: v.sharpen } });

/** The long operations core/card marks on a card (card-file.js markBusy), for a person. */
const BUSY_WORDS = /** @type {Record<string, string>} */ ({ make: 'генерация', regenerate: 'перегенерация', edit: 'правка картинки', import: 'проверка своей картинки' });

/** Spend for a person: the image and, when the vision model was asked, its part. @param {{images: number, vision: number}} sp */
const spendText = sp => (sp.vision ? `картинка ${usd(sp.images)} · взгляд ${usd(sp.vision)}` : usd(sp.images));

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

/** The checks of one version in plain words, from its summary (card.json) or, for a version that failed, its error. @param {any} a */
const verdictOf = a => verdict(a.check ? { ...a.check, needsEyes: a.check.needsEyes ?? a.check.fails.length - a.check.blocking } : null, a.error ? 'failed' : 'made');

/** What the vision model said about a version: its issues, or that it found none. @param {any} a */
function lookHtml(a) {
  const look = a.look;
  if (!look) return '';
  if (look.verdict === 'unknown') return `<p class="ink-3 lookline">Смотрящая модель не дала ответа${look.error ? `: ${esc(look.error)}` : ''}.</p>`;
  if (!look.issues?.length) return `<p class="ink-3 lookline">Смотрящая модель (${esc(modelName(look.model))}) сверила с заказом: замечаний нет.</p>`;
  return `<p class="label">Что увидела смотрящая модель</p><ul class="checks">${look.issues.map((/** @type {any} */ i) => `<li><span class="badge badge--${i.blocking ? 'fail' : 'warn'}">${i.blocking ? 'FAIL' : 'WARN'}</span><span>${i.id ? `<b>${esc(i.id)}</b> ` : ''}${esc(i.what)}</span></li>`).join('')}</ul>`;
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
  let blocked = false, off_ = '', where = '', total = { images: 0, vision: 0 };
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
    off_ = blocked ? 'disabled' : '';
    where = set ? `Набор «${set.title}», место ${s.slot + 1}` : 'В хранилище, вне наборов';
    total = versions.reduce((x, a) => ({ images: x.images + a.spend.images, vision: x.vision + a.spend.vision }), { images: 0, vision: 0 });
  };
  take(first);
  let wish = typed;
  /** an action's call is under way: further clicks wait for it (no double sends) */
  let pending = false;

  /** how the wish is sent: regenerate | edit (kept while the panel is drawn over) */
  let wishMode = 'regenerate';
  /** @param {boolean} edit */
  const wishHint = edit => (edit
    ? `Картинка версии ${cur} уйдёт модели с вашим пожеланием: она поправит только то, о чём вы просите. Результат станет новой версией.`
    : 'Карточка будет сгенерирована заново по своему заказу с вашим пожеланием и станет новой версией.');

  /** @type {number|null} the version shown */
  let cur = versions.some(a => a.n === version) ? /** @type {number} */ (version) : data.chosen ?? versions.at(-1)?.n ?? null;
  const shown = () => versions.find(a => a.n === cur) ?? null;

  const { sheet, body, close } = openSheet({ title: s.title, wide: true, body: '', foot: '', onClose: () => off() });
  const foot = document.createElement('footer');
  foot.className = 'sheet__foot';
  sheet.append(foot);

  // ---------- one render per version shown ----------
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
  /** the render whose images may still be drawn: a slower image of an earlier render must not cover a newer one */
  let renders = 0;
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

  function render() {
    const a = shown();
    const i = versions.indexOf(a);
    const v = a ? verdictOf(a) : verdict(null, s.status);
    applied = a?.processing ? flat(a.processing) : flat(proc.neutral);
    Object.assign(values, applied);
    const ranges = {
      sharpen: [0, Math.max(proc.sharpenMax, applied.sharpen)],
      saturation: [Math.min(proc.bounds.saturation.min, applied.saturation), Math.max(proc.bounds.saturation.max, applied.saturation)],
      brightness: [Math.min(proc.bounds.brightness.min, applied.brightness), Math.max(proc.bounds.brightness.max, applied.brightness)],
      shadows: [0, Math.max(proc.bounds.shadows?.max ?? 0, applied.shadows)],
    };
    const canAdjust = !!a?.files?.preparedUrl;
    const isCard = a && a.n === data.chosen;
    const issues = (a?.details?.results ?? []).filter((/** @type {any} */ r) => r.status !== 'PASS' && r.status !== 'N/A');
    const look = a ? lookHtml(a) : '';
    const edit = wishMode === 'edit' && !!a?.files?.original;
    const details = issues.length || a?.details?.visual?.length ? `<details class="more"><summary class="btn btn--text btn--s"><span>Подробности проверок</span></summary>
        ${issues.length ? `<ul class="checks">${issues.map((/** @type {any} */ r) => `<li><span class="badge badge--${r.status === 'FAIL' ? 'fail' : 'warn'}">${esc(r.status)}</span><span><b>${esc(r.id)}</b> ${esc(r.title)}<br><span class="data ink-3">${esc(typeof r.value === 'object' ? JSON.stringify(r.value) : r.value)}${r.threshold ? ` · ${esc(r.threshold)}` : ''}</span>${r.note ? `<br><span class="ink-3">${esc(r.note)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
        ${a?.details?.visual?.length ? `<p class="label">Проверить глазами</p><ul class="checks checks--eyes">${a.details.visual.map((/** @type {any} */ x) => `<li><span class="ink-3 data">${esc(x.id ?? `${x.doc} #${x.check}`)}</span><span>${esc(x.what)}</span></li>`).join('')}</ul>` : ''}
      </details>` : '';

    const vbar = versions.length ? `<div class="vbar">
        <button type="button" class="btn btn--secondary btn--icon btn--s" data-ver="-1" aria-label="Предыдущая версия" ${i <= 0 ? 'disabled' : ''}>${I.back}</button>
        <span class="vbar__text"><b>Версия ${a?.n ?? '—'}</b><span class="ink-3"> из ${versions.length}</span>${isCard ? '<span class="vbar__card">' + I.check + 'карточка</span>' : ''}</span>
        <button type="button" class="btn btn--secondary btn--icon btn--s" data-ver="1" aria-label="Следующая версия" ${i >= versions.length - 1 ? 'disabled' : ''}>${I.next}</button>
      </div>` : '';
    const choose = a && !isCard && a.files?.cardUrl ? `<button type="button" class="btn btn--secondary" data-choose ${off_}>${I.check}Сделать карточкой</button>` : '';
    const versionsHtml = versions.map(x => `<li><button type="button" class="att${x.n === cur ? ' is-current' : ''}${x.n === data.chosen ? ' is-chosen' : ''}" data-show="${x.n}" aria-pressed="${x.n === cur}">
        <span class="att__img thumb__img">${x.files.cardUrl ? `<img src="${esc(x.files.cardUrl)}" alt="" loading="lazy">` : `<span class="thumb__empty">${I.alert}</span>`}</span>
        <span class="att__text"><span><b>Версия ${x.n}</b>${x.n === data.chosen ? ' · карточка' : ''}${x.wish ? ` · «${esc(x.wish)}»` : ''}</span><span class="data ink-3">${esc(modelName(x.model))} · ${x.cost == null ? 'цена неизвестна' : spendText(x.spend)}</span>${x.error ? `<span class="att__err">${esc(x.error.message)}</span>` : badge(verdictOf(x))}</span></button></li>`).join('');

    body.innerHTML = `<div class="cardp">
      <div class="cardp__figure"><div class="cardp__img thumb__img"><canvas data-canvas aria-label="${esc(s.title)}"></canvas>${!a?.files?.cardUrl ? `<span class="thumb__empty">${I.image}</span>` : ''}</div>
        ${vbar}
        ${a ? `<p class="vbar__meta data ink-3">${esc(modelName(a.model))} · ${a.cost == null ? 'цена неизвестна' : spendText(a.spend)}</p>` : ''}
        ${choose ? `<div class="vbar__act">${choose}</div>` : ''}
        <p class="cardp__where ink-2">${esc(where)}</p></div>
      <div class="cardp__side">
        <div class="verdict">${badge(v)}<span>${esc(v.text)}</span></div>
        ${look}
        ${details}
        ${running ? jobline(running) : busy.length ? `<div class="jobline panel"><i class="dot dot--work"></i><span class="jobline__title">Карточка занята</span><span class="lookline ink-2">идёт ${esc(busy.map(w => BUSY_WORDS[w] ?? w).join(', '))} — действия с карточкой подождут её конца</span></div>` : ''}
        <section class="cardp__sec" aria-label="Пожелание"><div class="field"><span class="label">Пожелание</span>
          <span class="seg" role="group" data-wish-mode><button type="button" data-v="regenerate" aria-pressed="${!edit}">Сделать заново</button><button type="button" data-v="edit" aria-pressed="${edit}" ${a?.files?.original ? '' : 'disabled'}>Поправить картинку</button></span>
          <textarea class="input" rows="2" data-wish placeholder="Например: поплавок крупнее, фон теплее">${esc(wish)}</textarea>
          ${textHelp('cardWish')}
          <span class="field__hint" data-wish-hint>${esc(wishHint(edit))}</span></div>
          <div class="row"><button type="button" class="btn btn--secondary" data-wish-go ${off_}>${I.spark}Отправить</button></div>
        </section>
        <section class="cardp__sec" aria-label="Обработка"><div class="cardp__sec-head"><span class="label">Обработка версии ${a?.n ?? ''}</span></div>
          ${canAdjust ? SLIDERS.filter(sl => sl.key !== 'shadows' || ranges.shadows[1] > 0).map(sl => `<div class="slider" data-slider="${sl.key}"><span class="slider__label">${sl.label}<i class="slider__changed"></i></span><span class="slider__value" data-value>${sl.fmt(applied[sl.key])}</span>
            <button type="button" class="btn btn--text btn--icon btn--s" data-reset="${sl.key}" aria-label="Вернуть ${sl.label.toLowerCase()}" disabled>${I.reset}</button>
            <input type="range" min="${ranges[/** @type {keyof typeof ranges} */ (sl.key)][0]}" max="${ranges[/** @type {keyof typeof ranges} */ (sl.key)][1]}" step="${sl.step}" value="${applied[sl.key]}" aria-label="${sl.label}"></div>`).join('')
            : '<p class="ink-3">У этой версии нет подготовленной картинки — обработку менять не на чем.</p>'}
          ${canAdjust ? `<span class="field__hint">${a.processingFixed ? 'Обработку этой версии задали вручную.' : 'Обработку подобрала программа.'} Предпросмотр считает тот же код, что пишет итоговую картинку; «Применить» сохранит её и проверит заново, «Сбросить» вернёт ползунки к сохранённым значениям.</span>` : ''}
          ${canAdjust && a.processingFixed ? `<div class="row"><button type="button" class="btn btn--text btn--s" data-auto ${off_}><span>Вернуть обработку программы</span></button></div>` : ''}
        </section>
        <section class="cardp__sec" aria-label="Версии"><div class="cardp__sec-head"><span class="label">Версии · ${versions.length}</span><span class="data ink-3" title="Картинки ${usd(total.images)}, взгляд смотрящей модели ${usd(total.vision)}">${usd(total.images + total.vision)}</span></div><ol class="atts">${versionsHtml}</ol></section>
        <details class="more"><summary class="btn btn--text btn--s"><span>Ещё</span></summary><div class="form">
          <div class="field"><span class="field__label">Переместить</span><div class="row row--fill">
            <span class="select"><select class="input" data-move-set><option value="">В хранилище</option>${col.sets.map((/** @type {any} */ x) => `<option value="${esc(x.id)}" ${x.id === s.setId ? 'selected' : ''}>${esc(`${x.number ?? ''} · ${x.title}`)}</option>`).join('')}</select></span>
            <span class="select select--narrow"><select class="input" data-move-slot>${Array.from({ length: 10 }, (_, k) => `<option value="${k}" ${k === s.slot ? 'selected' : ''}>место ${k + 1}</option>`).join('')}</select></span>
            <button type="button" class="btn btn--secondary" data-move>Переместить</button></div><span class="field__hint">Если место занято, карточки поменяются местами; карточка из хранилища вытеснит занявшую место обратно в хранилище.</span></div>
          <div class="field"><span class="field__label">Своя картинка</span><input class="input" type="file" accept="image/png,image/jpeg,image/webp" data-import ${off_}><span class="field__hint">Станет новой версией: программа обрежет её до карточки, найдёт контур, подберёт обработку и проверит так же строго, как сгенерированную.</span></div>
          <div class="row"><button type="button" class="btn btn--secondary" data-export>${I.download}Экспорт</button><button type="button" class="btn btn--secondary" data-folder>${I.folder}Открыть в папке</button></div>
          <div class="row"><button type="button" class="btn btn--text btn--s" data-delete><span>Удалить карточку</span></button></div>
        </div></details>
      </div></div>`;
    foot.innerHTML = canAdjust ? `<button type="button" class="btn btn--secondary" data-reset-all disabled title="Вернуть ползунки к сохранённой обработке этой версии">${I.reset}Сбросить</button><button type="button" class="btn btn--primary" data-apply disabled>Применить обработку</button>` : '';
    foot.hidden = !canAdjust;

    // the image and the live preview: the card's own image, until a slider moves; the preview is computed over the
    // prepared image. The canvas drawn so far stays in place until the new image is decoded, so it does not blink.
    const fresh = /** @type {HTMLCanvasElement} */ (body.querySelector('[data-canvas]'));
    if (canvas && a?.files?.cardUrl) fresh.replaceWith(canvas); else canvas = fresh;
    ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { colorSpace: 'srgb' }));
    src = null;
    const my = ++renders;
    if (a?.files?.cardUrl) pixels(a.files.cardUrl).then(p => { if (my === renders && !changed()) paint(p); }).catch(() => {});
    if (canAdjust) pixels(a.files.preparedUrl).then(p => { if (my !== renders) return; src = p; if (changed()) draw(); }).catch(() => toast('Не получилось прочитать подготовленную картинку версии.', { kind: 'fail' }));
    // the other versions' images, ready for the arrows
    for (const x of versions) if (x.files?.cardUrl) pixels(x.files.cardUrl).catch(() => {});
    syncSliders();
  }

  let loads = 0;
  /** what a reload overtaken by a newer one asked for, carried over to it @type {{version?: number|null, job?: any}} */
  let asked = {};
  /**
   * Reads the card again and draws the panel over in place (it is not closed and opened again), keeping the wish
   * typed and the scroll.
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
    render();
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
    for (const b of foot.querySelectorAll('[data-reset-all]')) /** @type {HTMLButtonElement} */ (b).disabled = !changed();
    for (const b of foot.querySelectorAll('[data-apply]')) /** @type {HTMLButtonElement} */ (b).disabled = !changed() || blocked || pending;
  }
  render();
  bindTextHelp(body, () => ({ collectionId, context: { collection: col.collection.title, card: s.title } }));

  sheet.addEventListener('input', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.matches('[data-wish]')) { wish = /** @type {HTMLTextAreaElement} */ (t).value; return; }
    const el = t.closest('[data-slider]');
    if (!el) return;
    values[/** @type {string} */ (/** @type {HTMLElement} */ (el).dataset.slider)] = Number(/** @type {HTMLInputElement} */ (t).value);
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
  const show = n => {
    if (n == null || n === cur) return;
    if (changed() && !confirm('Обработка этой версии изменена, но не применена. Перейти к другой версии без неё?')) return;
    wish = /** @type {HTMLTextAreaElement|null} */ (body.querySelector('[data-wish]'))?.value ?? wish;
    cur = n;
    render();
  };
  sheet.addEventListener('keydown', e => {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/** @type {HTMLElement} */ (e.target).closest('input, textarea, select')) {
      const i = versions.findIndex(a => a.n === cur) + (e.key === 'ArrowLeft' ? -1 : 1);
      if (versions[i]) show(versions[i].n);
    }
  });
  sheet.addEventListener('click', async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const step = /** @type {HTMLElement|null} */ (t.closest('[data-ver]'));
    if (step) { const i = versions.findIndex(a => a.n === cur) + Number(step.dataset.ver); if (versions[i]) show(versions[i].n); return; }
    const pick = /** @type {HTMLElement|null} */ (t.closest('[data-show]'));
    if (pick) { show(Number(pick.dataset.show)); return; }
    if (t.closest('[data-choose]')) {
      const r = await act(() => attempt(() => call('chooseAttempt', { collectionId, cardId, n: cur })));
      if (r) { toast(`Версия ${cur} — теперь карточка.`, { kind: 'done' }); app.refresh(); reload(); }
      return;
    }
    const mode = /** @type {HTMLElement|null} */ (t.closest('[data-wish-mode] > button'));
    if (mode) {
      e.preventDefault();
      wishMode = /** @type {string} */ (mode.dataset.v);
      for (const b of /** @type {HTMLElement} */ (mode.parentElement).children) b.setAttribute('aria-pressed', String(b === mode));
      /** @type {HTMLElement} */ (body.querySelector('[data-wish-hint]')).textContent = wishHint(wishMode === 'edit');
      return;
    }
    const reset = /** @type {HTMLElement|null} */ (t.closest('[data-reset]'));
    if (reset) { values[/** @type {string} */ (reset.dataset.reset)] = applied[/** @type {string} */ (reset.dataset.reset)]; syncSliders(); draw(); return; }
    if (t.closest('[data-reset-all]')) { Object.assign(values, applied); syncSliders(); draw(); return; }
    if (t.closest('[data-apply]')) {
      const r = await act(() => attempt(() => call('adjustCard', { collectionId, cardId, n: cur, saturation: values.saturation, brightness: values.brightness, sharpen: values.sharpen, shadows: values.shadows })));
      if (r) { toast('Обработка применена, версия проверена заново.', { kind: 'done' }); reload(); }
      return;
    }
    if (t.closest('[data-auto]')) {
      const r = await act(() => attempt(() => call('adjustCard', { collectionId, cardId, n: cur, reset: true })));
      if (r) { toast('Обработка снова подобрана программой, версия проверена заново.', { kind: 'done' }); reload(); }
      return;
    }
    if (t.closest('[data-wish-go]')) {
      const text = /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-wish]')).value.trim();
      if (!text) { toast('Напишите пожелание: что изменить.', { kind: 'fail' }); return; }
      const edit = /** @type {HTMLElement} */ (body.querySelector('[data-wish-mode] [aria-pressed="true"]')).dataset.v === 'edit';
      const r = await act(() => attempt(() => call(edit ? 'editCard' : 'regenerateCard', { collectionId, cardId, wish: text, ...(edit ? { n: cur } : {}) })));
      if (r) { /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-wish]')).value = ''; reload({ job: r.job }); }
      return;
    }
    if (t.closest('[data-move]')) {
      const setId = /** @type {HTMLSelectElement} */ (body.querySelector('[data-move-set]')).value;
      const slot = Number(/** @type {HTMLSelectElement} */ (body.querySelector('[data-move-slot]')).value);
      const r = await act(() => attempt(() => call('moveCard', setId ? { collectionId, cardId, setId, slot } : { collectionId, cardId, pool: true })));
      if (r !== undefined) { toast(setId ? 'Карточка перемещена.' : 'Карточка убрана в хранилище.', { kind: 'done' }); app.refresh(); reload(); }
      return;
    }
    if (t.closest('[data-export]')) { close(); openExport({ collection: col.collection, sets: col.sets, set: set ?? undefined, cardId, cardTitle: s.title }); return; }
    if (t.closest('[data-folder]')) { await attempt(() => call('openFolder', { collectionId, path: data.dir })); return; }
    if (t.closest('[data-delete]')) {
      const b = /** @type {HTMLElement} */ (t.closest('[data-delete]'));
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.innerHTML = '<span>Точно удалить? Нажмите ещё раз — папка уйдёт в корзину</span>'; return; }
      if (await attempt(() => call('deleteCard', { collectionId, cardId })) !== undefined) { close(); app.refresh(); }
    }
  });
  body.addEventListener('change', async e => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!input.matches('[data-import]')) return;
    const file = input.files?.[0];
    if (!file || blocked || pending) return;
    const r = await act(async () => {
      const dataUrl = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
      toast('Проверяю картинку: обрезка, контур, обработка, проверки…');
      return attempt(() => call('importImage', { collectionId, cardId, data: dataUrl }));
    });
    if (r) { toast('Картинка добавлена новой версией.', { kind: 'done' }); reload({ version: r.chosen }); }
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
