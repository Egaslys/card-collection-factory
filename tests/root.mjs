// The project root for tests: the folder above tests/.
import path from 'node:path';
import url from 'node:url';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

// Tests never read the person's settings/local.json (ignored by Git, written by the editor's settings screen): core/settings.js
// reads CCF_SETTINGS_DIR when it is set, here a copy of defaults.json alone. Child processes (ccf.mjs) inherit it.
// The copy names a key variable nobody sets, and CCF_EDITOR_FILE points at no editor: a command a test runs never
// finds the person's key (.env) or their running editor, so it never makes a paid call.
import fs from 'node:fs';
import os from 'node:os';
if (!process.env.CCF_SETTINGS_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-settings-'));
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/defaults.json'), 'utf8'));
  defaults.provider.openrouter.keyEnvVar = 'CCF_TEST_NO_KEY';
  fs.writeFileSync(path.join(dir, 'defaults.json'), JSON.stringify(defaults, null, 2));
  process.env.CCF_SETTINGS_DIR = dir;
  process.env.CCF_EDITOR_FILE ??= path.join(dir, 'no-editor.json');
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}
