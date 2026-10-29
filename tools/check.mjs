// ============================================================================
//  card-collection-factory — the project check
// ----------------------------------------------------------------------------
//  node tools/check.mjs   agent setup (agent-doctor), native skills (sync-agents --check),
//                         tests/*.test.mjs (node --test)
//
//  Every step runs even when an earlier one failed, so one run shows every problem.
//  Exit code: 0 — all passed, 1 — something failed, 2 — a wrong command line.
// ============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { cli } from './cli-args.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

await cli({
  name: 'tools/check.mjs',
  usage: ['tools/check.mjs'],
  about: 'The project check: agent setup (agent-doctor), native skills (sync-agents --check) and\n' +
    'tests/*.test.mjs through node --test. Writes nothing to the project; tests use temporary folders.\n' +
    'Exit code: 0 — all passed, 1 — something failed, 2 — a wrong command line (nothing done).',
  options: {},
});

// Set when this check itself runs inside a node --test process: the nested node --test
// would then skip every file and report success.
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

const tests = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).sort().map(f => 'tests/' + f);
const STEPS = [
  { title: 'настройка агентов', args: ['tools/agent-doctor.mjs'] },
  { title: 'нативные скиллы', args: ['tools/sync-agents.mjs', '--check'] },
  { title: 'тесты', args: ['--test', ...tests] },
];

const failed = [];
for (const step of STEPS) {
  console.log('\n— ' + step.title);
  const r = spawnSync(process.execPath, step.args, { cwd: ROOT, stdio: 'inherit', env });
  if (r.status === 0) console.log('  ok');
  else { failed.push(step.title); console.log('  FAIL' + (r.error ? ' ' + r.error.message : '')); }
}
console.log('\n' + (failed.length ? 'Не прошло: ' + failed.join(', ') : 'Всё прошло.'));
process.exitCode = failed.length ? 1 : 0;
