// Read-only diagnosis of the common project setup. Optional MCPs are checked by the CLI.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, syncAgents } from './sync-agents.mjs';
import { GIO_INSTALL_HINT } from './trash.mjs';
import { cli } from './cli-args.mjs';

// The programs AGENTS.md ("Terminal and command-line tools") tells agents to use. A missing one is
// a warning, not a failure: the setup works without it, but the agent finds out only mid-task.
const TOOLS = ['rg', 'fd', 'ast-grep', 'jq', 'yq'];

/** Warnings about programs missing from PATH; the trash needs gio on Linux. */
export function toolWarnings(platform = process.platform) {
  const missing = name => spawnSync(name, ['--version'], { stdio: 'ignore', timeout: 5000 }).error?.code === 'ENOENT';
  const warnings = [];
  const absent = TOOLS.filter(missing);
  if (absent.length) warnings.push(`Missing command-line tools that AGENTS.md asks agents to use: ${absent.join(', ')}. Install them.`);
  if (platform === 'linux' && missing('gio')) warnings.push(`gio is missing: node tools/trash.mjs cannot delete anything. ${GIO_INSTALL_HINT}`);
  return warnings;
}

export async function doctor(root = PROJECT_ROOT) {
  root = path.resolve(root);
  const errors = [];
  const read = async rel => {
    try { return await fs.readFile(path.join(root, rel), 'utf8'); }
    catch { errors.push(`Missing ${rel}; restore it from the repository.`); return ''; }
  };
  const agents = await read('AGENTS.md');
  // Claude Code reads AGENTS.md itself (v2.1.277+) only while none of these is in the project:
  // any of them takes its place (https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md).
  for (const rel of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
    try { await fs.access(path.join(root, rel)); errors.push(`Remove ${rel}: Claude Code then reads it instead of AGENTS.md.`); } catch { /* absent: fine */ }
  }
  const codex = await read('.codex/config.toml');
  const top = codex.split(/^\s*\[/m)[0];
  const limits = [...top.matchAll(/^\s*project_doc_max_bytes\s*=\s*([0-9_]+)\s*(?:#.*)?$/gm)];
  if (limits.length !== 1 || Number(limits[0][1].replaceAll('_', '')) !== 131072) {
    errors.push('Set project_doc_max_bytes = 131072 at the root of .codex/config.toml; trust the project in Codex.');
  }
  try {
    const result = await syncAgents({ root });
    if (!result.ok) errors.push(...result.errors, 'Run node tools/sync-agents.mjs --write after transferring any native edits to the source.');
    for (const id of result.skills) {
      if (!agents.includes(`agents/skills/${id}/SKILL.md`)) errors.push(`Add agents/skills/${id}/SKILL.md to the AGENTS.md skill table.`);
    }
  } catch (e) { errors.push(e.message, 'Restore agents/skills and run node tools/sync-agents.mjs --write.'); }
  return { root, node: process.version, ok: errors.length === 0, errors, warnings: toolWarnings() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = await cli({
    name: 'tools/agent-doctor.mjs',
    usage: ['tools/agent-doctor.mjs [--root PROJECT]'],
    about: 'Read-only diagnosis of the common agent setup: AGENTS.md is read by Claude Code and Codex (no\n' +
      'CLAUDE.md takes its place), .codex/config.toml raises project_doc_max_bytes, native skills match\n' +
      'agents/skills and the AGENTS.md skill table. Warns, without failing, about missing\n' +
      `command-line tools (${TOOLS.join(', ')}; gio on Linux). Writes and installs nothing;\n` +
      'optional MCP connections are checked by your CLI. Exit code: 0 — ok, 1 — problems listed.',
    options: { root: { type: 'string', value: 'PROJECT', help: 'project to diagnose (default: this one)' } },
  });
  const result = await doctor(values.root);
  console.log(`Project: ${result.root}\nNode: ${result.node}\nMCP: optional; verify connections using your CLI.`);
  console.log(result.warnings.length ? result.warnings.join('\n') : 'Command-line tools: ok.');
  if (result.ok) console.log('Shared instructions, native skills and project settings: ok.');
  else { console.error(result.errors.join('\n')); process.exitCode = 1; }
}
