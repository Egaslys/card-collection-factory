// core/store: export of card images as folders and as ZIP (core/store/zip.js, no dependency). The archive is read
// back by an independent parser here (headers, CRC-32, inflate) and, where the system has it, by `unzip`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { writeZip } from '../core/store/zip.js';
import { tempStore, writeCard } from './store-helpers.mjs';

/** Reads a ZIP through its central directory: [{ name, data, utf8 }], checking each entry's CRC-32. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'есть запись конца архива');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'заголовок оглавления');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(offset), 0x04034b50, 'локальный заголовок');
    assert.equal(buf.readUInt32LE(offset + 14), crc, 'CRC в двух заголовках совпадает');
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size);
    assert.equal(zlib.crc32(data), crc, `CRC-32 «${name}»`);
    out.push({ name, data, utf8: (flags & 0x0800) !== 0 });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const hasUnzip = spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0;

async function collection(t) {
  const { store, root } = tempStore(t);
  const c = (await store.createCollection({ title: 'Летняя рыбалка' })).id;
  const lake = (await store.createSet(c, { title: 'Озеро: утро' })).id;
  const sea = (await store.createSet(c, { title: 'Море' })).id;
  const img = {
    a: writeCard(store, c, 'a', { title: 'Поплавок' }),
    b: writeCard(store, c, 'b', { title: 'Поплавок' }),
    d: writeCard(store, c, 'd', { title: 'Удочка' }),
    loose: writeCard(store, c, 'loose', { title: 'Сачок' }),
  };
  writeCard(store, c, 'none', { image: false });
  await store.setSlots(c, lake, [null, 'b', null, 'a', 'none', null, null, null, null, null]);
  await store.setSlots(c, sea, ['d', ...Array(9).fill(null)]);
  return { store, root, c, lake, sea, img };
}

test('выгрузка PNG: коллекция → наборы по номеру и названию, карточки в порядке слотов, хранилище отдельной папкой, понятные имена', async t => {
  const { store, root, c, img } = await collection(t);
  const r = await store.exportItems({ collectionId: c, format: 'png', name: 'итог' });
  assert.equal(r.path, path.join(root, c, 'export', 'итог'));
  assert.equal(r.files, 4);
  assert.deepEqual(r.skipped, [{ id: 'none', reason: 'нет готовой картинки' }]);
  const files = fs.readdirSync(r.path, { recursive: true }).map(String).filter(f => f.endsWith('.png')).sort();
  assert.deepEqual(files, [
    path.join('Летняя рыбалка', '01 Озеро утро', '02 Поплавок.png'),
    path.join('Летняя рыбалка', '01 Озеро утро', '04 Поплавок.png'),
    path.join('Летняя рыбалка', '02 Море', '01 Удочка.png'),
    path.join('Летняя рыбалка', 'Хранилище', 'Сачок.png'),
  ]);
  assert.deepEqual(fs.readFileSync(path.join(r.path, 'Летняя рыбалка', 'Хранилище', 'Сачок.png')), img.loose);
  assert.deepEqual(fs.readFileSync(path.join(r.path, files[1])), img.a);

  const again = await store.exportItems({ collectionId: c, name: 'итог' });
  assert.equal(path.basename(again.path), 'итог (2)', 'прежняя выгрузка не перезаписана');
});

test('выгрузка: по набору, по выбранным карточкам (папка «Карточки»), повторы имён различаются', async t => {
  const { store, c, sea, img } = await collection(t);
  const r = await store.exportItems({ collectionId: c, setIds: [sea], cardIds: ['a', 'b', 'loose'] });
  assert.match(path.basename(r.path), /^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d$/, 'имя по времени');
  const files = fs.readdirSync(r.path, { recursive: true }).map(String).filter(f => f.endsWith('.png')).sort();
  assert.deepEqual(files, [
    path.join('Летняя рыбалка', '02 Море', '01 Удочка.png'),
    path.join('Летняя рыбалка', 'Карточки', 'Поплавок (2).png'),
    path.join('Летняя рыбалка', 'Карточки', 'Поплавок.png'),
    path.join('Летняя рыбалка', 'Карточки', 'Сачок.png'),
  ]);
  assert.deepEqual(fs.readFileSync(path.join(r.path, 'Летняя рыбалка', 'Карточки', 'Сачок.png')), img.loose);
  await assert.rejects(store.exportItems({ collectionId: c, cardIds: ['none'] }), /Выгружать нечего/);
  await assert.rejects(store.exportItems({ collectionId: c, cardIds: ['zz'] }), /Карточки «zz»/);
  await assert.rejects(store.exportItems({ collectionId: c, format: 'tar' }), /Формат выгрузки/);
});

test('выгрузка хранилища: наборы и хранилище, как экспорт коллекции в редакторе; коллекция только из свободных карточек', async t => {
  const { store, c, lake } = await collection(t);
  const r = await store.exportItems({ collectionId: c, setIds: [lake], pool: true });
  const files = fs.readdirSync(r.path, { recursive: true }).map(String).filter(f => f.endsWith('.png')).sort();
  assert.deepEqual(files, [
    path.join('Летняя рыбалка', '01 Озеро утро', '02 Поплавок.png'),
    path.join('Летняя рыбалка', '01 Озеро утро', '04 Поплавок.png'),
    path.join('Летняя рыбалка', 'Хранилище', 'Сачок.png'),
  ], 'набор «Море» не выбран — его нет; хранилище есть');
  const setOnly = await store.exportItems({ collectionId: c, setIds: [lake] });
  assert.equal(setOnly.files, 2, 'набор без pool — только набор');

  // «20 cards about X»: cards made into the pool, no set at all
  const only = (await store.createCollection({ title: 'Свободные' })).id;
  const one = writeCard(store, only, 'x', { title: 'Лодка' });
  writeCard(store, only, 'y', { image: false });
  for (const args of [{}, { setIds: [], pool: true }]) {
    const e = await store.exportItems({ collectionId: only, ...args });
    assert.equal(e.files, 1);
    assert.deepEqual(e.skipped, [{ id: 'y', reason: 'нет готовой картинки' }]);
    assert.deepEqual(fs.readFileSync(path.join(e.path, 'Свободные', 'Хранилище', 'Лодка.png')), one);
  }
});

test('выгрузка ZIP: тот же порядок папок, имена в UTF-8, содержимое и CRC сходятся', async t => {
  const { store, root, c, img } = await collection(t);
  const r = await store.exportItems({ collectionId: c, format: 'zip', name: 'архив' });
  assert.equal(r.path, path.join(root, c, 'export', 'архив.zip'));
  const entries = readZip(r.path);
  assert.deepEqual(entries.map(e => e.name), [
    'Летняя рыбалка/01 Озеро утро/02 Поплавок.png',
    'Летняя рыбалка/01 Озеро утро/04 Поплавок.png',
    'Летняя рыбалка/02 Море/01 Удочка.png',
    'Летняя рыбалка/Хранилище/Сачок.png',
  ]);
  assert.ok(entries.every(e => e.utf8));
  assert.deepEqual(entries.map(e => e.data), [img.b, img.a, img.d, img.loose]);
  assert.ok(!fs.readdirSync(path.dirname(r.path)).some(f => f.endsWith('.tmp')));
  const second = await store.exportItems({ collectionId: c, format: 'zip', name: 'архив' });
  assert.equal(path.basename(second.path), 'архив (2).zip');
});

test('ZIP: несжимаемое хранится как есть, сжимаемое — deflate; системный unzip читает архив', { skip: !hasUnzip && 'нет unzip' }, t => {
  const { root } = tempStore(t);
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  const random = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + (i >> 3) * 104729) % 251));
  fs.writeFileSync(path.join(src, 'random.bin'), zlib.deflateRawSync(random, { level: 9 }));
  fs.writeFileSync(path.join(src, 'text.txt'), 'карточка '.repeat(500));
  fs.writeFileSync(path.join(src, 'empty'), '');
  const file = path.join(root, 'out.zip');
  writeZip(file, [
    { name: 'a/сжатое.bin', source: path.join(src, 'random.bin') },
    { name: 'a/текст.txt', source: path.join(src, 'text.txt') },
    { name: 'пусто', source: path.join(src, 'empty') },
  ]);
  const entries = readZip(file);
  assert.deepEqual(entries.map(e => e.data), ['random.bin', 'text.txt', 'empty'].map(f => fs.readFileSync(path.join(src, f))));
  const methods = (() => {
    const buf = fs.readFileSync(file);
    const out = [];
    for (let p = 0; buf.readUInt32LE(p) === 0x04034b50; p += 30 + buf.readUInt16LE(p + 26) + buf.readUInt32LE(p + 18)) out.push(buf.readUInt16LE(p + 8));
    return out;
  })();
  assert.deepEqual(methods, [0, 8, 0], 'сжатые данные хранятся, текст — deflate, пустой файл — как есть');

  const test = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
  assert.equal(test.status, 0, test.stdout + test.stderr);
  const out = path.join(root, 'unpacked');
  const unpack = spawnSync('unzip', ['-q', file, '-d', out], { encoding: 'utf8' });
  assert.equal(unpack.status, 0, unpack.stderr);
  assert.equal(fs.readFileSync(path.join(out, 'a', 'текст.txt'), 'utf8'), 'карточка '.repeat(500));
  assert.deepEqual(fs.readFileSync(path.join(out, 'a', 'сжатое.bin')), fs.readFileSync(path.join(src, 'random.bin')));
});
