// Export: PNG files in folders a person understands (collection → sets, single cards apart) or a ZIP archive — of a
// card, a set or the whole collection; then «Открыть в папке».
import { call } from '../api.js';
import { attempt, count, esc, I, openSheet } from '../ui.js';

/**
 * @param {{collection: any, sets: any[], set?: any, cardId?: string, cardTitle?: string}} o
 *   set: export that set by default; cardId: export one card
 */
export function openExport({ collection, sets, set, cardId, cardTitle }) {
  // a variant group exports its chosen variant; a group without a choice exports all its variants
  const chosenIds = () => {
    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const s of sets) groups.set(s.variantGroup ?? s.id, [...(groups.get(s.variantGroup ?? s.id) ?? []), s]);
    return [...groups.values()].flatMap(vs => (vs.some(v => v.chosen) ? vs.filter(v => v.chosen) : vs)).map(s => s.id);
  };
  const scopes = [
    ...(cardId ? [{ id: 'card', label: 'Карточка', args: { cardIds: [cardId] }, about: `«${cardTitle}» — одним файлом PNG.` }] : []),
    ...(set ? [{ id: 'set', label: 'Набор', args: { setIds: [set.id] }, about: `«${set.title}»: карточки по порядку мест в окне.` }] : []),
    { id: 'collection', label: 'Коллекция', args: { setIds: chosenIds() }, about: `Все наборы «${collection.title}» по номерам; из вариантов — выбранный.` },
  ];
  const { sheet } = openSheet({
    title: 'Экспорт',
    body: `<div class="form">
      <div class="field"><span class="field__label">Что</span><div class="seg" role="group" data-seg="scope">${scopes.map((s, i) => `<button type="button" data-v="${s.id}" aria-pressed="${i === 0}">${s.label}</button>`).join('')}</div>
        <span class="field__hint" data-about>${esc(scopes[0].about)}</span>
        <label class="check" data-pool-row ${scopes[0].id === 'collection' ? '' : 'hidden'}><input type="checkbox" data-pool checked><span>Выгрузить хранилище</span></label>
        <span class="field__hint" data-pool-hint ${scopes[0].id === 'collection' ? '' : 'hidden'}>Карточки вне наборов — отдельной папкой «Хранилище».</span></div>
      <div class="field"><span class="field__label">Как</span><div class="seg" role="group" data-seg="format"><button type="button" data-v="png" aria-pressed="true">Картинки PNG</button><button type="button" data-v="zip" aria-pressed="false">Архив ZIP</button></div>
        <span class="field__hint">Файлы ложатся в папку коллекции → export, по папкам: коллекция → наборы → карточки.</span></div>
      <div data-result></div>
    </div>`,
    foot: `<button type="button" class="btn btn--secondary" data-open-folder>${I.folder}Открыть папку экспорта</button><button type="button" class="btn btn--primary" data-submit>${I.download}Экспортировать</button>`,
  });
  const pressed = (/** @type {string} */ n) => /** @type {HTMLElement} */ (sheet.querySelector(`[data-seg="${n}"] [aria-pressed="true"]`)).dataset.v;
  const result = /** @type {HTMLElement} */ (sheet.querySelector('[data-result]'));
  /** @type {string|null} */
  let lastPath = null;
  sheet.addEventListener('click', async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const b = /** @type {HTMLElement|null} */ (t.closest('[data-seg] > button'));
    if (b) {
      for (const x of /** @type {HTMLElement} */ (b.parentElement).children) x.setAttribute('aria-pressed', String(x === b));
      /** @type {HTMLElement} */ (sheet.querySelector('[data-about]')).textContent = scopes.find(s => s.id === pressed('scope'))?.about ?? '';
      for (const el of sheet.querySelectorAll('[data-pool-row], [data-pool-hint]')) /** @type {HTMLElement} */ (el).hidden = pressed('scope') !== 'collection';
      return;
    }
    if (t.closest('[data-open-folder]')) {
      await attempt(() => call('openFolder', lastPath ? { collectionId: collection.id, path: lastPath } : { collectionId: collection.id, exports: true }));
      return;
    }
    if (t.closest('[data-submit]')) {
      const scope = scopes.find(s => s.id === pressed('scope'));
      const btn = /** @type {HTMLButtonElement} */ (t.closest('[data-submit]'));
      btn.disabled = true;
      result.innerHTML = '<p class="field__hint">Экспортирую…</p>';
      const pool = scope?.id === 'collection' && /** @type {HTMLInputElement} */ (sheet.querySelector('[data-pool]')).checked;
      const r = await attempt(() => call('exportItems', { collectionId: collection.id, format: pressed('format'), ...scope?.args, ...(pool ? { pool: true } : {}) }));
      btn.disabled = false;
      result.innerHTML = '';
      if (!r) return;
      lastPath = r.path;
      const skipped = r.skipped?.length ? `<p class="field__hint">Пропущено без картинки: ${esc(r.skipped.length)}.</p>` : '';
      result.innerHTML = `<div class="done panel"><i class="dot dot--done"></i><div><p><b>Готово:</b> ${count(r.files, 'картинка', 'картинки', 'картинок')}${pressed('format') === 'zip' ? ' в архиве' : ''}</p><p class="data ink-3 done__path">${esc(r.path)}</p>${skipped}</div></div>`;
      /** @type {HTMLElement} */ (sheet.querySelector('[data-open-folder]')).innerHTML = `${I.folder}Открыть в папке`;
    }
  });
}
