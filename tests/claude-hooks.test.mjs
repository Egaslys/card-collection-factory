// Claude Code project settings: status line, helper journals, regex guard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ROOT } from './root.mjs';
import { formatStatus, parseBranch } from '../.claude/statusline.mjs';
import { agentRun, lastReport } from '../.claude/hooks/agent-run.mjs';
import { REPORT_MARK, RUNS_REL } from '../.claude/hooks/shared.mjs';
import { handoffContext } from '../.claude/hooks/handoff.mjs';

const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const tempRoot = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf hooks '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const run = (script, input, root) => spawnSync(process.execPath, [path.join(ROOT, script)], {
  input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root },
});

test('статуслайн: контекст, лимит за 5 часов, модель, ветка со звёздочкой', () => {
  const data = { model: { display_name: 'Opus' }, context_window: { used_percentage: 23.7 }, rate_limits: { five_hour: { used_percentage: 41.2 } } };
  assert.equal(plain(formatStatus(data, { branch: 'main', dirty: true })), 'Context Used: 23% · 5h Limit Used: 41% · Opus · main*');
  assert.equal(plain(formatStatus(data, { branch: 'main', dirty: false })), 'Context Used: 23% · 5h Limit Used: 41% · Opus · main');
  // Without a repository, a limit or a model the segments drop or fall back.
  assert.equal(plain(formatStatus({}, null)), 'Context Used: 0% · ?');
});

test('статуслайн: цвет контекста — жёлтый с 35 %, красный с 50 %', () => {
  const at = pct => formatStatus({ context_window: { used_percentage: pct } }, null);
  assert.ok(at(34).startsWith('\x1b[2m'));
  assert.ok(at(35).startsWith('\x1b[33m'));
  assert.ok(at(49.9).startsWith('\x1b[33m'));
  assert.ok(at(50).startsWith('\x1b[31m'));
});

test('статуслайн: без готовой доли она считается по входным токенам', () => {
  const data = { context_window: { used_percentage: null, total_input_tokens: 50000, total_output_tokens: 90000, context_window_size: 200000 } };
  assert.match(plain(formatStatus(data, null)), /^Context Used: 25% /);
});

test('статуслайн: имя ветки из git status --porcelain --branch', () => {
  assert.equal(parseBranch('## feature/2d-engine...origin/feature/2d-engine [ahead 1]'), 'feature/2d-engine');
  assert.equal(parseBranch('## main'), 'main');
  assert.equal(parseBranch('## No commits yet on main'), 'main');
  assert.equal(parseBranch('## HEAD (no branch)'), 'HEAD');
});

test('статуслайн: скрипт читает JSON со stdin и печатает строку', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, '.claude/statusline.mjs')], {
    input: JSON.stringify({ model: { display_name: 'Opus' }, context_window: { used_percentage: 8 }, workspace: { current_dir: os.tmpdir() } }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(plain(r.stdout), 'Context Used: 8% · Opus');
});

test('журнал помощника: старт создаёт файл и передаёт путь, повторный старт берёт тот же', t => {
  const root = tempRoot(t);
  const input = { hook_event_name: 'SubagentStart', agent_id: 'a1b2', agent_type: 'general-purpose' };
  const out = JSON.parse(agentRun(root, input, new Date(2026, 9, 9, 14, 5, 7)));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SubagentStart');
  const journals = () => fs.readdirSync(path.join(root, RUNS_REL)).filter(name => name.endsWith('.md'));
  const files = journals();
  assert.deepEqual(files, ['2026-10-09_140507_general-purpose_a1b2.md']);
  assert.ok(out.hookSpecificOutput.additionalContext.includes(RUNS_REL + '/' + files[0]));
  agentRun(root, input, new Date(2026, 9, 9, 15, 0, 0));
  assert.deepEqual(journals(), files);
});

test('журнал помощника: остановка дописывает последнее сообщение и путь транскрипта', t => {
  const root = tempRoot(t);
  agentRun(root, { hook_event_name: 'SubagentStart', agent_id: 'x9', agent_type: 'Explore' });
  assert.equal(agentRun(root, { hook_event_name: 'SubagentStop', agent_id: 'x9', agent_type: 'Explore',
    last_assistant_message: 'Готово: найдено 3 места.', agent_transcript_path: '/tmp/t.jsonl' }), '');
  const [name] = fs.readdirSync(path.join(root, RUNS_REL));
  const text = fs.readFileSync(path.join(root, RUNS_REL, name), 'utf8');
  assert.match(text, new RegExp('^' + REPORT_MARK + ' — ', 'm'));
  assert.match(text, /^Transcript: \/tmp\/t\.jsonl$/m);
  assert.match(text, /Готово: найдено 3 места\./);
});

test('журнал помощника: без last_assistant_message отчёт берётся из транскрипта', t => {
  const root = tempRoot(t);
  const entry = (type, content) => JSON.stringify({ type, message: { role: type, content } });
  const transcript = (...entries) => { put(root, 't.jsonl', entries.join('\n') + '\n'); return path.join(root, 't.jsonl'); };
  const handback = { type: 'tool_use', name: 'SubagentHandback', input: { message: 'Отчёт: всё сделано.' } };
  const edit = { type: 'tool_use', name: 'Edit', input: {} };
  // The report is the message of the SubagentHandback call, even after an earlier text reply.
  assert.equal(lastReport(transcript(entry('assistant', [{ type: 'text', text: 'Читаю файл.' }]), entry('assistant', [handback]),
    entry('user', [{ type: 'tool_result' }]))), 'Отчёт: всё сделано.');
  assert.equal(lastReport(transcript(entry('assistant', [edit]), entry('assistant', [{ type: 'text', text: 'Итог.' }]))), 'Итог.');
  // Cut off mid-work: the last assistant entry is another tool call, so there is no report.
  assert.equal(lastReport(transcript(entry('assistant', [{ type: 'text', text: 'Начинаю.' }]), entry('assistant', [edit]))), '');
  assert.equal(lastReport(path.join(root, 'missing.jsonl')), '');

  const file = transcript(entry('assistant', [handback]));
  agentRun(root, { hook_event_name: 'SubagentStop', agent_id: 'r1', agent_type: 'Plan', agent_transcript_path: file });
  const [name] = fs.readdirSync(path.join(root, RUNS_REL));
  assert.match(fs.readFileSync(path.join(root, RUNS_REL, name), 'utf8'), /\nОтчёт: всё сделано\.\n$/);
});

test('журнал помощника: служебные агенты без agent_type и чужие события пропускаются', t => {
  const root = tempRoot(t);
  assert.equal(agentRun(root, { hook_event_name: 'SubagentStart', agent_id: 'h1' }), '');
  assert.equal(agentRun(root, { hook_event_name: 'Stop', agent_id: 'h1', agent_type: 'x' }), '');
  assert.equal(fs.existsSync(path.join(root, RUNS_REL)), false);
});

test('журнал помощника: скрипт отвечает JSON и пишет в проект из CLAUDE_PROJECT_DIR', t => {
  const root = tempRoot(t);
  const r = run('.claude/hooks/agent-run.mjs', { hook_event_name: 'SubagentStart', agent_id: 'id 7', agent_type: 'my agent' }, root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /_my-agent_id-7\.md/);
});

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

test('ограничитель регулярок: счётчик повторов больше 500 отклоняется, меньший проходит', { skip: !hasSh && 'нет sh: хук работает только там, где есть инструмент Bash' }, () => {
  const guard = command => spawnSync('sh', [path.join(ROOT, '.claude/hooks/regex-guard.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8',
  });
  for (const command of ['grep -o "x.\\{0,3500\\}" f', "sed -n 's/a.{501}//p' f", 'rg "a{1000,}" f']) {
    const r = guard(command);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', command);
  }
  for (const command of ['rg "a{2,500}" f', 'node -e "const o = {}"', 'echo ${HOME}']) {
    assert.equal(guard(command).stdout, '', command);
  }
});

test('передача после сжатия: текст файла и git status, без файла — тишина', t => {
  const root = tempRoot(t);
  assert.equal(handoffContext(root, 'docs/NEXT.md', 'compact', ''), '');
  put(root, 'docs/NEXT.md', '   \n');
  assert.equal(handoffContext(root, 'docs/NEXT.md', 'compact', ''), '');
  put(root, 'docs/NEXT.md', '# Next\n\nstep 2\n');
  const text = handoffContext(root, 'docs/NEXT.md', 'resume', ' M a.js\n');
  assert.match(text, /^Handoff docs\/NEXT\.md, re-read after resume/);
  assert.match(text, /# Next\n\nstep 2\n\ngit status --short:\n M a\.js$/);
  assert.match(handoffContext(root, 'docs/NEXT.md', 'compact', ''), /\(clean\)$/);
  assert.match(handoffContext(root, 'docs/NEXT.md', 'compact', null), /\(git failed or this is not a repository\)$/);
});

test('передача после сжатия: скрипт печатает простой текст из CLAUDE_PROJECT_DIR, без аргумента — ничего', t => {
  const root = tempRoot(t);
  put(root, 'NEXT_SESSION.md', '# Next\n');
  const hook = args => spawnSync(process.execPath, [path.join(ROOT, '.claude/hooks/handoff.mjs'), ...args], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  const r = hook(['NEXT_SESSION.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Handoff NEXT_SESSION\.md, re-read after compact/);
  assert.match(r.stdout, /# Next/);
  assert.equal(hook([]).stdout, '');
});
