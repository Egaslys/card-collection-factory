// How a check's measured value reads for a person, in the page's language: the number with its unit, then the norm and
// the limit the style compares it with, in words. The unit comes from the style's plain words of its checks
// (styles/<style>/checks/explain.json → `units`, named by each check's `unit`), the bounds from the checker's result
// (`norm`, `limit`: {min, max}). A value that is not a plain number — a compound measure the checker writes as text
// for agents — is not shown: the check's plain words say what it looks at, and the agents' report keeps the numbers.
import { lang, words } from './i18n.js';

/** @typedef {{min?: number|null, max?: number|null}} Bound */
/** @typedef {{ru: string, en: string, attach?: boolean, scale?: number}} Unit */

const t = words({
  ru: { measured: 'Измерено {v}', norm: 'норма {r}', limit: 'допустимо {r}', between: 'от {a} до {b}', from: 'от {a}', upTo: 'до {b}' },
  en: { measured: 'Measured {v}', norm: 'norm {r}', limit: 'allowed {r}', between: '{a} to {b}', from: 'at least {a}', upTo: 'at most {b}' },
});

/**
 * The measured line of one check result, or '' when its value is not a number.
 * @param {{value: unknown, norm?: Bound|null, limit?: Bound|null}} result
 * @param {Unit} [unit]
 */
export function measureText(result, unit) {
  const { value } = result;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const l = lang(), word = unit ? unit[l] ?? unit.ru : '', scale = unit?.scale ?? 1;
  const nf = new Intl.NumberFormat(l === 'ru' ? 'ru-RU' : 'en-GB', { maximumFractionDigits: 3 });
  /** @param {number} v */
  const num = v => `${nf.format(v * scale)}${unit?.attach ? (word === '°' ? word : ` ${word}`) : ''}`;
  /** @param {Bound|null|undefined} b */
  const bound = b => !b ? '' : b.min != null && b.max != null ? t('between', { a: num(b.min), b: num(b.max) })
    : b.min != null ? t('from', { a: num(b.min) }) : b.max != null ? t('upTo', { b: num(b.max) }) : '';
  const norm = bound(result.norm), limit = bound(result.limit);
  return [
    t('measured', { v: num(value) }) + (unit && !unit.attach ? ` (${word})` : ''),
    norm && t('norm', { r: norm }),
    limit && t('limit', { r: limit }),
  ].filter(Boolean).join(' · ');
}
