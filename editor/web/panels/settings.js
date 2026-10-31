// Settings, reachable from every screen, in sections: Сервис (the service every keyed call goes to — provider.preset:
// OpenRouter or Google AI Studio —, its key applied as soon as it is pasted, the endpoint), Генерация (who draws: the
// service's model or Codex CLI, which the factory starts itself; the image model; attempts per card; cards at the same
// time), Взгляд на карточки, Текстовая модель, Вид (theme, language, hints), and «Выключить редактор». Each section keeps
// what is rare under «Дополнительные настройки <раздела>». The model fields are searchable lists of the service's own
// models (op listModels); a typed id is taken too. Spend caps are not shown (the author's decision, 2026-10-31).
// Saved into settings/local.json through core/settings.js.
import { call, jobs } from '../api.js';
import { lang, LANGS, setLang, words } from '../i18n.js';
import { attempt, confirmDialog, esc, I, openSheet, setTheme, tip, toast, usd } from '../ui.js';
import { app } from '../state.js';
import { hintMemory, setHintsOn } from '../hints.js';

const t = words({
  ru: {
    title: 'Настройки', cancel: 'Отмена', save: 'Сохранить', saved: 'Настройки сохранены.',
    service: 'Сервис', serviceField: 'Через какой сервис работают модели',
    hint_openrouter: 'OpenRouter — один ключ к моделям разных компаний, оплата за каждый вызов с баланса OpenRouter.',
    hint_google: 'Google AI Studio — модели Google (Nano Banana, Gemini) напрямую, по ключу Gemini API; оплата по счёту Google.',
    keyOf: 'Ключ {service}', keyNone: 'Ключа нет.', keyNoneText: 'Генерация через {service}, план набора и взгляд на карточки не работают. Codex CLI рисует без ключа.',
    keyTemp: 'Временный ключ', keyTempText: '— живёт, пока запущен редактор.', keyPerm: 'Постоянный ключ', keyPermText: '— из файла .env ({envVar}).',
    keyPlaceholderNone: 'Вставьте ключ', keyPlaceholder: 'Вставьте ключ, чтобы заменить его временным',
    keyHint: 'Вставили — ключ сразу работает, пока запущен редактор; на диск он не сохраняется. Постоянный ключ кладут в файл .env в папке фабрики: {envVar}=… Ключи лучше время от времени менять у сервиса.',
    keyWhere_openrouter: 'Ключ выдаёт openrouter.ai в разделе Keys.', keyWhere_google: 'Ключ выдаёт aistudio.google.com/apikey.',
    keyShow: 'Показать ключ', keyHide: 'Скрыть ключ', keySet: 'Временный ключ подключён.', keyForget: 'Забыть временный ключ',
    keyCheck: 'Проверить ключ', keyAsking: 'Спрашиваю {service}…', keyOkCredits: 'Ключ работает. Осталось {left} из {total}.',
    keyOkModels: 'Ключ работает: доступно моделей — {n}{missing}. Баланс этот сервис через API не сообщает.', keyMissing: ', но модели картинок из настроек среди них нет',
    endpoint: 'Адрес подключения', endpointHint: 'Менять не нужно, если сервис не просит другой адрес.',
    moreService: 'Дополнительные настройки сервиса', keyVar: 'Переменная ключа', keyVarHint: 'Имя строки в файле .env, где лежит постоянный ключ.',
    generation: 'Генерация', who: 'Кто рисует картинки',
    codexExplain: 'Фабрика сама запускает Codex CLI на этом компьютере, в фоне, и просит его нарисовать каждую картинку. Рисует по вашей подписке Codex — без оплаты за картинку, только модель GPT Image. Открывать Codex не нужно: он должен быть установлен, и в него нужно один раз войти. План набора и взгляд на карточки всё равно идут через {service}.',
    codexWindows: 'На Windows работа через Codex не проверена. Если что-то не получится, откройте папку фабрики в Codex и попросите его разобраться и поправить.',
    apiHint: 'Картинки рисует модель {service} по ключу — оплата за каждую картинку.',
    imageModel: 'Модель картинок', imageNote: 'Модели сервиса, которые рисуют картинки.',
    attempts: 'Попыток на карточку', attemptsTip: 'Сколько раз карточку можно нарисовать заново, если она не прошла проверки стиля. Каждая попытка — оплата за картинку.',
    parallel: 'Карточек одновременно', parallelTip: 'Сколько карточек набора рисуются в одно и то же время.',
    moreGeneration: 'Дополнительные настройки генерации', fallback: 'Запасная модель картинок', fallbackHint: 'Пробуется, если основная не справилась.', noFallback: 'Без запасной модели',
    look: 'Взгляд на карточки', lookField: 'Модель смотрит на каждую попытку', on: 'Включён', off: 'Выключен',
    lookHint: 'Сверяет картинку с заказом и замечает лишнее; нужен ключ сервиса. Выключайте, если карточки смотрит сам агент.',
    visionModel: 'Смотрящая модель', visionNote: 'Только модели, которые видят картинки.',
    textSection: 'Текстовая модель', textModel: 'Модель для текста', textNote: 'Модели сервиса, которые пишут текст.',
    textHint: 'Пишет планы наборов и заказы карточек, помогает с текстом («Сформулировать»).',
    view: 'Вид', theme: 'Тема', light: 'Светлая', dark: 'Тёмная', language: 'Язык', languageHint: 'Страница перезагрузится. Подписи на карточках не переводятся.',
    hints: 'Подсказки', hintsOn: 'Включены', hintsOff: 'Выключены', hintsHint: 'Строка «Следующий шаг», подсказки при первом действии и о ключе на первом экране. Включите снова — вернутся и скрытые.',
    stopEditor: 'Выключить редактор', stopHint: 'Генерация остановится. Открыть снова — файлом запуска фабрики.',
    stopAsk: 'Выключить редактор?', stopAskText: 'Идёт генерация ({n}): она остановится, начатые карточки останутся недоделанными.', stopYes: 'Да, выключить', stopNo: 'Нет, оставить',
    search: 'Найти модель или вписать её id', take: 'Взять «{id}»', loading: 'Загружаю список моделей…', listFailed: 'Список не пришёл: {error} Можно вписать id модели в поиск и нажать Enter.',
    shown: 'Показано {n} из {all}. Уточните поиск.', nothing: 'Таких моделей в списке сервиса нет. Enter — взять вписанный id.',
    needNumber: '«{label}»: нужно число не меньше {min}.',
  },
  en: {
    title: 'Settings', cancel: 'Cancel', save: 'Save', saved: 'Settings saved.',
    service: 'Service', serviceField: 'Which service the models work through',
    hint_openrouter: 'OpenRouter — one key to models of many companies; every call is paid from your OpenRouter balance.',
    hint_google: 'Google AI Studio — Google’s models (Nano Banana, Gemini) directly, with a Gemini API key; billed by Google.',
    keyOf: '{service} key', keyNone: 'No key.', keyNoneText: 'Generating through {service}, set plans and the model’s look do not work. Codex CLI draws without a key.',
    keyTemp: 'Temporary key', keyTempText: '— lives while the editor runs.', keyPerm: 'Permanent key', keyPermText: '— from the .env file ({envVar}).',
    keyPlaceholderNone: 'Paste the key', keyPlaceholder: 'Paste a key to replace it with a temporary one',
    keyHint: 'Once pasted, the key works at once while the editor runs; it is not saved to disk. A permanent key goes into the .env file in the factory folder: {envVar}=… Change keys at the service from time to time.',
    keyWhere_openrouter: 'openrouter.ai gives keys under Keys.', keyWhere_google: 'aistudio.google.com/apikey gives keys.',
    keyShow: 'Show the key', keyHide: 'Hide the key', keySet: 'Temporary key connected.', keyForget: 'Forget the temporary key',
    keyCheck: 'Check the key', keyAsking: 'Asking {service}…', keyOkCredits: 'The key works. {left} left of {total}.',
    keyOkModels: 'The key works: {n} models available{missing}. This service does not report a balance through its API.', keyMissing: ', but the image model of the settings is not among them',
    endpoint: 'Endpoint', endpointHint: 'Leave it unless the service asks for another address.',
    moreService: 'More service settings', keyVar: 'Key variable', keyVarHint: 'The name of the line in the .env file that holds the permanent key.',
    generation: 'Generation', who: 'Who draws the pictures',
    codexExplain: 'The factory itself starts Codex CLI on this computer, in the background, and asks it to draw each picture. It draws under your Codex subscription — no payment per picture, GPT Image only. You do not need to open Codex: it must be installed and signed in once. Set plans and the model’s look still go through {service}.',
    codexWindows: 'Drawing through Codex has not been tried on Windows. If something goes wrong, open the factory’s folder in Codex and ask it to find the problem and fix it.',
    apiHint: 'A {service} model draws the pictures with the key — every picture is paid.',
    imageModel: 'Image model', imageNote: 'The service’s models that draw pictures.',
    attempts: 'Attempts per card', attemptsTip: 'How many times a card may be drawn again when it fails the style checks. Every attempt is a paid picture.',
    parallel: 'Cards at the same time', parallelTip: 'How many cards of a set are drawn at the same time.',
    moreGeneration: 'More generation settings', fallback: 'Fallback image model', fallbackHint: 'Tried when the main one fails.', noFallback: 'No fallback model',
    look: 'The model’s look at cards', lookField: 'A model looks at every attempt', on: 'On', off: 'Off',
    lookHint: 'Compares the picture with the order and notices what is off; needs the service key. Turn it off when an agent looks at the cards itself.',
    visionModel: 'Vision model', visionNote: 'Only models that see pictures.',
    textSection: 'Text model', textModel: 'Model for text', textNote: 'The service’s models that write text.',
    textHint: 'Writes set plans and card orders, helps with texts (“Write it for me”).',
    view: 'Look', theme: 'Theme', light: 'Light', dark: 'Dark', language: 'Language', languageHint: 'The page reloads. Card captions are not translated.',
    hints: 'Hints', hintsOn: 'On', hintsOff: 'Off', hintsHint: 'The “Next step” line, first-action hints and the key hint on the first screen. Turn them on again and the hidden ones come back.',
    stopEditor: 'Switch the editor off', stopHint: 'Generation stops. To open it again, use the factory’s launcher.',
    stopAsk: 'Switch the editor off?', stopAskText: 'Generation is under way ({n}): it will stop, cards started stay unfinished.', stopYes: 'Yes, switch off', stopNo: 'No, keep it',
    search: 'Find a model or type its id', take: 'Use “{id}”', loading: 'Loading the model list…', listFailed: 'The list did not come: {error} You can type a model id into the search and press Enter.',
    shown: '{n} of {all} shown. Narrow the search.', nothing: 'The service lists no such model. Enter uses the typed id.',
    needNumber: '“{label}”: a number of at least {min} is needed.',
  },
});

/** The model fields of a service: settings key, list kind, label, note, whether «none» is a choice. */
const MODEL_FIELDS = /** @type {const} */ ({
  model: { kind: 'image', label: 'imageModel', note: 'imageNote', none: false },
  fallbackModel: { kind: 'image', label: 'fallback', note: 'imageNote', none: true },
  visionModel: { kind: 'vision', label: 'visionModel', note: 'visionNote', none: false },
  textModel: { kind: 'text', label: 'textModel', note: 'textNote', none: false },
});
/** The text fields of a service besides its models. */
const TEXT_FIELDS = /** @type {const} */ (['endpoint', 'keyEnvVar']);
/** The longest list a model dropdown draws at once: a search narrows OpenRouter's hundreds. */
const LIST_MAX = 150;
/** Sliders: settings path, label, tip, the range a person picks from (the top grows to a larger saved value). */
const SLIDERS = /** @type {const} */ ([
  { path: 'card.attempts', label: 'attempts', tip: 'attemptsTip', min: 1, max: 5 },
  { path: 'set.parallel', label: 'parallel', tip: 'parallelTip', min: 1, max: 8 },
]);

/** @param {any} o @param {string} p */
const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
/** @param {Record<string, any>} o @param {string} p @param {unknown} v */
function put(o, p, v) {
  const ks = p.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] ??= {};
  x[/** @type {string} */ (ks.at(-1))] = v;
}
/** @param {string} name @param {[string, string][]} opts @param {string} cur @param {string} [cls] */
const seg = (name, opts, cur, cls = '') => `<div class="seg ${cls}" role="group" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
/** @param {HTMLElement} root @param {string} name */
const pressed = (root, name) => /** @type {HTMLElement} */ (root.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`)).dataset.v ?? '';

/** @param {{path: string, label: string, tip: string, min: number, max: number}} sl @param {number} v */
function slider(sl, v) {
  const max = Math.max(sl.max, v);
  return `<div class="slider" data-slider="${sl.path}"><span class="slider__label">${esc(t(/** @type {any} */ (sl.label)))}${tip(t(/** @type {any} */ (sl.tip)))}</span><span class="slider__value" data-value>${v}</span><span></span>
    <input type="range" min="${sl.min}" max="${max}" step="1" value="${v}" style="--p:${((v - sl.min) / (max - sl.min)) * 100}%" aria-label="${esc(t(/** @type {any} */ (sl.label)))}">
    <span class="ticks" aria-hidden="true">${Array.from({ length: max - sl.min + 1 }, (_, k) => `<span>${sl.min + k}</span>`).join('')}</span></div>`;
}

/** A searchable dropdown of models. @param {string} field  a MODEL_FIELDS key @param {string|null} value */
const combo = (field, value) => `<div class="combo" data-combo="${field}"><button type="button" class="input combo__btn" data-combo-open aria-haspopup="listbox" aria-expanded="false"><span class="data">${esc(value ?? t('noFallback'))}</span></button>
  <div class="combo__menu" hidden><span class="input-wrap"><input class="input" data-combo-search placeholder="${esc(t('search'))}" autocomplete="off" spellcheck="false"><span class="btn btn--text btn--icon btn--s" aria-hidden="true">${I.search}</span></span>
    <div class="combo__list" role="listbox"></div><p class="combo__foot"></p></div></div>`;

export async function openSettings() {
  const r = await attempt(() => call('getSettings'));
  if (!r) return;
  const s = r.settings;
  /** @type {Record<string, any>} */
  const keys = r.keys;
  /** @type {Record<string, string>} */
  const titles = Object.fromEntries(Object.entries(keys).map(([p, k]) => [p, k.title]));
  let preset = s.provider.preset;
  /** what the form holds for each service: its models, endpoint and key variable */
  /** @type {Record<string, Record<string, any>>} */
  const svc = Object.fromEntries(Object.keys(keys).map(p => [p, Object.fromEntries([...Object.keys(MODEL_FIELDS), ...TEXT_FIELDS].map(f => [f, s.provider[p]?.[f] ?? null]))]));
  /** the service's model lists, read once per service while the window is open @type {Record<string, Promise<any>>} */
  const lists = {};
  const listOf = (/** @type {string} */ p) => (lists[p] ??= call('listModels', { preset: p }));
  listOf(preset).catch(() => {});

  const keyBlock = (/** @type {any} */ k) => {
    const state = k.source === 'none'
      ? `<p class="keyline keyline--fail"><i class="dot dot--fail"></i><span><b>${esc(t('keyNone'))}</b> ${esc(t('keyNoneText', { service: titles[preset] }))}</span></p>`
      : `<p class="keyline"><i class="dot dot--done"></i><span><b>${esc(t(k.source === 'temporary' ? 'keyTemp' : 'keyPerm'))}</b> ${esc(t(k.source === 'temporary' ? 'keyTempText' : 'keyPermText', { envVar: k.envVar }))}</span></p>`;
    return `${state}
      <span class="input-wrap"><input class="input" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(t(k.source === 'none' ? 'keyPlaceholderNone' : 'keyPlaceholder'))}" data-key-input aria-label="${esc(t('keyOf', { service: titles[preset] }))}"><button type="button" class="btn btn--text btn--icon btn--s" data-key-toggle aria-label="${esc(t('keyShow'))}" aria-pressed="false">${I.eye}</button></span>
      <span class="field__hint">${esc(t(/** @type {any} */ (`keyWhere_${preset}`)))} ${esc(t('keyHint', { envVar: k.envVar }))}</span>
      <div class="keyacts">${k.source !== 'none' ? `<button type="button" class="btn btn--text btn--s" data-key-check><span>${esc(t('keyCheck'))}</span></button>` : ''}${k.source === 'temporary' ? `<button type="button" class="btn btn--text btn--s" data-key-clear><span>${esc(t('keyForget'))}</span></button>` : ''}</div>
      <p class="field__hint" data-key-result></p>`;
  };
  const whoHint = (/** @type {string} */ use) => (use === 'codex-cli' ? `<div class="explain">${I.info}<span>${esc(t('codexExplain', { service: titles[preset] }))}${r.platform === 'win32' ? ` ${esc(t('codexWindows'))}` : ''}</span></div>` : `<span class="field__hint">${esc(t('apiHint', { service: titles[preset] }))}</span>`);
  const use0 = s.provider.use;
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

  const { sheet, close } = openSheet({
    title: t('title'),
    body: `<form class="form" data-form onsubmit="return false">
      <section class="sset" aria-label="${esc(t('service'))}"><h3 class="sset__title">${esc(t('service'))}</h3>
        <div class="field"><span class="field__label">${esc(t('serviceField'))}</span>${seg('preset', Object.keys(keys).map(p => [p, esc(titles[p])]), preset)}<span class="field__hint" data-preset-hint>${esc(t(/** @type {any} */ (`hint_${preset}`)))}</span></div>
        <div class="field"><span class="field__label" data-key-title>${esc(t('keyOf', { service: titles[preset] }))}</span><div class="keyblock" data-key>${keyBlock(keys[preset])}</div></div>
        <label class="field"><span class="field__label">${esc(t('endpoint'))}</span><input class="input data" data-svc="endpoint" value="${esc(svc[preset].endpoint ?? '')}" spellcheck="false" inputmode="url"><span class="field__hint">${esc(t('endpointHint'))}</span></label>
        <details class="disclose"><summary>${I.chev}${esc(t('moreService'))}</summary><div>
          <label class="field"><span class="field__label">${esc(t('keyVar'))}</span><input class="input data" data-svc="keyEnvVar" value="${esc(svc[preset].keyEnvVar ?? '')}" spellcheck="false"><span class="field__hint">${esc(t('keyVarHint'))}</span></label></div></details></section>

      <section class="sset" aria-label="${esc(t('generation'))}"><h3 class="sset__title">${esc(t('generation'))}</h3>
        <div class="field"><span class="field__label">${esc(t('who'))}</span>${seg('use', [['api', esc(titles[preset])], ['codex-cli', 'Codex CLI']], use0)}<div data-who-hint>${whoHint(use0)}</div></div>
        <div class="field" data-api-only ${use0 === 'codex-cli' ? 'hidden' : ''}><span class="field__label">${esc(t('imageModel'))}</span>${combo('model', svc[preset].model)}</div>
        ${SLIDERS.map(sl => slider(sl, Number(get(s, sl.path)))).join('')}
        <details class="disclose" data-api-only ${use0 === 'codex-cli' ? 'hidden' : ''}><summary>${I.chev}${esc(t('moreGeneration'))}</summary><div>
          <div class="field"><span class="field__label">${esc(t('fallback'))}</span>${combo('fallbackModel', svc[preset].fallbackModel)}<span class="field__hint">${esc(t('fallbackHint'))}</span></div></div></details></section>

      <section class="sset" aria-label="${esc(t('look'))}"><h3 class="sset__title">${esc(t('look'))}</h3>
        <div class="field"><span class="field__label">${esc(t('lookField'))}</span>${seg('look', [['true', esc(t('on'))], ['false', esc(t('off'))]], String(!!s.look.use))}<span class="field__hint">${esc(t('lookHint'))}</span></div>
        <div class="field"><span class="field__label">${esc(t('visionModel'))}</span>${combo('visionModel', svc[preset].visionModel)}</div></section>

      <section class="sset" aria-label="${esc(t('textSection'))}"><h3 class="sset__title">${esc(t('textSection'))}</h3>
        <div class="field"><span class="field__label">${esc(t('textModel'))}</span>${combo('textModel', svc[preset].textModel)}<span class="field__hint">${esc(t('textHint'))}</span></div></section>

      <section class="sset" aria-label="${esc(t('view'))}"><h3 class="sset__title">${esc(t('view'))}</h3>
        <div class="field"><span class="field__label">${esc(t('theme'))}</span>${seg('theme', [['light', `${I.sun}${esc(t('light'))}`], ['dark', `${I.moon}${esc(t('dark'))}`]], theme)}</div>
        <div class="field"><span class="field__label">${esc(t('language'))}</span>${seg('lang', LANGS.map(l => [l, l === 'ru' ? 'Русский' : 'English']), lang())}<span class="field__hint">${esc(t('languageHint'))}</span></div>
        <div class="field"><span class="field__label">${esc(t('hints'))}</span>${seg('hints', [['on', esc(t('hintsOn'))], ['off', esc(t('hintsOff'))]], hintMemory().on ? 'on' : 'off')}<span class="field__hint">${esc(t('hintsHint'))}</span></div></section>

      <section class="sset sset--off" aria-label="${esc(t('stopEditor'))}"><button type="button" class="btn btn--secondary" data-stop>${I.power}<span>${esc(t('stopEditor'))}</span></button>
        <span class="field__hint">${esc(t('stopHint'))}</span></section>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>${esc(t('cancel'))}</button><button type="button" class="btn btn--primary" data-save>${esc(t('save'))}</button>`,
  });

  // ---------- the key: applied on paste, on leaving the field and on Enter ----------
  const keyEl = /** @type {HTMLElement} */ (sheet.querySelector('[data-key]'));
  /** A service's key changed: its block, and the top bar when it is the settings' service. @param {any} k */
  const redrawKey = k => {
    keys[preset] = k;
    if (preset === s.provider.preset) app.key = k;
    keyEl.innerHTML = keyBlock(k);
  };
  let applying = '';
  const applyKey = async () => {
    const input = /** @type {HTMLInputElement|null} */ (keyEl.querySelector('[data-key-input]'));
    const value = input?.value.trim() ?? '';
    if (!value || value === applying) return;
    applying = value;
    const k = await attempt(() => call('setKey', { key: value, preset }));
    applying = '';
    if (k) { redrawKey(k); toast(t('keySet'), { kind: 'done' }); delete lists[preset]; listOf(preset).catch(() => {}); }
  };
  keyEl.addEventListener('paste', e => { if (/** @type {HTMLElement} */ (e.target).matches('[data-key-input]')) setTimeout(applyKey, 0); });
  keyEl.addEventListener('change', e => { if (/** @type {HTMLElement} */ (e.target).matches('[data-key-input]')) applyKey(); });
  keyEl.addEventListener('keydown', e => { if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).matches('[data-key-input]')) { e.preventDefault(); applyKey(); } });

  // ---------- the model dropdowns: a menu that opens over the form, the form itself never redrawn ----------
  /** @type {HTMLElement|null} */
  let openCombo = null;
  const closeCombo = () => {
    if (!openCombo) return;
    /** @type {HTMLElement} */ (openCombo.querySelector('.combo__menu')).hidden = true;
    openCombo.querySelector('[data-combo-open]')?.setAttribute('aria-expanded', 'false');
    openCombo = null;
  };
  /** @param {HTMLElement} box */
  async function fillCombo(box) {
    const field = /** @type {keyof typeof MODEL_FIELDS} */ (box.dataset.combo);
    const def = MODEL_FIELDS[field];
    const listEl = /** @type {HTMLElement} */ (box.querySelector('.combo__list'));
    const foot = /** @type {HTMLElement} */ (box.querySelector('.combo__foot'));
    const query = /** @type {HTMLInputElement} */ (box.querySelector('[data-combo-search]')).value.trim().toLowerCase();
    const cur = svc[preset][field];
    let models = /** @type {{id: string, name?: string}[]} */ ([]);
    let failed = '';
    if (!lists[preset]) foot.textContent = t('loading');
    try { models = (await listOf(preset))[def.kind] ?? []; } catch (/** @type {any} */ e) { failed = e?.message ?? String(e); delete lists[preset]; }
    if (openCombo !== box) return;
    const hits = models.filter(m => !query || m.id.toLowerCase().includes(query) || (m.name ?? '').toLowerCase().includes(query));
    const opt = (/** @type {string|null} */ id, /** @type {string} */ label, /** @type {string} */ tag = '') => `<button type="button" class="combo__opt" role="option" data-pick="${esc(id ?? '')}" aria-selected="${id === cur}"><span class="data">${esc(label)}</span><span class="combo__tag">${esc(tag)}</span></button>`;
    const typed = query && !models.some(m => m.id.toLowerCase() === query) ? /** @type {HTMLInputElement} */ (box.querySelector('[data-combo-search]')).value.trim() : '';
    listEl.innerHTML = [
      ...(def.none && !query ? [opt(null, t('noFallback'))] : []),
      ...hits.slice(0, LIST_MAX).map(m => opt(m.id, m.id, m.name && m.name !== m.id ? m.name : '')),
      ...(typed ? [opt(typed, t('take', { id: typed }))] : []),
    ].join('');
    foot.textContent = failed ? t('listFailed', { error: failed }) : hits.length > LIST_MAX ? t('shown', { n: LIST_MAX, all: hits.length }) : !hits.length ? t('nothing') : t(/** @type {any} */ (def.note));
  }
  /** @param {HTMLElement} box @param {string|null} id */
  const pick = (box, id) => {
    const field = /** @type {keyof typeof MODEL_FIELDS} */ (box.dataset.combo);
    svc[preset][field] = id;
    /** @type {HTMLElement} */ (box.querySelector('[data-combo-open] > span')).textContent = id ?? t('noFallback');
    closeCombo();
  };
  sheet.addEventListener('input', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const box = /** @type {HTMLElement|null} */ (target.closest('[data-combo]'));
    if (box && target.matches('[data-combo-search]')) { fillCombo(box); return; }
    const sl = /** @type {HTMLElement|null} */ (target.closest('[data-slider]'));
    if (sl) {
      const input = /** @type {HTMLInputElement} */ (target);
      /** @type {HTMLElement} */ (sl.querySelector('[data-value]')).textContent = input.value;
      input.style.setProperty('--p', `${((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`);
      return;
    }
    if (target.matches('[data-svc]')) svc[preset][/** @type {string} */ (target.dataset.svc)] = /** @type {HTMLInputElement} */ (target).value.trim() || null;
  });
  sheet.addEventListener('keydown', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!openCombo) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeCombo(); return; }
    // Enter takes the first model of the list; with no model found, the id typed
    if (e.key === 'Enter' && target.matches('[data-combo-search]')) {
      e.preventDefault();
      const first = /** @type {HTMLElement|null} */ (openCombo.querySelector('.combo__opt'));
      if (first) pick(openCombo, first.dataset.pick || null);
    }
  }, true);
  document.addEventListener('pointerdown', function away(e) {
    if (!sheet.isConnected) { document.removeEventListener('pointerdown', away); return; }
    if (openCombo && !openCombo.contains(/** @type {Node} */ (e.target))) closeCombo();
  });

  /** Shows the chosen service's values in the fields that depend on it. */
  const showPreset = () => {
    /** @type {HTMLElement} */ (sheet.querySelector('[data-preset-hint]')).textContent = t(/** @type {any} */ (`hint_${preset}`));
    /** @type {HTMLElement} */ (sheet.querySelector('[data-key-title]')).textContent = t('keyOf', { service: titles[preset] });
    /** @type {HTMLElement} */ (sheet.querySelector('[data-seg="use"] [data-v="api"]')).textContent = titles[preset];
    /** @type {HTMLElement} */ (sheet.querySelector('[data-who-hint]')).innerHTML = whoHint(pressed(sheet, 'use'));
    for (const el of /** @type {NodeListOf<HTMLInputElement>} */ (sheet.querySelectorAll('[data-svc]'))) el.value = svc[preset][/** @type {string} */ (el.dataset.svc)] ?? '';
    for (const box of /** @type {NodeListOf<HTMLElement>} */ (sheet.querySelectorAll('[data-combo]'))) /** @type {HTMLElement} */ (box.querySelector('[data-combo-open] > span')).textContent = svc[preset][/** @type {string} */ (box.dataset.combo)] ?? t('noFallback');
    keyEl.innerHTML = keyBlock(keys[preset]);
    listOf(preset).catch(() => {});
  };

  sheet.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    const opener = /** @type {HTMLElement|null} */ (target.closest('[data-combo-open]'));
    if (opener) {
      const box = /** @type {HTMLElement} */ (opener.closest('[data-combo]'));
      if (openCombo === box) { closeCombo(); return; }
      closeCombo();
      openCombo = box;
      opener.setAttribute('aria-expanded', 'true');
      /** @type {HTMLElement} */ (box.querySelector('.combo__menu')).hidden = false;
      const search = /** @type {HTMLInputElement} */ (box.querySelector('[data-combo-search]'));
      search.value = '';
      search.focus();
      fillCombo(box);
      return;
    }
    const option = /** @type {HTMLElement|null} */ (target.closest('[data-pick]'));
    if (option && openCombo) { pick(openCombo, option.dataset.pick || null); return; }
    const tog = /** @type {HTMLElement|null} */ (target.closest('[data-key-toggle]'));
    if (tog) {
      const input = /** @type {HTMLInputElement} */ (keyEl.querySelector('[data-key-input]'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      tog.setAttribute('aria-pressed', String(show));
      tog.setAttribute('aria-label', t(show ? 'keyHide' : 'keyShow'));
      return;
    }
    if (target.closest('[data-key-clear]')) { const k = await attempt(() => call('clearKey', { preset })); if (k) redrawKey(k); return; }
    if (target.closest('[data-key-check]')) {
      const out = /** @type {HTMLElement} */ (keyEl.querySelector('[data-key-result]'));
      out.classList.remove('field__hint--fail');
      out.textContent = t('keyAsking', { service: titles[preset] });
      try {
        const c = await call('checkKey', { preset });
        out.textContent = c.credits ? t('keyOkCredits', { left: usd(c.credits.remaining), total: usd(c.credits.total) }) : t('keyOkModels', { n: c.models, missing: c.hasModel ? '' : t('keyMissing') });
      } catch (/** @type {any} */ err) { out.textContent = err.message; out.classList.add('field__hint--fail'); }
      return;
    }
    const b = /** @type {HTMLElement|null} */ (target.closest('[data-seg] > button'));
    if (b) {
      const name = /** @type {HTMLElement} */ (b.parentElement).dataset.seg;
      if (name === 'lang') { setLang(/** @type {import('../i18n.js').Lang} */ (b.dataset.v)); return; }
      for (const x of /** @type {HTMLElement} */ (b.parentElement).children) x.setAttribute('aria-pressed', String(x === b));
      if (name === 'theme') setTheme(/** @type {string} */ (b.dataset.v));
      // at once, like the theme; «on» again brings back the hints hidden with ×
      if (name === 'hints') setHintsOn(b.dataset.v === 'on');
      if (name === 'preset') { closeCombo(); preset = /** @type {string} */ (b.dataset.v); showPreset(); }
      if (name === 'use') {
        /** @type {HTMLElement} */ (sheet.querySelector('[data-who-hint]')).innerHTML = whoHint(b.dataset.v ?? 'api');
        for (const el of /** @type {NodeListOf<HTMLElement>} */ (sheet.querySelectorAll('[data-api-only]'))) el.hidden = b.dataset.v === 'codex-cli';
      }
      return;
    }
    if (target.closest('[data-stop]')) {
      const running = [...jobs.values()].filter(j => j.status === 'running').length;
      if (running && !(await confirmDialog({ title: t('stopAsk'), text: t('stopAskText', { n: running }), yes: t('stopYes'), no: t('stopNo'), icon: I.power }))) return;
      await attempt(() => call('stopEditor', { force: true }));
      return;
    }
    if (target.closest('[data-save]')) {
      /** @type {Record<string, any>} */
      const patch = {};
      /** @type {string[]} fields left empty: back to their default */
      const reset = [];
      put(patch, 'provider.use', pressed(sheet, 'use'));
      put(patch, 'provider.preset', preset);
      put(patch, 'look.use', pressed(sheet, 'look') === 'true');
      for (const [p, v] of Object.entries(svc)) {
        for (const f of Object.keys(MODEL_FIELDS)) if (v[f] !== (s.provider[p]?.[f] ?? null)) put(patch, `provider.${p}.${f}`, v[f]);
        for (const f of TEXT_FIELDS) { if (v[f] === null) reset.push(`provider.${p}.${f}`); else if (v[f] !== s.provider[p]?.[f]) put(patch, `provider.${p}.${f}`, v[f]); }
      }
      for (const sl of SLIDERS) {
        const n = Number(/** @type {HTMLInputElement} */ (sheet.querySelector(`[data-slider="${sl.path}"] input`)).value);
        if (!Number.isInteger(n) || n < sl.min) { toast(t('needNumber', { label: t(/** @type {any} */ (sl.label)), min: sl.min }), { kind: 'fail' }); return; }
        put(patch, sl.path, n);
      }
      const ok = await attempt(() => call('saveSettings', { patch, reset }));
      if (ok) { app.key = ok.key; close(); toast(t('saved'), { kind: 'done' }); }
    }
  });
}
