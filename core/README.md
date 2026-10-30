# core — the product's operations

For agents. The product's vision: `docs/plans/VISION.md` («Устройство и стек», «Как с продуктом работают»). Everything a person can do in the editor and an agent can do with `ccf.mjs` is an operation here; the editor server and the CLI are thin callers. No operation lives only in a caller.

## Modules

| Folder | What | Owner of the contract |
|---|---|---|
| `providers/` | image generation: OpenRouter-compatible endpoint, Codex CLI | `openrouter.js`, `codex-cli.js` |
| `image/` | model image → card pixels (`prepare.js`), post-processing shared with the browser (`adjust.js`, no imports) | |
| `style/` | card orders, prompt assembly from the bible's fragments, reference picking | `style/README.md` |
| `card/` | one card: generate → prepare → tune → check → regenerate (`make.js`), recheck, hero outline (`hero.js`) | `card/card-file.js` |
| `store/` | collections, sets, the card pool, moves, export, live events | `store/README.md` |
| `set/` | planning a set and a collection by the style's rules, generating them | `set/README.md` |
| `settings.js` | `settings/defaults.json` + `settings/local.json`; the key is never in settings | |

## Data layout (one source: `store/README.md` once written; until then this section)

```
collections/<collection>/
  collection.json        id, title, description, fields {…}, style, set order
  cards/<card>/          the collection's card pool: every card lives here once (card.json, card.png, attempts/)
  sets/<set>/set.json    id, title, number in the collection, brief (theme, wishes), window (kind, template colour),
                         slots: 10 card ids or null in window order, variant group
  export/                what export wrote; «Открыть в папке» opens it
```

A card belongs to the collection, not to a set: moving a card between sets or back to the pool changes only `set.json` slots. A set variant is a set with the same variant group.

## Store API (the agreed contract; `store/` implements it, `set/`, `card/`, the editor and `ccf.mjs` call it)

```
listCollections() → [{ id, title, description, setCount, cardCount, cover }]
createCollection({ title, description, fields?, style? }) → Collection
getCollection(collectionId) → { collection, sets: Set[], pool: CardSummary[] }   // pool = cards in no set
updateCollection(collectionId, patch) / deleteCollection(collectionId)           // delete = OS trash
createSet(collectionId, { title, brief: { theme, wishes, variants }, window: { kind, template }, number?, variantGroup? }) → Set
getSet(collectionId, setId) / updateSet(collectionId, setId, patch) / deleteSet(collectionId, setId)
setSlots(collectionId, setId, slots)                 // 10 card ids or null, window order
moveCard(collectionId, cardId, { setId, slot } | { pool: true })
newCardId(collectionId, base) → id                   // unique, readable (from the card's title)
cardDir(collectionId, cardId) → absolute path        // where core/card writes the card
listCards(collectionId, { setId? , pool? }) → CardSummary[]   // id, title, image, status, cost, check summary, setId, slot
exportItems({ collectionId, setIds?, cardIds?, format: 'png' | 'zip' }) → { path }
openFolder(path)                                     // the OS file manager
watch(onEvent) → stop                                // { type: 'collection' | 'set' | 'card', collectionId, id, change }
```

## Calling conventions

- Every operation is an exported async function taking one options object and returning plain JSON-able data; errors throw with a Russian message a person can act on.
- Paid operations take a spend cap and report cost.
- Writes go through `store/` only, so the editor's live view (file events) sees every change, whoever made it.
- The API key: from the environment / `.env` (permanent) or held in memory by a running editor (temporary). An agent without a key uses a running editor's key by sending the operation to the editor server; the key never leaves the editor process.
