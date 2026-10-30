// Settings, reachable from every screen: the key (status, a temporary key held only while the editor runs), the
// image provider and models, attempts and spend caps. Saved into settings/local.json through core/settings.js;
// what is rare sits under «Дополнительно».
import { call } from '../api.js';
import { attempt, esc, I, openSheet, setTheme, toast, usd } from '../ui.js';
import { app } from '../state.js';

/** One editable setting: a dotted path into the settings, its label and kind. */
const FIELDS = {
  main: [
    { path: 'provider.openrouter.model', label: 'Модель картинок', hint: 'Основная модель OpenRouter.' },
    { path: 'card.attempts', label: 'Попыток на карточку', type: 'number', min: 1, step: 1, hint: 'Сколько раз карточку можно сгенерировать заново, если она не прошла проверки стиля.' },
    { path: 'set.maxSpendUsd', label: 'Потолок на набор, $', type: 'number', min: 0, step: 0.1, hint: 'Больше этого один набор не потратит.' },
    { path: 'card.maxSpendUsd', label: 'Потолок на карточку, $', type: 'number', min: 0, step: 0.05 },
  ],
  more: [
    { path: 'provider.openrouter.fallbackModel', label: 'Запасная модель картинок', hint: 'Пробуется, если основная не справилась. Пусто — без запасной.', nullable: true },
    { path: 'vision.model', label: 'Смотрящая модель', hint: 'Смотрит на готовые карточки, когда нет агента.' },
    { path: 'set.plan.model', label: 'Текстовая модель', hint: 'Пишет план набора и коллекции.' },
    { path: 'provider.openrouter.endpoint', label: 'Адрес подключения', hint: 'OpenRouter или совместимый сервис.', inputmode: 'url' },
    { path: 'provider.openrouter.keyEnvVar', label: 'Переменная ключа', hint: 'Имя строки в .env, где лежит постоянный ключ.' },
    { path: 'set.parallel', label: 'Карточек одновременно', type: 'number', min: 1, step: 1 },
    { path: 'set.plan.maxSpendUsd', label: 'Потолок на план, $', type: 'number', min: 0, step: 0.05 },
  ],
};

/** @type {Record<string, string>} */
const PROVIDER_HINT = {
  openrouter: 'OpenRouter — по ключу, оплата за каждую картинку.',
  'codex-cli': 'Codex CLI — по подписке Codex, без оплаты за картинку (только GPT Image). План набора всё равно пишет текстовая модель через OpenRouter.',
};

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
const fieldHtml = (f, s) => {
  const v = get(s, f.path);
  return `<label class="field"><span class="field__label">${esc(f.label)}</span>
    <input class="input" name="${esc(f.path)}" ${f.type === 'number' ? `type="number" min="${f.min}" step="${f.step}" inputmode="decimal"` : `type="text" spellcheck="false" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}`} value="${esc(v ?? '')}">
    ${f.hint ? `<span class="field__hint">${esc(f.hint)}</span>` : ''}</label>`;
};

/** @param {any} k */
function keyBlock(k) {
  const state = k.source === 'none'
    ? `<p class="keystate keystate--fail"><i class="dot dot--fail"></i><span><b>Ключа нет.</b> Генерация через OpenRouter и план набора не работают. Codex CLI работает без ключа.</span></p>`
    : k.source === 'temporary'
      ? `<p class="keystate"><i class="dot dot--done"></i><span><b>Временный ключ</b> …${esc(k.hint)} — живёт, пока открыт редактор.</span></p>`
      : `<p class="keystate"><i class="dot dot--done"></i><span><b>Постоянный ключ</b> …${esc(k.hint)} — из файла .env или переменной ${esc(k.envVar)}.</span></p>`;
  return `${state}
    <label class="field"><span class="field__label">${k.source === 'none' ? 'Временный ключ' : 'Заменить на временный'}</span>
      <span class="input-wrap"><input class="input" type="password" name="key" autocomplete="off" spellcheck="false" placeholder="sk-or-…" data-key-input><button type="button" class="btn btn--text btn--icon btn--s" data-key-toggle aria-label="Показать ключ" aria-pressed="false">${I.eye}</button></span>
      <span class="field__hint">Ключ не сохраняется на диск: он живёт, пока запущен редактор. Постоянный ключ кладут в файл .env в папке фабрики: ${esc(k.envVar)}=…</span></label>
    <div class="row"><button type="button" class="btn btn--secondary btn--s" data-key-set>${I.key}Использовать ключ</button>
      ${k.source === 'temporary' ? '<button type="button" class="btn btn--text btn--s" data-key-clear><span>Забыть временный ключ</span></button>' : ''}
      ${k.source !== 'none' ? '<button type="button" class="btn btn--text btn--s" data-key-check><span>Проверить баланс</span></button>' : ''}</div>
    <p class="field__hint" data-key-result></p>`;
}

export async function openSettings() {
  const r = await attempt(() => call('getSettings'));
  if (!r) return;
  const s = r.settings;
  const provider = s.provider.use;
  const { sheet, close } = openSheet({
    title: 'Настройки',
    body: `<form class="form" data-form onsubmit="return false">
      <section class="form__sec" aria-label="Ключ"><span class="label">Ключ OpenRouter</span><div class="keyblock" data-key>${keyBlock(r.key)}</div></section>
      <section class="form__sec" aria-label="Генерация"><span class="label">Генерация</span>
        <div class="field"><span class="field__label">Чем генерировать картинки</span>
          <div class="seg" role="group" data-provider><button type="button" data-v="openrouter" aria-pressed="${provider === 'openrouter'}">OpenRouter</button><button type="button" data-v="codex-cli" aria-pressed="${provider === 'codex-cli'}">Codex CLI</button></div>
          <span class="field__hint" data-provider-hint>${PROVIDER_HINT[provider] ?? ''}</span></div>
        ${FIELDS.main.map(f => fieldHtml(f, s)).join('')}
      </section>
      <section class="form__sec" aria-label="Вид"><span class="label">Вид</span>
        <div class="field"><span class="field__label">Тема</span><div class="seg" role="group" data-theme-set>${['light', 'dark'].map(t => `<button type="button" data-v="${t}" aria-pressed="${(document.documentElement.dataset.theme ?? 'light') === t}">${t === 'light' ? `${I.sun}Светлая` : `${I.moon}Тёмная`}</button>`).join('')}</div>
          <span class="field__hint">Запоминается в этом браузере.</span></div></section>
      <details class="more"><summary class="btn btn--text btn--s"><span>Дополнительно</span></summary><div class="form">${FIELDS.more.map(f => fieldHtml(f, s)).join('')}</div></details>
    </form>`,
    foot: `<button type="button" class="btn btn--secondary" data-close>Отмена</button><button type="button" class="btn btn--primary" data-save>Сохранить</button>`,
  });
  const keyEl = /** @type {HTMLElement} */ (sheet.querySelector('[data-key]'));
  const redrawKey = (/** @type {any} */ k) => { app.key = k; keyEl.innerHTML = keyBlock(k); };

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
      const k = await attempt(() => call('setKey', { key: input.value }));
      if (k) { input.value = ''; redrawKey(k); toast('Временный ключ подключён.', { kind: 'done' }); }
      return;
    }
    if (t.closest('[data-key-clear]')) { const k = await attempt(() => call('clearKey')); if (k) redrawKey(k); return; }
    if (t.closest('[data-key-check]')) {
      const out = /** @type {HTMLElement} */ (sheet.querySelector('[data-key-result]'));
      out.textContent = 'Спрашиваю OpenRouter…';
      try {
        const c = await call('checkKey');
        out.textContent = `Ключ работает. Осталось ${usd(c.credits.remaining)} из ${usd(c.credits.total)}.`;
      } catch (/** @type {any} */ err) { out.textContent = err.message; out.classList.add('field__hint--fail'); }
      return;
    }
    const th = /** @type {HTMLElement|null} */ (t.closest('[data-theme-set] > button'));
    if (th) {
      for (const b of /** @type {HTMLElement} */ (th.parentElement).children) b.setAttribute('aria-pressed', String(b === th));
      setTheme(/** @type {string} */ (th.dataset.v));
      return;
    }
    const pv = /** @type {HTMLElement|null} */ (t.closest('[data-provider] > button'));
    if (pv) {
      for (const b of /** @type {HTMLElement} */ (pv.parentElement).children) b.setAttribute('aria-pressed', String(b === pv));
      /** @type {HTMLElement} */ (sheet.querySelector('[data-provider-hint]')).textContent = PROVIDER_HINT[/** @type {string} */ (pv.dataset.v)];
      return;
    }
    if (t.closest('[data-save]')) {
      /** @type {Record<string, any>} */
      const patch = {};
      put(patch, 'provider.use', /** @type {HTMLElement} */ (sheet.querySelector('[data-provider] [aria-pressed="true"]')).dataset.v);
      for (const f of [...FIELDS.main, ...FIELDS.more]) {
        const input = /** @type {HTMLInputElement} */ (sheet.querySelector(`[name="${f.path}"]`));
        const raw = input.value.trim();
        /** @type {any} */ (f).type === 'number' ? put(patch, f.path, Number(raw)) : put(patch, f.path, raw === '' && /** @type {any} */ (f).nullable ? null : raw);
      }
      const ok = await attempt(() => call('saveSettings', { patch }));
      if (ok) { app.key = ok.key; close(); toast('Настройки сохранены.', { kind: 'done' }); }
    }
  });
}
