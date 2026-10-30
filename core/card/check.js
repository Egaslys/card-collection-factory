// Runs a style's automatic checks on one attempt and sums them up for the loop.
// A style plugs in through styles/<style>/checks/check-card.mjs, which exports
//   checkCard(spec entry, {baseDir, overlaysDir}) → {hero, results, visual, …},
//   restsOnUnconfirmedMask(result, hero) → boolean, and CARD_SIZE {width, height}.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../settings.js';
import { ATTEMPT_FILES } from './card-file.js';

/** @param {string} style */
export function styleDir(style) {
  if (!/^[\w-]+$/.test(String(style))) throw new Error(`Недопустимое имя стиля: «${style}».`);
  const dir = path.join(ROOT, 'styles', style);
  if (!fs.existsSync(dir)) throw new Error(`Нет стиля «${style}» (папка styles/${style}).`);
  return dir;
}

/**
 * The style's checker module.
 * @param {string} style
 * @returns {Promise<{checkCard: (card: object, o: {baseDir?: string, overlaysDir?: string}) => Promise<any>, restsOnUnconfirmedMask: (r: any, hero: any) => boolean, CARD_SIZE: {width: number, height: number}}>}
 */
export async function styleChecker(style) {
  return import(pathToFileURL(path.join(styleDir(style), 'checks', 'check-card.mjs')).href);
}

/**
 * Checks attempts/<n>/card.png against the staging of the order; writes check.json (and the outline overlay) into
 * the attempt folder.
 * @param {object} o
 * @param {import('../style/card-order.js').CardOrder} o.order
 * @param {string} o.dir  the attempt folder
 * @param {import('./card-file.js').Review} [o.review]
 * @returns {Promise<{summary: import('./card-file.js').CheckSummary, visual: {doc: string, check: number, what: string}[]}>}
 */
export async function checkAttempt({ order, dir, review = {} }) {
  const checker = await styleChecker(order.style);
  // id "card" names the overlay card.mask.png (ATTEMPT_FILES.mask)
  const result = await checker.checkCard({ ...order.staging, ...review, id: 'card', file: ATTEMPT_FILES.card }, { baseDir: dir, overlaysDir: dir });
  fs.writeFileSync(path.join(dir, ATTEMPT_FILES.check), JSON.stringify(result, null, 1));
  return { summary: summarize(result, checker.restsOnUnconfirmedMask), visual: result.visual };
}

/**
 * @param {{hero: any, results: any[]}} result  a checkCard result
 * @param {(r: any, hero: any) => boolean} restsOnUnconfirmedMask
 * @returns {import('./card-file.js').CheckSummary}
 */
export function summarize(result, restsOnUnconfirmedMask) {
  const fails = result.results.filter(r => r.status === 'FAIL' && !r.expected).map(r => ({
    id: r.id, title: r.title, value: r.value, threshold: r.threshold, note: r.note, needsMask: restsOnUnconfirmedMask(r, result.hero),
  }));
  return {
    maskStatus: result.hero?.mask_status ?? 'not found',
    blocking: fails.filter(f => !f.needsMask).length,
    warns: result.results.filter(r => r.status === 'WARN').length,
    fails,
  };
}
