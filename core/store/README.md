# core/store — collections, sets, the card pool

For agents. The one description of the factory folder's layout and of `collection.json` / `set.json`. The card folder's own files (`card.json`, `card.png`, `attempts/`) are described in `core/card/card-file.js`. The operations are listed in `core/README.md` («Store API»); their exact behaviour is in the JSDoc of `store.js`.

## Entry points

- `index.js` — the Store API over the factory's `collections/`: `import { listCollections, createSet, … } from './core/store/index.js'`. Also re-exports `createStore`, `slugify` and the layout constants.
- `store.js` — `createStore({ root, trashMove?, spawn?, platform? })`: the same operations over another folder (tests use a temporary one).
- `layout.js` — file and folder names, `SLOT_COUNT`, `DEFAULT_STYLE`: the one place for these values; `windowKinds(style)` and `windowTemplates(style, kind)` read the window kinds and their colour templates from the style's `windows/windows.json`, their one source.
- `ids.js` (readable ids), `files.js` (atomic writes), `zip.js` (ZIP writer, no dependency), `watch.js` (live events).

## Layout

```
collections/                         ignored by Git
  <collection>/
    collection.json
    sets/<set>/set.json
    cards/<card>/                    the collection's card pool: every card lives here once
      card.json  card.png  attempts/<n>/…      (core/card/card-file.js)
    export/                          what exportItems wrote; «Открыть в папке» opens it
```

A card belongs to the collection, not to a set. Which set a card sits in is recorded only in `set.json` → `slots`; `card.json` does not know it. Moving a card between sets or back to the pool rewrites only `set.json` files. A card is in at most one slot of one set: `setSlots`, `moveCard` and `updateSet({ slots })` take it out of any other place. A card in no set is in the pool.

A folder under `collections/` without `collection.json` is not a collection: `listCollections` skips it.

## Ids

An id is the folder name: a slug of the title (Cyrillic transliterated, lower case, `a-z0-9-`, at most 40 characters), `-2`, `-3`, … when taken. The id is reserved by creating its folder, so parallel writers never get the same one (`newCardId` creates the empty card folder at once). Ids passed in must match `^[\w][\w.-]*$`; anything else is refused (no `..`).

## collection.json

```json
{
  "id": "letnyaya-rybalka",
  "title": "Летняя рыбалка",
  "description": "free text: what the collection is",
  "fields": { "season": "лето" },
  "style": "scapes",
  "sets": ["ozero", "more"],
  "cover": "poplavok",
  "createdAt": "2026-10-30T10:00:00.000Z",
  "updatedAt": "2026-10-30T10:05:00.000Z"
}
```

- `fields` — free-form fields of the collection; `updateCollection({ fields })` replaces the object as a whole.
- `style` — `styles/<style>`; `DEFAULT_STYLE` when not given.
- `sets` — the collection's set order. `updateCollection({ sets })` must list every set exactly once. A set folder missing from the list (written by hand) is shown after the listed ones, by number.
- `cover` — optional: the card a person chose as the collection's cover (`updateCollection({ cover })`: a card of the collection, or `null`). `listCollections` gives its image as `cover`; without one, or when that card has no image (or is gone), the first card in the first set, else any card.

## set.json

```json
{
  "id": "ozero",
  "title": "Озеро",
  "number": 1,
  "brief": { "theme": "озеро", "wishes": "без лодок", "variants": 2 },
  "window": { "kind": "large", "template": "blue" },
  "slots": ["poplavok", null, null, null, null, null, null, null, null, null],
  "variantGroup": "ozero",
  "plan": { "…": "core/set's SetPlan, stored as given" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

- `number` — the set's number in the collection; default: the largest so far + 1. Variants of one set may share it.
- `brief` — the producer's input in free text; defaults `""`, `""`, `1`. `updateSet({ brief })` merges key by key.
- `window` — `kind` one of the style's window kinds, `template` one of that kind's colour templates (both from `styles/<style>/windows/windows.json` through `layout.js`; for Scapes: `large`, `small`, `grand`; `blue`, `violet`, `crimson`, `orange` for the large and small windows, `crystal` for the grand one — `styles/scapes/SETS.md` §4). Defaults: the style's main window (`large`; SETS.md §4.3: a single set goes in the large window by default) and the kind's first template (which template is the default is not decided by the author); a template that does not fit a changed kind and was not given becomes the new kind's first. Other keys inside `window` are kept. `updateSet({ window })` merges key by key.
- `slots` — `SLOT_COUNT` (10) card ids or `null`, in window order: row by row, left to right. In the API a slot is the **0-based index** into this array; export file names number slots from 01.
- `variantGroup` — sets with the same group are variants of one set; a new set's group is its own id.
- `plan` — optional, owned by `core/set`; the store keeps it as given.
- `places` — optional, owned by `core/set` (`core/set/places.js`): the stars and frame a person set on each place of the window, `{ stars, frame }` or `null` per slot, over the plan's; the store keeps it as given.
- Any other top-level key passed to `createSet` / `updateSet` is stored and kept on later updates. `id`, `createdAt`, `updatedAt` are set by the store only.

## Card summary (`listCards`, `getCollection().pool`, `moveCard`)

`{ id, title, orderId, image, status, checks, attempts, cost, spend, costUnknown, model, setId, slot, updatedAt, busy, error? }`

- `title` — the order's `title`, else its `object`, else the id.
- `orderId` — the order's `id`, kept when the title changes: which order of a set plan the card was made from (`core/set/places.js`).
- `image` — absolute path of `card.png`, `null` while there is none.
- `status` — `new` (no attempt yet, e.g. a reserved id), `made` (a chosen attempt and `card.png`), `failed` (attempts, none usable).
- `checks` — of the chosen attempt: `{ blocking, warns, needsEyes, maskStatus }`; `needsEyes` = FAILs that rest on an unconfirmed hero outline. `null` when the attempt has no check summary.
- `cost` — USD, the sum of attempts whose cost is known (images and the vision model's calls); `spend` — the same split `{ images, vision }`; `costUnknown` — how many attempts have no reported cost.
- `model` — the model that made the chosen version (`agent` for an image handed in); `null` without one.
- `setId`, `slot` — where the card sits; `null` in the pool.
- `busy` — the long operations running on the card now, in any process (`make`, `regenerate`, `edit`, `import`; `core/card/card-file.js` busy markers); `[]` when none. The editor's card panel holds its actions meanwhile.
- `error` — `card.json` could not be parsed (the rest of the list still works).

`listCards(c)` — all cards, oldest folder first; `{ setId }` — that set's cards in slot order; `{ pool: true }` — cards in no set.

## Spend

`spend({ collectionId? })` → `{ images, vision, text, total, unknown }` (USD, known costs; `unknown` = calls without a reported price). Images and the vision model's calls are read from the cards' `card.json` (every attempt); the text model's calls (plans, text help), which no card records, from the factory's ledger `collections/spend.jsonl` (`SPEND_FILE`): one JSON line per call `{ at, collectionId, kind, what, model, usd }`, appended by `recordSpend(collectionId | null, { kind, what, model, usd })` — appending, so several processes never overwrite each other. With a collection: its cards and its ledger lines. Without: every collection there is now and the ledger lines of no collection (the text of a collection not yet created); a deleted collection's spend is not counted.

## Deleting

`deleteCollection`, `deleteSet`, `deleteCard` move the folder to the OS trash through `tools/trash.mjs`, allowed only strictly inside the collections folder. A deleted set's cards stay in the pool; a deleted card leaves its slot empty.

## Export

`exportItems({ collectionId?, setIds?, cardIds?, pool?, originals?, format: 'png'|'zip', name?, language? })` → `{ path, files, skipped }`.

```
collections/<c>/export/<name>/            (or <name>.zip with the same tree inside)
  <Collection title>/
    01 <Set title>/01 <Card title>.png    sets by number, cards by slot (empty slots skipped)
    Хранилище/<Card title>.png            the pool's cards: those in no set (pool)
    Карточки/<Card title>.png             the chosen single cards (cardIds)
```

- No `setIds`, no `cardIds` and no `pool` — every set of the collection, in the collection's order, and the pool (a collection of loose cards only exports its pool). `pool: true` adds the pool to the chosen sets or cards (the editor's collection export: the chosen variant of each set and the pool). Only `cardIds` — only the «Карточки» folder.
- `language` — `ru` (default, the terminal) or `en`: the names inside the export a person reads (`EXPORT_NAMES` in `layout.js`: «Хранилище» / «Pool», «Карточки» / «Cards», «(оригинал)» / «(original)»). The editor passes the page's language.
- `name` — default: local time `YYYY-MM-DD HH-MM-SS`. A name already in `export/` gets ` (2)`; an export never overwrites another.
- File names are the titles a person reads: characters that file systems refuse are replaced, length ≤ 80, repeats get ` (2)`.
- Cards without `card.png` are skipped and listed in `skipped`. Nothing to export → an error.
- ZIP: written by `zip.js` (deflate, or stored when that is not smaller, as PNG usually is; names in UTF-8, flag bit 11; no ZIP64 — over 4 GiB or 65 535 files is refused).

`openFolder(path)` opens it in the OS file manager: `open` (macOS), `explorer` (Windows), `xdg-open` (Linux).

## Writes and live events

Every JSON write goes to `<file>.<pid>.<random>.tmp` and is renamed over the target, so a reader sees the old file or the new one. Writes are synchronous inside each operation, so one process never interleaves two operations; two processes writing the same `set.json` at the same moment can still lose one update (no cross-process lock). `card.json` is written by core/card under a per-card lock, safe across processes (`core/card/card-file.js`).

`watch(onEvent, { debounceMs = 150, pollMs = 1000, poll = false }?)` → `stop()`. Events: `{ type: 'collection'|'set'|'card', collectionId, id, change: 'created'|'updated'|'deleted' }`.

- `collection` — `collection.json`; `set` — `set.json`; `card` — the card folder appearing or disappearing, `card.json` or `card.png` changing, a long operation starting or ending on it (its busy markers). Attempt files and exports give no event.
- `fs.watch` (recursive) marks a collection as touched; `debounceMs` after the first touch the watcher compares that collection's files (time and size) with the last state, so a burst of writes gives one event per entity, and a long run of writes still gives an event every `debounceMs`. Where recursive `fs.watch` is unavailable or fails, the whole folder is polled every `pollMs`; `poll: true` forces that.
- Events come in the order collection, set, card. Card files that core/card writes in place (`card.png` is copied, not renamed) could be read mid-write; the delay makes that unlikely but does not rule it out — a reader that fails on `card.png` should retry on the next event.
