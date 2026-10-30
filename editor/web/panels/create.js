// Creating: a collection (with its description; optionally all 16 sets at once), a set inside a collection from a
// free-text brief, loose cards into the collection's pool, the whole collection with one button, and editing what the
// collection is.
import { call } from '../api.js';
import { attempt, bindTextHelp, count, esc, I, openSheet, textHelp, toast } from '../ui.js';
import { app } from '../state.js';

/** Places in a collection: the style's set-rules.json collection.sets (Scapes: 16), which the page does not load. */
export const PLACES = 16;

/**
 * Which models a generation run will use, from the settings: one line for a person, and a warning when the key is
 * missing. No spend caps here (the author's decision, 2026-10-31): the person limits spend on their provider's key;
 * the caps of settings stay a safety net for agents and the command line, not a promise of the editor.
 * @param {HTMLElement} sheet @param {'set'|'collection'|'cards'} what
 */
async function bindCost(sheet, what) {
  const el = /** @type {HTMLElement} */ (sheet.querySelector('[data-cost]'));
  const r = await attempt(() => call('getSettings'));
  if (!r) return;
  const s = r.settings;
  const codex = s.provider.use === 'codex-cli';
  const p = s.provider[s.provider.preset];
  const service = r.keys[s.provider.preset].title;
  const model = codex ? 'Codex CLI (по подписке, без оплаты за картинку)' : `${p.model} (${service})`;
  const keyNeeded = app.key.source === 'none'
    ? `<p class="field__hint field__hint--fail">${I.alert} Нет ключа ${service}: ${what === 'cards' ? 'заказы карточек' : 'план набора'} пишет текстовая модель через ${service}. <button type="button" class="btn btn--text btn--s" data-open-key><span>Ввести ключ</span></button></p>` : '';
  el.innerHTML = `<div class="costline"><p class="field__hint">Картинки: ${esc(model)}. План пишет ${esc(p.textModel)}. Изменить — в настройках.</p>${keyNeeded}</div>`;
  el.querySelector('[data-open-key]')?.addEventListener('click', async () => { (await import('./settings.js')).openSettings(); });
}

/** @param {number} n */
const variantsSeg = (n = 1) => `<div class="seg" role="group" aria-label="Сколько вариантов" data-seg="variants">${[1, 2, 3].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === n}">${v}</button>`).join('')}</div>`;
/** @param {HTMLElement} root @param {string} name */
const segValue = (root, name) => Number(/** @type {HTMLElement|null} */ (root.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`))?.dataset.v ?? 1);
/** @param {HTMLElement} root */
function bindSegs(root) {
  root.addEventListener('click', e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-seg] > button'));
    if (!b) return;
    for (const x of /** @type {HTMLElement} */ (b.parentElement).children) x.setAttribute('aria-pressed', String(x === b));
  });
}

export async function openCreateCollection() {
  const { sheet, close } = openSheet({
    title: 'Новая коллекция',
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">Название</span><input class="input" name="title" required autofocus placeholder="Например, Летний отдых"></label>
      <label class="field"><span class="field__label">Что это за коллекция</span><textarea class="input" name="description" rows="4" placeholder="Тема, настроение, для кого. Можно набросать мысли как есть — «Сформулировать» превратит их в описание. Это описание — основа всех наборов"></textarea>${textHelp('collection')}</label>
      <label class="field"><span class="field__label">Пожелания</span><textarea class="input" name="wishes" rows="2" placeholder="Необязательно: что обязательно должно быть или чего избегать"></textarea>${textHelp('wishes')}</label>
      <div class="field"><span class="field__label">Как собирать</span>
        <div class="seg" role="group" data-seg="how"><button type="button" data-v="0" aria-pressed="true">По одному набору</button><button type="button" data-v="1" aria-pressed="false">Сразу все 16</button></div>
        <span class="field__hint" data-how-hint>Коллекция создаётся пустой; наборы вы создаёте сами, по одному.</span></div>
      <div data-cost hidden></div>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-submit>Создать</button>`,
  });
  bindSegs(sheet);
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindTextHelp(form, () => ({ context: { collection: String(new FormData(form).get('title') ?? ''), description: String(new FormData(form).get('description') ?? '') } }));
  const costEl = /** @type {HTMLElement} */ (sheet.querySelector('[data-cost]'));
  await bindCost(sheet, 'collection');
  sheet.querySelector('[data-seg="how"]')?.addEventListener('click', e => {
    // the clicked button, not aria-pressed: bindSegs (on the sheet) updates that only after this listener
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-v]'));
    if (!b) return;
    const all = b.dataset.v === '1';
    /** @type {HTMLElement} */ (sheet.querySelector('[data-how-hint]')).textContent = all
      ? 'Модель разделит описание на 16 наборов и сделает все карточки. Это долго; ход виден в очереди.'
      : 'Коллекция создаётся пустой; наборы вы создаёте сами, по одному.';
    costEl.hidden = !all;
  });
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const title = String(f.get('title') ?? '').trim();
    if (!title) { /** @type {HTMLInputElement} */ (form.elements.namedItem('title')).focus(); toast('Назовите коллекцию.', { kind: 'fail' }); return; }
    const description = String(f.get('description') ?? '').trim();
    const wishes = String(f.get('wishes') ?? '').trim();
    const col = await attempt(() => call('createCollection', { title, description, fields: wishes ? { 'Пожелания': wishes } : {} }));
    if (!col) return;
    if (segValue(sheet, 'how') === 1) {
      if (!description) toast('Без описания модель возьмёт за тему название коллекции.');
      await attempt(() => call('buildCollection', { collectionId: col.id, theme: description || title, wishes }));
    }
    close();
    app.go(`#/c/${encodeURIComponent(col.id)}`);
  });
}

/** @param {any} col */
export async function openCreateSet(col) {
  const { sheet, close } = openSheet({
    title: 'Новый набор',
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">Тема набора</span><input class="input" name="theme" required autofocus placeholder="Например, рыбалка на озере">${textHelp('setTheme')}</label>
      <label class="field"><span class="field__label">Пожелания</span><textarea class="input" name="wishes" rows="3" placeholder="Свободным текстом: что показать, чего избегать, какое настроение"></textarea>${textHelp('wishes')}</label>
      <div class="field"><span class="field__label">Сколько вариантов</span>${variantsSeg(1)}<span class="field__hint">Каждый вариант — набор целиком; потом выберете лучший.</span></div>
      <div data-cost></div>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-submit>${I.spark}Собрать набор</button>`,
  });
  bindSegs(sheet);
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindTextHelp(form, () => ({ collectionId: col.id, context: { collection: col.title, description: col.description, set: String(new FormData(form).get('theme') ?? '') } }));
  await bindCost(sheet, 'set');
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const theme = String(f.get('theme') ?? '').trim();
    if (!theme) { /** @type {HTMLInputElement} */ (form.elements.namedItem('theme')).focus(); toast('Напишите тему набора.', { kind: 'fail' }); return; }
    const r = await attempt(() => call('buildSet', { collectionId: col.id, theme, wishes: String(f.get('wishes') ?? '').trim(), variants: segValue(sheet, 'variants') }));
    if (!r) return;
    close();
    toast('Набор собирается: сначала план, потом карточки. Он появится здесь сам.');
    app.refresh();
  });
}

/** Loose cards into the collection's pool: a theme, wishes, how many and how many scenes. @param {any} col */
export async function openCreateCards(col) {
  const st = await attempt(() => call('getSettings'));
  const max = st?.settings.set.cards.maxCount ?? 1;
  const { sheet, close } = openSheet({
    title: 'Новые карточки',
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">О чём карточки</span><input class="input" name="theme" required autofocus placeholder="Например, снасти для рыбалки">${textHelp('cardsTheme')}</label>
      <label class="field"><span class="field__label">Пожелания</span><textarea class="input" name="wishes" rows="3" placeholder="Свободным текстом: что показать, чего избегать, какое настроение"></textarea>${textHelp('wishes')}</label>
      <div class="row row--fields">
        <label class="field"><span class="field__label">Сколько карточек</span><input class="input data" name="count" type="number" min="1" max="${max}" step="1" value="${Math.min(5, max)}" inputmode="numeric"></label>
        <label class="field"><span class="field__label">Из них сцен с персонажами</span><input class="input data" name="scenes" type="number" min="0" max="${Math.min(5, max)}" step="1" value="0" inputmode="numeric"></label>
      </div>
      <p class="field__hint">Карточки лягут в хранилище коллекции, вне наборов; оттуда их можно разложить по наборам.</p>
      <div data-cost></div>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-submit>${I.spark}Создать карточки</button>`,
  });
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindTextHelp(form, () => ({ collectionId: col.id, context: { collection: col.title, description: col.description } }));
  await bindCost(sheet, 'cards');
  const countEl = /** @type {HTMLInputElement} */ (form.elements.namedItem('count'));
  const scenesEl = /** @type {HTMLInputElement} */ (form.elements.namedItem('scenes'));
  // scenes are some of the cards: never more than the count
  countEl.addEventListener('input', () => { scenesEl.max = String(Math.max(0, Math.min(Number(countEl.value) || 0, max))); });
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const theme = String(f.get('theme') ?? '').trim();
    const count = Number(f.get('count')), scenes = Number(f.get('scenes'));
    if (!theme) { /** @type {HTMLInputElement} */ (form.elements.namedItem('theme')).focus(); toast('Напишите, о чём карточки.', { kind: 'fail' }); return; }
    if (!(Number.isInteger(count) && count >= 1 && count <= max)) { toast(`Сколько карточек: целое число от 1 до ${max} за раз.`, { kind: 'fail' }); return; }
    if (!(Number.isInteger(scenes) && scenes >= 0 && scenes <= count)) { toast(`Сцен с персонажами: от 0 до ${count}.`, { kind: 'fail' }); return; }
    const r = await attempt(() => call('makeCards', { collectionId: col.id, theme, wishes: String(f.get('wishes') ?? '').trim(), count, scenes }));
    if (!r) return;
    close();
    toast('Карточки создаются: сначала заказы, потом картинки. Они появятся в хранилище сами.');
    app.refresh();
  });
}

/** @param {any} col @param {number} have  places of the collection its sets already hold (variants count once) */
export async function openBuildCollection(col, have) {
  const missing = PLACES - have;
  // a collection that has sets: only its missing places, or one more variant of every place (the author's decision,
  // 2026-10-31); the core's buildCollection `mode`
  const hints = {
    missing: `Модель спланирует ${count(missing, 'недостающий набор', 'недостающих набора', 'недостающих наборов')} под их номерами, не повторяя то, что есть, и сделает их карточки. Готовые наборы не трогаются.`,
    variants: `Модель сделает ещё по варианту каждого из ${PLACES} наборов: у каждого места появится новый вариант рядом с тем, что есть${missing ? ', а пустые места получат свой набор' : ''}. Ничего не заменяется — лучший вариант места вы выберете сами.`,
  };
  const first = missing ? 'missing' : 'variants';
  const choice = have ? `<div class="field"><span class="field__label">Что собрать</span>
      <div class="seg" role="group" data-seg="mode"><button type="button" data-v="missing" aria-pressed="${first === 'missing'}"${missing ? '' : ' disabled'}>Только недостающие (${missing})</button><button type="button" data-v="variants" aria-pressed="${first === 'variants'}">Ещё по варианту каждого из ${PLACES}</button></div>
      <span class="field__hint" data-mode-hint>${hints[first]}</span></div>` : '';
  const { sheet, close } = openSheet({
    title: 'Собрать все наборы',
    body: `<form class="form" data-form>
      <p class="ink-2">${have ? `В коллекции уже ${count(have, 'набор', 'набора', 'наборов')} из ${PLACES}.` : `Модель разделит тему на ${PLACES} наборов (последний — гранд-набор) и сделает все карточки.`}</p>
      ${choice}
      <label class="field"><span class="field__label">Видение коллекции</span><textarea class="input" name="theme" rows="5" autofocus>${esc(col.description || col.title)}</textarea>${textHelp('collection')}<span class="field__hint">Описание коллекции; поправьте, если хотите сказать иначе.</span></label>
      <label class="field"><span class="field__label">Пожелания</span><textarea class="input" name="wishes" rows="2">${esc(col.fields?.['Пожелания'] ?? '')}</textarea>${textHelp('wishes')}</label>
      <div class="field"><span class="field__label">Вариантов каждого набора</span>${variantsSeg(1)}</div>
      <div data-cost></div>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-submit>${I.spark}Собрать коллекцию</button>`,
  });
  bindSegs(sheet);
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindTextHelp(form, () => ({ collectionId: col.id, context: { collection: col.title, description: String(new FormData(form).get('theme') ?? '') } }));
  await bindCost(sheet, 'collection');
  const mode = () => /** @type {HTMLElement|null} */ (sheet.querySelector('[data-seg="mode"] [aria-pressed="true"]'))?.dataset.v ?? first;
  sheet.querySelector('[data-seg="mode"]')?.addEventListener('click', e => {
    // the clicked button, not aria-pressed: bindSegs (on the sheet) updates that only after this listener
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-v]'));
    if (b) /** @type {HTMLElement} */ (sheet.querySelector('[data-mode-hint]')).textContent = hints[/** @type {'missing'|'variants'} */ (b.dataset.v)];
  });
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const r = await attempt(() => call('buildCollection', { collectionId: col.id, theme: String(f.get('theme') ?? '').trim(), wishes: String(f.get('wishes') ?? '').trim(), variants: segValue(sheet, 'variants'), ...(have ? { mode: mode() } : {}) }));
    if (!r) return;
    close();
    toast('Коллекция собирается: наборы будут появляться здесь по мере готовности.');
    app.refresh();
  });
}

/** @param {any} col */
export function openEditCollection(col) {
  const rows = Object.entries(col.fields ?? {});
  const row = (/** @type {string} */ k = '', /** @type {unknown} */ v = '') => `<div class="kv"><input class="input" name="k" value="${esc(k)}" placeholder="Поле" aria-label="Название поля"><input class="input" name="v" value="${esc(v)}" placeholder="Значение" aria-label="Значение"><button type="button" class="btn btn--secondary btn--icon" data-del-row aria-label="Убрать поле">${I.x}</button></div>`;
  const { sheet, close } = openSheet({
    title: 'Коллекция',
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">Название</span><input class="input" name="title" value="${esc(col.title)}" required></label>
      <label class="field"><span class="field__label">Что это за коллекция</span><textarea class="input" name="description" rows="6">${esc(col.description)}</textarea>${textHelp('collection')}</label>
      <div class="field"><span class="field__label">Поля</span><div class="kvs" data-rows>${rows.map(([k, v]) => row(k, v)).join('')}</div>
        <button type="button" class="btn btn--text btn--s" data-add-row>${I.plus}<span>Добавить поле</span></button><span class="field__hint">Свои поля коллекции: сезон, аудитория, настроение — что угодно.</span></div>
      <details class="more"><summary class="btn btn--text btn--s"><span>Удалить коллекцию</span></summary>
        <p class="ink-2">Папка коллекции со всеми наборами и карточками уйдёт в корзину системы — оттуда её можно вернуть.</p>
        <button type="button" class="btn btn--secondary" data-delete>${I.trash}Удалить «${esc(col.title)}»</button></details>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-submit>Сохранить</button>`,
  });
  const rowsEl = /** @type {HTMLElement} */ (sheet.querySelector('[data-rows]'));
  bindTextHelp(sheet, () => ({ collectionId: col.id, context: { collection: String(/** @type {HTMLInputElement} */ (sheet.querySelector('[name="title"]')).value) } }));
  sheet.addEventListener('click', async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('[data-add-row]')) { rowsEl.insertAdjacentHTML('beforeend', row()); /** @type {HTMLInputElement} */ (rowsEl.lastElementChild?.querySelector('input')).focus(); }
    t.closest('[data-del-row]')?.closest('.kv')?.remove();
    if (t.closest('[data-delete]')) {
      if (await attempt(() => call('deleteCollection', { collectionId: col.id })) !== undefined) { close(); app.go('#/'); }
    }
    if (t.closest('[data-submit]')) {
      const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
      /** @type {Record<string, string>} */
      const fields = {};
      for (const kv of rowsEl.querySelectorAll('.kv')) {
        const [k, v] = [...kv.querySelectorAll('input')].map(i => i.value.trim());
        if (k) fields[k] = v;
      }
      const f = new FormData(form);
      const title = String(f.get('title') ?? '').trim();
      if (!title) { toast('У коллекции должно быть название.', { kind: 'fail' }); return; }
      const ok = await attempt(() => call('updateCollection', { collectionId: col.id, patch: { title, description: String(f.get('description') ?? '').trim(), fields } }));
      if (ok) { close(); app.refresh(); }
    }
  });
}
