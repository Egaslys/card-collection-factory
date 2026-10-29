import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';

test('doctor accepts shared settings without MCP and gives actionable failures without writing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccf doctor '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await put('AGENTS.md', '`agents/skills/ccf-demo/SKILL.md`');
  await put('agents/skills/ccf-demo/SKILL.md', '---\nname: ccf-demo\ndescription: Demo\n---\nDemo\n');
  await put('.codex/config.toml', '# shared\nproject_doc_max_bytes = 131072\n');
  assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'tools/sync-agents.mjs'), '--write', '--root', root]).status, 0);
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'tools/agent-doctor.mjs'), '--root', root], { encoding: 'utf8' });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MCP.*optional/i);
  await put('.codex/config.toml', '[profile]\nproject_doc_max_bytes = 131072\n');
  await put('CLAUDE.md', '@AGENTS.md\n');
  await put('agents/skills/ccf-demo/SKILL.md', '---\nname: ccf-demo\ndescription: Demo\n---\nChanged\n');
  const manifest = await fs.readFile(path.join(root, 'agents/manifest.json'));
  r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /project_doc_max_bytes = 131072/);
  assert.match(r.stderr, /Remove CLAUDE\.md/);
  assert.match(r.stderr, /sync-agents.mjs --write/);
  assert.deepEqual(await fs.readFile(path.join(root, 'agents/manifest.json')), manifest);
});

test('doctor names missing command-line tools as warnings and still passes', async t => {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'ccf empty path '));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/agent-doctor.mjs')], { encoding: 'utf8', env: { ...env, PATH: bin } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Missing command-line tools .*: rg, fd, ast-grep, jq, yq\./);
  if (process.platform === 'linux') assert.match(r.stdout, /gio is missing.*libglib2\.0-bin/);
});
