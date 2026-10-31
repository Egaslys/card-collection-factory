// What a person reads from core and the server, as data (core/say.js): the codes core gives its errors, warnings
// and journal lines, how the editor's jobs keep them (editor/server/jobs.js), and how the page words them in its
// language (editor/web/said.js). No network, no real key, no Codex.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { said, saidError, saidOf, saidOfText, textSaid } from '../core/say.js';
import { generateImage } from '../core/providers/openrouter.js';
import { failureOf } from '../core/providers/codex-cli.js';
import { keyProblemOf } from '../core/card/make.js';
import { keyStopText, stepText } from '../core/set/make.js';
import { createJobs } from '../editor/server/jobs.js';
import { setLang } from '../editor/web/i18n.js';
import { logText, saidText } from '../editor/web/said.js';

const reply = (status, body) => ({ ok: status < 400, status, headers: new Headers(), text: async () => JSON.stringify(body) });
const base = { endpoint: 'https://example.test/api/v1', apiKey: 'sk-test-secret-123', model: 'm', prompt: 'p' };

test('коды: ошибка несёт русский текст и код с параметрами; предупреждение остаётся строкой, а его код помнится по тексту', () => {
  const e = saidError('Пожелание пустое: напишите, что изменить.', 'wish.empty');
  assert.equal(e.message, 'Пожелание пустое: напишите, что изменить.');
  assert.deepEqual(saidOf(e), { code: 'wish.empty' });
  assert.equal(saidOf(new Error('x')), null);
  const w = textSaid('Смотрящая модель не выбрала версию: таймаут', 'pick.failed', { reason: 'таймаут' });
  assert.equal(w, 'Смотрящая модель не выбрала версию: таймаут');
  assert.deepEqual(saidOfText(w), said('pick.failed', { reason: 'таймаут' }));
  assert.equal(saidOfText('чужой текст'), null);
});

test('коды: отказ сервиса — provider.http с ответом сервиса, ключ — key.auth / key.billing; таймаут; Codex — вход и лимит', async () => {
  const fetchImpl = async () => reply(401, { error: { message: 'No auth credentials found' } });
  const e = await generateImage({ ...base, net: { fetchImpl, retries: 0 } }).catch(x => x);
  assert.deepEqual(e.said, { code: 'provider.http', params: { status: 401, reply: 'No auth credentials found' } });
  const k = keyProblemOf(e);
  assert.deepEqual(k?.said, { code: 'key.auth', params: { reply: 'No auth credentials found' } });
  assert.match(k?.message ?? '', /^С ключом проблема/, 'русский текст для агентов и терминала прежний');
  // the run's closing line: the same code, with «what is made is saved»
  assert.deepEqual(saidOfText(keyStopText(/** @type {any} */ (k))), { code: 'key.auth', params: { reply: 'No auth credentials found', saved: true } });
  const pay = await generateImage({ ...base, net: { fetchImpl: async () => reply(402, { error: { message: 'Insufficient credits' } }), retries: 0 } }).catch(x => x);
  assert.equal(keyProblemOf(pay)?.said?.code, 'key.billing');
  const slow = await generateImage({ ...base, net: { fetchImpl: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, timeoutMs: 5000 } }).catch(x => x);
  assert.deepEqual(slow.said, { code: 'provider.timeout', params: { seconds: 5 } });
  assert.deepEqual(failureOf('You have hit your usage limit, try again at 5:04 PM.')?.said, { code: 'codex.limit', params: { when: 'try again at 5:04 PM' } });
  assert.deepEqual(failureOf('401 Unauthorized')?.said, { code: 'codex.login' });
  assert.equal(failureOf('something else'), null);
});

test('журнал: попытка — номер в этом запуске, не номер версии', () => {
  assert.equal(stepText({ stage: 'generate', n: 4, done: 0, of: 1 }), 'попытка 1 из 1: генерация');
  assert.equal(stepText({ stage: 'process', n: 5, done: 1, of: 3 }), 'попытка 2 из 3: обработка и проверки');
  assert.equal(stepText({ stage: 'done', n: null, done: 3, of: 3 }), 'попыток сделано 3 из 3');
});

test('задачи: строки журнала карточек, плана и заметок — данными; предупреждения и ошибка — с кодами', async () => {
  const jobs = createJobs(() => {});
  const warning = textSaid('Пропущен набор «Море» (№3): нет плана', 'set.skipped', { title: 'Море', number: 3, why: 'noPlan' });
  const job = jobs.start({
    op: 'buildSet', title: 'Набор', run: async ({ progress }) => {
      progress('план набора «Море»', { title: 'Море', status: 'planning' });
      progress('«Море»: план сохранён (more)', { title: 'Море', status: 'planned', errors: 0, set: 'more' });
      progress('План готов — делаю карточки', { total: 0.01, say: { k: 'note', code: 'planDone' } });
      progress('слот 1: «Волна» — готово (блокирующих FAIL 0), $0.0400', { set: 'more', slot: 1, cardId: 'v', title: 'Волна', status: 'made', spent: 0.04, image: true, stop: 'ok', blocking: 0 });
      progress('слот 2: «Риф» — пропущена: потолок расходов набора', { set: 'more', slot: 2, cardId: null, title: 'Риф', status: 'skipped', spent: 0, why: 'cap' });
      progress(warning);
      progress('строка без данных');
      return { warnings: [warning, 'самопроверка плана не дала читаемого ответа'] };
    },
  });
  await jobs.wait(job.id);
  assert.deepEqual(job.log.map(l => l.say), [
    { k: 'plan', status: 'planning', title: 'Море' },
    { k: 'plan', status: 'planned', title: 'Море', errors: 0, set: 'more' },
    { k: 'note', code: 'planDone' },
    { k: 'card', status: 'made', title: 'Волна', slot: 1, image: true, stop: 'ok', blocking: 0, spent: 0.04 },
    { k: 'card', status: 'skipped', title: 'Риф', slot: 2, why: 'cap' },
    { k: 'said', code: 'set.skipped', params: { title: 'Море', number: 3, why: 'noPlan' } },
    undefined,
  ]);
  assert.deepEqual(job.warningSaid, [{ code: 'set.skipped', params: { title: 'Море', number: 3, why: 'noPlan' } }, null]);
  const failed = jobs.start({ op: 'buildSet', title: 'Набор', run: async () => { throw saidError('План не получился: нет карточек', 'plan.failed', { reasons: 'нет карточек' }); } });
  await jobs.wait(failed.id);
  assert.equal(failed.error, 'План не получился: нет карточек');
  assert.deepEqual(failed.errorSaid, { code: 'plan.failed', params: { reasons: 'нет карточек' } });
  assert.throws(() => jobs.cancel('нет-такой'), e => saidOf(e)?.code === 'job.notFound');
});

test('страница: по-английски — слова кода с ответом сервиса как есть; по-русски и для незнакомого кода — текст core', () => {
  const k = { code: 'key.auth', params: { reply: 'No auth credentials found', saved: true } };
  setLang('en');
  try {
    assert.equal(saidText(k, 'С ключом проблема…'), 'Problem with the key: the service did not accept it (wrong, revoked or without access). The service replied: No auth credentials found Replace the key and run again. What is made is saved.');
    assert.equal(saidText({ code: 'plan.cap', params: { spent: 0.5, cap: 0.5 } }, 'x'), 'Planning stopped: $0.5 spent of the $0.5 cap (settings set.plan.maxSpendUsd).');
    assert.equal(saidText({ code: 'unknown.code' }, 'Русский текст'), 'Русский текст');
    assert.equal(saidText(null, 'Русский текст'), 'Русский текст');
    assert.equal(saidText({ code: 'plan.interrupted', params: { reason: 'Планирование остановлено по просьбе', reasonCode: 'plan.cancelled' } }, 'x'), 'Planning was cut short: Planning stopped on request: no new model calls.');
    assert.equal(logText({ text: 'слот 1: «Волна» — готово', say: { k: 'card', status: 'made', title: 'Волна', slot: 1, image: true, blocking: 0, spent: 0.04 } }), 'slot 1: “Волна” — done (blocking FAILs: 0), $0.0400');
    assert.equal(logText({ text: 'слот 2: «Риф» — попытка 2 из 3: генерация', say: { k: 'attempt', stage: 'generate', n: 7, done: 1, of: 3, title: 'Риф', slot: 2 } }), 'slot 2: “Риф” — attempt 2 of 3: drawing');
    assert.equal(logText({ text: 'ошибка', say: { k: 'card', status: 'failed', title: 'Риф', error: 'Провайдер вернул HTTP 500 (/x): oops', errorSaid: { code: 'provider.http', params: { status: 500, reply: 'oops' } } } }), '“Риф” — error: The service answered HTTP 500: oops');
    assert.equal(logText({ text: 'строка без данных' }), 'строка без данных');
    setLang('ru');
    assert.equal(saidText(k, 'С ключом проблема…'), 'С ключом проблема…');
    assert.equal(logText({ text: 'слот 1: «Волна» — готово', say: { k: 'card', status: 'made', title: 'Волна' } }), 'слот 1: «Волна» — готово');
  } finally { setLang('ru'); }
});
