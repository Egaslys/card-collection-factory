// core/text/draft.js: the editor's text help — rough notes into the finished text of a field, with a fake text model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './root.mjs';
import { loadSettings } from '../core/settings.js';
import { presetOf } from '../core/providers/preset.js';
import { draftPrompt, draftText, textModel } from '../core/text/draft.js';

test('помощь с текстом: запрос из настроек — что за текст, его форма, к чему он относится, заметки как есть', () => {
  const help = loadSettings().text.help;
  const p = draftPrompt({ kind: 'wishes', notes: 'без лодок, утро', context: { collection: 'Лето', description: '', card: undefined }, help });
  assert.ok(p.includes(help.kinds.wishes.what) && p.includes(help.kinds.wishes.form));
  assert.ok(p.includes('The collection: «Лето».'));
  assert.ok(!p.includes('What the collection is'), 'пустое — не в запросе');
  assert.ok(p.includes('---\nбез лодок, утро\n---'));
  assert.ok(!/\{(what|form|context|notes)\}/.test(p));
  for (const k of ['collection', 'setTheme', 'wishes', 'cardWish', 'cardsTheme']) assert.ok(help.kinds[k], k);
  assert.throws(() => draftPrompt({ kind: 'poem', notes: 'x', help }), /не знает поля «poem»/);
});

test('помощь с текстом: модель и ключ из настроек, ответ без обёрток, расход записан на коллекцию', async () => {
  const settings = loadSettings();
  const sent = [], spent = [];
  const complete = async req => { sent.push(req); return { text: '```\n«Летняя коллекция о рыбалке на рассвете.»\n```', model: req.model, cost: 0.0012 }; };
  const store = { recordSpend: async (c, e) => { spent.push([c, e]); } };
  const r = await draftText({ kind: 'collection', notes: '  рыбалка, рассвет  ', collectionId: 'leto', settings, apiKey: 'k', complete, store });
  assert.deepEqual(r, { text: 'Летняя коллекция о рыбалке на рассвете.', model: textModel(settings).model, cost: 0.0012 });
  assert.equal(sent[0].model, presetOf(settings.provider).textModel);
  assert.equal(sent[0].apiKey, 'k');
  assert.equal(sent[0].maxTokens, settings.text.help.maxTokens);
  assert.match(sent[0].messages[0].content, /рыбалка, рассвет/);
  assert.deepEqual(spent, [['leto', { kind: 'text', what: 'text-help', model: presetOf(settings.provider).textModel, usd: 0.0012 }]]);
  await assert.rejects(draftText({ kind: 'collection', notes: ' ', settings, apiKey: 'k', complete, store }), /Поле пустое/);
  assert.equal(sent.length, 1, 'пустое поле — без платного вызова');
});
