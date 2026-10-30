---
name: ccf-style
description: Develop a card style and its bible — the documents in styles/<style>/, their prompt fragments, prompt-assembly.json, set-rules.json, processing.json, the automated checks and their control run, reference cards, character anchors and window templates. Use before editing anything under styles/ or core/style/.
---

# Develop a style and its bible

The only style so far is `styles/scapes/`. Its entry point is `styles/scapes/README.md` (the table of bible documents and how to read them). The bible is written for a person (Russian); fragments that go to a model are English. The bible documents are the authority; each JSON file makes their checkable part readable by the program and names its source.

| What | Where it is described |
|---|---|
| prompt fragments, their markers, the assembly rules format | `core/style/README.md`; order of assembly for a person: `PROMPTS.md` |
| how fragments are picked and joined, staging vocabulary, references and anchors | `prompt-assembly.json` |
| set and collection rules as data, including what a card order may say to the image model (`orders`, SETS.md 9.22–9.24) and the text model's prompt glue for plans and loose cards (`prompt`) | `set-rules.json` (source: `SETS.md`); how core uses it: `core/set/README.md` |
| post-processing numbers: bounds, shadow lift, the start per image model (a new model needs a `start` entry, or `sameAs` in its settings profile `provider.models`) | `processing.json` (its `_about`) |
| automated checks, thresholds, the control run, the hero outline | `checks/README.md` |
| the order of checks for a person or agent | `CHECKLIST.md` |
| reference cards / character anchors | `references/README.md` / `characters/README.md` |
| window kinds (large, small, grand), colour templates, frames (`windows/frames/`) and slot geometry — read by the store and the editor | `windows/windows.json` |

## Rules of the bible

- Every rule is marked as the author's decision, measured, or by eye. What is not decided or measured goes in each document's last section and is not a rule.
- One place per fact; other documents link to it. The same holds for the JSON files: a number lives in one of them, the bible names the rule.
- A fragment keeps its `<!-- fragment: id -->` marker when its text is edited. A changed fragment is unproven until a generation run has used it: say so.
- A number in a bible check and in `checks/thresholds.json` change together, in one task, followed by the full control run.
- A staging no reference card shows is never added as the agent's own choice: only the author decides art (`docs/plans/VISION.md`).
- `research/` is local and ignored by Git; nothing tracked depends on it.

## Check

- `node tools/check.mjs` must pass. Its style tests: `tests/style-prompt.test.mjs` (every fragment marked and named, vocabulary equal to the checks' `--help`, pilot orders assemble), `tests/style-sheet.test.mjs`, `tests/scapes-checks.test.mjs` (a short control run), `tests/set-plan.test.mjs` (set rules).
- After a check, threshold or measure change, the full control run must exit 0: `node styles/scapes/checks/check-card.mjs --summary --quiet --no-visual`. A new unexpected FAIL on a reference card means the threshold or the measure is wrong: fix one of them (`checks/README.md`, «Keeping it in sync with the bible»).
- After a fragment or assembly change, read the assembled prompt for real: `node ccf.mjs card prompt ORDER.json` on orders from `tests/style-pilot-orders.mjs`.
- Processing changes: `styles/scapes/checks/adjust-trial.mjs` (`--help`), then `check-card.mjs` on the chosen copies.
- Paid generation to test fragments only with the author's consent; the factory's own trial runs use the services `docs/plans/VISION.md` names at the end of its image source section. Each image model reads the prompt differently: a fragment proven on one model is unproven on another. A per-model closing phrase is the profile's `framing` (settings `provider.models`), not a fragment.
- Update `MAP.md` and `CHANGELOG.md` when a document, a rule file or a decision changes.

TODO: a second style. No contract yet lists what a style folder must contain; today core reads the bible documents' fragments and `BACKGROUNDS.md` staging table, `prompt-assembly.json`, `set-rules.json`, `processing.json`, `checks/thresholds.json` and `checks/check-card.mjs` from `styles/<style>/`; the store and the editor read `windows/windows.json`.
