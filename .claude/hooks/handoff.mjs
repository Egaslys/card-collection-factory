// SessionStart on compact and resume: puts the handoff and the uncommitted files back into the
// context. A compaction summary is written without the latest turns, and a resumed session may
// predate the handoff, so the curated state of the work is re-read from the project itself.
// The handoff path is the hook's argument in settings.json: the file the project's AGENTS.md names.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot, readInput, isEntry } from './shared.mjs';

/** The context text, or '' when the handoff is missing or empty. `status` is null when git failed. */
export function handoffContext(root, rel, source, status) {
  let text;
  try { text = fs.readFileSync(path.join(root, rel), 'utf8').trim(); } catch { return ''; }
  if (!text) return '';
  return [
    `Handoff ${rel}, re-read after ${source}: the curated current state of the work. Read it together ` +
      'with the latest turns kept verbatim and the git status below; a compaction summary is written ' +
      'without the latest turns and may be out of date.',
    '',
    text,
    '',
    'git status --short:',
    status === null ? '(git failed or this is not a repository)' : (status.trimEnd() || '(clean)'),
  ].join('\n');
}

function gitStatus(root) {
  try {
    return execFileSync('git', ['--no-optional-locks', 'status', '--short'],
      { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}

if (isEntry(import.meta.url)) {
  const rel = process.argv[2];
  if (rel) {
    const root = projectRoot();
    const out = handoffContext(root, rel, readInput().source || 'compact', gitStatus(root));
    if (out) process.stdout.write(out + '\n');
  }
  process.exit(0);
}
