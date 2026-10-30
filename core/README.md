# core — the product's operations

For agents. The product's vision: `docs/plans/VISION.md` («Устройство и стек», «Как с продуктом работают»). Everything a person can do in the editor and an agent can do with `ccf.mjs` is an operation here; the editor server and the CLI are thin callers. No operation lives only in a caller.

## Modules

| Folder | What | Owner of the contract |
|---|---|---|
| `providers/` | image generation: OpenRouter-compatible endpoint, Codex CLI; each model's profile (ratios, reference images, request fields) | `openrouter.js`, `codex-cli.js`, `models.js` |
| `image/` | model image → card pixels (`prepare.js`), post-processing shared with the browser (`adjust.js`, no imports) | |
| `style/` | card orders, prompt assembly from the bible's fragments, reference picking | `style/README.md` |
| `card/` | one card: generate → prepare → hero outline (`hero.js`) → tune → check → the vision model's look (`look.js`) → regenerate (`make.js`); a person's requests: regenerate with a wish, edit, adjust by hand (or reset to the program's own), import an image (checked as strictly as a generated one), choose any version (attempt) as the card; recheck | `card/card-file.js` |
| `store/` | collections, sets, the card pool, moves, export, live events | `store/README.md` |
| `set/` | planning a set and a collection by the style's rules, generating them; loose cards into a collection's pool | `set/README.md` |
| `text/` | text help: a producer's rough notes → the finished text of a field (`draft.js` `draftText`) | `text/draft.js` |
| `settings.js` | `settings/defaults.json` + `settings/local.json`; the key is never in settings | |

## Data layout

The factory folder `collections/` (collections, their sets, the collection's card pool, exports) and the formats of `collection.json` and `set.json`: [store/README.md](store/README.md), the one description. A card belongs to the collection, not to a set; which set it sits in is recorded only in `set.json` slots.

## Store API (the agreed contract; `store/` implements it, `set/`, `card/`, the editor and `ccf.mjs` call it)

Import from `core/store/index.js`; `createStore({ root })` gives the same operations over another folder. Exact behaviour: JSDoc in `store/store.js`.

```
listCollections() → [{ id, title, description, setCount, cardCount, cover }]
createCollection({ title, description, fields?, style? }) → Collection
getCollection(collectionId) → { collection, sets: CardSet[], pool: CardSummary[] }   // pool = cards in no set
updateCollection(collectionId, patch) / deleteCollection(collectionId)           // delete = OS trash
createSet(collectionId, { title, brief: { theme, wishes, variants }, window: { kind, template }, number?, variantGroup?, plan?, … }) → CardSet
getSet(collectionId, setId) / updateSet(collectionId, setId, patch) / deleteSet(collectionId, setId)
                                                     // set.json keeps `plan` (core/set) and any other key as given
setSlots(collectionId, setId, slots)                 // 10 card ids or null, window order; slot = 0-based index
moveCard(collectionId, cardId, { setId, slot } | { pool: true }) → CardSummary   // into a taken slot: the cards swap
deleteCard(collectionId, cardId)                     // OS trash; its slot becomes empty
newCardId(collectionId, base) → id                   // sync; unique, readable (from the card's title); creates the folder
cardDir(collectionId, cardId) → absolute path        // sync; where core/card writes the card
listCards(collectionId, { setId? , pool? }) → CardSummary[]   // id, title, image, status, checks, cost, setId, slot
exportItems({ collectionId, setIds?, cardIds?, format: 'png' | 'zip', name? }) → { path, files, skipped }
recordSpend(collectionId | null, { kind: 'images'|'vision'|'text', what, model, usd })   // a paid call no card records
spend({ collectionId? }?) → { images, vision, text, total, unknown }                    // USD by kind: a collection, or the factory
openFolder(path)                                     // the OS file manager
watch(onEvent, { debounceMs?, pollMs?, poll? }?) → stop   // { type: 'collection' | 'set' | 'card', collectionId, id, change }
```

## Calling conventions

- Every operation is an exported async function taking one options object and returning plain JSON-able data; errors throw with a Russian message a person can act on.
- Paid operations take a spend cap and report cost.
- Writes go through `store/` only, so the editor's live view (file events) sees every change, whoever made it.
- The API key: from the environment / `.env` (permanent) or held in memory by a running editor (temporary). An agent without a key uses a running editor's key by sending the operation to the editor server; the key never leaves the editor process.
