// The card panel: the card big, what the style's checks say in plain words, a wish to generate it again or edit
// it, the processing sliders with a live preview — computed here by core/image/adjust.js over the attempt's
// prepared.png, the same code that writes the final card — and the history of attempts. Rare things (move, own
// image, export, delete) sit under «Ещё».
import { adjust } from '/core/image/adjust.js';
import { call, jobs, onEvent } from '../api.js';
import { attempt, badge, esc, fromHtml, I, jobline, openSheet, toast, usd, verdict } from '../ui.js';
import { app } from '../state.js';
import { openExport } from './export.js';

/** The sliders: key, label, how the value reads, and where it sits in the settings object of adjust.js. */
const SLIDERS = [
  { key: 'sharpen', label: 'Резкость', fmt: (/** @type {number} */ v) => v.toFixed(2), step: 0.01 },
  { key: 'saturation', label: 'Насыщенность', fmt: (/** @type {number} */ v) => `×${v.toFixed(2)}`, step: 0.01 },
  { key: 'brightness', label: 'Яркость', fmt: (/** @type {number} */ v) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)), step: 1 },
];

/** @param {any} p  AdjustSettings @returns {Record<string, number>} */
const flat = p => ({ sharpen: p.sharpen.amount, saturation: p.saturation, brightness: p.brightness });
/** @param {Record<string, number>} v @param {any} base */
const settingsOf = (v, base) => ({ ...base, brightness: v.brightness, saturation: v.saturation, sharpen: { ...base.sharpen, amount: v.sharpen } });

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

/** @param {string} collectionId @param {string} cardId */
export async function openCard(collectionId, cardId) {
  const [data, col] = await Promise.all([attempt(() => call('getCard', { collectionId, cardId })), attempt(() => call('getCollection', { collectionId }))]);
  if (!data || !col) return;
  const s = data.summary ?? { id: cardId, title: data.order.title ?? cardId, status: 'new' };
  const chosen = data.attempts.find((/** @type {any} */ a) => a.n === data.chosen);
  const set = s.setId ? col.sets.find((/** @type {any} */ x) => x.id === s.setId) : null;
  const v = verdict(s.checks, s.status);
  const proc = data.processing;
  const applied = chosen?.processing ? flat(chosen.processing) : flat(proc.neutral);
  const ranges = {
    sharpen: [0, Math.max(proc.sharpenMax, applied.sharpen)],
    saturation: [Math.min(proc.bounds.saturation.min, applied.saturation), Math.max(proc.bounds.saturation.max, applied.saturation)],
    brightness: [Math.min(proc.bounds.brightness.min, applied.brightness), Math.max(proc.bounds.brightness.max, applied.brightness)],
  };
  const canAdjust = !!chosen?.files?.preparedUrl;
  const running = [...jobs.values()].find(j => j.status === 'running' && j.scope?.cardId === cardId);

  const issues = (data.check?.results ?? []).filter((/** @type {any} */ r) => r.status !== 'PASS' && r.status !== 'N/A');
  const look = chosen?.look ?? chosen?.check?.look;
  const lookHtml = look?.issues?.length ? `<p class="label">Что увидела смотрящая модель</p><ul class="checks">${look.issues.map((/** @type {any} */ i) => `<li><span class="badge badge--${i.blocking ? 'fail' : 'warn'}">${i.blocking ? 'FAIL' : 'WARN'}</span><span>${i.id ? `<b>${esc(i.id)}</b> ` : ''}${esc(i.what)}</span></li>`).join('')}</ul>` : '';
  const details = issues.length || data.check?.visual?.length || lookHtml ? `<details class="more"><summary class="btn btn--text btn--s"><span>Подробности проверок</span></summary>
      ${issues.length ? `<ul class="checks">${issues.map((/** @type {any} */ r) => `<li><span class="badge badge--${r.status === 'FAIL' ? 'fail' : 'warn'}">${esc(r.status)}</span><span><b>${esc(r.id)}</b> ${esc(r.title)}<br><span class="data ink-3">${esc(typeof r.value === 'object' ? JSON.stringify(r.value) : r.value)}${r.threshold ? ` · ${esc(r.threshold)}` : ''}</span>${r.note ? `<br><span class="ink-3">${esc(r.note)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
      ${lookHtml}
      ${data.check?.visual?.length ? `<p class="label">Проверить глазами</p><ul class="checks checks--eyes">${data.check.visual.map((/** @type {any} */ x) => `<li><span class="ink-3 data">${esc(x.id)}</span><span>${esc(x.what)}</span></li>`).join('')}</ul>` : ''}
    </details>` : '';

  const where = set ? `Набор «${set.title}», место ${s.slot + 1}` : 'В хранилище, вне наборов';
  const attemptsHtml = data.attempts.map((/** @type {any} */ a) => {
    const av = verdict(a.check ? { ...a.check, needsEyes: a.check.needsEyes ?? a.check.fails.length - a.check.blocking } : null, a.error ? 'failed' : 'made');
    return `<li class="att${a.n === data.chosen ? ' is-chosen' : ''}">
      <span class="att__img thumb__img">${a.files.cardUrl ? `<img src="${esc(a.files.cardUrl)}" alt="Попытка ${a.n}" loading="lazy">` : `<span class="thumb__empty">${I.alert}</span>`}</span>
      <span class="att__text"><span><b>${a.n}</b>${a.n === data.chosen ? ' · карточка' : ''}${a.wish ? ` · «${esc(a.wish)}»` : ''}</span><span class="data ink-3">${esc(a.model)} · ${a.cost == null ? 'цена неизвестна' : usd(a.cost)}</span>${a.error ? `<span class="att__err">${esc(a.error.message)}</span>` : badge(av)}</span></li>`;
  }).join('');
  const spent = data.attempts.reduce((/** @type {number} */ x, /** @type {any} */ a) => x + (a.cost ?? 0), 0);

  const { sheet, body, close } = openSheet({
    title: s.title,
    wide: true,
    body: `<div class="cardp">
      <div class="cardp__figure"><div class="cardp__img thumb__img"><canvas data-canvas aria-label="${esc(s.title)}"></canvas>${!s.imageUrl ? `<span class="thumb__empty">${I.image}</span>` : ''}</div>
        <p class="cardp__where ink-2">${esc(where)}</p></div>
      <div class="cardp__side">
        <div class="verdict">${badge(v)}<span>${esc(v.text)}</span></div>
        ${details}
        ${running ? jobline(running) : ''}
        <section class="cardp__sec" aria-label="Пожелание"><span class="label">Пожелание</span>
          <div class="seg" role="group" data-wish-mode><button type="button" data-v="regenerate" aria-pressed="true">Сделать заново</button><button type="button" data-v="edit" aria-pressed="false" ${chosen?.files?.original ? '' : 'disabled'}>Поправить картинку</button></div>
          <textarea class="input" rows="2" data-wish placeholder="Например: поплавок крупнее, фон теплее"></textarea>
          <span class="field__hint" data-wish-hint>Карточка будет сгенерирована заново по своему заказу с вашим пожеланием; лучшая попытка станет карточкой.</span>
          <div class="row"><button type="button" class="btn btn--secondary" data-wish-go ${running ? 'disabled' : ''}>${I.spark}Отправить</button></div>
        </section>
        <section class="cardp__sec" aria-label="Обработка"><div class="cardp__sec-head"><span class="label">Обработка</span></div>
          ${canAdjust ? SLIDERS.map(sl => `<div class="slider" data-slider="${sl.key}"><span class="slider__label">${sl.label}<i class="slider__changed"></i></span><span class="slider__value" data-value>${sl.fmt(applied[sl.key])}</span>
            <button type="button" class="btn btn--text btn--icon btn--s" data-reset="${sl.key}" aria-label="Вернуть ${sl.label.toLowerCase()}" disabled>${I.reset}</button>
            <input type="range" min="${ranges[/** @type {keyof typeof ranges} */ (sl.key)][0]}" max="${ranges[/** @type {keyof typeof ranges} */ (sl.key)][1]}" step="${sl.step}" value="${applied[sl.key]}" aria-label="${sl.label}"></div>`).join('')
            : '<p class="ink-3">У этой карточки нет подготовленной картинки — обработку менять не на чем.</p>'}
          <span class="field__hint">Предпросмотр считает тот же код, что пишет итоговую карточку. «Применить» сохранит карточку и проверит её заново.</span>
        </section>
        <section class="cardp__sec" aria-label="Попытки"><div class="cardp__sec-head"><span class="label">Попытки · ${data.attempts.length}</span><span class="data ink-3">${usd(spent)}</span></div><ol class="atts">${attemptsHtml}</ol></section>
        <details class="more"><summary class="btn btn--text btn--s"><span>Ещё</span></summary><div class="form">
          <div class="field"><span class="field__label">Переместить</span><div class="row row--fill">
            <span class="select"><select class="input" data-move-set><option value="">В хранилище</option>${col.sets.map((/** @type {any} */ x) => `<option value="${esc(x.id)}" ${x.id === s.setId ? 'selected' : ''}>${esc(`${x.number ?? ''} · ${x.title}`)}</option>`).join('')}</select></span>
            <span class="select select--narrow"><select class="input" data-move-slot>${Array.from({ length: 10 }, (_, i) => `<option value="${i}" ${i === s.slot ? 'selected' : ''}>место ${i + 1}</option>`).join('')}</select></span>
            <button type="button" class="btn btn--secondary" data-move>Переместить</button></div><span class="field__hint">Если место занято, карточки поменяются местами; карточка из хранилища вытеснит занявшую место обратно в хранилище.</span></div>
          <div class="field"><span class="field__label">Своя картинка</span><input class="input" type="file" accept="image/png,image/jpeg,image/webp" data-import><span class="field__hint">Станет новой попыткой: программа обрежет её до карточки, обработает и проверит.</span></div>
          <div class="row"><button type="button" class="btn btn--secondary" data-export>${I.download}Экспорт</button><button type="button" class="btn btn--secondary" data-folder>${I.folder}Открыть в папке</button></div>
          <div class="row"><button type="button" class="btn btn--text btn--s" data-delete><span>Удалить карточку</span></button></div>
        </div></details>
      </div></div>`,
    foot: canAdjust ? `<button type="button" class="btn btn--secondary" data-reset-all disabled>${I.reset}Сбросить</button><button type="button" class="btn btn--primary" data-apply disabled>Применить обработку</button>` : '',
    onClose: () => off(),
  });

  // ---------- the image and the live preview ----------
  const canvas = /** @type {HTMLCanvasElement} */ (sheet.querySelector('[data-canvas]'));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { colorSpace: 'srgb' }));
  /** @type {{pixels: Uint8ClampedArray, width: number, height: number}|null} */
  let src = null;
  const values = { ...applied };
  if (s.imageUrl) {
    const shown = await pixelsOf(s.imageUrl).catch(() => null);
    if (shown) { canvas.width = shown.width; canvas.height = shown.height; ctx.putImageData(new ImageData(shown.pixels, shown.width, shown.height), 0, 0); }
  }
  if (canAdjust) pixelsOf(chosen.files.preparedUrl).then(p => { src = p; }).catch(() => toast('Не получилось прочитать подготовленную картинку карточки.', { kind: 'fail' }));
  let frame = 0;
  const draw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!src) return;
      const out = adjust(src.pixels, src.width, src.height, settingsOf(values, chosen.processing ?? proc.neutral));
      canvas.width = src.width; canvas.height = src.height;
      ctx.putImageData(new ImageData(out, src.width, src.height), 0, 0);
    });
  };
  const changed = () => SLIDERS.some(sl => values[sl.key] !== applied[sl.key]);
  const syncSliders = () => {
    for (const sl of SLIDERS) {
      const el = /** @type {HTMLElement|null} */ (sheet.querySelector(`[data-slider="${sl.key}"]`));
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
    for (const b of sheet.querySelectorAll('[data-apply], [data-reset-all]')) /** @type {HTMLButtonElement} */ (b).disabled = !changed();
  };
  syncSliders();
  sheet.addEventListener('input', e => {
    const el = /** @type {HTMLElement} */ (e.target).closest('[data-slider]');
    if (!el) return;
    values[/** @type {string} */ (/** @type {HTMLElement} */ (el).dataset.slider)] = Number(/** @type {HTMLInputElement} */ (e.target).value);
    syncSliders();
    draw();
  });

  // ---------- actions ----------
  const reopen = () => { close(); openCard(collectionId, cardId); };
  sheet.addEventListener('click', async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const mode = /** @type {HTMLElement|null} */ (t.closest('[data-wish-mode] > button'));
    if (mode) {
      for (const b of /** @type {HTMLElement} */ (mode.parentElement).children) b.setAttribute('aria-pressed', String(b === mode));
      /** @type {HTMLElement} */ (sheet.querySelector('[data-wish-hint]')).textContent = mode.dataset.v === 'edit'
        ? 'Картинка карточки уйдёт модели с вашим пожеланием: она поправит только то, о чём вы просите.'
        : 'Карточка будет сгенерирована заново по своему заказу с вашим пожеланием; лучшая попытка станет карточкой.';
      return;
    }
    const reset = /** @type {HTMLElement|null} */ (t.closest('[data-reset]'));
    if (reset) { values[/** @type {string} */ (reset.dataset.reset)] = applied[/** @type {string} */ (reset.dataset.reset)]; syncSliders(); draw(); return; }
    if (t.closest('[data-reset-all]')) { Object.assign(values, applied); syncSliders(); draw(); return; }
    if (t.closest('[data-apply]')) {
      const btn = /** @type {HTMLButtonElement} */ (t.closest('[data-apply]'));
      btn.disabled = true;
      const r = await attempt(() => call('adjustCard', { collectionId, cardId, n: data.chosen, saturation: values.saturation, brightness: values.brightness, sharpen: values.sharpen }));
      if (r) { toast('Обработка применена, карточка проверена заново.', { kind: 'done' }); reopen(); } else btn.disabled = false;
      return;
    }
    if (t.closest('[data-wish-go]')) {
      const wish = /** @type {HTMLTextAreaElement} */ (sheet.querySelector('[data-wish]')).value.trim();
      if (!wish) { toast('Напишите пожелание: что изменить.', { kind: 'fail' }); return; }
      const op = /** @type {HTMLElement} */ (sheet.querySelector('[data-wish-mode] [aria-pressed="true"]')).dataset.v === 'edit' ? 'editCard' : 'regenerateCard';
      const r = await attempt(() => call(op, { collectionId, cardId, wish }));
      if (r) reopen();
      return;
    }
    if (t.closest('[data-move]')) {
      const setId = /** @type {HTMLSelectElement} */ (sheet.querySelector('[data-move-set]')).value;
      const slot = Number(/** @type {HTMLSelectElement} */ (sheet.querySelector('[data-move-slot]')).value);
      const r = await attempt(() => call('moveCard', setId ? { collectionId, cardId, setId, slot } : { collectionId, cardId, pool: true }));
      if (r !== undefined) { toast(setId ? 'Карточка перемещена.' : 'Карточка убрана в хранилище.', { kind: 'done' }); app.refresh(); reopen(); }
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
  sheet.querySelector('[data-import]')?.addEventListener('change', async e => {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    const r = await attempt(() => call('importImage', { collectionId, cardId, data: dataUrl }));
    if (r) { toast('Картинка добавлена новой попыткой.', { kind: 'done' }); reopen(); }
  });

  // ---------- live: the card changed elsewhere, or its job moved on ----------
  const off = onEvent(e => {
    if (!body.isConnected) return;
    if (e.type === 'job' && e.job.scope?.cardId === cardId) {
      if (e.job.status !== 'running') reopen();
      else body.querySelector(`[data-jobline="${e.job.id}"]`)?.replaceWith(fromHtml(jobline(e.job)));
    }
    if (e.type === 'store' && e.entity === 'card' && e.id === cardId && !changed() && !running) reopen();
  });
}
