// The editor page's two languages (editor/web/i18n.js): lookup with fallback, slots and the word forms of counts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fill, lang, plural, setLang, words } from '../editor/web/i18n.js';

test('i18n: слова на языке страницы, пропуск — по-русски, потом сам ключ; подстановки и формы чисел', () => {
  const t = words({ ru: { hi: 'Привет, {name}', only: 'Только русский' }, en: { hi: 'Hello, {name}' } });
  setLang('ru');
  assert.equal(lang(), 'ru');
  assert.equal(t('hi', { name: 'Аня' }), 'Привет, Аня');
  const forms = /** @type {const} */ ({ ru: ['карточка', 'карточки', 'карточек'], en: ['card', 'cards'] });
  assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(n => plural(n, { ru: [...forms.ru], en: [...forms.en] })), ['карточка', 'карточки', 'карточек', 'карточек', 'карточка', 'карточки', 'карточек']);
  setLang('en');
  assert.equal(t('hi', { name: 'Ann' }), 'Hello, Ann');
  assert.equal(t('only'), 'Только русский');
  assert.equal(t(/** @type {any} */ ('missing')), 'missing');
  assert.deepEqual([1, 2].map(n => plural(n, { ru: [...forms.ru], en: [...forms.en] })), ['card', 'cards']);
  assert.equal(fill('{a} и {b}', { a: 1 }), '1 и {b}');
});
