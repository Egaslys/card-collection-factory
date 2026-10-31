// The editor page's two languages (editor/web/i18n.js): lookup with fallback, slots and the word forms of counts; a
// check's measured value in words (editor/web/measure.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fill, lang, plural, setLang, words } from '../editor/web/i18n.js';
import { measureText } from '../editor/web/measure.js';

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

test('i18n: измерение проверки — число на языке страницы с единицей стиля, норма и допуск словами; составное значение не показывается', () => {
  const units = JSON.parse(fs.readFileSync(new URL('../styles/scapes/checks/explain.json', import.meta.url), 'utf8')).units;
  setLang('ru');
  assert.equal(measureText({ value: 0.189, norm: { max: 0.11 }, limit: { max: 0.25 } }, units.share), 'Измерено 18,9 % · норма до 11 % · допустимо до 25 %');
  assert.equal(measureText({ value: 30.6, norm: { min: 33, max: 78 }, limit: { min: 21 } }, units.chroma), `Измерено 30,6 (${units.chroma.ru}) · норма от 33 до 78 · допустимо от 21`);
  assert.equal(measureText({ value: 'dx -20.9, dy 33.1 (floating)' }, units.px), '');
  assert.equal(measureText({ value: null, norm: { min: 1 } }), '');
  setLang('en');
  assert.equal(measureText({ value: -22, norm: null, limit: { min: -17, max: 95 } }, units.px), 'Measured -22 px · allowed -17 px to 95 px');
  assert.equal(measureText({ value: 12.5, limit: { max: 25 } }, units.deg), 'Measured 12.5° · allowed at most 25°');
  setLang('ru');
});
