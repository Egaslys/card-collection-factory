---
name: ccf-make-sets
description: Make sets and collections with the card factory — plan a 10-card set by the style's set rules, check the plan, generate its cards; variants of a set; a whole 16-set collection with one button or set by set. Use when asked for a set, a pack, set variants or a collection, inside the factory folder or from another folder given its path.
---

# Make sets and collections

A set is 10 cards in a window; a collection is 16 sets, the 16th the grand set. `FACTORY` is the factory's folder; commands are `node FACTORY/ccf.mjs …` from any folder, `--help` gives exact options, `--json` a result for an agent (progress lines go to stderr).

The one sources: `FACTORY/core/set/README.md` (two ways to a plan, the `SetPlan` format, what the program checks and what it leaves to eyes, how making works); the style's set rules `FACTORY/styles/<style>/SETS.md` (§6 the algorithm for the agent, §9 the checks) and their checkable part as data `styles/<style>/set-rules.json` (window layouts, staging presets, shares, the collection curve). The person's word outranks every set rule: put their words in the plan's `humanRequest` and set-rule errors become warnings.

Readiness, who draws (provider), money and the collection: steps 1–2 of ccf-make-cards. Every set lives in a collection.

## 1. Choose the pace

- **Set by set**: plan, check, make and review one set, then the next. Offer this when the request does not say: the person sees the first set before the rest is paid for.
- **One button**: `collection plan` then `collection make` (all 16 sets). Only when the person asked for the whole collection at once.

## 2. Plan

**You write the plan (agent mode, the default).** Follow `SETS.md` §6: §6.2 collection, §6.3 a regular set, §6.4 the grand set, §6.5 variants. Write each set as a `SetPlan` JSON file (`core/set/README.md`). Card orders inside it follow ccf-make-cards step 3; `order.staging` may be a preset (`stagings` of `set-rules.json`). Then check until it reports no errors:

```sh
node FACTORY/ccf.mjs set check PLAN.json [VARIANT2.json …] --collection ID
```

`--collection` checks against the collection's other sets (no repeated item kinds or captions). Variants: one file per variant with `variant: { n, group }` and the same window layout, all checked in one call. Then go through the items the program cannot check («Not checkable by the program» in `core/set/README.md`) yourself.

Your own collection: write, check and make it set by set in collection order. `set check --collection` sees only plans already saved in the collection, and `set make PLAN.json` is what saves a plan, so each set is checked against the ones before it. The whole-collection check (16 sets, the grand set last, the scene curve) runs only inside `collection plan`; for your own plans go through the collection part of `SETS.md` §9 yourself.

**The text model writes the plan (the editor's path; small paid call).** Use when the person asks for it:

```sh
node FACTORY/ccf.mjs set plan --theme TEXT [--wishes TEXT] [--variants N] --collection ID --save
node FACTORY/ccf.mjs collection plan --theme TEXT (--collection ID | --title TEXT) [--wishes TEXT] [--variants N]
```

Read the saved plans (`plan` in each `collections/<c>/sets/<set>/set.json`) the same way before any card is paid for.

## 3. Make the cards

```sh
node FACTORY/ccf.mjs set make PLAN.json --collection ID          # checks, saves as a new set, makes its cards
node FACTORY/ccf.mjs set make --collection ID --set SET_ID [--slots 1,2] [--redo]   # a saved plan
node FACTORY/ccf.mjs collection make --collection ID [--sets N,N]
```

Options: `--provider`, `--parallel`, `--attempts`, `--max-spend`. Caps (`FACTORY/settings/defaults.json`, `_about`): `set.maxSpendUsd` per set, `card.maxSpendUsd` per card inside it, `set.plan.maxSpendUsd` per planning run; `collection make --max-spend` caps the whole run. Tell the person the cap before a paid run and stay inside what they agreed.

Progress: one stderr line per card event. Stop: one Ctrl+C — no new card starts, cards in progress finish, the rest are reported `cancelled`. Running `set make --set SET_ID` again continues: made slots are kept, failed ones are made again.

## 4. Review

- Each card: ccf-review-cards.
- The set as a whole: `ccf.mjs set sheet --collection ID --set SET_ID --out FILE.png`, look at the sheet, go through `SETS.md` §9 and the set part of `styles/<style>/CHECKLIST.md`; a collection: its collection part.
- Fix a slot: the card fixes of ccf-review-cards, or remake it with `set make --collection ID --set SET_ID --slots N --redo`; swap cards with the Store API `moveCard` (`core/README.md`) or in the editor by dragging.

## 5. Show

Editor, when `FACTORY/editor/server.mjs` exists: `node FACTORY/editor/server.mjs --open COLLECTION/SET`. Export: Store API `exportItems({ collectionId, setIds?, format: 'png' | 'zip' })` (no `setIds` = every set), called as in ccf-make-cards step 2; layout in `core/store/README.md`, «Export».

Done when every slot holds a reviewed card, the set's sheet was looked at, and the person has the editor view or the export path, the total spent and every open problem.
