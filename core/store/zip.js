// A minimal ZIP writer (PKWARE APPNOTE 6.3: local headers, central directory, end record), no dependency.
// Names are stored as UTF-8 (general purpose flag bit 11). Each file is deflated, or stored when deflate does not
// make it smaller (PNG is already compressed). No ZIP64: an archive over 4 GiB or 65 535 files is refused.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { TEMP_SUFFIX } from './files.js';

const UTF8_FLAG = 0x0800;
const STORED = 0, DEFLATED = 8;
const VERSION = 20; // 2.0: deflate
const MADE_BY_UNIX = (3 << 8) | VERSION; // so unzip keeps the permissions in the external attributes
const FILE_MODE = 0o100644;
const LIMIT = 0xffffffff;

/** @param {Date} d */
function dosTime(d) {
  const year = Math.max(d.getFullYear(), 1980);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Writes `file` (through a temporary file, renamed at the end).
 * @param {string} file
 * @param {{name: string, source: string}[]} entries  name inside the archive ("a/b.png", forward slashes); source on disk
 * @param {{date?: Date}} [o]
 */
export function writeZip(file, entries, { date = new Date() } = {}) {
  if (entries.length > 0xffff) throw new Error(`Архив: слишком много файлов (${entries.length}, предел 65 535).`);
  const { time, date: day } = dosTime(date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + TEMP_SUFFIX;
  const fd = fs.openSync(tmp, 'w');
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  try {
    for (const { name, source } of entries) {
      const raw = fs.readFileSync(source);
      const deflated = zlib.deflateRawSync(raw);
      const method = deflated.length < raw.length ? DEFLATED : STORED;
      const body = method === DEFLATED ? deflated : raw;
      const crc = zlib.crc32(raw);
      const nameBytes = Buffer.from(name, 'utf8');
      if (offset + 30 + nameBytes.length + body.length > LIMIT || raw.length > LIMIT) throw new Error('Архив больше 4 ГБ: так не умеем, выгрузите по частям.');

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(VERSION, 4);
      local.writeUInt16LE(UTF8_FLAG, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      local.writeUInt16LE(0, 28);
      fs.writeSync(fd, local);
      fs.writeSync(fd, nameBytes);
      fs.writeSync(fd, body);

      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(MADE_BY_UNIX, 4);
      head.writeUInt16LE(VERSION, 6);
      head.writeUInt16LE(UTF8_FLAG, 8);
      head.writeUInt16LE(method, 10);
      head.writeUInt16LE(time, 12);
      head.writeUInt16LE(day, 14);
      head.writeUInt32LE(crc, 16);
      head.writeUInt32LE(body.length, 20);
      head.writeUInt32LE(raw.length, 24);
      head.writeUInt16LE(nameBytes.length, 28);
      // 30 extra length, 32 comment length, 34 disk number, 36 internal attributes: all 0
      head.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
      head.writeUInt32LE(offset, 42);
      central.push(head, nameBytes);
      offset += 30 + nameBytes.length + body.length;
    }
    const dir = Buffer.concat(central);
    if (offset + dir.length > LIMIT) throw new Error('Архив больше 4 ГБ: так не умеем, выгрузите по частям.');
    fs.writeSync(fd, dir);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(dir.length, 12);
    end.writeUInt32LE(offset, 16);
    fs.writeSync(fd, end);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
