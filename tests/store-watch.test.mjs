// core/store: live events (watch) — through fs.watch and through the polling fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { tempStore, writeCard } from './store-helpers.mjs';

/** Starts a watcher; `until(pred)` waits for an event matching it (or fails after a timeout). */
function listen(t, store, options) {
  const events = [];
  const stop = store.watch(e => events.push(e), options);
  t.after(stop);
  const key = e => `${e.type}:${e.collectionId}/${e.id}:${e.change}`;
  async function until(wanted, ms = 5000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (wanted.every(w => events.some(e => key(e) === w))) return;
      await sleep(25);
    }
    assert.fail(`не дождались ${wanted.filter(w => !events.some(e => key(e) === w)).join(', ')}; были: ${events.map(key).join(', ')}`);
  }
  return { events, until, key };
}

for (const [mode, options] of [['fs.watch', { debounceMs: 50 }], ['опрос', { poll: true, pollMs: 50 }]]) {
  test(`живые события (${mode}): коллекция, набор, карточка — создана, изменена, удалена`, async t => {
    const { store } = tempStore(t);
    const { events, until, key } = listen(t, store, options);
    await sleep(100); // let the watcher settle

    const c = (await store.createCollection({ title: 'C' })).id;
    await until([`collection:${c}/${c}:created`]);
    const s = (await store.createSet(c, { title: 'S' })).id;
    await until([`set:${c}/${s}:created`, `collection:${c}/${c}:updated`]);

    const k = store.newCardId(c, 'Поплавок');
    await until([`card:${c}/${k}:created`]);
    await sleep(60);
    writeCard(store, c, k);
    await until([`card:${c}/${k}:updated`]);

    events.length = 0;
    await store.setSlots(c, s, [k, ...Array(9).fill(null)]);
    await until([`set:${c}/${s}:updated`]);
    await sleep(200);
    assert.deepEqual(events.map(key), [`set:${c}/${s}:updated`], 'одна запись — одно событие, карточка не тронута');

    await store.deleteCard(c, k);
    await until([`card:${c}/${k}:deleted`]);
    await store.deleteCollection(c);
    await until([`collection:${c}/${c}:deleted`, `set:${c}/${s}:deleted`]);
  });
}

test('живые события: пачка записей даёт одно событие на сущность; служебные файлы карточки событий не дают', async t => {
  const { store } = tempStore(t);
  const c = (await store.createCollection({ title: 'C' })).id;
  const k = store.newCardId(c, 'k');
  const { events, until, key } = listen(t, store, { debounceMs: 100 });
  await sleep(100);
  const attempt = path.join(store.cardDir(c, k), 'attempts', '1');
  fs.mkdirSync(attempt, { recursive: true });
  fs.writeFileSync(path.join(attempt, 'prepared.png'), 'x');
  await sleep(300);
  assert.deepEqual(events, [], 'попытка без card.json и card.png — не событие');
  for (let i = 0; i < 5; i++) writeCard(store, c, k, { title: `t${i}` });
  await until([`card:${c}/${k}:updated`]);
  await sleep(300);
  assert.equal(events.length, 1, events.map(key).join(', '));
});
