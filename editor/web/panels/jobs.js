// The generation queue: every long job of this editor (plans, sets, collections, cards) in plain words — what it does,
// its step now, how many cards are done, one row per card with its status —, its journal under a spoiler; no money
// (the top bar shows what has been spent). One scroll: the sheet's own. A running job that supports it can be stopped.
import { cancelJob, jobs, onEvent } from '../api.js';
import { lang, words } from '../i18n.js';
import { attempt, esc, I, itemDot, itemSay, jobCount, jobEnding, jobTitle, openSheet } from '../ui.js';
import { logText, saidText } from '../said.js';

const t = words({
  ru: {
    title: 'Генерация', stop: 'Остановить', codex: 'Картинки рисует Codex CLI на этом компьютере, в фоне.', log: 'Что происходило',
    empty: 'Сейчас ничего не генерируется', emptyText: 'Здесь появятся карточки, наборы и коллекции, пока они генерируются.',
  },
  en: {
    title: 'Generation', stop: 'Stop', codex: 'Codex CLI draws the pictures on this computer, in the background.', log: 'What happened',
    empty: 'Nothing is being generated', emptyText: 'Cards, sets and collections show up here while they are generated.',
  },
});


/** @param {string} iso */
const time = iso => new Date(iso).toLocaleTimeString(lang() === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

/** @param {any} j */
function section(j) {
  const st = j.status;
  const end = jobEnding(j);
  // a finished job that counted its cards says it in its ending («Готово: 2 из 3»)
  const count = st === 'running' || !j.outcome ? jobCount(j) : '';
  const total = j.about?.count;
  const done = j.outcome?.made ?? (j.items ?? []).filter((/** @type {any} */ i) => itemDot(i) === 'done').length;
  // why nothing or not all was drawn, when the warnings do not say it already
  const reason = j.outcome?.reason && !j.warnings?.length && !j.error ? saidText(j.outcome.reasonSaid, j.outcome.reason) : '';
  const items = j.items?.length ? `<ul class="qitems">${j.items.map((/** @type {any} */ i) => `<li class="qitem"><span class="qitem__img">${I.image}</span>
      <span class="qitem__text"><span class="qitem__name">${i.slot != null ? `<span class="data ink-3">${String(i.slot).padStart(2, '0')}</span> ` : ''}${esc(i.title)}</span>
      <span class="qitem__say qitem__say--${itemDot(i)}"><i class="dot dot--${itemDot(i)}"></i>${esc(itemSay(i))}</span></span></li>`).join('')}</ul>` : '';
  return `<section class="qjob" data-job="${esc(j.id)}">
    <div class="qjob__head"><span class="qjob__title">${esc(jobTitle(j))}</span>${st === 'running' && j.cancellable ? `<button type="button" class="btn btn--secondary btn--s" data-cancel="${esc(j.id)}">${I.stop}<span>${esc(t('stop'))}</span></button>` : ''}</div>
    <p class="qjob__say qjob__say--${end.kind}"><i class="dot dot--${end.kind}"></i><span>${esc(end.text)}</span></p>
    ${j.about?.codex ? `<p class="qjob__count">${esc(t('codex'))}</p>` : ''}
    ${j.error ? `<p class="qjob__error">${esc(saidText(j.errorSaid, j.error))}</p>` : ''}
    ${reason ? `<p class="qjob__error">${esc(reason)}</p>` : ''}
    ${(j.warnings ?? []).map((/** @type {string} */ w, /** @type {number} */ k) => `<p class="qjob__error">${esc(saidText(j.warningSaid?.[k], w))}</p>`).join('')}
    ${total ? `<div class="progress${end.kind === 'done' ? ' progress--done' : end.kind === 'fail' ? ' progress--fail' : ''}"><i style="--p:${Math.round(100 * done / total)}%"></i></div>` : ''}
    ${count ? `<p class="qjob__count">${esc(count)}</p>` : ''}
    ${items}
    ${j.log.length ? `<details class="disclose" data-log><summary>${I.chev}${esc(t('log'))}</summary><div><ol class="qlog">${j.log.map((/** @type {any} */ l) => `<li><time>${time(l.at)}</time> · ${esc(logText(l))}</li>`).join('')}</ol></div></details>` : ''}
  </section>`;
}

export function openJobs() {
  const list = () => [...jobs.values()].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.startedAt.localeCompare(a.startedAt));
  const body = () => {
    const all = list();
    return all.length ? all.map(section).join('')
      : `<div class="state"><span class="state__icon">${I.check}</span><h3 class="type-headline-sm">${esc(t('empty'))}</h3><p>${esc(t('emptyText'))}</p></div>`;
  };
  const { body: el } = openSheet({ title: t('title'), body: body(), onClose: () => off() });
  for (const j of jobs.values()) j.seen = true;
  // a job's event redraws that job's section only, keeping its open journal
  const off = onEvent(e => {
    if (e.type !== 'job' || !el.isConnected) return;
    e.job.seen = true;
    const old = el.querySelector(`[data-job="${CSS.escape(e.job.id)}"]`);
    if (!old) { el.innerHTML = body(); return; }
    const open = /** @type {HTMLDetailsElement|null} */ (old.querySelector('[data-log]'))?.open;
    const fresh = document.createElement('template');
    fresh.innerHTML = section(e.job).trim();
    const node = /** @type {HTMLElement} */ (fresh.content.firstElementChild);
    if (open) /** @type {HTMLDetailsElement|null} */ (node.querySelector('[data-log]'))?.setAttribute('open', '');
    old.replaceWith(node);
  });
  el.addEventListener('click', async e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-cancel]'));
    if (b) await attempt(() => cancelJob(/** @type {string} */ (b.dataset.cancel)));
  });
}
