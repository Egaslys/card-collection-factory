// The live board of the editor's design system. Loads DESIGN.md through tokens.js, renders every section from the
// tokens and content.js, computes every contrast ratio live from the token values and runs the live parts:
// theme switch, card selection and drag-to-reorder, window template switch, processing sliders, form controls.
// URL: ?theme=light|dark (otherwise the viewer's last choice, otherwise the system preference).

import { loadDesign } from '../tokens.js';
import { CARDS, CHECK, COLOR_GROUPS, WINDOWS, QUEUE, LOG, VARIANTS } from './content.js';

const PROCESSING_URL = '../../../styles/scapes/processing.json'; // the style's processing settings (neutral, start values)
const root = document.documentElement;
const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const store = {
  get(/** @type {string} */ k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(/** @type {string} */ k, /** @type {string} */ v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- contrast (WCAG 2.2) ----------
const hexRgb = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (/** @type {number} */ c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (/** @type {string} */ h) => { const [r, g, b] = hexRgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (/** @type {string} */ a, /** @type {string} */ b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const verdict = (/** @type {number} */ r, kind = 'text') => {
  if (kind === 'ui') return r >= 3 ? ['UI ≥ 3', true] : ['меньше 3', false];
  if (kind === 'decor') return ['декор', true];
  if (r >= 7) return ['AAA', true];
  if (r >= 4.5) return ['AA', true];
  if (r >= 3) return ['AA крупный', false];
  return ['не проходит', false];
};

const esc = (/** @type {any} */ s) => String(s).replace(/[&<>"]/g, (c) => /** @type {Record<string,string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const I = {
  sun: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>',
  moon: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/></svg>',
  gear: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.25"/><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05"/></svg>',
  spark: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75l1.6 4.65L14.25 8 9.6 9.6 8 14.25 6.4 9.6 1.75 8 6.4 6.4z"/></svg>',
  redo: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3.5v3.25H9.75"/><path d="M12.6 6.6A5 5 0 1 0 13 9.5"/></svg>',
  reset: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5v3.25h3.25"/><path d="M3.4 6.6A5 5 0 1 1 3 9.5"/></svg>',
  eye: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  grip: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="4" r=".9" fill="currentColor"/><circle cx="10" cy="4" r=".9" fill="currentColor"/><circle cx="6" cy="8" r=".9" fill="currentColor"/><circle cx="10" cy="8" r=".9" fill="currentColor"/><circle cx="6" cy="12" r=".9" fill="currentColor"/><circle cx="10" cy="12" r=".9" fill="currentColor"/></svg>',
  check: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  image: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2"/><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5"/><circle cx="10.5" cy="6" r="1"/></svg>',
  alert: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.25L14.25 13.25H1.75z"/><path d="M8 6.5v3M8 11.25v.01"/></svg>',
  x: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
const badge = (/** @type {'pass'|'warn'|'fail'} */ k) => `<span class="badge badge--${k}" title="${CHECK[k].title}">${CHECK[k].word}</span>`;
const img = (/** @type {any} */ c) => `<img src="${c.src}" alt="${esc(c.name)}" width="430" height="480" decoding="async">`;
const thumb = (/** @type {any} */ c, n, { selected = false, cls = '', grip = true } = {}) => `
  <figure class="thumb ${cls}" data-card="${c.id}" aria-selected="${selected}" ${grip ? 'draggable="true"' : ''} tabindex="0">
    <div class="thumb__img">${img(c)}</div>
    <figcaption class="thumb__cap"><span class="thumb__line"><span class="thumb__num">${String(n).padStart(2, '0')}</span><span class="thumb__name">${esc(c.name)}</span></span>
      <span class="thumb__line">${badge(c.check)}<span class="thumb__check">${I.check}</span>${grip ? `<button type="button" class="thumb__grip" data-grip aria-label="Переставить «${esc(c.name)}»: стрелки влево и вправо">${I.grip}</button>` : ''}</span></figcaption>
  </figure>`;
const blk = (/** @type {string} */ title, /** @type {string} */ meta, /** @type {string} */ body, note = '') => `
  <div class="blk"><div class="blk__head"><span class="label">${title}</span><span class="blk__meta">${meta}</span></div>${note ? `<p class="blk__note">${note}</p>` : ''}${body}</div>`;
const sec = (/** @type {string} */ id, /** @type {string} */ n, /** @type {string} */ title, /** @type {string} */ lead, /** @type {string} */ body) => `
  <section class="sec" id="${id}"><div class="wrap"><header class="sec__head"><p class="label">${n}</p><h2 class="type-headline-lg">${title}</h2><p class="sec__lead type-body-lg">${lead}</p></header>${body}</div></section>`;

// ---------- start ----------
let design;
try { design = await loadDesign(); } catch (e) {
  app.innerHTML = `<div class="boot-fail"><p><b>Доска не смогла прочитать DESIGN.md.</b></p><p>${esc(/** @type {Error} */ (e).message)}</p>
    <p>Откройте её через локальный сервер из корня репозитория — как написано в README.md дизайн-системы.</p></div>`;
  throw e;
}
const { tokens, colors } = design;
const S = {
  theme: (() => {
    const q = new URLSearchParams(location.search).get('theme') || store.get('ccf-ds-theme');
    if (q === 'light' || q === 'dark') return q;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  })(),
  order: CARDS.slice(0, 10).map((c) => c.id),
  selected: new Set(['024', '101']),
  window: WINDOWS[0].id,
  variant: 0,
};
const hex = (/** @type {string} */ name) => /** @type {Record<string,string>} */ (colors[/** @type {'light'|'dark'} */ (S.theme)])[name];

// ---------- sections ----------
const themeSeg = `<div class="seg seg--icon" role="group" aria-label="Тема">
  <button type="button" data-theme-set="light" aria-label="Светлая тема" title="Светлая тема">${I.sun}</button>
  <button type="button" data-theme-set="dark" aria-label="Тёмная тема" title="Тёмная тема">${I.moon}</button></div>`;

const fonts = [...new Set(Object.values(tokens.typography).map((t) => /** @type {any} */ (t).fontFamily))];

const hero = `<section class="hero"><div class="wrap">
  <p class="label">Фабрика карточек · веб-редактор</p>
  <h1 class="type-display hero__title">Дизайн-система редактора</h1>
  <p class="type-body-lg hero__lead">Тихий нейтральный интерфейс вокруг ярких карточек: цвет в нём что-то значит — зелёный зовёт к одному главному действию, синий показывает выделение и ход работы, янтарный и красный — то, что требует внимания.</p>
  <div class="facts">
    <div class="panel"><span class="label">Основа</span><p>«Монолит»: формат токенов, шрифты, шкалы, элементы управления, две темы</p></div>
    <div class="panel"><span class="label">Палитра</span><p class="facts__sw">${['accent', 'background', 'state', 'error'].map((k) => `<i data-chip="${k}"></i>`).join('')}<span>фирменные цвета</span></p></div>
    <div class="panel"><span class="label">Шрифты</span><p>${fonts.join(' · ')}</p></div>
  </div>
  <p class="hero__src data ink-3">Все значения читаются вживую из <a href="../DESIGN.md">DESIGN.md</a> · без сети</p>
</div></section>`;

const tokCard = (/** @type {string} */ name, /** @type {string} */ role) => `<article class="tok panel">
  <div class="tok__chip" data-chip="${name}"><span class="data" data-hex="${name}"></span></div>
  <div class="tok__body"><span class="tok__name data">--color-${name}</span><p class="tok__role">${role}</p><div class="tok__cr" data-tokcr="${name}"></div></div></article>`;

const colour = sec('colour', '01', 'Цвет', 'Каждому цвету — одна работа. Вокруг карточек — только нейтральный серый: так их цвет читается честно. Контраст каждой пары считается здесь же из токенов.',
  COLOR_GROUPS.map((g) => blk(g.title, g.note, `<div class="toks">${g.tokens.map(([n, r]) => tokCard(n, r)).join('')}</div>`)).join('') +
  blk('Контраст текста — WCAG 2.2', 'считается из токенов текущей темы', `<div class="panel matrix"><table>
    <thead><tr><th></th>${['background', 'surface', 'surface-sunken'].map((b) => `<th class="data">${b}</th>`).join('')}</tr></thead>
    <tbody>${['ink-1', 'ink-2', 'ink-3', 'ink-4', 'accent-ink', 'state-ink', 'warning-ink', 'error-ink'].map((f) => `<tr><th class="data">${f}</th>${['background', 'surface', 'surface-sunken'].map((b) => `<td data-mx="${f}|${b}|${f === 'ink-4' ? 'decor' : 'text'}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`) +
  blk('На заливках и подложках', 'текст на зелёном — только тёмный', `<div class="pairs">${[
    ['on-accent', 'accent', 'text', 'Главная кнопка'], ['on-accent', 'accent-hover', 'text', 'Наведение'], ['#FFFFFF', 'accent', 'never', 'Белый на зелёном — никогда'],
    ['accent-ink', 'accent-tint', 'text', 'PASS'], ['warning-ink', 'warning-tint', 'text', 'WARN'], ['error-ink', 'error-tint', 'text', 'FAIL'], ['state-ink', 'state-tint', 'text', 'Выбранная строка'],
    ['state', 'background', 'ui', 'Кольцо фокуса на фоне'], ['state', 'surface', 'ui', 'Кольцо на панели'], ['line-strong', 'surface', 'ui', 'Кромка поля'], ['accent', 'background', 'edge', 'Кромка зелёной кнопки'],
  ].map(([f, b, k, cap]) => `<div class="pair" data-pair="${f}|${b}|${k}"><span class="pair__aa">Aa</span><span class="pair__v data"></span><span class="pair__cap">${cap}</span><span class="pair__names data"></span></div>`).join('')}</div>`,
  'Кромке зелёной кнопки 3:1 не нужно: кнопку узнают по надписи. Синий, янтарный и красный — только заливки без текста; текст — их «чернилами» на фоне или на подложке.'));

const SCALE = [
  ['display', 'Только стартовый экран', 'Фабрика карточек'],
  ['headline-lg', 'Заголовок раздела', 'Коллекция «Лето»'],
  ['headline-md', 'Заголовок экрана', 'Набор 4 · Пляж'],
  ['headline-sm', 'Заголовок панели', 'Обработка карточки'],
  ['number-lg', 'Крупные числа', '8 / 10'],
  ['body-lg', 'Вводный текст', 'Проверьте набор глазами и поправьте то, что не нравится.'],
  ['body-md', 'Основной текст', 'Агент собрал три варианта набора. Выберите один или попросите переделать.'],
  ['body-sm', 'Подписи, строки очереди', 'Попытка 2 из 3 · потрачено $0.08'],
  ['button-md', 'Кнопки', 'Собрать набор'],
  ['label-md', 'Метки и значки', 'Очередь генерации · PASS'],
  ['data-md', 'Числа, журнал', '14:02:40 · ×1.30 · $0.31 / $2.00'],
  ['data-sm', 'Мелкие данные', '430 × 480 · 01–10'],
];
const type = sec('type', '02', 'Шрифты', 'Один характерный голос — коротко; всё длинное — нейтральный гротеск; данные — моноширинный. Все четыре семейства с кириллицей и лежат файлами рядом с системой.',
  blk('Семейства', `${fonts.length} семейства`, `<div class="fonts">${fonts.map((f) => {
    const tok = Object.entries(tokens.typography).find(([, t]) => /** @type {any} */ (t).fontFamily === f)?.[0];
    return `<article class="panel font"><div class="font__glyph type-${tok}" style="font-size:72px;line-height:80px">Aa Яя 0</div><h3 class="type-headline-sm">${f}</h3>
      <p class="font__abc type-${tok}">АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</p></article>`;
  }).join('')}</div>`) +
  blk('Шкала', 'кегль / строка; на телефоне — свои значения', `<div class="panel scale">${SCALE.map(([t, use, s]) => {
    const v = /** @type {any} */ (tokens.typography[t]); const m = /** @type {any} */ (tokens.typography[t + '-mobile']);
    return `<div class="scale__row"><div class="scale__spec"><span class="data">${t}</span><span class="ink-3 scale__use">${use} · ${parseInt(v.fontSize)}/${parseInt(v.lineHeight)}${m ? ` · ${parseInt(m.fontSize)}/${parseInt(m.lineHeight)}` : ''}</span></div><div class="type-${t} scale__s">${s}</div></div>`;
  }).join('')}</div>`));

const space = sec('space', '03', 'Отступы, радиусы, вложенность', 'Одна шкала с шагом 4 для всех отступов. Поля симметричны. Вложенные углы концентричны: внутренний радиус = внешний − отступ.',
  blk('Шкала отступов', '--spacing-s1 … s10', `<div class="panel spacing">${Object.entries(tokens.spacing).filter(([k]) => /^s\d+$/.test(k)).map(([k, v]) => `<div class="spacing__row"><span class="data">${k}</span><span class="data ink-3">${v}</span><i style="width:var(--spacing-${k})"></i></div>`).join('')}</div>`) +
  blk('Радиусы', '--rounded-*', `<div class="panel radii">${Object.entries(tokens.rounded).map(([k, v]) => `<div class="radius"><div class="radius__box" style="border-top-left-radius:min(var(--rounded-${k}), 48px)"></div><span class="data">${k}</span><span class="data ink-3">${v}</span></div>`).join('')}</div>`) +
  blk('Правило вложенности', 'r(внутри) = r(снаружи) − отступ', `<div class="conc">
    <div class="panel conc__card"><div class="nest" style="--nr:var(--rounded-xl);--np:var(--spacing-s2)"><div class="nest" style="--nr:var(--rounded-lg);--np:var(--spacing-s4)"><div class="nest nest--last" style="--nr:var(--rounded-sm)"></div></div></div><p class="data">окно 32 − 8 = панель 24 − 16 = поле 8</p></div>
    <div class="panel conc__card"><div class="seg"><button type="button" aria-pressed="true">Один</button><button type="button" aria-pressed="false">Два</button><button type="button" aria-pressed="false">Три</button></div><p class="data">оболочка 20 − 4 = сегмент 16</p></div>
  </div>`));

const STATES = ['Обычная', 'Наведение', 'Нажата', 'Фокус', 'Неактивна'];
const btnRow = (/** @type {string} */ name, /** @type {string} */ cls, /** @type {string} */ label, /** @type {string} */ icon) => `<span class="btns__name">${name}</span>` +
  ['', 'is-hover', 'is-press', 'is-focus', 'is-disabled'].map((st, i) => `<span class="btns__cell"><button type="button" class="btn ${cls} ${st}" tabindex="-1" ${st === 'is-disabled' ? 'disabled' : ''}>${icon}${label ? (cls.includes('text') ? `<span>${label}</span>` : label) : ''}</button><span class="btns__cap data ink-3">${STATES[i]}</span></span>`).join('');
const controls = sec('controls', '04', 'Элементы управления', 'Кнопки-капсулы, переключатели, поля и ползунки — те же, что в «Монолите», в нейтральном сером. Главная зелёная кнопка — одна на экран.',
  blk('Кнопки', 'L 48 · M 40 · S 32', `<div class="panel btns">
    <span></span>${STATES.map((s) => `<span class="btns__state data ink-3">${s}</span>`).join('')}
    ${btnRow('Главная', 'btn--primary', 'Собрать набор', '')}${btnRow('Вторичная', 'btn--secondary', 'Повторить', I.redo)}${btnRow('Текстовая', 'btn--text', 'Подробнее', '')}${btnRow('Иконка', 'btn--secondary btn--icon', '', I.gear)}
  </div><div class="sizes"><button type="button" class="btn btn--primary btn--l">Собрать набор</button><button type="button" class="btn btn--primary">Собрать набор</button><button type="button" class="btn btn--primary btn--s">Собрать набор</button><button type="button" class="btn btn--secondary btn--s">${I.redo}Ещё раз</button></div>`,
  'Текст на зелёном — тёмный (on-accent). Фокус — синее кольцо 2 px с отступом 2 px. Нажатие сдвигает кнопку на 1 px вниз.') +
  blk('Переключатели', 'оболочка 40 · сегмент 32', `<div class="row"><div class="seg" role="group" aria-label="Число вариантов" data-seg>${[1, 2, 3, 4].map((n) => `<button type="button" aria-pressed="${n === 3}">${n}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Провайдер" data-seg><button type="button" aria-pressed="true">OpenRouter</button><button type="button" aria-pressed="false">Codex CLI</button></div>${themeSeg}</div>`) +
  blk('Поля', 'h 40 · r 8 · кромка ≥ 3:1', `<div class="panel fields">
    <label class="field"><span class="field__label">Тематика набора</span><input class="input" placeholder="Например, «Пикник у озера»"><span class="field__hint">Одна фраза — агент развернёт её сам</span></label>
    <label class="field"><span class="field__label">В фокусе</span><input class="input is-focus" value="Пикник у озера"></label>
    <label class="field field--error"><span class="field__label">Адрес подключения</span><input class="input" value="htps://openrouter.ai/api" aria-invalid="true"><span class="field__hint">Адрес должен начинаться с https:// — проверьте, нет ли опечатки</span></label>
    <label class="field"><span class="field__label">Неактивное</span><input class="input" value="google/gemini-nano-banana-2.1" disabled></label>
    <label class="field"><span class="field__label">Выбор из списка</span><span class="select"><select class="input"><option>Большое окно</option><option>Малое окно</option></select></span></label>
    <label class="field"><span class="field__label">Пожелания</span><textarea class="input" rows="3" placeholder="Что важно в этом наборе"></textarea></label>
  </div>`) +
  blk('Ползунки', 'значение · сброс', `<div class="panel sliders" data-sliders="demo"></div>`));

// --- editor patterns ---
const gridApp = `<div class="appdemo panel" data-appdemo>
  <div class="appdemo__bar"><div class="topbar glass"><div class="topbar__where"><span class="ink-3">Лето</span><span class="topbar__sep">/</span><span><b>Набор 4 · Пляж</b></span></div>
    <button type="button" class="btn btn--secondary btn--icon btn--s" aria-label="Настройки">${I.gear}</button><button type="button" class="btn btn--primary btn--s" aria-label="Собрать варианты">${I.spark}<span class="hide-s">Собрать варианты</span></button></div></div>
  <div class="thumb-grid" data-grid role="listbox" aria-multiselectable="true" aria-label="Карточки набора"></div>
  <div class="appdemo__sel" data-selbar></div>
</div>`;
const windowBlk = `<div class="win">
  <div class="row"><div class="seg" role="group" aria-label="Шаблон окна" data-windows>${WINDOWS.map((w) => `<button type="button" data-window="${w.id}" style="--swatch:${w.swatch}" aria-label="${w.name}"><i class="swatch"></i><span class="hide-s">${w.name}</span></button>`).join('')}</div></div>
  <div class="window"><div class="window__stage" data-window-stage></div></div>
</div>`;
const processing = `<div class="proc"><div class="proc__card thumb__img">${img(byId['017'])}</div>
  <div class="panel proc__panel"><div class="proc__head"><h3 class="type-headline-sm">Обработка</h3><button type="button" class="btn btn--text btn--s" data-reset-all><span>Сбросить всё</span></button></div>
  <div class="sliders" data-sliders="card"></div>
  <p class="field__hint">Предпросмотр считает собственный код обработки продукта — тот же, что даёт итоговую карточку. Здесь показан только вид панели.</p></div></div>`;
const queue = `<div class="qlog"><div class="panel"><div class="proc__head"><h3 class="type-headline-sm">Очередь</h3><span class="data ink-2">потрачено $0.24 из $2.00</span></div>
  <div class="queue">${QUEUE.map((q) => `<div class="queue-row"><div class="queue-row__img">${q.card ? img(byId[q.card]) : ''}</div>
    <span class="queue-row__name">${esc(q.name)}</span><span class="queue-row__meta"><span class="data">${q.attempt}</span><span class="data">${q.cost}</span></span>
    <span class="queue-row__status is-${q.status}"><i class="dot dot--${q.status}"></i>${q.word}</span>${q.status === 'fail' ? `<button type="button" class="btn btn--secondary btn--s">${I.redo}Повторить</button>` : '<span></span>'}
    <div class="progress ${q.status === 'done' ? 'progress--done' : q.status === 'fail' ? 'progress--fail' : ''}" style="--p:${q.p}%"><i></i></div></div>`).join('')}</div></div>
  <div class="panel"><div class="proc__head"><h3 class="type-headline-sm">Журнал</h3><span class="data ink-3">новое — внизу</span></div>
  <ol class="log">${LOG.map((l) => `<li class="is-${l.k}"><time>${l.t}</time><i class="dot dot--${l.k}"></i><span>${esc(l.m)}</span></li>`).join('')}</ol></div></div>`;
const settings = `<form class="panel form" data-form onsubmit="return false">
  <div class="field"><span class="field__label">Провайдер</span><div class="seg" role="group" aria-label="Провайдер" data-seg><button type="button" aria-pressed="true">OpenRouter</button><button type="button" aria-pressed="false">Codex CLI</button></div></div>
  <label class="field"><span class="field__label">Адрес подключения</span><input class="input" value="https://openrouter.ai/api/v1" inputmode="url"></label>
  <label class="field"><span class="field__label">Модель-генератор</span><input class="input" value="google/gemini-nano-banana-2.1"></label>
  <label class="field"><span class="field__label">Модель-редактор</span><input class="input" placeholder="Та же, что генератор"></label>
  <label class="field form__wide"><span class="field__label">Ключ</span><span class="input-wrap"><input class="input" type="password" value="demo-key-not-real" autocomplete="off" data-key><button type="button" class="btn btn--text btn--icon btn--s" data-key-toggle aria-label="Показать ключ" aria-pressed="false">${I.eye}</button></span>
    <span class="field__hint">Ключ не сохраняется: он живёт, пока работает сервер редактора</span></label>
  <label class="field"><span class="field__label">Попыток на карточку</span><input class="input" type="number" value="3" min="1"></label>
  <label class="field"><span class="field__label">Потолок расходов, $</span><input class="input" type="number" value="2.00" step="0.5" min="0"></label>
  <div class="form__foot"><button type="button" class="btn btn--primary">Сохранить</button></div></form>`;
const brief = `<form class="panel form form--brief" onsubmit="return false">
  <label class="field form__wide"><span class="field__label">Тематика набора</span><input class="input" value="Пикник у озера"></label>
  <label class="field form__wide"><span class="field__label">Пожелания</span><textarea class="input" rows="3">Больше еды и посуды, один персонаж в конце, без лодок</textarea><span class="field__hint">Свободным текстом — как попросили бы агента</span></label>
  <div class="field"><span class="field__label">Вариантов</span><div class="seg" role="group" aria-label="Вариантов" data-seg>${[1, 2, 3, 4].map((n) => `<button type="button" aria-pressed="${n === 3}">${n}</button>`).join('')}</div></div>
  <div class="form__foot"><button type="button" class="btn btn--primary btn--l">${I.spark}Собрать набор</button></div></form>`;
const variants = `<div class="variants" data-variants>${VARIANTS.map((v, i) => {
  const counts = { pass: 0, warn: 0, fail: 0 }; v.cards.forEach((id) => counts[/** @type {'pass'|'warn'|'fail'} */ (byId[id].check)]++);
  return `<div class="panel variant" data-variant="${i}"><div class="variant__head"><h3 class="type-headline-sm">${v.name}</h3><button type="button" class="btn btn--secondary btn--s" data-choose="${i}">Выбрать</button></div>
    <div class="variant__cards">${v.cards.map((id) => `<div class="thumb__img">${img(byId[id])}</div>`).join('')}</div>
    <div class="variant__sum">${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `<span class="row-s">${badge(/** @type {any} */ (k))}<span class="data">× ${n}</span></span>`).join('')}</div></div>`;
}).join('')}</div>`;
const states = `<div class="states">
  <div class="panel state"><div class="state__icon">${I.image}</div><h3 class="type-headline-sm">В наборе пока нет карточек</h3><p>Опишите тему — агент или редактор соберёт варианты набора.</p><button type="button" class="btn btn--primary">${I.plus}Собрать набор</button></div>
  <div class="panel state state--loading" aria-busy="true"><div class="skel-grid">${'<div class="skeleton skel-card"></div>'.repeat(4)}</div><div class="skeleton skel-line"></div><p>Собираем варианты: карточка 3 из 10…</p></div>
  <div class="panel state state--error" role="alert"><div class="state__icon">${I.alert}</div><h3 class="type-headline-sm">Не удалось связаться с провайдером</h3><p>Сервер ответил «нет доступа» — проверьте ключ в настройках и повторите.</p><div class="row"><button type="button" class="btn btn--secondary">${I.redo}Повторить</button><button type="button" class="btn btn--text"><span>Открыть настройки</span></button></div></div>
</div>`;
const dragStates = `<div class="panel dragspec">${[
  ['Обычная', thumb(byId['068'], 1, { cls: '' })],
  ['Выбрана', thumb(byId['092'], 2, { selected: true })],
  ['Перетаскивается', thumb(byId['116'], 3, { cls: 'is-dragging' })],
  ['Пустое место', thumb(byId['116'], 3, { cls: 'is-ghost' })],
  ['Сюда встанет', thumb(byId['157'], 4, { cls: 'is-drop-before' })],
].map(([cap, t]) => `<div class="dragspec__i">${t}<span class="data ink-3">${cap}</span></div>`).join('')}</div>`;

const editor = sec('editor', '05', 'Редактор', 'Всё, что нужно человеку, чтобы быстро проверить набор глазами и внести небольшие правки. Карточки — настоящие эталоны стиля, чтобы видно было, как они читаются на нейтральном фоне.',
  blk('Сетка карточек', 'нажмите — выделить · перетащите — переставить', gridApp, 'Картинку ничто не закрывает: номер, подпись и значок проверки — под ней. Верхняя панель и панель выделения — стекло над прокручиваемой сеткой. Переставить можно и с клавиатуры: фокус на значке ⋮⋮, стрелки влево и вправо.') +
  blk('Состояния карточки', 'выделение и перетаскивание', dragStates) +
  blk('Набор в окне', 'четыре шаблона — выбирает пользователь', windowBlk, 'Картинку шаблона даёт стиль — её пока нет, поэтому рамка рисует нейтральную схему окна: полоса с названием, 2 × 5 мест, номер набора. Цвет кружков переключателя — заглушка до появления шаблонов.') +
  blk('Обработка карточки', 'резкость · насыщенность · яркость', processing) +
  blk('Очередь генерации и журнал', 'попытки, ход, стоимость', queue) +
  blk('Настройки', 'провайдер, адрес, модели, ключ', settings) +
  blk('Новый набор', 'тема и пожелания', brief) +
  blk('Сравнение вариантов', 'наборы целиком рядом', variants) +
  blk('Пусто · загрузка · ошибка', 'каждое состояние говорит, что делать', states));

const rules = sec('rules', '06', 'Да / нет', 'Правила, которые проще показать, чем пересказать. Полный список — в DESIGN.md, раздел «Do\'s and Don\'ts».',
  `<div class="rules">${[
    ['Одно главное действие на экран', `<div class="row"><button type="button" class="btn btn--primary btn--s" tabindex="-1">Собрать</button><button type="button" class="btn btn--primary btn--s" tabindex="-1">Сохранить</button></div>`,
      `<div class="row"><button type="button" class="btn btn--primary btn--s" tabindex="-1">Собрать</button><button type="button" class="btn btn--secondary btn--s" tabindex="-1">Сохранить</button></div>`],
    ['Карточка — на нейтральном сером', `<div class="rule__bg rule__bg--tint">${img(byId['041'])}</div>`, `<div class="rule__bg">${img(byId['041'])}</div>`],
    ['Ничего поверх картинки', `<div class="rule__over"><div class="thumb__img">${img(byId['003'])}</div>${badge('pass')}</div>`, thumb(byId['003'], 2, { grip: false })],
    ['Текст на зелёном — тёмный', `<span class="rule__white btn btn--s">Собрать набор</span>`, `<span class="btn btn--primary btn--s">Собрать набор</span>`],
  ].map(([t, no, yes]) => `<div class="panel rule"><h3 class="type-headline-sm">${t}</h3><div class="rule__pair"><div class="rule__ex"><span class="label rule__no">✕ нельзя</span>${no}</div><div class="rule__ex"><span class="label rule__yes">✓ можно</span>${yes}</div></div></div>`).join('')}</div>`);

app.innerHTML = `
<header class="bh"><div class="wrap"><div class="topbar glass bh__bar">
  <a class="topbar__where bh__brand" href="#top"><span class="label">Дизайн-система редактора</span></a>
  <nav class="bh__nav" aria-label="Разделы">${[['colour', 'Цвет'], ['type', 'Шрифты'], ['space', 'Отступы'], ['controls', 'Элементы'], ['editor', 'Редактор'], ['rules', 'Да / нет']].map(([id, n]) => `<a href="#${id}">${n}</a>`).join('')}</nav>
  ${themeSeg}</div></div></header>
<main id="top">${hero}${colour}${type}${space}${controls}${editor}${rules}</main>
<footer class="foot data ink-3"><div class="wrap">Токены — из <a href="../DESIGN.md">DESIGN.md</a> · шрифты — в <span>fonts/</span> · карточки — эталоны стиля Scapes</div></footer>`;

// ---------- live parts ----------
/** The pairs each token card reports: [foreground, background, kind]. @param {string} n */
function tokPairs(n) {
  if (['background', 'surface', 'surface-sunken'].includes(n)) return [['ink-1', n, 'text'], ['ink-3', n, 'text']];
  if (n === 'line') return [[n, 'surface', 'decor']];
  if (n === 'line-strong') return [[n, 'surface', 'ui'], [n, 'background', 'ui']];
  if (n === 'ink-4') return [[n, 'background', 'decor']];
  if (n === 'on-accent') return [[n, 'accent', 'text'], [n, 'accent-hover', 'text']];
  if (n === 'accent' || n === 'accent-hover') return [['on-accent', n, 'text']];
  if (n.endsWith('-tint')) return [[n.replace('-tint', '-ink'), n, 'text']];
  if (n.endsWith('-ink') || n.startsWith('ink-')) return [[n, 'background', 'text'], [n, 'surface-sunken', 'text']];
  if (n === 'state') return [[n, 'background', 'ui'], [n, 'surface', 'ui']];
  return [[n, 'background', 'decor']]; // warning, error: dots that always sit next to a word
}
function applyTheme() {
  root.dataset.theme = S.theme;
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.themeSet === S.theme)));
  document.querySelectorAll('[data-chip]').forEach((el) => {
    const h = hex(/** @type {HTMLElement} */ (el).dataset.chip || ''); /** @type {HTMLElement} */ (el).style.background = h;
    /** @type {HTMLElement} */ (el).style.color = ratio(hex('ink-1'), h) >= ratio(hex('surface'), h) ? hex('ink-1') : hex('surface');
  });
  document.querySelectorAll('[data-hex]').forEach((el) => { el.textContent = hex(/** @type {HTMLElement} */ (el).dataset.hex || ''); });
  document.querySelectorAll('[data-tokcr]').forEach((el) => {
    const n = /** @type {HTMLElement} */ (el).dataset.tokcr || '';
    el.innerHTML = tokPairs(n).map(([f, b, k]) => {
      const r = ratio(hex(f), hex(b)); const [w, ok] = verdict(r, k);
      const lab = f === n ? 'на ' + b : f;
      return `<span class="cr data ${ok ? '' : 'cr--fail'}">${lab} <b>${r.toFixed(2)}</b> ${w}</span>`;
    }).join('');
  });
  document.querySelectorAll('[data-mx]').forEach((el) => {
    const [f, b, k] = (/** @type {HTMLElement} */ (el).dataset.mx || '').split('|');
    const r = ratio(hex(f), hex(b)); const [w, ok] = verdict(r, k);
    /** @type {HTMLElement} */ (el).style.background = hex(b); /** @type {HTMLElement} */ (el).style.color = hex(f);
    el.innerHTML = `<span class="mx__aa">Aa</span><span class="data">${r.toFixed(2)}</span><span class="mx__k data ${ok ? '' : 'cr--fail'}">${w}</span>`;
  });
  document.querySelectorAll('[data-pair]').forEach((el) => {
    const [f, b, k] = (/** @type {HTMLElement} */ (el).dataset.pair || '').split('|');
    const fh = f.startsWith('#') ? f : hex(f), bh = hex(b), r = ratio(fh, bh);
    const [w, ok] = k === 'never' ? ['никогда', false] : k === 'edge' ? ['по надписи', true] : verdict(r, k);
    const sw = /** @type {HTMLElement} */ (el.querySelector('.pair__aa'));
    sw.style.background = bh; sw.style.color = k === 'ui' || k === 'edge' ? 'transparent' : fh;
    sw.style.boxShadow = k === 'ui' || k === 'edge' ? `inset 0 0 0 3px ${fh}` : 'none';
    /** @type {HTMLElement} */ (el.querySelector('.pair__v')).innerHTML = `<b>${r.toFixed(2)}</b> <span class="${ok ? '' : 'cr--fail'}">${w}</span>`;
    /** @type {HTMLElement} */ (el.querySelector('.pair__names')).textContent = `${f.startsWith('#') ? 'white' : f} / ${b}`;
  });
}

// grid: selection and drag-to-reorder
const grid = /** @type {HTMLElement} */ (document.querySelector('[data-grid]'));
const selbar = /** @type {HTMLElement} */ (document.querySelector('[data-selbar]'));
function renderGrid() {
  grid.innerHTML = S.order.map((id, i) => thumb(byId[id], i + 1, { selected: S.selected.has(id) }).replace('<figure', '<figure role="option"')).join('');
  const n = S.selected.size;
  selbar.innerHTML = n ? `<div class="selbar glass"><span class="selbar__count">Выбрано: ${n}</span><button type="button" class="btn btn--secondary btn--s">${I.redo}<span class="hide-s">Перегенерировать</span></button>
    <button type="button" class="btn btn--secondary btn--s"><span>Обработать</span></button><button type="button" class="btn btn--text btn--icon btn--s" data-clear aria-label="Снять выделение">${I.x}</button></div>` : '';
}
/** @type {string | null} */ let dragId = null;
grid.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  if (t.closest('[data-grip]')) return;
  const f = /** @type {HTMLElement | null} */ (t.closest('.thumb')); if (!f) return;
  const id = f.dataset.card || ''; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); renderGrid();
  /** @type {HTMLElement | null} */ (grid.querySelector(`[data-card="${id}"]`))?.focus();
});
grid.addEventListener('keydown', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const f = /** @type {HTMLElement | null} */ (t.closest('.thumb')); if (!f) return;
  const id = f.dataset.card || '';
  if (t.closest('[data-grip]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); const i = S.order.indexOf(id), j = i + (e.key === 'ArrowLeft' ? -1 : 1);
    if (j < 0 || j >= S.order.length) return;
    S.order.splice(i, 1); S.order.splice(j, 0, id); renderGrid(); renderWindow();
    /** @type {HTMLElement | null} */ (grid.querySelector(`[data-card="${id}"] [data-grip]`))?.focus();
  } else if (!t.closest('[data-grip]') && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); f.click(); }
});
const clearDrop = () => grid.querySelectorAll('.is-drop-before').forEach((x) => x.classList.remove('is-drop-before'));
grid.addEventListener('dragstart', (e) => {
  const f = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.thumb')); if (!f) return;
  dragId = f.dataset.card || null; grid.dataset.dropAt = ''; e.dataTransfer?.setData('text/plain', dragId || '');
  requestAnimationFrame(() => f.classList.add('is-ghost'));
});
grid.addEventListener('dragover', (e) => {
  if (!dragId) return; e.preventDefault();
  const f = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.thumb')); clearDrop(); if (!f || f.dataset.card === dragId) return;
  const r = f.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2;
  const target = after ? /** @type {HTMLElement | null} */ (f.nextElementSibling) : f;
  if (target && target.dataset.card !== dragId) target.classList.add('is-drop-before');
  grid.dataset.dropAt = target ? target.dataset.card || '' : 'end';
});
grid.addEventListener('drop', (e) => {
  e.preventDefault(); if (!dragId) return;
  const at = grid.dataset.dropAt || '';
  if (at !== dragId && (at === 'end' || S.order.includes(at))) {
    S.order.splice(S.order.indexOf(dragId), 1);
    if (at === 'end') S.order.push(dragId); else S.order.splice(S.order.indexOf(at), 0, dragId);
  }
  dragId = null; grid.dataset.dropAt = ''; renderGrid(); renderWindow();
});
grid.addEventListener('dragend', () => { dragId = null; clearDrop(); grid.querySelectorAll('.is-ghost').forEach((x) => x.classList.remove('is-ghost')); });
selbar.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('[data-clear]')) { S.selected.clear(); renderGrid(); } });

// window preview
function renderWindow() {
  const w = WINDOWS.find((x) => x.id === S.window) || WINDOWS[0];
  document.querySelectorAll('[data-window]').forEach((b) => b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.window === w.id)));
  const stage = /** @type {HTMLElement} */ (document.querySelector('[data-window-stage]'));
  stage.style.setProperty('--swatch', w.swatch);
  stage.innerHTML = `<span class="window__hint badge badge--warn" title="Картинка шаблона ещё не подключена">схема</span><div class="window__schema">
    <div class="window__title"><span>Пляж</span></div>
    <div class="window__slots">${S.order.map((id) => `<div class="window__slot"><div class="thumb__img">${img(byId[id])}</div><span class="window__slot-cap">${esc(byId[id].name)}</span></div>`).join('')}</div>
    <span class="window__num">Набор 4 / 16</span></div>`;
}

// sliders: values from the style's processing settings when they can be read
const DEMO_RANGES = { sharpen: [0, 1, 0.05], saturation: [0.5, 1.5, 0.05], brightness: [-40, 40, 1] }; // demo ranges: the editor sets the real ones
const fmt = { sharpen: (/** @type {number} */ v) => v.toFixed(2), saturation: (/** @type {number} */ v) => '×' + v.toFixed(2), brightness: (/** @type {number} */ v) => (v > 0 ? '+' : '') + v.toFixed(0) };
const NAMES = { sharpen: 'Резкость', saturation: 'Насыщенность', brightness: 'Яркость' };
async function renderSliders() {
  let p;
  try { const r = await fetch(PROCESSING_URL, { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); p = await r.json(); } catch (e) {
    document.querySelectorAll('[data-sliders]').forEach((el) => { el.innerHTML = `<div class="state state--error"><div class="state__icon">${I.alert}</div><p>Не удалось прочитать настройки обработки стиля (${esc(/** @type {Error} */ (e).message)}).</p></div>`; });
    return;
  }
  const model = Object.keys(p.start)[0];
  const neutral = { sharpen: p.neutral.sharpen.amount, saturation: p.neutral.saturation, brightness: p.neutral.brightness };
  const start = { sharpen: p.start[model].sharpen.amount, saturation: p.start[model].saturation, brightness: p.start[model].brightness };
  document.querySelectorAll('[data-sliders]').forEach((el) => {
    el.innerHTML = /** @type {const} */ (['sharpen', 'saturation', 'brightness']).map((k) => {
      const [min, max, step] = DEMO_RANGES[k];
      return `<div class="slider" data-k="${k}" data-neutral="${neutral[k]}"><span class="slider__label">${NAMES[k]}<i class="slider__changed" title="Изменено"></i></span>
        <span class="slider__value" data-v></span><button type="button" class="btn btn--text btn--icon btn--s" data-reset aria-label="Сбросить: ${NAMES[k].toLowerCase()}">${I.reset}</button>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${start[k]}" aria-label="${NAMES[k]}"></div>`;
    }).join('');
    el.querySelectorAll('.slider').forEach(updSlider);
  });
}
function updSlider(/** @type {Element} */ s) {
  const el = /** @type {HTMLElement} */ (s); const input = /** @type {HTMLInputElement} */ (el.querySelector('input'));
  const k = /** @type {'sharpen'|'saturation'|'brightness'} */ (el.dataset.k); const v = Number(input.value), n = Number(el.dataset.neutral);
  /** @type {HTMLElement} */ (el.querySelector('[data-v]')).textContent = fmt[k](v);
  input.style.setProperty('--p', ((v - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100) + '%');
  el.classList.toggle('is-changed', v !== n);
  /** @type {HTMLButtonElement} */ (el.querySelector('[data-reset]')).disabled = v === n;
}

document.addEventListener('input', (e) => { const s = /** @type {HTMLElement} */ (e.target).closest('.slider'); if (s) updSlider(s); });
document.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const th = /** @type {HTMLElement | null} */ (t.closest('[data-theme-set]'));
  if (th) { S.theme = th.dataset.themeSet || 'light'; store.set('ccf-ds-theme', S.theme); applyTheme(); return; }
  const w = /** @type {HTMLElement | null} */ (t.closest('[data-window]'));
  if (w) { S.window = w.dataset.window || S.window; renderWindow(); return; }
  const rs = t.closest('[data-reset]');
  if (rs) { const s = /** @type {HTMLElement} */ (rs.closest('.slider')); /** @type {HTMLInputElement} */ (s.querySelector('input')).value = s.dataset.neutral || '0'; updSlider(s); return; }
  const ra = t.closest('[data-reset-all]');
  if (ra) { ra.closest('.proc__panel')?.querySelectorAll('.slider').forEach((s) => { /** @type {HTMLInputElement} */ (s.querySelector('input')).value = /** @type {HTMLElement} */ (s).dataset.neutral || '0'; updSlider(s); }); return; }
  const seg = t.closest('[data-seg] > button');
  if (seg) { seg.parentElement?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === seg))); return; }
  const kt = /** @type {HTMLElement | null} */ (t.closest('[data-key-toggle]'));
  if (kt) { const inp = /** @type {HTMLInputElement} */ (kt.parentElement?.querySelector('[data-key]')); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; kt.setAttribute('aria-pressed', String(show)); kt.setAttribute('aria-label', show ? 'Скрыть ключ' : 'Показать ключ'); return; }
  const ch = /** @type {HTMLElement | null} */ (t.closest('[data-choose]'));
  if (ch) { S.variant = Number(ch.dataset.choose); renderVariants(); }
});
function renderVariants() {
  document.querySelectorAll('[data-variant]').forEach((v) => {
    const on = Number(/** @type {HTMLElement} */ (v).dataset.variant) === S.variant; v.classList.toggle('is-chosen', on);
    const b = /** @type {HTMLButtonElement} */ (v.querySelector('[data-choose]'));
    b.innerHTML = on ? `${I.check}Выбран` : 'Выбрать'; b.setAttribute('aria-pressed', String(on));
  });
}

applyTheme(); renderGrid(); renderWindow(); renderVariants(); await renderSliders();
