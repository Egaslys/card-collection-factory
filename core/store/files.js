// Reading and writing the store's files. Every write goes to a temporary file next to the target and is renamed over
// it, so a reader (the editor's live view, another process) sees the old file or the new one, never half of one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Temporary files of atomic writes end with this; the watcher ignores them. */
export const TEMP_SUFFIX = '.tmp';

/** @param {string} file @returns {any} */
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** @param {string} file @param {string|Uint8Array} bytes */
export function writeFileAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}${TEMP_SUFFIX}`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** @param {string} file @param {unknown} data */
export const writeJsonAtomic = (file, data) => writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');

/** @param {string} p */
export const exists = p => fs.existsSync(p);

/** Sub-folder names of a folder; none when it does not exist. @param {string} dir @returns {string[]} */
export function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return [];
    throw e;
  }
}
