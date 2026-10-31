// Creating and editing: a collection (with its description; how to fill it is chosen inside it), a set inside a
// collection — generated from a free-text brief, or an empty window gathered by hand —, a set's settings, loose cards
// into the collection's pool, all the sets of a collection with one button, and what the collection is (fields, cover,
// deleting).
import { call } from '../api.js';
import { attempt, bindTextHelp, confirmDialog, esc, I, openSheet, textHelp, tip, toast } from '../ui.js';
import { plural, words } from '../i18n.js';
import { colourName, colourSwatches, windowFor, windowsOf } from '../window.js';
import { app } from '../state.js';

const t = words({
  ru: {
    cancel: 'Отмена', save: 'Сохранить', create: 'Создать', title: 'Название',
    // what the run will use
    codex: 'Codex CLI (по подписке, без оплаты за картинку)', models: 'Картинки: {model}. План пишет {text}. Изменить — в настройках.',
    noKey: 'Нет ключа {service}: {what} пишет текстовая модель через {service}.', noKeyCards: 'заказы карточек', noKeyPlan: 'план набора', enterKey: 'Ввести ключ',
    variants: 'Сколько вариантов',
    // a new collection
    newCollection: 'Новая коллекция', titlePh: 'Например, Летний отдых', about: 'Что это за коллекция',
    aboutPh: 'Тема, настроение, для кого. Можно набросать мысли как есть — «Сформулировать» превратит их в описание. Это описание — основа всех наборов',
    wishes: 'Пожелания', wishesPh: 'Необязательно: что обязательно должно быть или чего избегать',
    emptyNote: 'Коллекция создастся пустой. Как наполнять — по набору, всю сразу или карточками — выберете внутри неё.', nameIt: 'Назовите коллекцию.',
    // a set
    createSet: 'Создать набор', tabGen: 'Сгенерировать', tabOwn: 'Собрать самому',
    genLead: 'Модель составит план из 10 карточек по теме и нарисует их. Набор появится в коллекции сам.',
    theme: 'Тема набора', themePh: 'Например, рыбалка на озере', setWishesPh: 'Свободным текстом: что показать, чего избегать, какое настроение',
    variantsHint: 'Каждый вариант — набор целиком; лучший выберете потом.', generateSet: 'Сгенерировать набор', writeTheme: 'Напишите тему набора.',
    setGoing: 'Набор генерируется: сначала план, потом карточки. Он появится здесь сам.',
    ownLead: 'Появится пустое окно на 10 мест. Перетащите в него карточки из хранилища; пустое место можно сгенерировать позже, по одной карточке.',
    setName: 'Название набора', setNamePh: 'Например, Марсианская кухня', createEmpty: 'Создать пустой набор', nameSet: 'Назовите набор.',
    kind: 'Вид окна', large: 'Большое', small: 'Малое', grand: 'Гранд',
    kindTip: 'Большое окно — обычный набор: звёзды растут к концу набора, у сцен с персонажами — золотые рамки. Малое — окно попроще: звёзды у каждого места свои, рамки серебряные или золотые. Гранд — последний, 16-й набор коллекции: один цвет, кристальные рамки и пять звёзд на каждом месте.',
    colour: 'Цвет окна', colourHint: '{name}. Цвет сохраняется у набора.', grandColour: 'У гранд-окна один цвет.',
    // set settings
    setSettings: 'Настройки набора', setTheme: 'Тема', windowSec: 'Окно', variantsSec: 'Варианты',
    moreLead: 'Модель составит новый план на ту же тему и нарисует карточки. Ничего не заменится: лучший вариант выберете вы.', more: 'Сделать ещё вариант',
    moreGoing: 'Новый вариант генерируется: он появится рядом с этим.', moreNoNumber: 'У набора нет номера в коллекции: вариант не к чему привязать.',
    deleteSec: 'Удаление', deleteSetLead: 'Карточки набора вернутся в хранилище коллекции; сам набор уйдёт в корзину системы — оттуда его можно вернуть.',
    deleteSet: 'Удалить набор', deleteSetQ: 'Удалить набор «{title}»?', yes: 'Да, удалить', no: 'Нет, оставить', nameRequired: 'У набора должно быть название.',
    // loose cards
    newCards: 'Создать карточки', cardsAbout: 'О чём карточки', cardsAboutPh: 'Например, снасти для рыбалки', cardsWishesPh: 'Необязательно: что показать, чего избегать, какое настроение',
    howMany: 'Сколько карточек', scenes: 'Из них сцен с персонажами', own: 'Своё число', ownPh: 'Своё', ownTip: 'Если вписать число, берётся оно, а не ползунок.',
    cardsNote: 'Карточки лягут в хранилище коллекции, вне наборов; оттуда их можно разложить по наборам.', writeCards: 'Напишите, о чём карточки.',
    badCount: 'Сколько карточек: целое число от 1 до {max} за раз.', badScenes: 'Сцен с персонажами: от 0 до {n}.',
    cardsGoing: 'Карточки создаются: сначала заказы, потом картинки. Они появятся в хранилище сами.',
    // all sets
    buildAll: 'Сгенерировать все наборы', what: 'Что сгенерировать', missing: 'Только недостающие ({n})', moreEach: 'Ещё по варианту каждого из {n}',
    missingHint: 'Модель спланирует недостающие наборы ({n}) под их номерами, не повторяя то, что есть, и нарисует их карточки. Готовые наборы не трогаются.',
    moreHint: 'Модель сделает ещё по варианту каждого из {n} наборов: у каждого места появится новый вариант рядом с тем, что есть{empty}. Ничего не заменяется — лучший вариант места вы выберете сами.',
    moreHintEmpty: ', а пустые места получат свой набор',
    have: 'В коллекции уже {sets} из {n}.', split: 'Модель разделит тему на {n} наборов (последний — гранд-набор) и нарисует все карточки. Это долго; ход виден в очереди.',
    vision: 'Видение коллекции', visionHint: 'Описание коллекции; поправьте, если хотите сказать иначе.', perSet: 'Вариантов каждого набора', generate: 'Сгенерировать',
    collectionGoing: 'Коллекция генерируется: наборы будут появляться здесь по мере готовности.',
    // the collection
    collection: 'Коллекция', fields: 'Поля', field: 'Поле', value: 'Значение', fieldName: 'Название поля', dropField: 'Убрать поле', addField: 'Добавить поле',
    fieldsHint: 'Свои поля коллекции: сезон, аудитория, настроение — что угодно.', cover: 'Обложка', coverHint: 'Картинка коллекции в списке коллекций.',
    coverFirst: 'Первая карточка набора', coverPick: 'Выбрать обложку', coverAll: 'Все карточки коллекции · {n}', coverNone: 'Карточек с картинкой пока нет.',
    deleteLead: 'Коллекция со всеми наборами и карточками уйдёт в корзину системы — оттуда её можно вернуть.', deleteCol: 'Удалить коллекцию',
    deleteColQ: 'Удалить коллекцию «{title}»?', deleteColText: 'Удалятся все наборы и карточки этой коллекции: {sets}, {cards}. Папка уйдёт в корзину системы — оттуда её можно вернуть.',
    titleRequired: 'У коллекции должно быть название.',
  },
  en: {
    cancel: 'Cancel', save: 'Save', create: 'Create', title: 'Title',
    codex: 'Codex CLI (by subscription, no charge per image)', models: 'Images: {model}. The plan is written by {text}. Change it in the settings.',
    noKey: 'No {service} key: {what} is written by the text model through {service}.', noKeyCards: 'the card orders', noKeyPlan: 'the set plan', enterKey: 'Enter a key',
    variants: 'How many variants',
    newCollection: 'New collection', titlePh: 'For example, Summer holidays', about: 'What this collection is',
    aboutPh: 'The theme, the mood, who it is for. Jot your thoughts as they come — «Draft» turns them into a description. Every set grows from this description',
    wishes: 'Wishes', wishesPh: 'Optional: what must be there, or what to avoid',
    emptyNote: 'The collection starts empty. How to fill it — set by set, all at once or with cards — you choose inside it.', nameIt: 'Give the collection a title.',
    createSet: 'Create a set', tabGen: 'Generate', tabOwn: 'Gather it yourself',
    genLead: 'The model writes a plan of 10 cards on the theme and draws them. The set appears in the collection by itself.',
    theme: 'Set theme', themePh: 'For example, fishing on a lake', setWishesPh: 'Free text: what to show, what to avoid, what mood',
    variantsHint: 'Each variant is a whole set; you pick the best one later.', generateSet: 'Generate the set', writeTheme: 'Write the set’s theme.',
    setGoing: 'The set is being generated: first the plan, then the cards. It appears here by itself.',
    ownLead: 'An empty window of 10 places appears. Drag cards into it from the pool; an empty place can be generated later, one card at a time.',
    setName: 'Set title', setNamePh: 'For example, Martian kitchen', createEmpty: 'Create an empty set', nameSet: 'Give the set a title.',
    kind: 'Window kind', large: 'Large', small: 'Small', grand: 'Grand',
    kindTip: 'The large window is a regular set: the stars rise towards the end, scenes with characters get gold frames. The small one is simpler: every place has its own stars, frames are silver or gold. The grand one is the 16th, last set of a collection: one colour, crystal frames and five stars on every place.',
    colour: 'Window colour', colourHint: '{name}. The colour is kept with the set.', grandColour: 'The grand window has one colour.',
    setSettings: 'Set settings', setTheme: 'Theme', windowSec: 'Window', variantsSec: 'Variants',
    moreLead: 'The model writes a new plan on the same theme and draws the cards. Nothing is replaced: you pick the best variant.', more: 'Make one more variant',
    moreGoing: 'A new variant is being generated: it appears next to this one.', moreNoNumber: 'The set has no number in the collection: the variant has nothing to join.',
    deleteSec: 'Deleting', deleteSetLead: 'The set’s cards go back to the collection’s pool; the set itself goes to the system trash, and can be brought back from there.',
    deleteSet: 'Delete the set', deleteSetQ: 'Delete the set «{title}»?', yes: 'Yes, delete', no: 'No, keep it', nameRequired: 'A set needs a title.',
    newCards: 'Create cards', cardsAbout: 'What the cards are about', cardsAboutPh: 'For example, fishing tackle', cardsWishesPh: 'Optional: what to show, what to avoid, what mood',
    howMany: 'How many cards', scenes: 'Of them, scenes with characters', own: 'Own number', ownPh: 'Own', ownTip: 'A number written here is used instead of the slider.',
    cardsNote: 'The cards land in the collection’s pool, outside the sets; from there you lay them out into sets.', writeCards: 'Write what the cards are about.',
    badCount: 'How many cards: a whole number from 1 to {max} at a time.', badScenes: 'Scenes with characters: from 0 to {n}.',
    cardsGoing: 'The cards are being made: first the orders, then the pictures. They appear in the pool by themselves.',
    buildAll: 'Generate all sets', what: 'What to generate', missing: 'Only the missing ones ({n})', moreEach: 'One more variant of each of {n}',
    missingHint: 'The model plans the missing sets ({n}) under their numbers, without repeating what is there, and draws their cards. The finished sets stay as they are.',
    moreHint: 'The model makes one more variant of each of the {n} sets: every place gets a new variant next to what it has{empty}. Nothing is replaced — you pick each place’s best variant.',
    moreHintEmpty: ', and the empty places get a set of their own',
    have: 'The collection already has {sets} of {n}.', split: 'The model splits the theme into {n} sets (the last one is the grand set) and draws every card. It takes a while; the queue shows the progress.',
    vision: 'Vision of the collection', visionHint: 'The collection’s description; change it if you want to say it differently.', perSet: 'Variants of each set', generate: 'Generate',
    collectionGoing: 'The collection is being generated: the sets appear here as they are ready.',
    collection: 'Collection', fields: 'Fields', field: 'Field', value: 'Value', fieldName: 'Field name', dropField: 'Remove the field', addField: 'Add a field',
    fieldsHint: 'The collection’s own fields: season, audience, mood — anything.', cover: 'Cover', coverHint: 'The collection’s picture in the list of collections.',
    coverFirst: 'The first card of a set', coverPick: 'Choose the cover', coverAll: 'All cards of the collection · {n}', coverNone: 'No cards with a picture yet.',
    deleteLead: 'The collection with all its sets and cards goes to the system trash, and can be brought back from there.', deleteCol: 'Delete the collection',
    deleteColQ: 'Delete the collection «{title}»?', deleteColText: 'Every set and card of this collection goes: {sets}, {cards}. The folder goes to the system trash, and can be brought back from there.',
    titleRequired: 'A collection needs a title.',
  },
});

/** Places in a collection: the style's set-rules.json collection.sets (Scapes: 16), which the page does not load. */
export const PLACES = 16;
/** The collection field the wishes of «Новая коллекция» are kept in (the core reads fields as free text). */
const WISHES_FIELD = 'Пожелания';

/** @param {number} n */
const setsCount = n => `${n} ${plural(n, { ru: ['набор', 'набора', 'наборов'], en: ['set', 'sets'] })}`;
/** @param {number} n */
const cardsCount = n => `${n} ${plural(n, { ru: ['карточка', 'карточки', 'карточек'], en: ['card', 'cards'] })}`;

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
  const model = codex ? t('codex') : `${p.model} (${service})`;
  const keyNeeded = app.key.source === 'none'
    ? `<p class="field__hint field__hint--fail">${I.alert} ${esc(t('noKey', { service, what: what === 'cards' ? t('noKeyCards') : t('noKeyPlan') }))} <button type="button" class="btn btn--text btn--s" data-open-key><span>${esc(t('enterKey'))}</span></button></p>` : '';
  el.innerHTML = `<div class="costline"><p class="field__hint">${esc(t('models', { model, text: p.textModel }))}</p>${keyNeeded}</div>`;
  el.querySelector('[data-open-key]')?.addEventListener('click', async () => { (await import('./settings.js')).openSettings(); });
}

/** A segmented control. @param {string} name @param {[string|number, string, boolean?][]} opts  value, label, disabled @param {string|number} cur @param {string} [cls] */
const seg = (name, opts, cur, cls = '') => `<div class="seg ${cls}" role="group" data-seg="${esc(name)}">${opts.map(([v, l, off]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}" ${off ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
/** @param {number} n */
const variantsSeg = (n = 1) => seg('variants', [[1, '1'], [2, '2'], [3, '3']], n);
/** @param {HTMLElement} root @param {string} name */
const segValue = (root, name) => /** @type {HTMLElement|null} */ (root.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`))?.dataset.v;
/** Segmented controls and swatches under `root` keep one pressed button; `onPick(name, value)` hears each change. @param {HTMLElement} root @param {(name: string, v: string) => void} [onPick] */
function bindSegs(root, onPick) {
  root.addEventListener('click', e => {
    const b = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-seg] > button'));
    if (!b || b.disabled) return;
    const group = /** @type {HTMLElement} */ (b.parentElement);
    for (const x of group.children) x.setAttribute('aria-pressed', String(x === b));
    onPick?.(/** @type {string} */ (group.dataset.seg), /** @type {string} */ (b.dataset.v));
  });
}

/**
 * The window controls of a set: its kind (with the «i» telling the kinds apart) and its colour. Changing the kind
 * redraws the colours of the new kind. @param {any} g  windows.json @param {string} kind @param {string} [template]
 */
function windowControls(g, kind, template) {
  const kinds = [g.kind, ...Object.keys(g.families ?? {})];
  const w = windowFor(g, kind);
  const cur = template && template in w.templates ? template : Object.keys(w.templates)[0];
  const label = (/** @type {string} */ k) => (['large', 'small', 'grand'].includes(k) ? t(/** @type {'large'} */ (k)) : k);
  const colours = colourSwatches(w, cur);
  return `<div class="field"><span class="field__label field__label--tip">${esc(t('kind'))}${tip(t('kindTip'), { side: 'left' })}</span>${seg('kind', kinds.map(k => [k, esc(label(k))]), kind)}</div>
    <div class="field" data-colours><span class="field__label">${esc(t('colour'))}</span>${colours
      ? `${colours}<span class="field__hint">${esc(t('colourHint', { name: cap(colourName(cur, w.templates[cur])) }))}</span>`
      : `<span class="field__hint">${esc(t('grandColour'))}</span>`}</div>`;
}
/** @param {string} s */
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Keeps the window controls under `root` in step: a new kind shows its own colours. @param {HTMLElement} root @param {any} g */
function bindWindowControls(root, g) {
  bindSegs(root, (name, v) => {
    const box = /** @type {HTMLElement} */ (root.querySelector('[data-window-controls]'));
    if (name === 'kind') box.innerHTML = windowControls(g, v);
    if (name === 'colour') box.innerHTML = windowControls(g, /** @type {string} */ (segValue(box, 'kind')), v);
  });
}
/** @param {HTMLElement} root */
const windowValue = root => ({ kind: /** @type {string} */ (segValue(root, 'kind')), template: segValue(root, 'colour') });

export async function openCreateCollection() {
  const { sheet, close } = openSheet({
    title: t('newCollection'),
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">${esc(t('title'))}</span><input class="input" name="title" required autofocus placeholder="${esc(t('titlePh'))}"></label>
      <div class="field"><span class="field__label">${esc(t('about'))}</span><textarea class="input" name="description" rows="4" placeholder="${esc(t('aboutPh'))}"></textarea>${textHelp('collection')}</div>
      <div class="field"><span class="field__label">${esc(t('wishes'))}</span><textarea class="input" name="wishes" rows="2" placeholder="${esc(t('wishesPh'))}"></textarea>${textHelp('wishes')}</div>
      <p class="field__hint">${esc(t('emptyNote'))}</p>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${esc(t('create'))}</button>`,
  });
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindTextHelp(form, () => ({ context: { collection: String(new FormData(form).get('title') ?? ''), description: String(new FormData(form).get('description') ?? '') } }));
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const title = String(f.get('title') ?? '').trim();
    if (!title) { /** @type {HTMLInputElement} */ (form.elements.namedItem('title')).focus(); toast(t('nameIt'), { kind: 'fail' }); return; }
    const wishes = String(f.get('wishes') ?? '').trim();
    const col = await attempt(() => call('createCollection', { title, description: String(f.get('description') ?? '').trim(), fields: wishes ? { [WISHES_FIELD]: wishes } : {} }));
    if (!col) return;
    close();
    app.go(`#/c/${encodeURIComponent(col.id)}`);
  });
}

/** «Создать набор»: generated from a theme and wishes, or an empty window gathered by hand. @param {any} col */
export async function openCreateSet(col) {
  const g = await windowsOf(col.style);
  const tabs = `<div class="sheet__tabs">${seg('tab', [['gen', `${I.spark}<span>${esc(t('tabGen'))}</span>`], ['own', `${I.grip}<span>${esc(t('tabOwn'))}</span>`]], 'gen', 'seg--full')}</div>`;
  const gen = `<form class="form" data-tab="gen">
      <p class="lead">${esc(t('genLead'))}</p>
      <div class="field"><span class="field__label">${esc(t('theme'))}</span><input class="input" name="theme" autofocus placeholder="${esc(t('themePh'))}">${textHelp('setTheme')}</div>
      <div class="field"><span class="field__label">${esc(t('wishes'))}</span><textarea class="input" name="wishes" rows="3" placeholder="${esc(t('setWishesPh'))}"></textarea>${textHelp('wishes')}</div>
      <div class="field"><span class="field__label">${esc(t('variants'))}</span>${variantsSeg(1)}<span class="field__hint">${esc(t('variantsHint'))}</span></div>
      <div data-cost></div>
    </form>`;
  const own = `<form class="form" data-tab="own" hidden>
      <p class="lead">${esc(t('ownLead'))}</p>
      <label class="field"><span class="field__label">${esc(t('setName'))}</span><input class="input" name="title" placeholder="${esc(t('setNamePh'))}"></label>
      <div class="form__sec" data-window-controls>${windowControls(g, g.kind)}</div>
    </form>`;
  const foot = (/** @type {'gen'|'own'} */ tab) => tab === 'gen'
    ? `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${I.spark}<span>${esc(t('generateSet'))}</span></button>`
    : `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${I.plus}<span>${esc(t('createEmpty'))}</span></button>`;
  const { sheet, close } = openSheet({ title: t('createSet'), body: `${tabs}${gen}${own}`, foot: foot('gen') });
  const genForm = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-tab="gen"]'));
  const ownForm = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-tab="own"]'));
  const footEl = /** @type {HTMLElement} */ (sheet.querySelector('.sheet__foot'));
  bindSegs(sheet, (name, v) => {
    if (name !== 'tab') return;
    genForm.hidden = v !== 'gen';
    ownForm.hidden = v !== 'own';
    footEl.innerHTML = foot(/** @type {'gen'|'own'} */ (v));
    /** @type {HTMLInputElement} */ ((v === 'gen' ? genForm : ownForm).querySelector('input')).focus();
  });
  bindWindowControls(ownForm, g);
  bindTextHelp(genForm, () => ({ collectionId: col.id, context: { collection: col.title, description: col.description, set: String(new FormData(genForm).get('theme') ?? '') } }));
  await bindCost(sheet, 'set');
  footEl.addEventListener('click', async e => {
    if (!(/** @type {HTMLElement} */ (e.target).closest('[data-submit]'))) return;
    if (!genForm.hidden) {
      const f = new FormData(genForm);
      const theme = String(f.get('theme') ?? '').trim();
      if (!theme) { /** @type {HTMLInputElement} */ (genForm.elements.namedItem('theme')).focus(); toast(t('writeTheme'), { kind: 'fail' }); return; }
      const r = await attempt(() => call('buildSet', { collectionId: col.id, theme, wishes: String(f.get('wishes') ?? '').trim(), variants: Number(segValue(genForm, 'variants') ?? 1) }));
      if (!r) return;
      close();
      toast(t('setGoing'));
      return;
    }
    const title = String(new FormData(ownForm).get('title') ?? '').trim();
    if (!title) { /** @type {HTMLInputElement} */ (ownForm.elements.namedItem('title')).focus(); toast(t('nameSet'), { kind: 'fail' }); return; }
    const set = await attempt(() => call('createSet', { collectionId: col.id, title, window: windowValue(ownForm) }));
    if (!set) return;
    close();
    app.go(`#/c/${encodeURIComponent(col.id)}/s/${encodeURIComponent(set.id)}`);
  });
}

/**
 * «Настройки набора»: title, theme and wishes, the window's kind and colour, one more variant, deleting.
 * @param {any} col @param {any} set @param {any[]} variants  the set's variant group
 */
export async function openSetSettings(col, set, variants) {
  const g = await windowsOf(col.style);
  const { sheet, close } = openSheet({
    title: t('setSettings'),
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">${esc(t('title'))}</span><input class="input" name="title" value="${esc(set.title)}" required></label>
      <div class="field"><span class="field__label">${esc(t('setTheme'))}</span><input class="input" name="theme" value="${esc(set.brief?.theme ?? '')}">${textHelp('setTheme')}</div>
      <div class="field"><span class="field__label">${esc(t('wishes'))}</span><textarea class="input" name="wishes" rows="3" placeholder="${esc(t('setWishesPh'))}">${esc(set.brief?.wishes ?? '')}</textarea>${textHelp('wishes')}</div>
      <section class="form__sec"><span class="label">${esc(t('windowSec'))}</span><div class="form__sec" data-window-controls>${windowControls(g, set.window.kind, set.window.template)}</div></section>
      ${set.plan ? `<section class="form__sec"><span class="label">${esc(t('variantsSec'))}</span><p class="lead">${esc(t('moreLead'))}</p>
        <button type="button" class="btn btn--secondary form__btn" data-more>${I.spark}<span>${esc(t('more'))}</span></button></section>` : ''}
      <section class="form__sec danger-zone"><span class="label">${esc(t('deleteSec'))}</span><p class="lead">${esc(t('deleteSetLead'))}</p>
        <button type="button" class="btn btn--danger" data-delete>${I.trash}<span>${esc(t('deleteSet'))}</span></button></section>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${esc(t('save'))}</button>`,
  });
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindWindowControls(form, g);
  bindTextHelp(form, () => ({ collectionId: col.id, context: { collection: col.title, description: col.description, set: String(new FormData(form).get('theme') ?? '') } }));
  const where = { collectionId: col.id, setId: set.id };
  sheet.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest('[data-more]')) {
      if (!set.number) { toast(t('moreNoNumber'), { kind: 'fail' }); return; }
      // one more variant of this set's place: the core's «ещё по варианту» run narrowed to its number
      if (await attempt(() => call('buildCollection', { collectionId: col.id, mode: 'variants', only: [set.number], theme: col.description || col.title }))) { close(); toast(t('moreGoing')); }
      return;
    }
    if (target.closest('[data-delete]')) {
      const ok = await confirmDialog({ title: t('deleteSetQ', { title: set.title }), text: t('deleteSetLead'), yes: t('yes'), no: t('no') });
      if (!ok) return;
      if (await attempt(() => call('deleteSet', where)) !== undefined) {
        close();
        const rest = variants.filter(v => v.id !== set.id);
        app.go(rest.length ? `#/c/${encodeURIComponent(col.id)}/s/${encodeURIComponent(rest[0].id)}` : `#/c/${encodeURIComponent(col.id)}`);
      }
      return;
    }
    if (!target.closest('[data-submit]')) return;
    const f = new FormData(form);
    const title = String(f.get('title') ?? '').trim();
    if (!title) { toast(t('nameRequired'), { kind: 'fail' }); return; }
    const w = windowValue(form);
    const patch = { title, brief: { theme: String(f.get('theme') ?? '').trim(), wishes: String(f.get('wishes') ?? '').trim() }, window: { kind: w.kind, ...(w.template ? { template: w.template } : {}) } };
    if (await attempt(() => call('updateSet', { ...where, patch }))) { close(); app.refresh(); }
  });
}

/**
 * A count picked with a slider 1–10 (or 0–10) and an own number beside it that, when written, is the one used.
 * @param {string} name @param {string} label @param {number} min @param {number} value
 */
function countPicker(name, label, min, value) {
  const p = ((value - min) / (10 - min)) * 100;
  return `<div class="field countpick" data-count="${name}">
    <div class="slider"><span class="slider__label">${esc(label)}</span><span class="slider__value" data-count-value>${value}</span><span></span>
      <input type="range" min="${min}" max="10" step="1" value="${value}" style="--p:${p}%" data-count-range aria-label="${esc(label)}">
      <span class="ticks">${Array.from({ length: 11 - min }, (_, k) => `<span>${min + k}</span>`).join('')}</span></div>
    <label class="countpick__own"><span class="field__label field__label--tip">${esc(t('own'))}${tip(t('ownTip'), { side: 'right' })}</span><input class="input data" type="number" min="${min}" step="1" inputmode="numeric" placeholder="${esc(t('ownPh'))}" data-count-own aria-label="${esc(`${label}: ${t('own')}`)}"></label>
  </div>`;
}
/** The count a picker gives: its own number when written, else the slider's. @param {HTMLElement} root @param {string} name */
function countOf(root, name) {
  const box = /** @type {HTMLElement} */ (root.querySelector(`[data-count="${name}"]`));
  const own = /** @type {HTMLInputElement} */ (box.querySelector('[data-count-own]')).value.trim();
  return own !== '' ? Number(own) : Number(/** @type {HTMLInputElement} */ (box.querySelector('[data-count-range]')).value);
}
/** @param {HTMLElement} root */
function bindCountPickers(root) {
  root.addEventListener('input', e => {
    const r = /** @type {HTMLInputElement} */ (e.target);
    const box = r.closest('[data-count]');
    if (!box) return;
    const range = /** @type {HTMLInputElement} */ (box.querySelector('[data-count-range]'));
    const own = /** @type {HTMLInputElement} */ (box.querySelector('[data-count-own]'));
    if (r === range) { range.style.setProperty('--p', `${((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100}%`); own.value = ''; }
    /** @type {HTMLElement} */ (box.querySelector('[data-count-value]')).textContent = own.value.trim() || range.value;
    box.classList.toggle('is-own', own.value.trim() !== '');
  });
}

/** Loose cards into the collection's pool: a theme, wishes, how many and how many scenes. @param {any} col */
export async function openCreateCards(col) {
  const st = await attempt(() => call('getSettings'));
  const max = st?.settings.set.cards.maxCount ?? 1;
  const { sheet, close } = openSheet({
    title: t('newCards'),
    body: `<form class="form" data-form>
      <div class="field"><span class="field__label">${esc(t('cardsAbout'))}</span><input class="input" name="theme" required autofocus placeholder="${esc(t('cardsAboutPh'))}">${textHelp('cardsTheme')}</div>
      <div class="field"><span class="field__label">${esc(t('wishes'))}</span><textarea class="input" name="wishes" rows="3" placeholder="${esc(t('cardsWishesPh'))}"></textarea>${textHelp('wishes')}</div>
      ${countPicker('count', t('howMany'), 1, Math.min(5, max))}
      ${countPicker('scenes', t('scenes'), 0, 0)}
      <p class="field__hint">${esc(t('cardsNote'))}</p>
      <div data-cost></div>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${I.spark}<span>${esc(t('newCards'))}</span></button>`,
  });
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindCountPickers(form);
  bindTextHelp(form, () => ({ collectionId: col.id, context: { collection: col.title, description: col.description } }));
  await bindCost(sheet, 'cards');
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const theme = String(f.get('theme') ?? '').trim();
    const count = countOf(form, 'count'), scenes = countOf(form, 'scenes');
    if (!theme) { /** @type {HTMLInputElement} */ (form.elements.namedItem('theme')).focus(); toast(t('writeCards'), { kind: 'fail' }); return; }
    if (!(Number.isInteger(count) && count >= 1 && count <= max)) { toast(t('badCount', { max }), { kind: 'fail' }); return; }
    if (!(Number.isInteger(scenes) && scenes >= 0 && scenes <= count)) { toast(t('badScenes', { n: count }), { kind: 'fail' }); return; }
    const r = await attempt(() => call('makeCards', { collectionId: col.id, theme, wishes: String(f.get('wishes') ?? '').trim(), count, scenes }));
    if (!r) return;
    close();
    toast(t('cardsGoing'));
  });
}

/** @param {any} col @param {number} have  places of the collection its sets already hold (variants count once) */
export async function openBuildCollection(col, have) {
  const missing = PLACES - have;
  // a collection that has sets: only its missing places, or one more variant of every place (the author's decision,
  // 2026-10-31); the core's buildCollection `mode`
  const hints = { missing: t('missingHint', { n: missing }), variants: t('moreHint', { n: PLACES, empty: missing ? t('moreHintEmpty') : '' }) };
  const first = missing ? 'missing' : 'variants';
  const choice = have ? `<div class="field"><span class="field__label">${esc(t('what'))}</span>
      ${seg('mode', [['missing', esc(t('missing', { n: missing })), !missing], ['variants', esc(t('moreEach', { n: PLACES }))]], first)}
      <span class="field__hint" data-mode-hint>${esc(hints[first])}</span></div>` : '';
  const { sheet, close } = openSheet({
    title: t('buildAll'),
    body: `<form class="form" data-form>
      <p class="lead">${esc(have ? t('have', { sets: setsCount(have), n: PLACES }) : t('split', { n: PLACES }))}</p>
      ${choice}
      <div class="field"><span class="field__label">${esc(t('vision'))}</span><textarea class="input" name="theme" rows="5" autofocus>${esc(col.description || col.title)}</textarea>${textHelp('collection')}<span class="field__hint">${esc(t('visionHint'))}</span></div>
      <div class="field"><span class="field__label">${esc(t('wishes'))}</span><textarea class="input" name="wishes" rows="2">${esc(col.fields?.[WISHES_FIELD] ?? '')}</textarea>${textHelp('wishes')}</div>
      <div class="field"><span class="field__label">${esc(t('perSet'))}</span>${variantsSeg(1)}</div>
      <div data-cost></div>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${I.spark}<span>${esc(t('generate'))}</span></button>`,
  });
  bindSegs(sheet, (name, v) => { if (name === 'mode') /** @type {HTMLElement} */ (sheet.querySelector('[data-mode-hint]')).textContent = hints[/** @type {'missing'|'variants'} */ (v)]; });
  const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
  bindTextHelp(form, () => ({ collectionId: col.id, context: { collection: col.title, description: String(new FormData(form).get('theme') ?? '') } }));
  await bindCost(sheet, 'collection');
  sheet.querySelector('[data-submit]')?.addEventListener('click', async () => {
    const f = new FormData(form);
    const r = await attempt(() => call('buildCollection', {
      collectionId: col.id, theme: String(f.get('theme') ?? '').trim(), wishes: String(f.get('wishes') ?? '').trim(), variants: Number(segValue(sheet, 'variants') ?? 1),
      ...(have ? { mode: segValue(sheet, 'mode') ?? first } : {}),
    }));
    if (!r) return;
    close();
    toast(t('collectionGoing'));
  });
}

/**
 * What the collection is: title, description, fields, the cover (the current one, and every card with a picture to
 * choose from in a list that opens and scrolls — a collection may hold hundreds), deleting.
 * @param {any} col @param {any[]} cards  the collection's cards (CardSummary with imageUrl)
 */
export function openEditCollection(col, cards) {
  const rows = Object.entries(col.fields ?? {});
  const row = (/** @type {string} */ k = '', /** @type {unknown} */ v = '') => `<div class="kv"><input class="input" name="k" value="${esc(k)}" placeholder="${esc(t('field'))}" aria-label="${esc(t('fieldName'))}"><input class="input" name="v" value="${esc(v)}" placeholder="${esc(t('value'))}" aria-label="${esc(t('value'))}"><button type="button" class="btn btn--secondary btn--icon" data-del-row aria-label="${esc(t('dropField'))}">${I.x}</button></div>`;
  const pictured = cards.filter(c => c.imageUrl);
  /** the chosen cover: its card id, or null for «the first card» */
  let cover = /** @type {string|null} */ (col.cover && pictured.some(c => c.id === col.cover) ? col.cover : null);
  const current = () => {
    const c = cover ? pictured.find(x => x.id === cover) : null;
    const shown = c ?? pictured[0];
    return `<span class="cover__img">${shown ? `<img src="${esc(shown.imageUrl)}" alt="" width="430" height="480">` : I.image}</span>
      <span class="cover__text"><b>${esc(c ? c.title : t('coverFirst'))}</b><span class="field__hint">${esc(t('coverHint'))}</span></span>`;
  };
  const picker = pictured.length
    ? `<details class="more2 cover__pick"><summary>${I.next}<span>${esc(t('coverPick'))}</span></summary>
        <div class="cover__list" role="group" aria-label="${esc(t('coverAll', { n: pictured.length }))}">${pictured.map(c => `<button type="button" class="thumb__img" data-cover="${esc(c.id)}" aria-pressed="${c.id === cover}" title="${esc(c.title)}"><img src="${esc(c.imageUrl)}" alt="${esc(c.title)}" loading="lazy" decoding="async"></button>`).join('')}</div></details>`
    : `<p class="field__hint">${esc(t('coverNone'))}</p>`;
  const { sheet, close } = openSheet({
    title: t('collection'),
    body: `<form class="form" data-form>
      <label class="field"><span class="field__label">${esc(t('title'))}</span><input class="input" name="title" value="${esc(col.title)}" required></label>
      <div class="field"><span class="field__label">${esc(t('about'))}</span><textarea class="input" name="description" rows="6">${esc(col.description)}</textarea>${textHelp('collection')}</div>
      <div class="field"><span class="field__label">${esc(t('cover'))}</span><div class="cover" data-cover-current>${current()}</div>${picker}</div>
      <div class="field"><span class="field__label">${esc(t('fields'))}</span><div class="kvs" data-rows>${rows.map(([k, v]) => row(k, v)).join('')}</div>
        <button type="button" class="btn btn--text btn--s" data-add-row>${I.plus}<span>${esc(t('addField'))}</span></button><span class="field__hint">${esc(t('fieldsHint'))}</span></div>
      <section class="form__sec danger-zone"><span class="label">${esc(t('deleteSec'))}</span><p class="lead">${esc(t('deleteLead'))}</p>
        <button type="button" class="btn btn--danger" data-delete>${I.trash}<span>${esc(t('deleteCol'))}</span></button></section>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-submit>${esc(t('save'))}</button>`,
  });
  const rowsEl = /** @type {HTMLElement} */ (sheet.querySelector('[data-rows]'));
  bindTextHelp(sheet, () => ({ collectionId: col.id, context: { collection: String(/** @type {HTMLInputElement} */ (sheet.querySelector('[name="title"]')).value) } }));
  sheet.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest('[data-add-row]')) { rowsEl.insertAdjacentHTML('beforeend', row()); /** @type {HTMLInputElement} */ (rowsEl.lastElementChild?.querySelector('input')).focus(); }
    target.closest('[data-del-row]')?.closest('.kv')?.remove();
    const pick = /** @type {HTMLElement|null} */ (target.closest('[data-cover]'));
    if (pick) {
      cover = cover === pick.dataset.cover ? null : /** @type {string} */ (pick.dataset.cover);
      for (const b of sheet.querySelectorAll('[data-cover]')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.cover === cover));
      /** @type {HTMLElement} */ (sheet.querySelector('[data-cover-current]')).innerHTML = current();
    }
    if (target.closest('[data-delete]')) {
      const sets = col.sets?.length ?? 0;
      const ok = await confirmDialog({ title: t('deleteColQ', { title: col.title }), text: t('deleteColText', { sets: setsCount(sets), cards: cardsCount(cards.length) }), yes: t('yes'), no: t('no') });
      if (ok && await attempt(() => call('deleteCollection', { collectionId: col.id })) !== undefined) { close(); app.go('#/'); }
    }
    if (target.closest('[data-submit]')) {
      const form = /** @type {HTMLFormElement} */ (sheet.querySelector('[data-form]'));
      /** @type {Record<string, string>} */
      const fields = {};
      for (const kv of rowsEl.querySelectorAll('.kv')) {
        const [k, v] = [...kv.querySelectorAll('input')].map(i => i.value.trim());
        if (k) fields[k] = v;
      }
      const f = new FormData(form);
      const title = String(f.get('title') ?? '').trim();
      if (!title) { toast(t('titleRequired'), { kind: 'fail' }); return; }
      const ok = await attempt(() => call('updateCollection', { collectionId: col.id, patch: { title, description: String(f.get('description') ?? '').trim(), fields, cover } }));
      if (ok) close();
    }
  });
}
