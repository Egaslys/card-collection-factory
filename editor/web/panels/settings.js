// Settings, reachable from every screen: the service every keyed call goes to (provider.preset: OpenRouter or Google
// AI Studio) and its key (status, a temporary key held only while the editor runs — one per service), who draws (the
// service's model or Codex), the models of the chosen service, attempts. Spend caps are not shown (the author's
// decision, 2026-10-31: the person limits spend on their provider's key; the caps of settings are a safety net for
// agents and the command line). Saved into settings/local.json through core/settings.js; what is rare sits under
// «Дополнительно».
import { call } from '../api.js';
import { attempt, esc, I, openSheet, setTheme, toast, usd } from '../ui.js';
import { app } from '../state.js';

/** The services (settings provider.preset): what each is, the key's look and where to get one; their names come with
 * the key statuses (getSettings → keys[preset].title, core/providers/preset.js). */
const PRESETS = /** @type {Record<string, {title?: string, hint: string, placeholder: string, keyHint: string}>} */ ({
  openrouter: { hint: 'OpenRouter — один ключ к моделям разных компаний, оплата за каждый вызов с баланса OpenRouter.', placeholder: 'sk-or-…', keyHint: 'Ключ выдаёт openrouter.ai в разделе Keys.' },
  google: { hint: 'Google AI Studio — модели Google (Nano Banana, Gemini) напрямую, по ключу Gemini API; оплата по счёту Google.', placeholder: 'ключ Gemini API', keyHint: 'Ключ выдаёт aistudio.google.com/apikey.' },
});

/** One editable setting: a dotted path into the settings ({p} = the service's key), its label and kind. */
const FIELDS = {
  main: [
    { path: 'provider.{p}.model', label: 'Модель картинок', hint: 'Основная модель сервиса.' },
    { path: 'card.attempts', label: 'Попыток на карточку', type: 'number', min: 1, step: 1, hint: 'Сколько раз карточку можно сгенерировать заново, если она не прошла проверки стиля.' },
  ],
  look: [
    { path: 'provider.{p}.visionModel', label: 'Модель, которая смотрит', hint: 'Смотрит на готовые карточки: находит контур героя и сверяет картинку с заказом.' },
  ],
  more: [
    { path: 'provider.{p}.fallbackModel', label: 'Запасная модель картинок', hint: 'Пробуется, если основная не справилась. Пусто — без запасной.', nullable: true },
    { path: 'provider.{p}.textModel', label: 'Текстовая модель', hint: 'Пишет план набора и коллекции, помогает с текстом.' },
    { path: 'provider.{p}.endpoint', label: 'Адрес подключения', hint: 'Адрес API сервиса.', inputmode: 'url' },
    { path: 'provider.{p}.keyEnvVar', label: 'Переменная ключа', hint: 'Имя строки в .env, где лежит постоянный ключ.' },
    { path: 'set.parallel', label: 'Карточек одновременно', type: 'number', min: 1, step: 1 },
  ],
};

/** @param {string} use @param {string} preset */
const providerHint = (use, preset) => use === 'codex-cli'
  ? `Codex CLI — по подписке Codex, без оплаты за картинку (только GPT Image). План набора и взгляд на карточки всё равно идут через ${PRESETS[preset].title}.`
  : `Картинки рисует модель ${PRESETS[preset].title} — по ключу, оплата за каждую картинку.`;

/** @param {any} o @param {string} p */
const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
/** @param {Record<string, any>} o @param {string} p @param {unknown} v */
function put(o, p, v) {
  const ks = p.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] ??= {};
  x[/** @type {string} */ (ks.at(-1))] = v;
}

/** @param {any} f @param {any} s */
const oneField = (f, s) => {
  const v = get(s, f.path);
  return `<label class="field"><span class="field__label">${esc(f.label)}</span>
    <input class="input" name="${esc(f.path)}" ${f.type === 'number' ? `type="number" min="${f.min}" step="${f.step}" inputmode="decimal"` : `type="text" spellcheck="false" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}`} value="${esc(v ?? '')}">
    ${f.hint ? `<span class="field__hint">${esc(f.hint)}</span>` : ''}</label>`;
};

/** A field; one of a service's ({p} in its path) is drawn for every service, the chosen one shown. @param {any} f @param {any} s */
const fieldHtml = (f, s) => !f.path.includes('{p}') ? oneField(f, s)
  : Object.keys(PRESETS).map(p => `<div data-preset-field="${p}"${p === s.provider.preset ? '' : ' hidden'}>${oneField({ ...f, path: f.path.replace('{p}', p) }, s)}</div>`).join('');

/** Every setting path the form writes. */
const allPaths = () => [...FIELDS.main, ...FIELDS.look, ...FIELDS.more].flatMap(f => (f.path.includes('{p}') ? Object.keys(PRESETS).map(p => ({ ...f, path: f.path.replace('{p}', p) })) : [f]));

/** The key block of a service. @param {any} k  its status @param {string} preset */
function keyBlock(k, preset) {
  const P = PRESETS[preset];
  const state = k.source === 'none'
    ? `<p class="keystate keystate--fail"><i class="dot dot--fail"></i><span><b>Ключа нет.</b> Генерация через ${esc(P.title)}, план набора и взгляд на карточки не работают. Codex CLI рисует без ключа.</span></p>`
    : k.source === 'temporary'
      ? `<p class="keystate"><i class="dot dot--done"></i><span><b>Временный ключ</b> — живёт, пока открыт редактор.</span></p>`
      : `<p class="keystate"><i class="dot dot--done"></i><span><b>Постоянный ключ</b> — из файла .env или переменной ${esc(k.envVar)}.</span></p>`;
  return `${state}
    <label class="field"><span class="field__label">${k.source === 'none' ? 'Временный ключ' : 'Заменить на временный'}</span>
      <span class="input-wrap"><input class="input" type="password" name="key" autocomplete="off" spellcheck="false" placeholder="${esc(P.placeholder)}" data-key-input><button type="button" class="btn btn--text btn--icon btn--s" data-key-toggle aria-label="Показать ключ" aria-pressed="false">${I.eye}</button></span>
      <span class="field__hint">${esc(P.keyHint)} Ключ не сохраняется на диск: он живёт, пока запущен редактор. Постоянный ключ кладут в файл .env в папке фабрики: ${esc(k.envVar)}=… Ключи лучше время от времени менять (ротировать) у провайдера.</span></label>
    <div class="row"><button type="button" class="btn btn--secondary btn--s" data-key-set>${I.key}Использовать ключ</button>
      ${k.source === 'temporary' ? '<button type="button" class="btn btn--text btn--s" data-key-clear><span>Забыть временный ключ</span></button>' : ''}
      ${k.source !== 'none' ? `<button type="button" class="btn btn--text btn--s" data-key-check><span>${preset === 'openrouter' ? 'Проверить баланс' : 'Проверить ключ'}</span></button>` : ''}</div>
    <p class="field__hint" data-key-result></p>`;
}

export async function openSettings() {
  const r = await attempt(() => call('getSettings'));
  if (!r) return;
  const s = r.settings;
  const provider = s.provider.use;
  let preset = s.provider.preset;
  /** @type {Record<string, any>} */
  const keys = r.keys;
  for (const [p, k] of Object.entries(keys)) PRESETS[p].title = k.title;
  const { sheet, close } = openSheet({
    title: 'Настройки',
    body: `<form class="form" data-form onsubmit="return false">
      <section class="form__sec" aria-label="Сервис"><span class="label">Сервис</span>
        <div class="field"><span class="field__label">Через какой сервис работают модели</span>
          <div class="seg" role="group" data-preset>${Object.entries(PRESETS).map(([p, P]) => `<button type="button" data-v="${p}" aria-pressed="${p === preset}">${esc(P.title)}</button>`).join('')}</div>
          <span class="field__hint" data-preset-hint>${esc(PRESETS[preset].hint)}</span></div></section>
      <section class="form__sec" aria-label="Ключ"><span class="label" data-key-title>Ключ ${esc(PRESETS[preset].title)}</span><div class="keyblock" data-key>${keyBlock(keys[preset], preset)}</div></section>
      <section class="form__sec" aria-label="Генерация"><span class="label">Генерация</span>
        <div class="field"><span class="field__label">Кто рисует картинки</span>
          <div class="seg" role="group" data-provider><button type="button" data-v="api" aria-pressed="${provider === 'api'}" data-api-title>${esc(PRESETS[preset].title)}</button><button type="button" data-v="codex-cli" aria-pressed="${provider === 'codex-cli'}">Codex CLI</button></div>
          <span class="field__hint" data-provider-hint>${esc(providerHint(provider, preset))}</span></div>
        ${FIELDS.main.map(f => fieldHtml(f, s)).join('')}
      </section>
      <section class="form__sec" aria-label="Взгляд на карточки"><span class="label">Взгляд на карточки</span>
        <div class="field"><span class="field__label">Смотрящая модель проверяет каждую попытку</span>
          <div class="seg" role="group" data-look><button type="button" data-v="true" aria-pressed="${s.look.use}">Включена</button><button type="button" data-v="false" aria-pressed="${!s.look.use}">Выключена</button></div>
          <span class="field__hint">Сверяет картинку с заказом и замечает лишнее; нужен ключ сервиса. Выключайте, если карточки смотрит сам агент.</span></div>
        ${FIELDS.look.map(f => fieldHtml(f, s)).join('')}
      </section>
      <section class="form__sec" aria-label="Вид"><span class="label">Вид</span>
        <div class="field"><span class="field__label">Тема</span><div class="seg" role="group" data-theme-set>${['light', 'dark'].map(t => `<button type="button" data-v="${t}" aria-pressed="${(document.documentElement.dataset.theme ?? 'light') === t}">${t === 'light' ? `${I.sun}Светлая` : `${I.moon}Тёмная`}</button>`).join('')}</div>
          <span class="field__hint">Запоминается в этом браузере.</span></div></section>
      <details class="more"><summary class="btn btn--text btn--s"><span>Дополнительно</span></summary><div class="form">${FIELDS.more.map(f => fieldHtml(f, s)).join('')}</div></details>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-save>Сохранить</button>`,
  });
  const keyEl = /** @type {HTMLElement} */ (sheet.querySelector('[data-key]'));
  /** A service's key changed: its block, and the top bar's chip when it is the settings' service. @param {any} k */
  const redrawKey = k => {
    keys[preset] = k;
    if (preset === s.provider.preset) app.key = k;
    keyEl.innerHTML = keyBlock(k, preset);
  };
  const usePressed = () => /** @type {HTMLElement} */ (sheet.querySelector('[data-provider] [aria-pressed="true"]')).dataset.v ?? 'api';

  sheet.addEventListener('click', async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const tog = /** @type {HTMLElement|null} */ (t.closest('[data-key-toggle]'));
    if (tog) {
      const input = /** @type {HTMLInputElement} */ (sheet.querySelector('[data-key-input]'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      tog.setAttribute('aria-pressed', String(show));
      tog.setAttribute('aria-label', show ? 'Скрыть ключ' : 'Показать ключ');
      return;
    }
    if (t.closest('[data-key-set]')) {
      const input = /** @type {HTMLInputElement} */ (sheet.querySelector('[data-key-input]'));
      const k = await attempt(() => call('setKey', { key: input.value, preset }));
      if (k) { input.value = ''; redrawKey(k); toast('Временный ключ подключён.', { kind: 'done' }); }
      return;
    }
    if (t.closest('[data-key-clear]')) { const k = await attempt(() => call('clearKey', { preset })); if (k) redrawKey(k); return; }
    if (t.closest('[data-key-check]')) {
      const out = /** @type {HTMLElement} */ (sheet.querySelector('[data-key-result]'));
      out.textContent = `Спрашиваю ${PRESETS[preset].title}…`;
      try {
        const c = await call('checkKey', { preset });
        out.textContent = c.credits ? `Ключ работает. Осталось ${usd(c.credits.remaining)} из ${usd(c.credits.total)}.`
          : `Ключ работает: доступно моделей — ${c.models}${c.hasModel ? '' : ', но модели картинок из настроек среди них нет'}. Баланс этот сервис через API не сообщает.`;
      } catch (/** @type {any} */ err) { out.textContent = err.message; out.classList.add('field__hint--fail'); }
      return;
    }
    const th = /** @type {HTMLElement|null} */ (t.closest('[data-theme-set] > button'));
    if (th) {
      for (const b of /** @type {HTMLElement} */ (th.parentElement).children) b.setAttribute('aria-pressed', String(b === th));
      setTheme(/** @type {string} */ (th.dataset.v));
      return;
    }
    const lk = /** @type {HTMLElement|null} */ (t.closest('[data-look] > button'));
    if (lk) {
      for (const b of /** @type {HTMLElement} */ (lk.parentElement).children) b.setAttribute('aria-pressed', String(b === lk));
      return;
    }
    const pr = /** @type {HTMLElement|null} */ (t.closest('[data-preset] > button'));
    if (pr) {
      preset = /** @type {string} */ (pr.dataset.v);
      for (const b of /** @type {HTMLElement} */ (pr.parentElement).children) b.setAttribute('aria-pressed', String(b === pr));
      /** @type {HTMLElement} */ (sheet.querySelector('[data-preset-hint]')).textContent = PRESETS[preset].hint;
      /** @type {HTMLElement} */ (sheet.querySelector('[data-key-title]')).textContent = `Ключ ${PRESETS[preset].title}`;
      /** @type {HTMLElement} */ (sheet.querySelector('[data-api-title]')).textContent = PRESETS[preset].title;
      /** @type {HTMLElement} */ (sheet.querySelector('[data-provider-hint]')).textContent = providerHint(usePressed(), preset);
      for (const el of /** @type {NodeListOf<HTMLElement>} */ (sheet.querySelectorAll('[data-preset-field]'))) el.hidden = el.dataset.presetField !== preset;
      keyEl.innerHTML = keyBlock(keys[preset], preset);
      return;
    }
    const pv = /** @type {HTMLElement|null} */ (t.closest('[data-provider] > button'));
    if (pv) {
      for (const b of /** @type {HTMLElement} */ (pv.parentElement).children) b.setAttribute('aria-pressed', String(b === pv));
      /** @type {HTMLElement} */ (sheet.querySelector('[data-provider-hint]')).textContent = providerHint(usePressed(), preset);
      return;
    }
    if (t.closest('[data-save]')) {
      /** @type {Record<string, any>} */
      const patch = {};
      put(patch, 'provider.use', usePressed());
      put(patch, 'provider.preset', preset);
      put(patch, 'look.use', /** @type {HTMLElement} */ (sheet.querySelector('[data-look] [aria-pressed="true"]')).dataset.v === 'true');
      /** number fields left empty: back to their default */
      const reset = [];
      for (const f of /** @type {any[]} */ (allPaths())) {
        const input = /** @type {HTMLInputElement} */ (sheet.querySelector(`[name="${f.path}"]`));
        const raw = input.value.trim();
        if (f.type !== 'number') { put(patch, f.path, raw === '' && f.nullable ? null : raw); continue; }
        // a number field with text it cannot read reports an empty value: badInput tells the two apart
        if (raw === '' && !input.validity.badInput) { reset.push(f.path); continue; }
        const n = Number(raw);
        if (raw === '' || !Number.isFinite(n) || n < f.min) {
          input.closest('details')?.setAttribute('open', '');
          input.focus();
          toast(`«${f.label}»: нужно число не меньше ${f.min}. Пустое поле вернёт значение по умолчанию.`, { kind: 'fail' });
          return;
        }
        put(patch, f.path, n);
      }
      const ok = await attempt(() => call('saveSettings', { patch, reset }));
      if (ok) { app.key = ok.key; close(); toast('Настройки сохранены.', { kind: 'done' }); }
    }
  });
}
