# MAP.md — project map

Navigation for an agent: where things live and which file to start from. It is not a list of every file and not a copy of the documents; look at the current contents of a folder before working in it.

Update this map in the same task when an area, an entry point, a system file or a significant document is added, moved or removed. Do not describe what is planned as if it already exists.

## Entry points

- `AGENTS.md` — the agent's rules, what the project is, the task → skill table, commands.
- `README.md` — the purpose of the project for a person.
- `ccf.mjs` — the factory's commands for an agent in the terminal (`node ccf.mjs --help`): `card make`, `card check`, `models`, `credits`; thin calls of `core/` operations, `--json` for agents.
- `docs/plans/VISION.md` — the author's accepted vision of the project (not a log).
- `docs/plans/ROADMAP.md` — the directions of the work on the product: what is done and what is left, with links to plans.
- `docs/plans/` also holds local working documents ignored by Git (handoff, brainstorm logs, source materials): see «Local working documents» in `AGENTS.md`.

## Product

- `styles/` — art styles the product generates in; one per folder. `styles/scapes/` — the first style: its style bible (`README.md` is the entry point and map of the bible documents); `references/` — all 160 reference cards with an index (`references/README.md`); `checks/` — the automated part of the bible's checks (`check-card.mjs` with `thresholds.json`, the control-run spec of the references, `adjust-trial.mjs` for post-generation adjustments with the product's own processing; both read images with `sharp`; entry point `checks/README.md`); `processing.json` — the style's post-processing settings (neutral, starting settings per model, sharpening bound): the one place for their numbers; `prompt-assembly.json` — how the program assembles a card's image-model prompt from the bible's marked fragments (which fragment for which staging, slot filling, staging vocabulary of a card order, reference-card picking); `research/` inside is local, ignored by Git.

- `core/style/` — the card order and its prompt: `card-order.js` (`CardOrder` typedef, `validateOrder`), `prompt.js` (`buildPrompt`: order → prompt, fragments used, reference cards to attach), `fragments.js` (parses `<!-- fragment: id -->` markers in the bible, fills slots), `assembly.js`, `references.js`, `style.js`; fields and formats for agents: `core/style/README.md`. Tests: `tests/style-prompt.test.mjs` (with the five pilot cards as orders in `tests/style-pilot-orders.mjs`).

- `core/image/` — image processing: `prepare.js` (Node, `sharp`: `prepareCard` turns a model image into card pixels of the size the caller gives — cover scale, centre crop, Lanczos-3; `encodePng`) and `adjust.js` (browser-safe pure functions: `adjust(pixels, width, height, settings)` — brightness, saturation, luma unsharp mask; the same code for the pipeline and the editor preview). Tests: `tests/core-image.test.mjs`.

- `core/card/` — the production loop of one card: `make.js` (`makeCard`: order → prompt → generation → `core/image` → the style's checks, regenerating within the attempt limit and the spend cap; `recheckCard`; `providerFrom` picks the provider from the settings; the outline policy is in its header), `check.js` (plugs in a style's checker `styles/<style>/checks/check-card.mjs`), `card-file.js` (the one description of the card folder and `card.json`). Tests: `tests/card-loop.test.mjs`, fake provider.

- `core/settings.js` + `settings/` — the factory settings: `settings/defaults.json` (tracked; provider choice and values, attempts and spend cap per run, post-processing overrides per model; what each means is in its `_about`) and `settings/local.json` (personal override, ignored by Git; the editor will write it). The API key is never in settings.

- `collections/` — the factory's output, ignored by Git: `<collection>/sets/<set>/cards/<card>/` with `card.json`, `card.png` and `attempts/<n>/` (layout: `core/card/card-file.js`).

- `core/providers/` — image providers; every value comes from the caller (the factory's settings, `settings/defaults.json` → `provider`): `openrouter.js` (`generateImage`, `listImageModels`, `getCredits`, `loadApiKey`; OpenRouter-compatible endpoint). Tests: `tests/provider-openrouter.test.mjs`, mocked fetch. `codex-cli.js` (`generateImage` with the same contract through `codex exec` under the ChatGPT subscription, no per-image payment). Tests: `tests/provider-codex-cli.test.mjs`, mocked spawn.

## Agent setup

- `agents/skills/` — editable sources of project skills (`ccf-<name>`); none yet. `.claude/skills/` and `.agents/skills/` are generated copies, `agents/manifest.json` records them.
- `agents/README.md` — how Claude Code and Codex work in the project: skills, hooks, permissions, optional MCP.
- `agents/harnesses/`, `agents/browser/` — optional MCP examples (Playwright, Context7, Tavily) and browser profiles for Playwright.
- `.claude/` — `settings.json` (auto memory off, compaction at 500k, agent teams, no nested helpers, permissions, hooks), `hooks/` (`handoff.mjs`, `agent-run.mjs`, `regex-guard.sh`, `shared.mjs`), `statusline.mjs`; `runs/` — helper journals, ignored by Git.
- `.codex/config.toml` — `project_doc_max_bytes` raised so `AGENTS.md` is not truncated.

## Installation and launch

- `run.command` (macOS, double-click), `run.sh` (Linux), `run.bat` (Windows) — the one-click launchers: check that Node exists, run `tools/setup.mjs`; the editor start goes after it once the editor exists.
- `tools/setup.mjs` — first-run setup: Node version against `package.json` engines, `npm install --no-package-lock` when `node_modules` is missing or stale (stamp `node_modules/.ccf-install.json`), checks that `sharp` loads. `package-lock.json` is deliberately not tracked (see the header of the script and `CHANGELOG.md`).
- `package.json` — the only dependencies (`sharp`; `typescript` as dev). `tsconfig.json` — the type check of the product code (`core/**/*.js`, JSDoc types, no build); run by `tools/check.mjs`.

## Tools and checks

- `tools/check.mjs` — the project check: `agent-doctor`, `sync-agents --check`, `tests/*.test.mjs`, and the type check of `core/` (skipped while packages are not installed).
- `tools/agent-doctor.mjs`, `tools/sync-agents.mjs` — diagnosis of the agent setup and generation of native skill copies.
- `tools/trash.mjs` — the only sanctioned way to delete: to the OS trash, only inside the project and Claude Code's temporary folders.
- `tools/cli-args.mjs` — the shared command line of the scripts (`--help`, refusing unknown options).
- `tests/` — tests of the agent setup, hooks, status line and tools, and a short run of the Scapes checks.

## Changes

- `CHANGELOG.md` — notable changes and decisions with dates.
