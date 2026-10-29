// Status line. Answers the questions that are otherwise seen by eye and always too late:
// how much context is used, and how much of the five-hour limit. Context is the only real
// limit on session length, and "push the task through or stop at a stage boundary" is a
// guess without the number.
//
// Prints: context share, five-hour limit share (when the account reports one), model, Git
// branch with a star on a dirty tree (the branch disappears where there is no repository).
// The context colour is the warning: yellow from 35 %, red from 50 % — the project compacts at
// 500k of the 1M window (autoCompactWindow in .claude/settings.json), so red means compaction is near.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isEntry } from './hooks/shared.mjs';

const RESET = '\x1b[0m', DIM = '\x1b[2m', YELLOW = '\x1b[33m', RED = '\x1b[31m';

/** Branch name from the first line of `git status --porcelain --branch`. */
export function parseBranch(line) {
  const head = line.replace(/^## /, '');
  const fresh = head.match(/^(?:No commits yet|Initial commit) on (.+)$/);
  if (fresh) return fresh[1];
  if (head.startsWith('HEAD (no branch)')) return 'HEAD';
  return head.split('...')[0].split(' ')[0];
}

/** Branch and dirtiness of the tree at `cwd`; null outside a repository. */
export function gitInfo(cwd) {
  // --no-optional-locks: Claude Code cancels an in-flight status line on every new update,
  // and a git status killed while refreshing the index leaves a stale .git/index.lock that
  // blocks every commit.
  const r = spawnSync('git', ['--no-optional-locks', 'status', '--porcelain', '--branch'], { cwd, encoding: 'utf8', timeout: 3000 });
  if (r.status !== 0 || !r.stdout) return null;
  const lines = r.stdout.split('\n').filter(Boolean);
  return { branch: parseBranch(lines[0]), dirty: lines.length > 1 };
}

/** Whole percent of the context and of the five-hour limit; the limit is null when the account does not report it. */
export function usage(data) {
  const cw = data.context_window || {};
  // The ready share is missing before the first reply and right after /compact: then it is
  // computed the same way, from input tokens only.
  let pct = cw.used_percentage;
  if (typeof pct !== 'number') pct = cw.context_window_size > 0 ? (cw.total_input_tokens || 0) * 100 / cw.context_window_size : 0;
  const limit = data.rate_limits?.five_hour?.used_percentage;
  return { context: Math.max(0, Math.floor(pct)), fiveHour: typeof limit === 'number' ? Math.floor(limit) : null };
}

/** The status line for Claude Code's JSON input and the Git state. */
export function formatStatus(data, git) {
  const u = usage(data);
  const color = u.context >= 50 ? RED : u.context >= 35 ? YELLOW : DIM;
  const parts = [`${color}Context Used: ${u.context}%${RESET}`];
  if (u.fiveHour !== null) parts.push(`5h Limit Used: ${u.fiveHour}%`);
  parts.push(data.model?.display_name || '?');
  if (git) parts.push(git.branch + (git.dirty ? '*' : ''));
  return parts.join(' · ');
}

if (isEntry(import.meta.url)) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* render with fallbacks */ }
  let git = null;
  try { git = gitInfo(data.workspace?.current_dir || data.cwd || process.cwd()); } catch { /* no branch */ }
  process.stdout.write(formatStatus(data, git));
}
