// SubagentStart and SubagentStop — a journal per helper, so its work survives a hang,
// a kill, or the lead's compaction (AGENTS.md: each helper keeps a temporary journal).
//
// Start: create the journal (a teammate waking again gets its own back) and hand its path
// to the helper through additionalContext, which reaches it before its brief. The helper
// keeps its notes there. Stop: append the helper's final report and the path of its full
// transcript. A read-only helper cannot write notes, but its report still lands on disk.
//
// The helper's name arrives in agent_type; there is no agent_name field. Claude Code's
// own helper agents (progress summaries, prompt suggestions) fire the same events with no
// agent_type: not ours, skipped.
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_MARK, RUNS_REL, isEntry, projectRoot, readInput } from './shared.mjs';

// File names are built from these characters only.
const safe = s => String(s || '').replace(/[^A-Za-z0-9._-]/g, '-');
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * The helper's final report from its transcript (JSONL). In Claude Code 2.1.295 SubagentStop
 * carries no last_assistant_message: a helper hands its report back as the `message` of a
 * SubagentHandback tool call. Only the last assistant entry counts — when it is neither that
 * call nor text, the helper was cut off mid-work and has no report.
 */
export function lastReport(transcriptPath) {
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type !== 'assistant') continue;
    const parts = Array.isArray(entry.message?.content) ? entry.message.content : [];
    const handback = parts.find(p => p.type === 'tool_use' && p.name === 'SubagentHandback');
    if (handback) return String(handback.input?.message || '');
    return parts.filter(p => p.type === 'text').map(p => p.text).join('\n').trim();
  }
  return '';
}

/** Handles one event; returns the hook's stdout ('' when it has nothing to say). */
export function agentRun(root, input, now = new Date()) {
  const event = input.hook_event_name;
  const id = safe(input.agent_id), type = safe(input.agent_type);
  if (!id || !type || (event !== 'SubagentStart' && event !== 'SubagentStop')) return '';
  const dir = path.join(root, RUNS_REL);
  fs.mkdirSync(dir, { recursive: true });
  const time = stamp(now);

  // A teammate fires SubagentStart at every wake with the same agent_id: reuse its journal.
  const existing = fs.readdirSync(dir).find(n => n.endsWith(`_${id}.md`));
  let file = existing && path.join(dir, existing);
  if (!file) {
    file = path.join(dir, `${time.replace(' ', '_').replaceAll(':', '')}_${type}_${id}.md`);
    fs.writeFileSync(file, `# Run: ${type} ${id}\nStarted: ${time}\n\n`);
  }

  if (event === 'SubagentStart') {
    const where = file.split(path.sep).join('/');
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: `Your run journal: ${where}. If you can write files, add to it before any other work and keep it current: the task in one line, status, what you did, paths of what you produced, checks, open questions, and what you dropped or could not do. It is scratch for the lead, not your deliverable and not a source of truth. Your final message is appended to it automatically when you finish. No file-writing tool: skip it.`,
      },
    });
  }
  // SubagentStop.
  const transcript = input.agent_transcript_path ? `Transcript: ${input.agent_transcript_path}\n` : '';
  const report = input.last_assistant_message || lastReport(input.agent_transcript_path) || '(no final message)';
  fs.appendFileSync(file, `\n${REPORT_MARK} — ${time}\n${transcript}\n${report}\n`);
  return '';
}

if (isEntry(import.meta.url)) {
  try {
    const out = agentRun(projectRoot(), readInput());
    if (out) process.stdout.write(out + '\n');
  } catch { /* silence: see shared.mjs */ }
}
