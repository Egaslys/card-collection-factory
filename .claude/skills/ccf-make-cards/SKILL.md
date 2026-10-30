---
name: ccf-make-cards
description: Make cards with the card factory — from a request like "20 cards about X" to finished, checked card images in a collection. Use for single or loose cards, inside the factory folder or from another folder given the factory's path; for a 10-card set or a collection use ccf-make-sets.
---

# Make cards

`FACTORY` is the factory's folder. Every command below is `node FACTORY/ccf.mjs …` and works from any folder: your own files (orders, images) resolve against your folder, cards always land in `FACTORY/collections/`. `--help` on any command gives its exact options; `--json` gives a result for an agent (progress lines go to stderr). The person's word outranks every rule of the style: `FACTORY/docs/plans/VISION.md`.

## 1. Ready

- `FACTORY/node_modules` missing → `node FACTORY/tools/setup.mjs` (installs `sharp`).
- Pick who draws:
  - `openrouter` — the product default (`provider.use` in `FACTORY/settings/defaults.json`; what each setting means is in its `_about`). Needs the key in the environment or `FACTORY/.env` (variable: `provider.openrouter.keyEnvVar`). `node FACTORY/ccf.mjs credits` shows whether it works. Never print, copy or write the key.
  - `codex-cli` — Codex under the person's ChatGPT subscription, no payment per image, GPT Image only; the factory's own trial runs use it (`--provider codex-cli`). Needs `codex` installed and logged in.
  - Your own built-in image tool — step 4b.
  - No key, but the person's editor is running with one: the paid commands (`card make`, `card regenerate`, `card edit`, `set plan`, `set make`, `collection plan`, `collection make`) send themselves to the editor and run there with its key; the output is the same. Without a key and without an editor they stop and say so.
- A paid run spends the person's money. Before it, tell them how many cards and the cap (`card.maxSpendUsd` per card run, or `--max-spend`), and stay inside what they agreed.

## 2. Collection

Every card lives in a collection's card pool.

```sh
node FACTORY/ccf.mjs collection list --json
node FACTORY/ccf.mjs collection create --title TITLE [--description "what it is"] --json   # → id
node FACTORY/ccf.mjs collection show ID --json                                              # sets and the pool
```

Use the collection the person named or the one the request clearly belongs to; otherwise create one titled after the request and say which you chose.

## 3. Orders

One JSON `CardOrder` per card. Fields and their meaning: `FACTORY/core/style/README.md` («CardOrder»). Staging values: `FACTORY/styles/<style>/prompt-assembly.json` → `fields`. Worked orders for categories 1–5: `FACTORY/tests/style-pilot-orders.mjs`.

- Staging decides the category: the staging table at the top of the variables section of `styles/<style>/BACKGROUNDS.md` (staging → category → reference cards); categories in `BASE_RULES.md` §2; character scenes in `CHARACTERS.md`.
- `subject`, `object`, `environment`, `palette` in English; `title` is the caption.
- Use only stagings some reference card shows. One the references never show needs `humanRequest` with the person's own words.
- Many loose cards are not a set, but the style's measure of a good mix is `SETS.md` §3.5–3.7 (categories, backdrops, patterns): follow it unless the person asked otherwise, and say so.
- A request that is really a set (10 cards in a window) or a collection → ccf-make-sets.

Check each order for free: `ccf.mjs card prompt ORDER.json` prints the assembled prompt, or the order's errors with exit 1. Nothing is generated.

## 4a. Make with a provider

```sh
node FACTORY/ccf.mjs card make ORDER.json --collection ID [--set ID --slot N] [--provider codex-cli] [--max-spend USD] --json
```

The loop generates, crops, tunes the processing, checks, and regenerates while a blocking FAIL remains, within the attempt limit and the cap. Several `card make` processes may run at once for pool cards; with `--set` run them one after another (two processes writing one `set.json` can lose an update: `core/store/README.md`, «Writes and live events»). To try again on the same card after changing its order: `--card CARD_ID` (attempts are appended).

## 4b. Make with your own image tool

1. `ccf.mjs card prompt ORDER.json --json` → `prompt`, `references` (attach in this order), `aspectRatio`, `next`.
2. Draw one image with your tool from exactly that prompt and those references.
3. `ccf.mjs card import ORDER.json IMAGE --collection ID [--set ID --slot N] --json` (new card) or `card import CARD_DIR IMAGE --json` (new attempt of a card). It is cropped, processed and checked like a generated one; cost 0.

## 5. Read the report

The `--json` result is a `CardReport` (typedef in `FACTORY/core/card/make.js`; the card folder: header of `core/card/card-file.js`):

| `stop` | Meaning → next |
|---|---|
| `passed` | no blocking FAIL; still review it (step 6) |
| `attempts`, `budget` | limit hit with FAILs left → review, fix the order, `card make … --card ID` |
| `provider-error` | `attempts[].error`; the fallback model was already tried in the same attempt |
| `cost-unknown` | the provider gave no price, so the cap cannot be kept: stop and tell the person |
| `cancelled` | stopped by the caller |

`chosenCheck.fails[].needsMask` = the FAIL rests on an unconfirmed hero outline: it never triggers a paid regeneration and needs a hero box or a confirmation (ccf-review-cards). `chosenCheck.maskStatus` `auto` = the outline was cut in a box the vision model found (or you gave) and is trusted: its FAILs are blocking. `chosenCheck.look` = what the vision model saw against the order (with an OpenRouter key; settings → `look`): `verdict`, `issues` — the `blocking` ones are counted in `blocking` and made the loop regenerate. `chosenVisual` = the checks left for eyes. `spent` = USD of this run, the vision model's calls included. Without a key, `warnings` says nothing looked.

## 6. Review

Review every card before showing it: ccf-review-cards.

## 7. Show

- Editor: `node FACTORY/ccf.mjs editor --open COLLECTION[/SET]` starts it in the background (or uses the running one), opens the browser there and prints the address. `--stop` stops it; leave an editor the person uses running.
- Files: `image` of each report is the card's `card.png`. A folder for the person: `node FACTORY/ccf.mjs export --collection ID --card ID,ID [--zip] [--open] --json` → `path` under `collections/<collection>/export/` (layout: `core/store/README.md`, «Export»).

Done when every requested card has a reviewed `card.png`, and the person has the editor view or the export path, the total spent, and every problem left open.
