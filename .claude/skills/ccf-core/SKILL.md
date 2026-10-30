---
name: ccf-core
description: Develop the factory's core — the operations in core/ (providers, image processing, prompt assembly, the card loop, the store, set planning, settings) and their terminal caller ccf.mjs. Use before changing or adding code in core/, ccf.mjs, settings/ or their tests.
---

# Develop the core

Read first: `core/README.md` (modules, the Store API contract, calling conventions) and the structure-and-stack section of `docs/plans/VISION.md` (the author's decisions). Per module: `core/style/README.md`, `core/set/README.md`, `core/store/README.md`, the headers of `core/card/card-file.js` (card folder, versions) and `core/card/make.js` (the loop, request semantics, the outline policy); services: `core/providers/preset.js` (API presets, `runSettings` for a run's `--provider` / `--model`) and `models.js` (image model profiles, settings `provider.models`). Where each file and test lives: `MAP.md`. The style's own rules and files: ccf-style.

## Invariants

- **One core, two callers.** Every product function is an exported core operation. `ccf.mjs` (and `core/set/cli.js`) and the editor's `editor/server/ops.js` only map arguments to it. A new capability is a core export first, then a CLI command, then an editor operation (ccf-editor).
- **Calling conventions** of `core/README.md`: one options object in, plain JSON-able data out, errors thrown with a Russian message a person can act on; paid operations take a spend cap, report cost and record it by kind — images and vision in the card's attempts, a text model's calls through `recordSpend` (`core/store/README.md`, `spend`).
- **Writes go through `core/store`** (atomic writes; the editor's live view sees them).
- **One source per value.** Factory settings: `settings/defaults.json` (a new key gets its line in `_about`); the style's numbers: `styles/<style>/*.json`; folder and file names: `core/store/layout.js` and `core/card/card-file.js`.
- **The key** — one per service, its variable `provider.<preset>.keyEnvVar` — comes from the environment, `.env`, or a running editor's memory (a paid command without a key here runs in the editor: `editor/remote.js` `hereOrInEditor`). It is never in settings, files, logs or output.
- **No build.** Plain JavaScript with JSDoc types checked by `tsc` (`tsconfig.json`); Node only, no framework; the one dependency is `sharp` (`package.json`). Processing is own code: `core/image/adjust.js` has no imports and runs in the browser too, so the editor's preview equals the card.
- **The person's word outranks the rules**: a request (`regenerate`, `edit`, `import`) or a choice (`card choose`) makes its version the card and keeps it on recheck; `promptOverride` and `humanRequest` lift the style's limits.
- **Outline policy** (`core/card/make.js` header): a FAIL resting on an unconfirmed hero outline never triggers a paid regeneration.
- **Command line**: `tools/cli-args.mjs` — `--help`, an unknown option refused with exit 2 before anything runs, `--json` for agents.

## What other parts rely on

The Store API, the `CardOrder` and `SetPlan` formats, the card folder, and the `ccf.mjs` commands and options are used by the editor and named in the skills ccf-make-cards, ccf-make-sets and ccf-review-cards. Changing one of them means updating its README and those skills in the same task.

## Check

- `node tools/check.mjs` must pass: agent setup, skill copies, every `tests/*.test.mjs`, and the type check.
- One test file: `node --test tests/<name>.test.mjs`.
- Tests make no paid calls: temporary stores (`createStore({ root })`), fake image providers, a fake service on 127.0.0.1, mocked `fetch` and `spawn`; importing `tests/root.mjs` gives a test settings with a key variable nobody sets and no editor to forward to (needed by any test that reads settings or runs `ccf.mjs`). New pure logic gets a test in the matching existing file.
- A changed command: run it for real (`--help`, then a free run such as `card prompt`, `card check`, `set check`). A paid generation only with the author's consent; the factory's own trial runs use the services `docs/plans/VISION.md` names at the end of its image source section (`--provider`; with `codex-cli` the vision and text calls go to the settings' `provider.preset`).
- Update the module's README, `MAP.md` and `CHANGELOG.md` in the same task.
