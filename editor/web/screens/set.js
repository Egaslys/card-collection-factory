// A set: its window in one of the four template colours, cards dragged between slots and from the pool, a card
// opened by a click; the set's variants side by side, one of them chosen.
import { call, jobs } from '../api.js';
import { attempt, badge, esc, I, jobline, verdict } from '../ui.js';
import { templateSwitch, windowHtml, windowsOf } from '../window.js';
import { openExport } from '../panels/export.js';
import { app } from '../state.js';
import { poolHtml, poolView } from './pool.js';

/** @param {string} collectionId @param {string} setId */
export async function load(collectionId, setId) {
  const [{ collection: col, sets }, cards] = await Promise.all([call('getCollection', { collectionId }), call('listCards', { collectionId })]);
  const set = sets.find((/** @type {any} */ s) => s.id === setId);
  if (!set) throw new Error('Такого набора в коллекции нет: возможно, его удалили.');
  const g = await windowsOf(col.style);
  const byId = new Map(cards.map((/** @type {any} */ c) => [c.id, c]));
  const total = Math.max(16, ...sets.map((/** @type {any} */ s) => s.number ?? 0));
  const variants = sets.filter((/** @type {any} */ s) => (s.variantGroup ?? s.id) === (set.variantGroup ?? set.id));
  const template = set.window?.template in g.templates ? set.window.template : Object.keys(g.templates)[0];
  const href = (/** @type {string} */ s) => `#/c/${encodeURIComponent(collectionId)}/s/${encodeURIComponent(s)}`;

  const made = set.slots.filter((/** @type {string|null} */ c) => c && byId.get(c)?.status === 'made').length;
  const running = [...jobs.values()].filter(j => j.status === 'running' && j.scope?.collectionId === collectionId && (!j.scope.setId || j.scope.setId === setId));
  const progress = running.map(jobline).join('');
  const kindNote = set.window?.kind && set.window.kind !== g.kind
    ? `<p class="note ink-2">${I.alert}<span>Этот набор — для ${set.window.kind === 'grand' ? 'гранд-окна' : 'малого окна'}: его звёзды и рамки другие, а шаблона такого окна пока нет, поэтому он показан в большом окне.</span></p>` : '';
  const canMake = !!set.plan && made < 10 && !running.length;

  const brief = [set.brief?.theme && `Тема: ${set.brief.theme}`, set.brief?.wishes && `Пожелания: ${set.brief.wishes}`].filter(Boolean).join(' · ');
  const head = `<header class="head">
    <div class="head__main">
      <p class="label">Набор ${set.number ?? ''}${total ? ` из ${total}` : ''}${variants.length > 1 ? ` · вариант ${variants.indexOf(set) + 1} из ${variants.length}` : ''}</p>
      <h1 class="type-headline-md">${esc(set.title)}</h1>
      ${brief ? `<p class="head__desc ink-2">${esc(brief)}</p>` : ''}
    </div>
    ${canMake ? `<div class="head__actions"><button type="button" class="btn btn--secondary" data-make title="Сделать по плану набора карточки для пустых мест и для тех, что не получились">${I.spark}<span>${made ? 'Доделать карточки' : 'Сделать карточки'}</span></button></div>` : ''}
  </header>`;

  const variantCols = variants.length > 1 ? `<section class="variants-sec" aria-label="Варианты набора"><div class="sec-head"><span class="label">Варианты · ${variants.length}</span></div>
    <div class="variants">${variants.map((/** @type {any} */ v, /** @type {number} */ i) => {
      const vc = v.slots.map((/** @type {string|null} */ id) => (id ? byId.get(id) : null));
      const checks = vc.filter(Boolean).map((/** @type {any} */ c) => verdict(c.checks, c.status).kind);
      const sum = ['pass', 'warn', 'fail'].map(k => { const n = checks.filter((/** @type {any} */ x) => x === k).length; return n ? `${badge({ kind: k, word: `${k.toUpperCase()} ${n}`, text: '' })}` : ''; }).join('');
      const chosen = v.chosen === true;
      return `<article class="variant panel${chosen ? ' is-chosen' : ''}${v.id === set.id ? ' is-current' : ''}">
        <div class="variant__head"><a href="${href(v.id)}" class="variant__title"><span class="label">Вариант ${i + 1}</span><span>${esc(v.title)}</span></a>
          ${chosen ? `<span class="variant__chosen">${I.check}Выбран</span>` : `<button type="button" class="btn btn--secondary btn--s" data-choose="${esc(v.id)}">Выбрать</button>`}</div>
        <a class="variant__cards" href="${href(v.id)}" aria-label="Открыть вариант ${i + 1}">${vc.map((/** @type {any} */ c) => `<span class="thumb__img">${c?.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" loading="lazy">` : ''}</span>`).join('')}</a>
        <div class="variant__sum">${sum || '<span class="ink-3">Карточек пока нет</span>'}</div>
      </article>`;
    }).join('')}</div></section>` : '';

  return {
    where: [{ label: 'Коллекции', href: '#/' }, { label: col.title, href: `#/c/${encodeURIComponent(collectionId)}` }, { label: set.title, href: href(setId) }],
    primary: { label: 'Экспорт', icon: I.download, run: () => openExport({ collection: col, sets, set }) },
    html: `${head}${progress ? `<div class="joblines">${progress}</div>` : ''}<div class="cols">
      <section class="cols__main" aria-label="Окно набора">
        <div class="sec-head"><span class="label">Окно · ${made}/10</span>${templateSwitch(g, template)}</div>
        <div class="window"><div class="window__stage">${windowHtml(g, { set: { ...set, window: { ...set.window, template } }, cards: byId, style: col.style, total, drop: true })}</div></div>
        ${kindNote}
        <p class="hint ink-3">Нажмите на карточку, чтобы поправить её. Перетащите, чтобы поменять местами или убрать в хранилище.</p>
        ${variantCols}
      </section>
      ${poolHtml(cards)}</div>`,
    mount: (/** @type {HTMLElement} */ el) => {
      el.addEventListener('click', async e => {
        const t = /** @type {HTMLElement} */ (e.target);
        const tp = /** @type {HTMLElement|null} */ (t.closest('[data-template-pick]'));
        if (tp) {
          for (const b of el.querySelectorAll('[data-template-pick]')) b.setAttribute('aria-pressed', String(b === tp));
          await attempt(() => call('updateSet', { collectionId, setId, patch: { window: { template: tp.dataset.templatePick } } }));
          app.refresh();
          return;
        }
        const pick = /** @type {HTMLElement|null} */ (t.closest('[data-pool]'));
        if (pick) { poolView.all = pick.dataset.pool === 'all'; app.refresh(); return; }
        const ch = /** @type {HTMLElement|null} */ (t.closest('[data-choose]'));
        if (ch) {
          await attempt(async () => { for (const v of variants) await call('updateSet', { collectionId, setId: v.id, patch: { chosen: v.id === ch.dataset.choose } }); });
          app.refresh();
          return;
        }
        if (t.closest('[data-make]')) {
          const r = await attempt(() => call('makeSet', { collectionId, setId }));
          if (r) app.refresh();
          return;
        }
        const card = /** @type {HTMLElement|null} */ (t.closest('[data-card]'));
        if (card) app.openCard(collectionId, /** @type {string} */ (card.dataset.card));
      });
      el.addEventListener('keydown', e => {
        const card = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-card]'));
        if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); app.openCard(collectionId, /** @type {string} */ (card.dataset.card)); }
      });
    },
    affects: (/** @type {any} */ e) => e.collectionId === collectionId,
  };
}
