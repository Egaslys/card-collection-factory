# card-collection-factory in Claude Code CLI and Codex CLI

Open the project folder in the CLI you choose. Shared instructions live in `AGENTS.md`; both CLIs read it directly. Model, provider, credentials and personal settings remain your choice.

## Start and check

Run from the project root:

```sh
node tools/agent-doctor.mjs
node tools/check.mjs
```

Only Node is needed. Doctor also warns, without failing, about missing command-line tools that `AGENTS.md` asks agents to use, and on Linux about a missing `gio`. Every runnable script prints its options with `--help` and refuses an unknown option or argument (exit 2) before doing anything.

To delete files, any CLI runs `node tools/trash.mjs <path> …`. It moves them to the OS trash (macOS 15+ `trash`, the Windows Recycle Bin, Linux `gio trash`; where `gio` is missing it deletes nothing and names the package to install) only inside the project and Claude Code's temporary folders, refuses the project root and `.git`, and touches nothing when any path fails the check. The allowed roots live in the script and are the author's decision.

## Native skills and shared settings

| CLI | Native files | Explicit invocation | Instructions/settings |
|---|---|---|---|
| Claude Code | `.claude/skills/ccf-*/SKILL.md` | `/ccf-<name>` | `AGENTS.md`, `.claude/settings.json` |
| Codex | `.agents/skills/ccf-*/SKILL.md` | `$ccf-<name>` or `/skills` | `AGENTS.md`, `.codex/config.toml` |

The task → skill table in [AGENTS.md](../AGENTS.md#skills--read-before-working) owns the current skill inventory and routing.

Claude Code reads `AGENTS.md` itself only while there is no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`: any of them takes its place, so the project has none and doctor reports one ([AGENTS.md in Claude Code](https://code.claude.com/docs/en/memory#agents-md)). Codex truncates project instructions to 32 KiB by default; the shared `.codex/config.toml` sets `project_doc_max_bytes = 131072`, applied once the project is trusted in Codex.

## Edit or add skills

`agents/skills` is the editable source. The native directories hold generated ordinary files, ready in a fresh clone; no symlinks are used.

```sh
node tools/sync-agents.mjs --check
node tools/sync-agents.mjs --write
node tools/check.mjs
```

To add a skill, create `agents/skills/ccf-<name>/SKILL.md` with a matching `name` and a `description` in its front matter, and add its task to the `AGENTS.md` table. Sync copies the whole skill folder (references, scripts, assets) and records hashes in `agents/manifest.json`. A native copy edited by hand blocks writing: move the edit to the source first. Commit the source, the native copies and the manifest together. Skills are written in English.

## Claude Code: status line, hooks and permissions

The whole `.claude/` is shared through Git; only personal `settings.local.json` and session scratch (`runs/`, `worktrees/`) stay local. `.claude/settings.json` sets:

- **Auto memory off, compaction at 500k** (`autoCompactWindow`), agent teams on, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` (a subagent spawns no helpers of its own).
- **Status line** — `.claude/statusline.mjs`: context used (yellow from 35 %, red from 50 %), five-hour limit used when the account reports it, model, Git branch with `*` for uncommitted changes.
- **Handoff after compaction** — `.claude/hooks/handoff.mjs` on SessionStart `compact|resume` prints `docs/plans/NEXT_SESSION.md` and `git status --short` into the context. A compaction summary is written without the latest turns; the handoff brings the curated state back.
- **Helper journals** — `.claude/hooks/agent-run.mjs` on SubagentStart/SubagentStop creates `.claude/runs/<time>_<type>_<id>.md`, passes its path to the helper and appends its final report. Trash journals with `node tools/trash.mjs` once their work is taken over.
- **Regex guard** — `.claude/hooks/regex-guard.sh` before every Bash call refuses a regex repetition count above 500: GNU grep and sed build such a pattern without bound (one grep with `{0,3500}` was seen to take 71 GB of memory).
- **Permissions** — deny `rm`, `rmdir`, `sudo`, `git push`, `git reset --hard`, `git clean`, `grep` (use `rg`) and reading `.env`, keys and `id_rsa`; allow `node tools/trash.mjs`; ask before editing generated skill copies, the hooks, the status line and the trash script. Deny rules see command text only: they catch habits, not intent.

Codex has no hooks here: it follows the same rules from `AGENTS.md` by hand.

## Optional MCP examples

The example files never connect or install anything automatically. Choose the server blocks you need and merge them into your settings:

| CLI | Example | Add the selected block to |
|---|---|---|
| Claude Code | `harnesses/claude.mcp.example.json` | project `.mcp.json` → `mcpServers` (ignored by Git) |
| Codex | `harnesses/codex.mcp.example.toml` | `.codex/config.toml`, after the root `project_doc_max_bytes` line |

- **Playwright** — lets the agent open the web editor in a browser, press its buttons and take screenshots, to check what a person would see. Uses `browser/desktop.json` (1280×720) or `browser/mobile.json` and installed Google Chrome; screenshots go to the ignored `browser-output/`.
- **Tavily** — web search and page extraction: references for the theme of a set (films, objects, how they look) when a producer asks for a set. Needs `TAVILY_API_KEY` in the environment of the terminal that launches the CLI; never put the key into a file of the project.
- **Context7** — current documentation of libraries, SDKs and model APIs; needed when the project itself is developed, not when sets are made. Remote endpoint with the client's OAuth flow.

After connecting, check the client's MCP status and actually invoke a tool: a valid config file proves no connection.
