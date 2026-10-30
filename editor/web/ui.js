// Shared pieces of the editor's page: escaping, icons, card thumbnails, check words, the sheet (a side panel over
// the screen), toasts, dragging cards and the text help of free-text fields. The look comes only from
// design-system/components.css and editor.css.
import { call } from './api.js';

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
};

/** Switches the theme and remembers it in this browser; the top bar's switch follows. @param {string} t  light | dark */
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ccf-theme', t); } catch { /* private mode */ }
  for (const b of document.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.themePick === t));
}

/** The model that made a card's version, as a person reads it: without its provider prefix; "agent" = an image handed in. @param {string} model */
export const modelName = model => (model === 'agent' ? 'своя картинка' : model.replace(/^[\w.-]+\//, ''));

/** USD with cents, or a dash. @param {number|null|undefined} v */
export const usd = v => (v == null ? '—' : `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`);

/** Russian plural: plural(5, 'карточка', 'карточки', 'карточек'). @param {number} n @param {string} one @param {string} few @param {string} many */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
/** @param {number} n @param {string} one @param {string} few @param {string} many */
export const count = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;

/**
 * The verdict of a card's checks in a person's words: PASS / WARN / FAIL and a sentence.
 * @param {{blocking: number, warns: number, needsEyes: number}|null|undefined} c
 * @param {string} [status]  the card's status
 * @returns {{kind: 'pass'|'warn'|'fail'|null, word: string, text: string}}
 */
export function verdict(c, status) {
  if (status === 'failed') return { kind: 'fail', word: 'Ошибка', text: 'Карточка не получилась: ни одна попытка не дошла до проверки.' };
  if (status === 'new') return { kind: null, word: '', text: 'Карточка ещё не сделана.' };
  if (!c) return { kind: null, word: '', text: 'Проверок у этой карточки нет.' };
  if (c.blocking > 0) return { kind: 'fail', word: 'FAIL', text: `${count(c.blocking, 'ошибка', 'ошибки', 'ошибок')} по проверкам.` };
  if (c.needsEyes > 0) return { kind: 'warn', word: 'WARN', text: `${count(c.needsEyes, 'проверка зависит', 'проверки зависят', 'проверок зависят')} от контура предмета — посмотрите глазами.` };
  if (c.warns > 0) return { kind: 'warn', word: 'WARN', text: `${count(c.warns, 'замечание', 'замечания', 'замечаний')} — посмотрите глазами.` };
  return { kind: 'pass', word: 'PASS', text: 'Проверки стиля пройдены.' };
}

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
      <span class="thumb__line">${badge(v)}<span class="thumb__check">${I.check}</span>${drag ? `<span class="thumb__grip" data-grip aria-hidden="true">${I.grip}</span>` : ''}</span></figcaption>
  </figure>`;
}

/** One element from HTML. @param {string} html */
export const fromHtml = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return /** @type {HTMLElement} */ (t.content.firstElementChild); };

/**
 * One running job as a line on the screen it concerns: what is being done, its last step, what it has spent so far.
 * app.js replaces it in place on every progress event.
 * @param {any} j
 */
export function jobline(j) {
  const made = j.items?.filter((/** @type {any} */ i) => i.status === 'made' || i.status === 'kept').length;
  return `<div class="jobline panel" data-jobline="${esc(j.id)}"><i class="dot dot--work"></i><span class="jobline__title">${esc(j.title)}</span>
    <span class="jobline__last ink-2">${esc(j.log.at(-1)?.text ?? 'начинаю…')}</span>
    ${j.items?.length ? `<span class="data ink-3">${made}/${j.items.length}</span>` : ''}${j.spent != null ? `<span class="data ink-3">${usd(j.spent)}</span>` : ''}
    <button type="button" class="btn btn--text btn--s" data-open-jobs><span>Очередь</span></button></div>`;
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
      <header class="sheet__head"><h2 class="type-headline-sm">${esc(title)}</h2><button type="button" class="btn btn--secondary btn--icon btn--s" data-close aria-label="Закрыть">${I.x}</button></header>
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

// ---------- toasts ----------

/**
 * A short message at the bottom; an action is a text button.
 * @param {string} text @param {{kind?: 'fail'|'done'|null, action?: {label: string, run: () => void}, ms?: number}} [o]
 */
export function toast(text, { kind = null, action, ms = 5000 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); document.body.append(host); }
  const t = document.createElement('div');
  t.className = `toast glass glass--thick${kind ? ` toast--${kind}` : ''}`;
  t.innerHTML = `${kind ? `<i class="dot dot--${kind}"></i>` : ''}<span class="toast__text">${esc(text)}</span>${action ? `<button type="button" class="btn btn--text btn--s"><span>${esc(action.label)}</span></button>` : ''}`;
  if (action) t.querySelector('button')?.addEventListener('click', () => { action.run(); t.remove(); });
  host.append(t);
  setTimeout(() => t.remove(), kind === 'fail' ? Math.max(ms, 9000) : ms);
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
export const textHelp = kind => `<span class="texthelp" data-texthelp="${esc(kind)}"><button type="button" class="btn btn--text btn--s" data-draft title="Модель сделает из ваших мыслей готовый текст; проверьте его перед сохранением">${I.spark}<span>Сформулировать</span></button><button type="button" class="btn btn--text btn--s" data-draft-undo hidden><span>Вернуть как было</span></button></span>`;

/**
 * Makes the text help under `root` work.
 * @param {HTMLElement} root
 * @param {() => {context?: Record<string, string|undefined>, collectionId?: string|null}} about  what the text belongs
 *   to, read at the moment of the click
 */
export function bindTextHelp(root, about) {
  root.addEventListener('click', async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const box = /** @type {HTMLElement|null} */ (t.closest('[data-texthelp]'));
    if (!box) return;
    e.preventDefault();
    const field = /** @type {HTMLInputElement|HTMLTextAreaElement} */ (box.closest('.field')?.querySelector('textarea, input'));
    const go = /** @type {HTMLButtonElement} */ (box.querySelector('[data-draft]'));
    const undo = /** @type {HTMLButtonElement} */ (box.querySelector('[data-draft-undo]'));
    if (t.closest('[data-draft-undo]')) { field.value = box.dataset.before ?? ''; undo.hidden = true; field.focus(); return; }
    if (!t.closest('[data-draft]')) return;
    const notes = field.value.trim();
    if (!notes) { toast('Напишите мысли как есть — модель сформулирует из них текст.', { kind: 'fail' }); field.focus(); return; }
    const label = /** @type {HTMLElement} */ (go.querySelector('span'));
    go.disabled = true;
    label.textContent = 'Формулирую…';
    try {
      const r = await call('draftText', { kind: box.dataset.texthelp, notes, ...about() });
      box.dataset.before = field.value;
      field.value = r.text;
      undo.hidden = false;
      dispatchEvent(new Event(SPENT_EVENT));
    } catch (/** @type {any} */ err) {
      toast(err?.message ?? String(err), { kind: 'fail' });
    } finally {
      go.disabled = false;
      label.textContent = 'Сформулировать';
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
