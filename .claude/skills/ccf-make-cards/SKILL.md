---
name: ccf-make-cards
description: Make cards with the card factory — from a request like "20 cards about X" to finished, checked card images in a collection. Use for single or loose cards, inside the factory folder or from another folder given the factory's path; for a 10-card set or a collection use ccf-make-sets.
---

# Make cards

`FACTORY` is the factory's folder. Every command below is `node FACTORY/ccf.mjs …` and works from any folder: your own files (orders, images) resolve against your folder, cards always land in `FACTORY/collections/`. `node FACTORY/ccf.mjs <command> --help` gives a command's exact options; `--json` gives a result for an agent (progress lines go to stderr). The person's word outranks every rule of the style: `FACTORY/docs/plans/VISION.md`.

## 1. Ready

- `FACTORY/node_modules` missing → `node FACTORY/tools/setup.mjs` (installs `sharp`).
- Who draws, and which service the keyed calls go to. Settings: `FACTORY/settings/defaults.json` (each key explained in its `_about`), personal changes in `settings/local.json`.
  - **A keyed service** (`provider.use: "api"`, the default). `provider.preset` names it — `openrouter` or `google` (Google AI Studio) — and its block `provider.<preset>` holds the image model, the fallback (`fallbackModel`, `null` = none), the vision model (hero box, look), the text model (plans, `cards make`) and the key's variable (`keyEnvVar`). The key goes in the environment or `FACTORY/.env`; never print, copy or write it. `ccf.mjs models` shows whether the service answers; `ccf.mjs credits` gives the balance (OpenRouter only).
  - **`--provider openrouter | google | codex-cli`** on `card make`, `card regenerate`, `card edit`, `cards make`, `set make`, `collection make` picks who draws for one run, settings untouched. A named service also takes that run's vision and text calls. `codex-cli` draws with Codex under the person's ChatGPT subscription (GPT Image only, no payment per image; needs `codex` installed and logged in), while the vision and text calls still go to the settings' service and need its key.
  - **`--model ID`**: another image model of the service for one run (to compare models, or when the person names one); not with `codex-cli`. Each model is asked through its profile (`provider.models`: ratios, reference images, request fields); which ratio it is asked for and how the answer is cut to the card: `_about` of the settings and `core/image/prepare.js`.
  - **Your own built-in image tool**: step 4b.
  - The factory's own trial runs (developing the factory, not a person's order) use the services `docs/plans/VISION.md` names at the end of its image source section.
- No key here, but the person's editor runs with one (`ccf.mjs editor` started it, `.ccf/editor.json` exists): the paid commands (`card make`, `card regenerate`, `card edit`, `cards make`, `set plan`, `set make`, `collection plan`, `collection make`) send themselves to the editor and run there with its key for the run's service; the output is the same. Without a key and without an editor they stop and say so. `card import` goes to the editor too (for its vision steps), and without either runs here without them.
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

**Written for you** (the usual way for loose cards): `ccf.mjs cards make --collection ID --theme TEXT --count N [--scenes N] [--wishes TEXT] [--provider NAME] [--model ID] [--max-spend USD] --json`. N is 1 to settings `set.cards.maxCount` (10); more cards = several runs. The settings' text model writes N orders from the style's set fragments; they are checked like a set's orders, including what the image model will read (`styles/<style>/SETS.md` 9.22–9.24) — errors go back to the model, and with errors left nothing is made (`plan.errors`). Read `plan.warnings` (wishes worded as prohibitions, a missing category): they are not sent back to the model. Then each card is made into the pool as in 4a. It does not avoid item kinds the collection's sets already hold: compare with `collection show` yourself. The editor's create-cards button in the pool runs the same.

**Written by you**: one JSON `CardOrder` per card. Fields: `FACTORY/core/style/README.md` («CardOrder»); `id` and every staging field are required (the presets and missing ids of a set plan are a plan's shorthand only). Staging values: `styles/<style>/prompt-assembly.json` → `fields`. Worked orders for categories 1–5: `FACTORY/tests/style-pilot-orders.mjs`.

- Staging decides the category: the staging table at the top of the variables section of `styles/<style>/BACKGROUNDS.md` (staging → category → reference cards); categories in `BASE_RULES.md` §2; character scenes in `CHARACTERS.md`.
- `subject`, `object`, `environment`, `palette` in English; `title` is the caption. A wall's colour goes in `palette`.
- Write `subject`, `promptExtra` and wishes as what the viewer should see, not as prohibitions (VISION.md, the image source section): «small dark round eyes and a round, smooth body», not «no face»; «a plain painted wall», not «no pattern». The rules a set plan gets checked for (SETS.md 9.22–9.24: day light without characters, a backdrop unlike the hero, no fine-texture or chrome words) hold for your orders too; nothing checks them here.
- Use only stagings some reference card shows. One the references never show needs `humanRequest` with the person's own words.
- Many loose cards are not a set, but the style's measure of a good mix is `SETS.md` §3.5–3.7 (categories, backdrops, patterns): follow it unless the person asked otherwise, and say so.
- A request that is really a set (10 cards in a window) or a collection → ccf-make-sets.

Check each order for free: `ccf.mjs card prompt ORDER.json` prints the assembled prompt, or the order's errors with exit 1. Nothing is generated.

## 4a. Make with a provider

```sh
node FACTORY/ccf.mjs card make ORDER.json --collection ID [--set ID --slot N] [--provider NAME] [--model ID] [--max-spend USD] --json
```

The loop generates, crops, finds the hero box with the vision model, tunes the processing, checks, has the vision model look at the card against the order, and regenerates while a blocking FAIL or a blocking look issue remains, within the attempt limit and the cap. Several `card make` processes may run at once for pool cards; with `--set` run them one after another (two processes writing one `set.json` can lose an update: `core/store/README.md`, «Writes and live events»). To try again on the same card after changing its order: `--card CARD_ID` (attempts are appended).

## 4b. Make with your own image tool

1. `ccf.mjs card prompt ORDER.json --json` → `prompt`, `references` (attach in this order), `aspectRatio`, `next`.
2. Draw one image with your tool from exactly that prompt and those references.
3. `ccf.mjs card import ORDER.json IMAGE --collection ID [--set ID --slot N] --json` (new card) or `card import CARD_DIR IMAGE --json` (new attempt of a card). It goes through every step of a generated one — cropped, hero box from the vision model, processing tuned, checked, looked at against the order — with the key of the settings' service here or in a running editor; without either the vision steps are skipped and `warnings` says so (then give the hero box yourself: ccf-review-cards step 2). The image costs 0; the vision calls are counted.

## 5. Read the report

The `--json` result is a `CardReport` (typedef in `FACTORY/core/card/make.js`; the card folder: header of `core/card/card-file.js`):

| `stop` | Meaning → next |
|---|---|
| `passed` | no blocking FAIL; still review it (step 6) |
| `attempts`, `budget` | limit hit with FAILs left → review, fix the order, `card make … --card ID` |
| `provider-error` | `attempts[].error`; the service's fallback model, if it has one, was already tried in the same attempt |
| `cost-unknown` | the provider gave no price, so the cap cannot be kept: stop and tell the person |
| `cancelled` | stopped by the caller |

`chosenCheck.fails[].needsMask` = the FAIL rests on an unconfirmed hero outline: it never triggers a paid regeneration and needs a hero box or a confirmation (ccf-review-cards). `chosenCheck.maskStatus` `auto` = the outline was cut in a box the vision model found (or you gave) and is trusted: its FAILs are blocking. `chosenCheck.look` = what the vision model saw against the order (settings `look`): `verdict`, `issues` — the `blocking` ones are counted in `blocking` and made the loop regenerate. `chosenVisual` = the checks left for eyes. `spent` = USD of this run, vision calls included (the split into images and vision is in `card.json` and the editor). Without a key, `warnings` says nothing looked.

## 6. Review

Review every card before showing it: ccf-review-cards.

## 7. Show

- Editor: `node FACTORY/ccf.mjs editor --open COLLECTION[/SET]` starts it in the background (or uses the running one), opens the browser there and prints the address. `ccf.mjs editor --stop` stops it; leave an editor the person uses running.
- Files: `image` of each report is the card's `card.png`. A folder for the person: `node FACTORY/ccf.mjs export --collection ID --card ID,ID [--zip] [--open] --json` → `path` under `collections/<collection>/export/` (layout: `core/store/README.md`, «Export»).

Done when every requested card has a reviewed `card.png`, and the person has the editor view or the export path, the total spent, and every problem left open.
