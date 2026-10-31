// The hints' markup and their × (which hint shows when, and what is remembered: hints.js). The «Следующий шаг» line
// and a first-use pill go at the end of the main section's header row («Окно · 10/10», «Наборы · 1»), so they take no
// height of their own and the window and the set tiles keep their size; the setup card goes above the first screen's
// content. × hides one hint and says how to bring it back; the screens draw their hints again on HINTS_EVENT.
import { esc, I, toast } from './ui.js';
import { words } from './i18n.js';
import { dismissHint, HINTS_EVENT, restoreHint } from './hints.js';

const t = words({
  ru: {
    next: 'Следующий шаг', hide: 'Больше не показывать', hidden: 'Подсказка скрыта. Вернуть: Настройки → Вид.', restore: 'Вернуть',
    'collection.generating': 'Карточки появятся сами. Готовые уже можно смотреть — откройте набор.',
    'collection.open': 'Нажмите на окно набора, чтобы открыть его и проверить карточки.',
    'set.check': 'Нажмите на карточку, чтобы проверить её. Перетащите, чтобы поменять местами.',
    'set.export': 'Набор готов — нажмите «Экспорт» слева вверху. Нужны не все карточки? ⌘ или Ctrl + щелчок по ним.',
    'set.drag': 'Перетащите карточку из хранилища{right} в любое место окна', right: ' справа',
    'set.place': 'Нажмите на карточку в окне, чтобы выбрать звёзды, рамку и подпись',
    keyTitle: 'Ключ сервиса не подключён',
    keyText: 'Без ключа фабрика не нарисует карточки через сервис, не составит план набора и не проверит карточки. Даже когда рисует Codex, ключ нужен для планов и проверки.',
    keyButton: 'Подключить ключ',
    codexTitle: 'Codex не готов рисовать',
    codex_missing: 'В настройках картинки рисует Codex CLI, но на этом компьютере его не нашлось. Установите Codex CLI (как — в README фабрики) и войдите командой {cmd}.',
    codex_login: 'Codex CLI не вошёл в аккаунт ChatGPT. Выполните в терминале {cmd} и обновите эту страницу.',
    codex_error: 'Не получилось спросить Codex CLI, вошёл ли он. Выполните в терминале {cmd} и посмотрите, что он ответит.',
  },
  en: {
    next: 'Next step', hide: 'Do not show again', hidden: 'Hint hidden. To bring it back: Settings → Look.', restore: 'Bring back',
    'collection.generating': 'The cards appear by themselves. The ready ones can be looked at already — open the set.',
    'collection.open': 'Click a set window to open it and check its cards.',
    'set.check': 'Click a card to check it. Drag it to swap places.',
    'set.export': 'The set is ready — click “Export” at the top left. Not all the cards? ⌘ or Ctrl + click them.',
    'set.drag': 'Drag a card from the pool{right} into any place of the window', right: ' on the right',
    'set.place': 'Click a card in the window to choose its stars, frame and caption',
    keyTitle: 'The service key is not connected',
    keyText: 'Without the key the factory cannot draw cards through the service, plan a set or check the cards. Even when Codex draws, the key is needed for plans and checks.',
    keyButton: 'Connect a key',
    codexTitle: 'Codex is not ready to draw',
    codex_missing: 'The settings have Codex CLI draw the pictures, but it is not on this computer. Install Codex CLI (the factory’s README says how) and sign in with {cmd}.',
    codex_login: 'Codex CLI is not signed in to a ChatGPT account. Run {cmd} in a terminal and reload this page.',
    codex_error: 'Could not ask Codex CLI whether it is signed in. Run {cmd} in a terminal and see what it says.',
  },
});

/** The command each Codex status asks the person to run. */
const CODEX_CMD = /** @type {Record<string, string>} */ ({ missing: 'codex login', login: 'codex login', error: 'codex login status' });

/** A hand: «click». */
const HAND = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 8.5V3.25a1.25 1.25 0 0 1 2.5 0V7.5"/><path d="M8 7V6.25a1.25 1.25 0 0 1 2.5 0V7.5"/><path d="M10.5 7.25a1.25 1.25 0 0 1 2.5 0v2.5a4.5 4.5 0 0 1-4.5 4.5h-.6a4 4 0 0 1-3.1-1.5L2.6 10.2a1.2 1.2 0 0 1 1.8-1.6l1.1 1.15"/></svg>';
/** A terminal window: «run a command». */
const TERMINAL = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M4.5 6.25L6.5 8l-2 1.75M8.25 10h3"/></svg>';

/** The × of a hint. @param {string} id */
const x = id => `<button type="button" class="hint-x has-bubble" data-hint-x="${esc(id)}" aria-label="${esc(t('hide'))}">${I.x}<span class="bubble bubble--right" aria-hidden="true">${esc(t('hide'))}</span></button>`;

/**
 * A screen's step hint for its section header row, or nothing.
 * @param {import('./hints.js').Hint|null} h
 */
export function hintHtml(h) {
  if (!h) return '';
  // «справа»: the pool is beside the window only on a wide screen; under it on a narrower one, where the word is hidden
  const text = t(/** @type {any} */ (h.id), { right: t('right') });
  const shown = esc(t(/** @type {any} */ (h.id))).replace('{right}', `<span class="hint__wide">${esc(t('right'))}</span>`);
  if (h.kind === 'first') return `<span class="firstuse" data-hint="${esc(h.id)}">${h.id === 'set.drag' ? I.grip : HAND}<span title="${esc(text)}">${shown}</span>${x(h.id)}</span>`;
  return `<p class="nextstep" data-hint="${esc(h.id)}"><span class="label nextstep__label">${esc(t('next'))}</span><span class="nextstep__text" title="${esc(text)}">${esc(text)}</span>${x(h.id)}</p>`;
}

/**
 * The first screen's setup card: one row per hint (hints.js setupHints), or nothing.
 * @param {string[]} ids @param {string|null} codex  Codex's status
 */
export function setupHtml(ids, codex) {
  if (!ids.length) return '';
  const row = (/** @type {string} */ id, /** @type {string} */ icon, /** @type {string} */ title, /** @type {string} */ text, /** @type {string} */ act) =>
    `<div class="setup__row" data-hint="${esc(id)}"><span class="setup__icon">${icon}</span><div class="setup__text"><p class="setup__title">${esc(title)}</p><p class="setup__say">${text}</p></div>${act}${x(id)}</div>`;
  const rows = ids.map(id => (id === 'setup.key'
    ? row(id, I.key, t('keyTitle'), esc(t('keyText')), `<button type="button" class="btn btn--secondary btn--s setup__act" data-open-settings="key">${I.key}<span>${esc(t('keyButton'))}</span></button>`)
    : row(id, TERMINAL, t('codexTitle'), esc(t(/** @type {any} */ (`codex_${codex}`))).replace('{cmd}', `<code class="data">${esc(CODEX_CMD[codex ?? ''] ?? '')}</code>`), '')));
  return `<section class="panel setup" aria-label="${esc(ids.map(id => t(id === 'setup.key' ? 'keyTitle' : 'codexTitle')).join('. '))}">${rows.join('')}</section>`;
}

/** The × of every hint on the page: hides it, and the toast can bring it back. @param {HTMLElement} root */
export function bindHintClicks(root) {
  root.addEventListener('click', e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-hint-x]'));
    if (!b) return;
    const id = /** @type {string} */ (b.dataset.hintX);
    dismissHint(id);
    toast(t('hidden'), { action: { label: t('restore'), run: () => restoreHint(id) } });
  });
}

/**
 * Draws a screen's hints again whenever they may have changed, while the screen is on the page.
 * @param {HTMLElement} el  the screen @param {() => void} redraw
 */
export function onHints(el, redraw) {
  const on = () => { if (el.isConnected) redraw(); else removeEventListener(HINTS_EVENT, on); };
  addEventListener(HINTS_EVENT, on);
}
