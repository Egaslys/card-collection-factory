# MAP.md — project map

Navigation for an agent: where things live and which file to start from. It is not a list of every file and not a copy of the documents; look at the current contents of a folder before working in it.

Update this map in the same task when an area, an entry point, a system file or a significant document is added, moved or removed. Do not describe what is planned as if it already exists.

## Entry points

- `AGENTS.md` — the agent's rules, what the project is, the task → skill table, commands.
- `README.md` — the purpose of the project for a person.
- `docs/plans/VISION.md` — the author's accepted vision of the project (not a log).
- `docs/plans/ROADMAP.md` — the directions of the work on the product: what is done and what is left, with links to plans.
- `docs/plans/` also holds local working documents ignored by Git (handoff, brainstorm logs, source materials): see «Local working documents» in `AGENTS.md`.

## Agent setup

- `agents/skills/` — editable sources of project skills (`ccf-<name>`); none yet. `.claude/skills/` and `.agents/skills/` are generated copies, `agents/manifest.json` records them.
- `agents/README.md` — how Claude Code and Codex work in the project: skills, hooks, permissions, optional MCP.
- `agents/harnesses/`, `agents/browser/` — optional MCP examples (Playwright, Context7, Tavily) and browser profiles for Playwright.
- `.claude/` — `settings.json` (auto memory off, compaction at 500k, agent teams, no nested helpers, permissions, hooks), `hooks/` (`handoff.mjs`, `agent-run.mjs`, `regex-guard.sh`, `shared.mjs`), `statusline.mjs`; `runs/` — helper journals, ignored by Git.
- `.codex/config.toml` — `project_doc_max_bytes` raised so `AGENTS.md` is not truncated.

## Tools and checks

- `tools/check.mjs` — the project check: `agent-doctor`, `sync-agents --check`, `tests/*.test.mjs`.
- `tools/agent-doctor.mjs`, `tools/sync-agents.mjs` — diagnosis of the agent setup and generation of native skill copies.
- `tools/trash.mjs` — the only sanctioned way to delete: to the OS trash, only inside the project and Claude Code's temporary folders.
- `tools/cli-args.mjs` — the shared command line of the scripts (`--help`, refusing unknown options).
- `tests/` — tests of the agent setup, hooks, status line and tools.

## Changes

- `CHANGELOG.md` — notable changes and decisions with dates.
