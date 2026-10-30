// styles/scapes/checks: the command line, the thresholds file and a short control run on reference cards.
// The full control run (160 cards, about a minute) is run by hand: see styles/scapes/checks/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';

const DIR = path.join(ROOT, 'styles/scapes/checks');
const run = (script, args) => spawnSync(process.execPath, [path.join(DIR, script), ...args], { cwd: ROOT, encoding: 'utf8' });
const hasSharp = fs.existsSync(path.join(ROOT, 'node_modules/sharp/package.json'));

test('проверки Scapes: --help печатает справку, неизвестный ключ отклоняется до работы', () => {
  for (const script of ['check-card.mjs', 'adjust-trial.mjs']) {
    const help = run(script, ['--help']);
    assert.equal(help.status, 0, script);
    assert.match(help.stdout, /Usage:/, script);
    const bad = run(script, ['--no-such-option']);
    assert.equal(bad.status, 2, script);
  }
});

test('проверки Scapes: у каждой проверки в thresholds.json есть документ библии и номер', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'thresholds.json'), 'utf8'));
  for (const [id, t] of Object.entries(cfg.checks)) {
    assert.ok(t.doc && t.check != null, id);
    assert.ok(fs.existsSync(path.join(ROOT, 'styles/scapes', t.doc)), `${id}: ${t.doc}`);
  }
  for (const v of cfg.visual) assert.ok(fs.existsSync(path.join(ROOT, 'styles/scapes', v.doc)), v.id);
});

test('проверки Scapes: эталонные карточки с названными исключениями проходят контрольный прогон', { skip: !hasSharp && 'нет node_modules/sharp (сначала npm install)' }, () => {
  // #32 and #55 are named exceptions of COMPOSITION 5, #132 of COMPOSITION 5 and 11, #34 of COMPOSITION 2
  const r = run('check-card.mjs', ['--only', 'ref-001,ref-032,ref-034,ref-055,ref-132', '--quiet', '--no-visual']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /expected: bible names this card as an allowed exception/);
});
