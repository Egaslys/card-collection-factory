// Keep real directory-link coverage on Windows without symbolic-link privileges.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function directoryLink(target, link) {
  await fs.symlink(path.resolve(target), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
}

export async function fileLink(t, target, link) {
  try { await fs.symlink(target, link, 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip('File symbolic links are unavailable in this Windows process: ' + error.code);
    return false;
  }
  assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  return true;
}
