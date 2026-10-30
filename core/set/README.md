# core/set — planning and making sets and collections

For agents. The product: `docs/plans/VISION.md` («Результат», «Как с продуктом работают»): input — a theme and free wishes (and how many variants); output — several variants, each a whole set of 10 cards in its window; a collection is 16 sets, the 16th the grand set, made with one button or set by set. The style's rules for sets: `styles/<style>/SETS.md` (and `BASE_RULES.md`); their checkable part as data: `styles/<style>/set-rules.json`.

Two ways to a plan, one way to cards:

- **Agent mode.** The agent writes the `SetPlan` itself (the format below), checks it with `ccf.mjs set check PLAN.json [--collection ID]`, and makes it with `ccf.mjs set make PLAN.json --collection ID`.
- **Editor mode (no agent).** The text model of the settings' service (`provider.<preset>.textModel`, through `provider.preset`: openrouter or google; limits in `set.plan`) writes the plan: `ccf.mjs set plan --theme … [--variants N] --collection ID --save`, or a whole collection with `ccf.mjs collection plan --theme …`. The plan is validated and the errors go back to the model, at most `set.plan.repairs` times; an empty or cut answer is asked for again as it was, at most `set.plan.retries` times. A plan that passes is read once more by the text model in a separate small call (the self-check, the style's `prompt.glue.review`: the same brief and the plan, it names what the program cannot check); what it finds goes back as one more repair while repairs are left — if that repair breaks the rules, the plan that passed stands —, else it becomes the plan's warnings («самопроверка: …»). The program's validation stays the gate.
- Either way the plan is validated again before any card is paid for, saved in the set's `set.json` (`plan`), and its cards are made by `core/card` `makeCard` into the collection's pool and their slots.

## Modules

| File | What |
|---|---|
| `rules.js` | `loadSetRules(style)` → `{ rules, style }`; `stagingRow`, `rowCategories`, `seenPatterns`, `expandStaging` (presets), `windowSkeleton(rules, layout, scenes)`, `kindKey`, `cardBudget(cap, perCard)` (the spend cap of cards made a few at a time, for `makeSet` and loose cards: each card reserves its own cap; a card that finds nothing left waits for a running one to finish instead of starting with a cap of 0) |
| `plan.js` | `SetPlan` / `SlotPlan` typedefs, `normalizePlan`, `readyOrder(order)` (an order from a plan made ready for `card prompt`: preset expanded, temporary id), `validatePlan(plan, { registry, variants, titles })`, `slotLookErrors(slot, style)`, `registryOf(plan)`, `validateCollection(plans)` |
| `planner.js` | `setPrompt`, `planSet`, `planCollection`, `planFromAnswer`, `parseAnswer`, `textModelFrom(settings)`; shared with loose cards: `setFragment`, `answerParts` (staging ids and values, answer format, wishes), `slotFromAnswer`, `glue` |
| `cards.js` | loose cards into a collection's pool, outside any set: `cardsPrompt` (the set planner's `setFragment` and `answerParts`), `cardsFromAnswer` (`slotFromAnswer`, shared with `planFromAnswer`), `validateCards` (each order by the style, what the image model will read (`slotLookErrors`; warnings when the order has a `humanRequest`), its category by its staging, no item kind twice, the asked count and scenes; a missing category and wishes not reaching a card are warnings), `planCards` (with repairs and the spend cap of `set.plan`; 1 to `set.cards.maxCount` cards a run), `makeCardsInto` (plan, record its spend as text, make each card with `makeCard` under `set.maxSpendUsd`); prompt glue `prompt.glue.cards` of the style's set-rules.json |
| `make.js` | `planSetInto`, `planCollectionInto` (plan with the text model and save into the collection: the one composition the CLI and the editor call; a collection that has sets: `mode` missing — its `missingPlaces` — or variants — one more variant of every place), `saveSetPlan` (`set save PLAN.json --collection ID [--set ID]`: a new set, or with `--set` the plan of an existing one, the earlier plan kept in `planVersions`), `makeSet`, `makeCollection`, `collectionContext`, `storedPlan`; the editor's one-button runs `buildSet` and `buildCollection` (plan, then the cards of the sets just planned, under `runCap`) |
| `sheet.js` | `setSheet` — a contact sheet PNG of a set (cards in window order, stars, frame, caption) to look at the set as a whole |
| `cli.js` | `setCommands` — the `set …` and `collection …` commands that `ccf.mjs` dispatches to |

The text model: the service of the run, through `core/providers/preset.js` (`textModelFrom` in `planner.js`; JSON mode).

## SetPlan

```
{
  style: "scapes",
  title: "Lake Fishing",            // the set name, 1–2 words (SETS.md 1.2)
  theme: "Рыбалка на озере",        // as asked
  wishes?: "…",                     // the producer's words
  angle: "…",                       // one line (SETS.md 1.3)
  themeKind?, collectionTheme?, number?,   // number: place in the collection, 1–16
  grand?: true, place?: "…",        // grand set: one place, every scene's order.place equals it
  window: { layout: "large", template?: "blue", reason?: "…" },
  variant?: { n: 2, group: "lake-fishing" },
  language?: "English",
  humanRequest?: "…",               // the person's words departing from the set rules: set-rule errors become warnings
  slots: [ SlotPlan × 10 ]          // window order: 1–5 top row, 6–10 bottom row
}

SlotPlan {
  stars: 1–5, frame: "silver" | "gold" | "crystal",
  kind: "fishing bobber",           // the item kind (for a scene: its situation); compared across the collection
  facet?, subkind?,                 // SETS.md 3.2
  props?: ["fishing rod", …],       // scenes: noticeable item kinds (in hands, played with, background)
  hue?: "sky blue",                 // abstract backdrops: the backdrop colour word (also say it in order.palette)
  wishes?: "Warm low morning sun.", // with plan.wishes: what they ask of this card in English, as what is seen; "" = nothing
  order: CardOrder                  // core/style/README.md; order.title is the caption
}
```

- `window.layout` is a key of `set-rules.json` `windows` (`large`, `small-all-one`, `small-tail`, `small-gold-characters`, `small-gold-items`, `small-characters-silver`, `grand`); its `family` is the store's `window.kind`. Exact stars where the layout has them; otherwise the set's own ladder by `stars_order`, the reference ladders in `examples`.
- `order.staging` may be a preset: `{ "preset": "field", "pattern": "rays", "material": "metal" }` — the presets are the rows of BACKGROUNDS.md «Какую постановку выбрать» (`stagings` of `set-rules.json`: `preset` values, `fill` = what to add). `normalizePlan` expands them; the plan saved in `set.json` is the expanded one.
- `wishes` (VISION.md: the producer's theme and wishes go into each card's description): `normalizePlan` appends a slot's `wishes` to its `order.promptExtra` (once), so they reach the image prompt and the vision model's look; the planning model is asked to write them and to let the wishes shape the cards' own fields (staging `time`, environment, scene). The producer's words in `plan.wishes` alone reach no image.
- `order.id` may be left out: the plan gives `<set>-<slot>-<caption>`; the card loop makes it unique in the collection.

## What validatePlan checks (SETS.md 9 and the rules it points to)

Every order by the style (`checkOrder`: staging vocabulary, forbidden and unseen stagings without `humanRequest`, assembly); the category the staging row gives; 10 slots; the window's stars, frames and scene count; scenes as the window's tail (small windows: slots 9–10); gold by the layout (large: exactly on the scenes); no repeated item kind in the set; categories 1–4 each at least once (more than 3 of one — a warning); the share of abstract backdrops (small 4–8, large 3–5), 3–6 patterns, at most 3 of one, a pattern on every abstract backdrop, `hue` on each, neighbouring abstract slots not equal in pattern and hue; at least one scene plays an item of the set (warning); captions 1–2 words (grand: 1), 3–15 characters, unique in the set and the collection; the grand set's one place; the collection registry — no hero kind or scene prop of another set, no repeated set title; variants — the same window layout, at most 5 shared item kinds, each shared kind in another staging row; what the image model will read (`slotLookErrors(slot, style)`, SETS.md 9.22–9.24, data in set-rules.json `orders`): day light on cards without characters, golden hour on at most 2 cards, a backdrop `hue` unlike the hero's main colour in `palette` (word table → hue; COLOUR.7's least difference read from the style's checks/thresholds.json, or a lighter or darker class), no fine-texture or mirror-metal words in subject, environment, scene or wishes (each message says what to write instead). Warnings: a plan with `wishes` whose slot has no `wishes` field, and a slot `wishes` worded as a prohibition (no, not, without, never, avoid…). `validateCollection`: 16 sets, the grand set last, more scenes in the last five regular sets than in the first five.

Not checkable by the program, left to eyes: whether the caption names what is drawn, the angle against close themes, «two items of the same purpose», fine texture on the hero, how funny a scene is.

## Making

`makeSet({ collection, plan | set, settings, provider, limits })`: `plan` is validated against the collection (`collectionContext`: registry from the other sets' stored plans; a set without a plan is reported, its items unknown) and saved as a new set (`saveSetPlan`; variants join their group's store variant group and number); `set` uses the stored plan. Slots that hold a made card are kept (`redo` makes them again); a failed card is continued. `settings.set.parallel` cards at a time; one spend cap for the set (`settings.set.maxSpendUsd`): each card gets the smaller of `card.maxSpendUsd` and what is left after spent and in-progress cards, and a card is skipped once that is below the highest price per image seen in the set. `makeCollection` makes the sets by number (or only the given `numbers` or set ids `sets`), each set — each variant is a set — under its own cap, with an optional cap for the whole run.

**Planning stops cleanly.** `planSet` / `planCollection` never throw after a paid call: the spend cap of `set.plan` (counted over the whole run, the collection's split included), an answer without a price, a failed call or the `signal` end the run with `stopped` (a Russian message); a variant or set whose answers never read as a plan comes back with `plan: null` and its errors, and the next ones are still planned. `planSetInto` / `planCollectionInto` save every plan finished before the stop and record what was spent (an unpriced call as an entry without a price) before returning; `planCollectionInto` throws only when nothing was planned (the split did not come out, or the first call already stopped), after recording.

**The key.** When the service refuses the key or wants money (core/card/make.js: a card's `stop: 'key'` with `keyProblem`, or a provider error of kind auth / billing), the run stops instead of failing card after card: `makeSet` and `makeCardsInto` start no new card (the rest `cancelled`, the ones in flight finish), `makeCollection` no new set, the planner no new call; everything made is kept, the spend recorded, and the result carries `keyProblem` and its one message first in `warnings` (`keyStopText`: «С ключом проблема: … Готовое сохранено.»), which the editor's job shows.

**A collection that already has sets** (the author's decision, 2026-10-31: the person chooses). `mode: 'missing'` plans only its missing places, with their numbers, against the registry of the sets it has. `mode: 'variants'` plans one more variant of every place's set — its theme, window and scene count, the place's number and variant group (the plan's `variant.group`, else the store's `variantGroup`), checked by the variant rules against it; nothing is replaced, the person picks the chosen variant — and a new set on every empty place (the split into themes is asked only when some place is empty). `storedPlan(set)` gives a stored plan its place's number and group, so a set planned alone is known as the first variant of its group.

**Plan versions.** Replacing a set's plan (`saveSetPlan` with `set`, `set save --set`) moves the earlier one into the set's `planVersions` (`{at, plan}`, newest first), the last `set.plan.keepVersions` kept.

**One button (the editor's «Собрать набор», «Собрать все наборы», «Сразу все 16»).** `buildSet` = `planSetInto` then `makeCollection` over the sets it saved; `buildCollection` = `planCollectionInto` (by `mode`) then `makeCollection` over the sets this run planned, never the ones the collection had. Caps (`runCap`) are a safety net for agents and the command line, not shown in the editor (the author's decision, 2026-10-31: the person limits spend on their provider's key): every set, each variant included, keeps `set.maxSpendUsd`; the cards of the whole run at most that × the sets planned (or the run's `maxSpendUsd`); the planning its own `set.plan.maxSpendUsd` (`planMaxSpendUsd`).

Both take `signal` (an `AbortSignal`: once aborted no new card or set starts, the cards in progress finish; the remaining slots are reported `cancelled`; the CLI aborts on the first Ctrl+C) and `progress(text, event)`: the text for a person and a structured event — making: `{ set, slot, cardId, title, status: start | made | failed | skipped | kept | cancelled, spent }`; planning (`planSetInto`, `planCollectionInto`, both also taking `signal`): `{ number?, title, status: planning | planned | invalid, set? }`; the one-button runs also send `{ total }`, the planning's spend, once it is known.

## Tests

`tests/set-plan.test.mjs` (rules, validation, planning with a fake text model), `tests/set-make.test.mjs` (real card loop, temporary store, fake image provider, the sheet); fixture `tests/set-fixtures.mjs`.
