// Native skill generation is exercised on temporary projects, never personal skill folders.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { directoryLink, fileLink } from './file-links.mjs';

const tool = path.join(ROOT, 'tools/sync-agents.mjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccf skills '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (rel, data) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), data);
  };
  await put('agents/skills/ccf-demo/SKILL.md', '---\nname: ccf-demo\ndescription: Demo skill\n---\n\nDemo\n');
  const run = mode => spawnSync(process.execPath, [tool, mode, '--root', root], { encoding: 'utf8' });
  return { root, put, run, read: rel => fs.readFile(path.join(root, rel)) };
}

test('sync copies the entire skill and is idempotent with text CRLF and binary bytes', async t => {
  const f = await fixture(t);
  await f.put('agents/skills/ccf-demo/references/help.md', 'Help\r\nMore\r\n');
  const bytes = Buffer.from([0, 13, 10, 255, 72]);
  await f.put('agents/skills/ccf-demo/assets/data.bin', bytes);
  let r = f.run('--write');
  assert.equal(r.status, 0, r.stderr);
  for (const dest of ['.claude', '.agents']) {
    assert.equal((await f.read(`${dest}/skills/ccf-demo/references/help.md`)).toString(), 'Help\nMore\n');
    assert.deepEqual(await f.read(`${dest}/skills/ccf-demo/assets/data.bin`), bytes);
  }
  const manifest = await f.read('agents/manifest.json');
  await f.put('.agents/skills/ccf-demo/references/help.md', 'Help\r\nMore\r\n');
  assert.equal(f.run('--check').status, 0);
  assert.equal(f.run('--write').status, 0);
  assert.deepEqual(await f.read('agents/manifest.json'), manifest);
  assert.equal((await f.read('.agents/skills/ccf-demo/references/help.md')).toString(), 'Help\r\nMore\r\n');
});

test('sync detects stale bodies and auxiliary files and automatically discovers a new skill', async t => {
  const f = await fixture(t);
  assert.equal(f.run('--write').status, 0);
  await f.put('agents/skills/ccf-demo/SKILL.md', '---\nname: ccf-demo\ndescription: Demo skill\n---\nNew\n');
  await f.put('agents/skills/ccf-demo/references/new.txt', 'new\n');
  await f.put('agents/skills/ccf-next/SKILL.md', '---\nname: ccf-next\ndescription: Next\n---\nNext\n');
  const r = f.run('--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ccf-demo\/SKILL.md/);
  assert.match(r.stderr, /references\/new.txt/);
  assert.equal(f.run('--write').status, 0);
  assert.equal(f.run('--check').status, 0);
  assert.match((await f.read('.claude/skills/ccf-next/SKILL.md')).toString(), /name: ccf-next/);
});

test('macOS metadata files do not block sync or become generated skill resources', async t => {
  const f = await fixture(t);
  const metadata = Buffer.from([0, 1, 255, 72]);
  const paths = ['agents/skills/.DS_Store', 'agents/skills/ccf-demo/.DS_Store',
    'agents/skills/ccf-demo/references/.DS_Store'];
  for (const rel of paths) await f.put(rel, metadata);
  const r = f.run('--write');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.run('--check').status, 0);
  for (const rel of paths) assert.deepEqual(await f.read(rel), metadata);
  for (const dest of ['.claude', '.agents']) {
    for (const rel of ['.DS_Store', 'ccf-demo/.DS_Store', 'ccf-demo/references/.DS_Store']) {
      await assert.rejects(f.read(`${dest}/skills/${rel}`), { code: 'ENOENT' });
    }
  }
  const manifest = JSON.parse((await f.read('agents/manifest.json')).toString());
  assert.deepEqual(Object.keys(manifest.files).sort(), [
    '.agents/skills/ccf-demo/SKILL.md', '.claude/skills/ccf-demo/SKILL.md'
  ]);
});

test('metadata handling still refuses foreign root files and metadata directories or directory links', async t => {
  for (const name of ['foreign.txt', '.foreign']) {
    const f = await fixture(t);
    await f.put('agents/skills/' + name, 'foreign\n');
    const r = f.run('--write');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Expected a skill directory/);
    await assert.rejects(f.read('agents/manifest.json'), { code: 'ENOENT' });
  }
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory.root, 'agents/skills/.DS_Store'));
  assert.equal(directory.run('--write').status, 1);
  const link = await fixture(t);
  await directoryLink(path.join(link.root, 'agents/skills/ccf-demo'),
    path.join(link.root, 'agents/skills/.DS_Store'));
  assert.equal(link.run('--write').status, 1);
  const nested = await fixture(t);
  await directoryLink(path.join(nested.root, 'agents/skills/ccf-demo'),
    path.join(nested.root, 'agents/skills/ccf-demo/.DS_Store'));
  const r = nested.run('--write');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Symlink refused/);
});

test('metadata file symlinks are refused instead of ignored as ordinary .DS_Store files', async t => {
  for (const relative of ['agents/skills/.DS_Store', 'agents/skills/ccf-demo/.DS_Store']) {
    await t.test(relative, async t => {
      const f = await fixture(t);
      if (!await fileLink(t, path.join(f.root, 'agents/skills/ccf-demo/SKILL.md'), path.join(f.root, relative))) return;
      assert.equal(f.run('--write').status, 1);
      await assert.rejects(f.read('agents/manifest.json'), { code: 'ENOENT' });
    });
  }
});

test('manual native edits block all mutations and name the editable source', async t => {
  const f = await fixture(t);
  assert.equal(f.run('--write').status, 0);
  const before = await f.read('agents/manifest.json');
  const manual = '---\nname: ccf-demo\ndescription: Demo skill\n---\nManual edit\n';
  await f.put('.agents/skills/ccf-demo/SKILL.md', manual);
  await f.put('agents/skills/ccf-demo/references/help.md', 'new source\n');
  const r = f.run('--write');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agents\/skills\/ccf-demo\/SKILL.md/);
  assert.equal((await f.read('.agents/skills/ccf-demo/SKILL.md')).toString(), manual);
  assert.deepEqual(await f.read('agents/manifest.json'), before);
  await assert.rejects(f.read('.claude/skills/ccf-demo/references/help.md'), { code: 'ENOENT' });
  await f.put('agents/skills/ccf-demo/SKILL.md', manual);
  assert.equal(f.run('--write').status, 0);
  assert.equal(f.run('--check').status, 0);
  assert.equal((await f.read('.claude/skills/ccf-demo/SKILL.md')).toString(), manual);
});

test('removed skills delete only owned files; foreign files and skills survive', async t => {
  const f = await fixture(t);
  assert.equal(f.run('--write').status, 0);
  await f.put('.agents/skills/personal/SKILL.md', 'personal\n');
  await f.put('.claude/skills/ccf-demo/personal.txt', 'keep\n');
  await fs.rm(path.join(f.root, 'agents/skills/ccf-demo'), { recursive: true });
  assert.equal(f.run('--check').status, 1);
  assert.equal(f.run('--write').status, 0);
  await assert.rejects(f.read('.claude/skills/ccf-demo/SKILL.md'), { code: 'ENOENT' });
  assert.equal((await f.read('.claude/skills/ccf-demo/personal.txt')).toString(), 'keep\n');
  assert.equal((await f.read('.agents/skills/personal/SKILL.md')).toString(), 'personal\n');
  assert.equal(f.run('--check').status, 0);
});

test('missing native folders are restored; unowned collisions and symlinks are refused', async t => {
  const f = await fixture(t);
  await f.put('.claude/skills/ccf-demo/SKILL.md', 'foreign\n');
  assert.equal(f.run('--write').status, 1);
  assert.equal((await f.read('.claude/skills/ccf-demo/SKILL.md')).toString(), 'foreign\n');
  await fs.rm(path.join(f.root, '.claude'), { recursive: true });
  assert.equal(f.run('--write').status, 0);
  await fs.rm(path.join(f.root, '.agents'), { recursive: true });
  assert.equal(f.run('--write').status, 0);
  await fs.rm(path.join(f.root, '.agents/skills/ccf-demo'), { recursive: true });
  await directoryLink(path.join(f.root, 'agents/skills/ccf-demo'), path.join(f.root, '.agents/skills/ccf-demo'));
  const r = f.run('--write');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symlink/i);
});

test('a text-to-binary source change accepts unchanged CRLF native text', async t => {
  const f = await fixture(t);
  await f.put('agents/skills/ccf-demo/references/data.txt', 'Before\n');
  assert.equal(f.run('--write').status, 0);
  await f.put('.agents/skills/ccf-demo/references/data.txt', 'Before\r\n');
  const binary = Buffer.from([0, 255, 13, 10]);
  await f.put('agents/skills/ccf-demo/references/data.txt', binary);
  const r = f.run('--write');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await f.read('.agents/skills/ccf-demo/references/data.txt'), binary);
});

test('an unknown first argument is rejected even without --root', () => {
  const r = spawnSync(process.execPath, [tool, '--bogus', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage:/);
});

test('a project without agents/skills yet is consistent once the empty manifest is written', async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.root, 'agents/skills'), { recursive: true });
  assert.equal(f.run('--check').status, 1);
  assert.equal(f.run('--write').status, 0);
  assert.equal(f.run('--check').status, 0);
  assert.deepEqual(JSON.parse((await f.read('agents/manifest.json')).toString()), { version: 1, files: {} });
});
