# core/set — planning and making sets and collections

For agents. The product: `docs/plans/VISION.md` («Результат», «Как с продуктом работают»): input — a theme and free wishes (and how many variants); output — several variants, each a whole set of 10 cards in its window; a collection is 16 sets, the 16th the grand set, made with one button or set by set. The style's rules for sets: `styles/<style>/SETS.md` (and `BASE_RULES.md`); their checkable part as data: `styles/<style>/set-rules.json`.

Two ways to a plan, one way to cards:

- **Agent mode.** The agent writes the `SetPlan` itself (the format below), checks it with `ccf.mjs set check PLAN.json [--collection ID]`, and makes it with `ccf.mjs set make PLAN.json --collection ID`.
- **Editor mode (no agent).** The text model of the settings (`set.plan.model`, through `provider.openrouter`) writes the plan: `ccf.mjs set plan --theme … [--variants N] --collection ID --save`, or a whole collection with `ccf.mjs collection plan --theme …`. The plan is validated and the errors go back to the model, at most `set.plan.repairs` times.
- Either way the plan is validated again before any card is paid for, saved in the set's `set.json` (`plan`), and its cards are made by `core/card` `makeCard` into the collection's pool and their slots.

## Modules

| File | What |
|---|---|
| `rules.js` | `loadSetRules(style)` → `{ rules, style }`; `stagingRow`, `rowCategories`, `seenPatterns`, `expandStaging` (presets), `windowSkeleton(rules, layout, scenes)`, `kindKey` |
| `plan.js` | `SetPlan` / `SlotPlan` typedefs, `normalizePlan`, `validatePlan(plan, { registry, variants, titles })`, `registryOf(plan)`, `validateCollection(plans)` |
| `planner.js` | `setPrompt`, `planSet`, `planCollection`, `planFromAnswer`, `parseAnswer`, `textModelFrom(settings)` |
| `cards.js` | loose cards into a collection's pool, outside any set: `cardsPrompt`, `cardsFromAnswer`, `validateCards` (each order by the style, its category by its staging, no item kind twice, the asked count and scenes; a missing category and wishes not reaching a card are warnings), `planCards` (with repairs and the spend cap of `set.plan`), `makeCardsInto` (plan, record its spend as text, make each card with `makeCard` under `set.maxSpendUsd`); prompt glue `prompt.glue.cards` of the style's set-rules.json |
| `make.js` | `planSetInto`, `planCollectionInto` (plan with the text model and save into the collection: the one composition the CLI and the editor call), `saveSetPlan`, `makeSet`, `makeCollection`, `collectionContext` |
| `sheet.js` | `setSheet` — a contact sheet PNG of a set (cards in window order, stars, frame, caption) to look at the set as a whole |
| `cli.js` | `setCommands` — the `set …` and `collection …` commands that `ccf.mjs` dispatches to |

The text model: `core/providers/openrouter-text.js` `complete()` (chat completions, JSON mode).

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

Every order by the style (`checkOrder`: staging vocabulary, forbidden and unseen stagings without `humanRequest`, assembly); the category the staging row gives; 10 slots; the window's stars, frames and scene count; scenes as the window's tail (small windows: slots 9–10); gold by the layout (large: exactly on the scenes); no repeated item kind in the set; categories 1–4 each at least once (more than 3 of one — a warning); the share of abstract backdrops (small 4–8, large 3–5), 3–6 patterns, at most 3 of one, a pattern on every abstract backdrop, `hue` on each, neighbouring abstract slots not equal in pattern and hue; at least one scene plays an item of the set (warning); captions 1–2 words (grand: 1), 3–15 characters, unique in the set and the collection; the grand set's one place; the collection registry — no hero kind or scene prop of another set, no repeated set title; variants — the same window layout, at most 5 shared item kinds, each shared kind in another staging row. Warnings: a plan with `wishes` whose slot has no `wishes` field, and a slot `wishes` worded as a prohibition (no, not, without, never, avoid…). `validateCollection`: 16 sets, the grand set last, more scenes in the last five regular sets than in the first five.

Not checkable by the program, left to eyes: whether the caption names what is drawn, the angle against close themes, «two items of the same purpose», fine texture on the hero, how funny a scene is.

## Making

`makeSet({ collection, plan | set, settings, provider, limits })`: `plan` is validated against the collection (`collectionContext`: registry from the other sets' stored plans; a set without a plan is reported, its items unknown) and saved as a new set (`saveSetPlan`; variants join their group's store variant group and number); `set` uses the stored plan. Slots that hold a made card are kept (`redo` makes them again); a failed card is continued. `settings.set.parallel` cards at a time; one spend cap for the set (`settings.set.maxSpendUsd`): each card gets the smaller of `card.maxSpendUsd` and what is left after spent and in-progress cards, and a card is skipped once that is below the highest price per image seen in the set. `makeCollection` makes the sets by number, with an optional cap for the whole run.

Both take `signal` (an `AbortSignal`: once aborted no new card or set starts, the cards in progress finish; the remaining slots are reported `cancelled`; the CLI aborts on the first Ctrl+C) and `progress(text, event)`: the text for a person and a structured event — making: `{ set, slot, cardId, title, status: start | made | failed | skipped | kept | cancelled, spent }`; planning (`planSetInto`, `planCollectionInto`): `{ number?, title, status: planning | planned | invalid, set? }`.

## Tests

`tests/set-plan.test.mjs` (rules, validation, planning with a fake text model), `tests/set-make.test.mjs` (real card loop, temporary store, fake image provider, the sheet); fixture `tests/set-fixtures.mjs`.
