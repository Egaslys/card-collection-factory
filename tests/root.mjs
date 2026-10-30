// The project root for tests: the folder above tests/.
import path from 'node:path';
import url from 'node:url';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// Tests never read the person's settings/local.json (ignored by Git, written by the editor's settings screen): core/settings.js
// reads CCF_SETTINGS_DIR when it is set, here a copy of defaults.json alone. Child processes (ccf.mjs) inherit it.
import fs from 'node:fs';
import os from 'node:os';
if (!process.env.CCF_SETTINGS_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-settings-'));
  fs.copyFileSync(path.join(ROOT, 'settings/defaults.json'), path.join(dir, 'defaults.json'));
  process.env.CCF_SETTINGS_DIR = dir;
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}
