// Export, one window for every screen (the author's decision): «Что выгрузить» — every collection, this collection,
// this set or the selected cards, preselected by the screen it opens from —, the pool alongside, the model originals
// in full size, PNG files or one ZIP; then «Открыть папку экспорта». One core operation for the editor and
// `ccf.mjs export` (core/store exportItems).
import { call } from '../api.js';
import { plural, words } from '../i18n.js';
import { attempt, esc, I, openSheet } from '../ui.js';
import { app } from '../state.js';

const t = words({
  ru: {
    title: 'Экспорт', what: 'Что выгрузить', all: 'Все коллекции', allSub: '{n} {w}, у каждой своя папка: коллекция → наборы → карточки',
    collection: 'Эта коллекция', collectionSub: '«{title}»: наборы по номерам; из вариантов — выбранный', collectionOff: 'Откройте коллекцию, чтобы выгрузить её',
    set: 'Этот набор', setSub: '«{title}»: 10 карточек по порядку мест', setOff: 'Откройте набор, чтобы выгрузить его',
    card: 'Эта карточка', cardSub: '«{title}» — одной картинкой PNG',
    cards: 'Выбранные карточки', cardsSub: 'Выбрано: {n}', cardsOff: 'Выделяйте карточки щелчком с ⌘ (на Windows — с Ctrl)',
    pool: 'Выгрузить хранилище', poolHint: 'Карточки вне наборов — отдельной папкой «Хранилище».',
    originals: 'Оригиналы в полном размере', originalsHint: 'Рядом с карточками 430 × 480 — картинки такими, какими их нарисовала модель.',
    how: 'Как', png: 'Картинки PNG', zip: 'Архив ZIP', where: 'Файлы лягут в папку экспорта фабрики.',
    openFolder: 'Открыть папку экспорта', openResult: 'Открыть в папке', submit: 'Экспортировать', working: 'Экспортирую…',
    done: 'Готово: {n} {w}{zip}', inZip: ' в архиве', skipped: 'Пропущено без картинки: {n}.',
  },
  en: {
    title: 'Export', what: 'What to export', all: 'Every collection', allSub: '{n} {w}, each in its own folder: collection → sets → cards',
    collection: 'This collection', collectionSub: '“{title}”: sets by number; of variants, the chosen one', collectionOff: 'Open a collection to export it',
    set: 'This set', setSub: '“{title}”: 10 cards in the order of their places', setOff: 'Open a set to export it',
    card: 'This card', cardSub: '“{title}” — one PNG picture',
    cards: 'Selected cards', cardsSub: 'Selected: {n}', cardsOff: 'Select cards by clicking with ⌘ (Ctrl on Windows)',
    pool: 'Export the pool', poolHint: 'Cards outside sets — in a folder of their own.',
    originals: 'Originals in full size', originalsHint: 'Next to the 430 × 480 cards — the pictures as the model drew them.',
    how: 'How', png: 'PNG pictures', zip: 'ZIP archive', where: 'The files go to the factory’s export folder.',
    openFolder: 'Open the export folder', openResult: 'Show in folder', submit: 'Export', working: 'Exporting…',
    done: 'Done: {n} {w}{zip}', inZip: ' in an archive', skipped: 'Skipped, no picture: {n}.',
  },
});
const PICTURES = /** @type {const} */ ({ ru: ['картинка', 'картинки', 'картинок'], en: ['picture', 'pictures'] });
const COLLECTIONS = /** @type {const} */ ({ ru: ['коллекция', 'коллекции', 'коллекций'], en: ['collection', 'collections'] });
/** @param {number} n @param {{ru: readonly [string, string, string], en: readonly [string, string]}} f */
const nw = (n, f) => ({ n, w: plural(n, { ru: [...f.ru], en: [...f.en] }) });

/**
 * Opens the export window for the screen shown (app.route) and the selected cards (app.selection).
 * @param {{cardId?: string, cardTitle?: string}} [o]  opened from a card: that card is a choice too, preselected
 */
export async function openExport({ cardId, cardTitle } = {}) {
  const [, collectionId, , setId] = app.route[0] === 'c' ? app.route : [];
  const [list, col] = await Promise.all([
    attempt(() => call('listCollections')),
    collectionId ? attempt(() => call('getCollection', { collectionId })) : Promise.resolve(null),
  ]);
  if (!list || (collectionId && !col)) return;
  const set = setId ? col?.sets.find((/** @type {any} */ s) => s.id === setId) : null;
  const picked = app.selection.collectionId === collectionId ? [...app.selection.ids] : [];
  const choices = [
    ...(cardId && collectionId ? [{ v: 'card', label: t('card'), sub: t('cardSub', { title: cardTitle ?? cardId }), off: false }] : []),
    { v: 'all', label: t('all'), sub: t('allSub', nw(list.length, COLLECTIONS)), off: false },
    { v: 'collection', label: t('collection'), sub: col ? t('collectionSub', { title: col.collection.title }) : t('collectionOff'), off: !col },
    { v: 'set', label: t('set'), sub: set ? t('setSub', { title: set.title }) : t('setOff'), off: !set },
    { v: 'cards', label: t('cards'), sub: picked.length ? t('cardsSub', { n: picked.length }) : t('cardsOff'), off: !picked.length },
  ];
  const first = cardId && collectionId ? 'card' : picked.length ? 'cards' : set ? 'set' : col ? 'collection' : 'all';
  const { sheet } = openSheet({
    title: t('title'),
    body: `<div class="form">
      <div class="field"><span class="field__label">${esc(t('what'))}</span><div class="choices" role="radiogroup">${choices.map(c => `<label class="choice"><input type="radio" name="what" value="${c.v}" ${c.v === first ? 'checked' : ''} ${c.off ? 'disabled' : ''}><span>${esc(c.label)}</span><span class="choice__sub">${esc(c.sub)}</span></label>`).join('')}</div></div>
      <div class="field">
        <label class="check" data-pool-row><input type="checkbox" data-pool checked><span>${esc(t('pool'))}</span></label><span class="field__hint check__hint" data-pool-row>${esc(t('poolHint'))}</span>
        <label class="check"><input type="checkbox" data-originals><span>${esc(t('originals'))}</span></label><span class="field__hint check__hint">${esc(t('originalsHint'))}</span></div>
      <div class="field"><span class="field__label">${esc(t('how'))}</span><div class="seg seg--full" role="group" data-seg="format"><button type="button" data-v="png" aria-pressed="true">${esc(t('png'))}</button><button type="button" data-v="zip" aria-pressed="false">${esc(t('zip'))}</button></div>
        <span class="field__hint">${esc(t('where'))}</span></div>
      <div data-result></div>
    </div>`,
    foot: `<button type="button" class="btn btn--secondary" data-open-folder>${I.folder}<span>${esc(t('openFolder'))}</span></button><button type="button" class="btn btn--primary" data-submit>${I.download}<span>${esc(t('submit'))}</span></button>`,
  });
  /** @type {HTMLElement} */ (sheet.querySelector('.sheet__foot')).classList.add('sheet__foot--split');
  const what = () => /** @type {HTMLInputElement} */ (sheet.querySelector('input[name="what"]:checked')).value;
  const syncPool = () => { for (const el of /** @type {NodeListOf<HTMLElement>} */ (sheet.querySelectorAll('[data-pool-row]'))) el.hidden = what() === 'set' || what() === 'cards' || what() === 'card'; };
  syncPool();
  sheet.addEventListener('change', e => { if (/** @type {HTMLElement} */ (e.target).matches('input[name="what"]')) syncPool(); });
  const result = /** @type {HTMLElement} */ (sheet.querySelector('[data-result]'));
  /** @type {string|null} the last export, shown by «Открыть в папке» */
  let lastPath = null;
  /** the export folder of the last export's scope: the collection's, or the factory's */
  let lastCollection = collectionId ?? null;
  sheet.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const b = /** @type {HTMLElement|null} */ (target.closest('[data-seg] > button'));
    if (b) { for (const x of /** @type {HTMLElement} */ (b.parentElement).children) x.setAttribute('aria-pressed', String(x === b)); return; }
    if (target.closest('[data-open-folder]')) {
      await attempt(() => call('openFolder', lastPath ? { ...(lastCollection ? { collectionId: lastCollection } : {}), path: lastPath } : { ...(lastCollection ? { collectionId: lastCollection } : {}), exports: true }));
      return;
    }
    if (!target.closest('[data-submit]')) return;
    const w = what();
    const format = /** @type {HTMLElement} */ (sheet.querySelector('[data-seg="format"] [aria-pressed="true"]')).dataset.v;
    const pool = /** @type {HTMLInputElement} */ (sheet.querySelector('[data-pool]')).checked;
    const originals = /** @type {HTMLInputElement} */ (sheet.querySelector('[data-originals]')).checked;
    // a whole collection carries its pool; core's `pool: true` would mean the pool alone
    const withPool = pool ? {} : { pool: false };
    const args = w === 'all' ? withPool : w === 'collection' ? { collectionId, ...withPool } : w === 'set' ? { collectionId, setIds: [setId] } : { collectionId, cardIds: w === 'card' ? [cardId] : picked };
    const btn = /** @type {HTMLButtonElement} */ (target.closest('[data-submit]'));
    btn.disabled = true;
    result.innerHTML = `<p class="field__hint">${esc(t('working'))}</p>`;
    const r = await attempt(() => call('exportItems', { ...args, originals, format }));
    btn.disabled = false;
    result.innerHTML = '';
    if (!r) return;
    lastPath = r.path;
    lastCollection = w === 'all' ? null : collectionId ?? null;
    const skipped = r.skipped?.length ? `<p class="field__hint">${esc(t('skipped', { n: r.skipped.length }))}</p>` : '';
    result.innerHTML = `<div class="done panel"><i class="dot dot--done"></i><div><p><b>${esc(t('done', { ...nw(r.files, PICTURES), zip: format === 'zip' ? t('inZip') : '' }))}</b></p><p class="data ink-3 done__path">${esc(r.path)}</p>${skipped}</div></div>`;
    /** @type {HTMLElement} */ (sheet.querySelector('[data-open-folder]')).innerHTML = `${I.folder}<span>${esc(t('openResult'))}</span>`;
  });
}
