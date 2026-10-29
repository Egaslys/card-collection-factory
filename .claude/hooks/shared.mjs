// Shared by the project's Claude Code hooks. Not run on its own.
//
// Rule for every hook here: when the event is not ours or a file is missing, exit 0
// silently. A hook that breaks or delays the session is worse than none.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root: Claude Code passes it; the file's own location is the fallback. */
export function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

// Helper journals: scratch the lead reads, never a source of truth. Ignored by Git.
export const RUNS_REL = '.claude/runs';

// Heading the stop hook writes. A journal without it never reported back.
export const REPORT_MARK = '## Final report';

/** The hook's JSON input; an empty object when stdin is empty or not JSON. */
export function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return {}; }
}

/** Runs `main` only when the file is the process entry, so tests can import it. */
export function isEntry(metaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
