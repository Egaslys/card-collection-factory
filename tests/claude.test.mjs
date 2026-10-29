// Shared instructions, project skills and the shared Claude Code settings (status line, hooks).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './root.mjs';

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SKILLS = fs.existsSync(path.join(ROOT, 'agents/skills'))
  ? fs.readdirSync(path.join(ROOT, 'agents/skills'), { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => `agents/skills/${e.name}/SKILL.md`)
  : [];

test('скилл: front matter (name = папка, description), путь в таблице AGENTS.md', () => {
  const agentsMd = read('AGENTS.md');
  for (const rel of SKILLS) {
    const head = read(rel).match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(head, rel + ': нет front matter');
    assert.match(head[1], new RegExp('^name: ' + rel.split('/')[2] + '$', 'm'), rel);
    assert.match(head[1], /^description: \S/m, rel);
    assert.ok(agentsMd.includes('`' + rel + '`'), 'AGENTS.md не ведёт к ' + rel);
  }
});

test('скиллы написаны на английском', () => {
  for (const rel of SKILLS) {
    const line = read(rel).split('\n').findIndex(s => /\p{Script=Cyrillic}/u.test(s));
    assert.equal(line, -1, rel + ':' + (line + 1) + ' — кириллица');
  }
});

test('документация ведёт к существующим исходникам скиллов', () => {
  for (const rel of ['AGENTS.md', 'README.md', 'MAP.md', 'agents/README.md', ...SKILLS]) {
    const text = read(rel);
    for (const [ref] of text.matchAll(/agents\/skills\/ccf-[\w-]+\/SKILL\.md/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, ref)), rel + ': нет ' + ref);
    }
  }
});

test('.claude/settings.json: статуслайн и хуки ссылаются на существующие файлы проекта', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  const scripts = [settings.statusLine.command.match(/\.claude\/[\w./-]+/)[0]];
  for (const groups of Object.values(settings.hooks)) {
    for (const hook of groups.flatMap(g => g.hooks)) {
      scripts.push((hook.args ? hook.args[0] : hook.command).match(/\.claude\/[\w./-]+/)[0]);
    }
  }
  assert.ok(scripts.length >= 5);
  for (const rel of scripts) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
});

test('.claude/settings.json: хук передачи после сжатия и при возобновлении читает файл, который называет AGENTS.md', () => {
  const groups = JSON.parse(read('.claude/settings.json')).hooks.SessionStart;
  const hook = groups.flatMap(g => g.hooks).find(h => h.args?.[0].endsWith('/.claude/hooks/handoff.mjs'));
  assert.ok(hook, 'нет хука handoff.mjs');
  assert.equal(groups.find(g => g.hooks.includes(hook)).matcher, 'compact|resume');
  assert.equal(hook.args.length, 2);
  assert.ok(read('AGENTS.md').includes('The handoff `' + hook.args[1] + '`'), 'AGENTS.md называет другой файл передачи');
});

test('Claude Code читает AGENTS.md сам: в корне нет CLAUDE.md, который занял бы его место', () => {
  for (const rel of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) assert.ok(!fs.existsSync(path.join(ROOT, rel)), rel);
});

test('.claude/settings.json: память агента выключена, субагент не запускает своих субагентов', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  assert.equal(settings.autoMemoryEnabled, false);
  assert.equal(settings.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '1');
});
