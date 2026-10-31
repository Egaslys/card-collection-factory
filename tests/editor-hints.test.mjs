// The editor's hints (editor/web/hints.js): which hint a screen shows in which state, what × and the switch do, and
// the editor server's Codex readiness (editor/server/codex.js) with a fake spawn — no browser, no real Codex.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import './root.mjs';
import { collectionHint, dismissHint, hintDone, hintMemory, restoreHint, setHint, setHintsOn, setupHints } from '../editor/web/hints.js';
import { checkCodex, codexState } from '../editor/server/codex.js';

const fresh = { on: true, dismissed: [], done: [] };
const set = (/** @type {Partial<Parameters<typeof setHint>[0]>} */ f) => ({ places: 10, filled: 10, made: 10, problems: 0, freeCards: 0, ...f });

test('подсказки набора: пустое место и карточки в хранилище — перетащить; после — нажать на карточку; полный без проблем — экспорт; иначе — проверить', () => {
  assert.deepEqual(setHint(set({ filled: 0, made: 0, freeCards: 15 }), fresh), { kind: 'first', id: 'set.drag' });
  assert.equal(setHint(set({ filled: 0, made: 0, freeCards: 0 }), fresh), null, 'пустое окно, хранилище пусто: шага нет');
  // first-use wins over the «next» line, and comes back until done
  assert.deepEqual(setHint(set({ filled: 3, made: 3, freeCards: 2 }), fresh), { kind: 'first', id: 'set.drag' });
  const dragged = { ...fresh, done: ['set.drag'] };
  assert.deepEqual(setHint(set({ filled: 1, made: 1, freeCards: 14 }), dragged), { kind: 'first', id: 'set.place' });
  const both = { ...fresh, done: ['set.drag', 'set.place'] };
  assert.deepEqual(setHint(set({ filled: 1, made: 1, freeCards: 14 }), both), { kind: 'next', id: 'set.check' });
  assert.deepEqual(setHint(set({}), both), { kind: 'next', id: 'set.export' });
  assert.deepEqual(setHint(set({ problems: 1 }), both), { kind: 'next', id: 'set.check' }, 'карточка «Есть проблемы» — ещё не экспорт');
  assert.deepEqual(setHint(set({ made: 9 }), both), { kind: 'next', id: 'set.check' }, 'не все карточки готовы');
  assert.deepEqual(setHint(set({ filled: 9, made: 9 }), both), { kind: 'next', id: 'set.check' }, 'пустое место без карточек в хранилище');
});

test('подсказки: × скрывает одну, без замены другой; выключатель скрывает все, включение возвращает скрытые', () => {
  const m = { ...fresh, done: ['set.drag', 'set.place'], dismissed: ['set.export'] };
  assert.equal(setHint(set({}), m), null);
  assert.deepEqual(setHint(set({ problems: 2 }), m), { kind: 'next', id: 'set.check' });
  // a dismissed first-use hint lets the «next» line show
  assert.deepEqual(setHint(set({ filled: 4, made: 4, freeCards: 3 }), { ...fresh, dismissed: ['set.drag'] }), { kind: 'next', id: 'set.check' });
  const off = { ...fresh, on: false };
  assert.equal(setHint(set({ filled: 0, made: 0, freeCards: 5 }), off), null);
  assert.equal(collectionHint({ sets: 1, generating: false }, off), null);
  assert.deepEqual(setupHints({ key: 'none', codex: 'login' }, off), []);

  setHintsOn(true);
  dismissHint('collection.open');
  assert.deepEqual(hintMemory().dismissed, ['collection.open']);
  assert.equal(collectionHint({ sets: 2, generating: false }), null);
  restoreHint('collection.open');
  assert.deepEqual(collectionHint({ sets: 2, generating: false }), { kind: 'next', id: 'collection.open' });
  dismissHint('collection.open');
  setHintsOn(false);
  assert.equal(hintMemory().on, false);
  assert.deepEqual(hintMemory().dismissed, ['collection.open'], 'выключение не забывает скрытые');
  setHintsOn(true);
  assert.deepEqual(hintMemory().dismissed, [], 'включение возвращает скрытые');
  hintDone('set.drag');
  hintDone('set.drag');
  assert.deepEqual(hintMemory().done, ['set.drag']);
  setHintsOn(true);
  assert.deepEqual(hintMemory().done, ['set.drag'], 'сделанное первое действие не возвращается');
});

test('подсказки коллекции: без наборов — нет (говорит пустое состояние); идёт генерация; иначе — открыть набор', () => {
  assert.equal(collectionHint({ sets: 0, generating: true }, fresh), null);
  assert.deepEqual(collectionHint({ sets: 1, generating: true }, fresh), { kind: 'next', id: 'collection.generating' });
  assert.deepEqual(collectionHint({ sets: 3, generating: false }, fresh), { kind: 'next', id: 'collection.open' });
});

test('первый экран: нет ключа, Codex не готов — по строке; появился ключ, Codex готов или не рисует — пропадает; скрытая не возвращается сама', () => {
  assert.deepEqual(setupHints({ key: 'none', codex: null }, fresh), ['setup.key']);
  assert.deepEqual(setupHints({ key: 'none', codex: 'missing' }, fresh), ['setup.key', 'setup.codex']);
  assert.deepEqual(setupHints({ key: 'temporary', codex: 'login' }, fresh), ['setup.codex']);
  assert.deepEqual(setupHints({ key: 'permanent', codex: 'ready' }, fresh), []);
  assert.deepEqual(setupHints({ key: 'permanent', codex: 'error' }, fresh), ['setup.codex']);
  assert.deepEqual(setupHints({ key: 'none', codex: 'login' }, { ...fresh, dismissed: ['setup.key'] }), ['setup.codex']);
});

/** A fake `codex login status`: exit 0 or 1; a start failure with `error`. */
const fakeCodex = (/** @type {{code?: number, error?: string}} */ o) => {
  const asked = [];
  const spawnImpl = (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
    asked.push([cmd, ...args]);
    const c = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { on() {}, end() {} }, kill() {} });
    setImmediate(() => (o.error ? c.emit('error', Object.assign(new Error(o.error), { code: o.error })) : c.emit('close', o.code ?? 0)));
    return c;
  };
  return { asked, spawnImpl: /** @type {any} */ (spawnImpl) };
};

test('сервер редактора: Codex спрашивается, только когда рисует он; изменение сообщается странице', async () => {
  const provider = { use: 'codex-cli', codexCli: { command: 'codex', timeoutMs: 1000 }, openrouter: { keyEnvVar: 'A' }, google: { keyEnvVar: 'B' } };
  const changes = [];
  const login = fakeCodex({ code: 1 });
  assert.equal(await checkCodex({ provider }, s => changes.push(s), { spawnImpl: login.spawnImpl }), 'login');
  assert.deepEqual(login.asked, [['codex', 'login', 'status']]);
  assert.equal(await checkCodex({ provider }, s => changes.push(s), { spawnImpl: fakeCodex({ code: 1 }).spawnImpl }), 'login');
  assert.equal(await checkCodex({ provider }, s => changes.push(s), { spawnImpl: fakeCodex({ error: 'ENOENT' }).spawnImpl }), 'missing');
  assert.equal(await checkCodex({ provider }, s => changes.push(s), { spawnImpl: fakeCodex({ code: 0 }).spawnImpl }), 'ready');
  const api = fakeCodex({ code: 0 });
  assert.equal(await checkCodex({ provider: { ...provider, use: 'api' } }, s => changes.push(s), { spawnImpl: api.spawnImpl }), null);
  assert.equal(api.asked.length, 0, 'рисует сервис — Codex не спрашивается');
  assert.deepEqual(changes, ['login', 'missing', 'ready', null], 'одинаковый ответ не повторяется');
  assert.equal(codexState(), null);
});
