// The queue: every long job of this editor (plans, sets, collections, cards) with its status, its journal and what
// it has spent; a running job that supports it can be stopped.
import { cancelJob, jobs, onEvent } from '../api.js';
import { attempt, esc, I, openSheet, usd } from '../ui.js';

const WORD = { running: 'идёт', done: 'готово', failed: 'ошибка', cancelled: 'остановлено' };
const DOT = { running: 'work', done: 'done', failed: 'fail', cancelled: 'idle' };
/** A card row's status from core/set: [word, status class, dot]. @type {Record<string, [string, string, string]>} */
const ITEM = {
  start: ['делается', 'is-work', 'work'], made: ['готово', 'is-done', 'done'], kept: ['уже была', 'is-done', 'done'],
  skipped: ['пропущена: потолок расходов', '', 'warn'], failed: ['ошибка', 'is-fail', 'fail'], cancelled: ['остановлена', '', 'idle'],
};

/** @param {string} iso */
const time = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** @param {any} j */
function row(j) {
  const st = /** @type {keyof typeof WORD} */ (j.status);
  const cls = st === 'running' ? 'is-work' : st === 'done' ? 'is-done' : st === 'failed' ? 'is-fail' : '';
  return `<details class="jobrow panel"${st === 'running' || st === 'failed' ? ' open' : ''}>
    <summary class="jobrow__sum"><span class="queue-row__status ${cls}"><i class="dot dot--${DOT[st]}"></i>${WORD[st]}</span>
      <span class="jobrow__title">${esc(j.title)}</span><span class="data ink-3">${j.spent != null ? usd(j.spent) : ''}</span><span class="data ink-3">${time(j.startedAt)}</span></summary>
    ${j.error ? `<p class="jobrow__error">${esc(j.error)}</p>` : ''}
    ${(j.warnings ?? []).map((/** @type {string} */ w) => `<p class="jobrow__error">${esc(w)}</p>`).join('')}
    ${j.items?.length ? `<ol class="jobitems">${j.items.map((/** @type {any} */ i) => `<li class="queue-row__status ${ITEM[i.status]?.[1] ?? ''}"><span class="data ink-3">${String(i.slot).padStart(2, '0')}</span><i class="dot dot--${ITEM[i.status]?.[2] ?? 'idle'}"></i><span class="jobitems__title">${esc(i.title)}</span><span>${ITEM[i.status]?.[0] ?? esc(i.status)}</span><span class="data ink-3">${i.spent ? usd(i.spent) : ''}</span></li>`).join('')}</ol>` : ''}
    ${j.log.length ? `<ol class="log">${j.log.map((/** @type {any} */ l) => `<li><time>${time(l.at)}</time><i class="dot dot--idle"></i><span>${esc(l.text)}</span></li>`).join('')}</ol>` : ''}
    ${st === 'running' && j.cancellable ? `<button type="button" class="btn btn--secondary btn--s" data-cancel="${esc(j.id)}">${I.stop}Остановить</button>` : ''}
  </details>`;
}

export function openJobs() {
  const list = () => [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const body = () => {
    const all = list();
    const spent = all.reduce((s, j) => s + (j.spent ?? 0), 0);
    return all.length ? `<p class="ink-2 data">Потрачено в этом запуске редактора: ${usd(spent)}</p><div class="jobrows">${all.map(row).join('')}</div>`
      : `<div class="state"><span class="state__icon">${I.check}</span><h3 class="type-headline-sm">Очередь пуста</h3><p>Здесь появится сборка наборов и коллекций, пока она идёт.</p></div>`;
  };
  const { body: el } = openSheet({ title: 'Очередь', body: body(), onClose: () => off() });
  for (const j of jobs.values()) j.seen = true;
  const off = onEvent(e => {
    if (e.type !== 'job' || !el.isConnected) return;
    const open = new Set([...el.querySelectorAll('details[open]')].map(d => d.querySelector('.jobrow__title')?.textContent));
    el.innerHTML = body();
    for (const d of el.querySelectorAll('details')) if (open.has(d.querySelector('.jobrow__title')?.textContent)) d.open = true;
  });
  el.addEventListener('click', async e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-cancel]'));
    if (b) await attempt(() => cancelJob(/** @type {string} */ (b.dataset.cancel)));
  });
}
