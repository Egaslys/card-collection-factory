// tools/trash.mjs: which paths may go to the trash. The real move is replaced by a stub:
// a test run must not fill the user's trash.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { allowedRoots, trash } from '../tools/trash.mjs';

const setup = t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf trash '));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), outside = path.join(base, 'outside');
  for (const dir of [root + '/src', root + '/.git', outside]) fs.mkdirSync(dir, { recursive: true });
  for (const file of ['src/a.js', 'src/b.js', '.git/HEAD', '.gitignore']) fs.writeFileSync(path.join(root, file), '');
  fs.writeFileSync(path.join(outside, 'x.txt'), '');
  const moved = [];
  // The stub removes the files, as the trash would: success is judged by what is left on disk.
  const move = paths => { moved.push(...paths); for (const p of paths) fs.rmSync(p, { recursive: true }); return ''; };
  const run = (paths, cwd = root) => trash(paths, { cwd, root, roots: [root], move });
  return { root, outside, moved, run };
};

test('корзина: пути внутри проекта уходят одним вызовом, относительные — от текущей папки', t => {
  const { root, moved, run } = setup(t);
  const r = run(['src/a.js', path.join(root, 'src/b.js'), '.gitignore']);
  assert.equal(r.ok, true, r.lines.join('\n'));
  assert.equal(moved.length, 3);
  assert.ok(r.lines.every(l => l.startsWith('TRASHED: ')));
  assert.equal(fs.existsSync(path.join(root, 'src/a.js')), false);
});

test('корзина: один неверный путь — не трогается ничего', t => {
  const { root, outside, moved, run } = setup(t);
  for (const bad of [path.join(outside, 'x.txt'), 'src/missing.js', 'src/*.js', '.git/HEAD', '.git', root, '../outside/x.txt']) {
    const r = run(['src/a.js', bad]);
    assert.equal(r.ok, false, bad);
    assert.match(r.lines.join('\n'), /REFUSED/, bad);
  }
  assert.deepEqual(moved, []);
  assert.equal(fs.existsSync(path.join(root, 'src/a.js')), true);
});

test('корзина: ссылка уходит сама, а путь через ссылку наружу отклоняется', { skip: process.platform === 'win32' && 'ссылки на Windows требуют прав' }, t => {
  const { root, outside, moved, run } = setup(t);
  fs.symlinkSync(outside, path.join(root, 'link'));
  assert.equal(run(['link/x.txt']).ok, false);
  assert.equal(run(['link']).ok, true);
  assert.deepEqual(moved.map(p => path.basename(p)), ['link']);
  assert.equal(fs.existsSync(path.join(outside, 'x.txt')), true);
});

test('корзина: путь, оставшийся на диске после переноса, — FAILED', t => {
  const { root } = setup(t);
  const r = trash(['src/a.js'], { cwd: root, root, roots: [root], move: () => 'trash: permission denied' });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /^FAILED: /);
  assert.match(r.lines.join('\n'), /permission denied/);
});

test('корзина: разрешены проект и временные папки Claude Code', () => {
  const [project, scratch] = allowedRoots();
  assert.equal(project, ROOT);
  assert.match(scratch, process.platform === 'win32' ? /[\\/]claude$/ : /^\/tmp\/claude-\d+$/);
});

test('корзина: без аргументов — справка и код 2', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/trash.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: node tools\/trash\.mjs/);
});
