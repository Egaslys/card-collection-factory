# core/style — card order and prompt assembly

The program, not the agent, writes the image-model prompt of a card: it reads the style bible's prompt fragments and puts them together by the style's rules. The agent gives the card's staging and English words; it may append to the prompt (`promptExtra`) or replace it (`promptOverride` — the human's word beats any rule). Author's decision: `docs/plans/VISION.md`, «Источник изображений».

## API

- `validateOrder(order, { styleDir? })` → `Promise<string[]>` — readable errors (Russian), empty when the order can be assembled. `checkOrder(order, style)` is the same, synchronous, with `loadStyle(dir)` from `style.js`.
- `buildPrompt(order, { styleDir? })` → `Promise<{ prompt, fragments, references, sections, legend }>` (`legend`: the prompt's note on the attached images, or null); throws `OrderError` (`.errors`) for an invalid order. `fragments`: `[{ id, source: 'FILE.md:line' }]` in prompt order (items of a labelled block as `id[label]`, glue templates as `template`); `references`: `[{ path, ref }]` — absolute paths of the reference cards to attach, in the order the prompt numbers them; `sections`: the prompt by section.
- `styleDir` defaults to `styles/<order.style>`.

## CardOrder

The JSDoc typedefs in `card-order.js` are the reference; allowed staging values are in `styles/<style>/prompt-assembly.json` → `fields`.

| Field | Meaning |
|---|---|
| `id`, `style` | card id; style folder name (`scapes`) |
| `title` | caption; not used in the prompt |
| `subject` | English description of the hero; required for categories 1–4 |
| `object` | short English name of the hero for the staging phrase («a single [object] …»); required for 1–4 |
| `place`, `environment` | short place name and its English description (category 4 outdoors, scenes) |
| `motif` | backdrop icon motif (pattern `motif_repeat`) |
| `palette` | optional hero-against-backdrop colours: on an abstract backdrop appended after the bible's colour phrase («Here: …»), on a wall as its own line («This card's colours: …»); any other staging leaves it out |
| `staging` | see below |
| `scene` | category 5 only: `theme`, `time` (words: "at sunset"), `action`, `item`, `joke`, `reactor`, `jokeObject`, `crop` (`hips` / `waist` / `knees`), `characters: [{ name, costume? }]` |
| `promptExtra` | appended at the end; also lets a staging the bible has no fragment for pass validation. In a set plan the slot's `wishes` are appended to it (`core/set/README.md`). Written as what is seen, not as prohibitions |
| `promptOverride` | the prompt, verbatim; nothing is assembled (references are still picked) |
| `references` | reference card numbers to attach instead of the picked ones |
| `humanRequest` | the person's words when they asked for a staging no reference card shows; without it such a staging is an error (author's decision: the agent does not choose it on its own). What counts as one staging: `unseen_stagings` of `prompt-assembly.json` |

`staging`: the nine fields of the style's checks spec (`category`, `backdrop`, `pattern`, `placement`, `support`, `camera`, `characters`, `time`, `sky_top` — same names and values as `styles/scapes/checks/check-card.mjs --help`, all required) plus prompt-only fields that pick a variant inside a fragment: `stripes`, `surface`, `medium`, `setting`, `wall`, `floor`, `furniture`, `shape` (default `boxy`), `material` (one label or a list: the labels of the bible's material fragments, e.g. `glossy plastic`, `metal`, `wood`), `effects`, `stage_lights`, `brand`, `brand_finish`. A field is required when its `required_when` in `fields` matches. Strip the prompt-only fields before handing `staging` to the checks.

## Character sheet (`kind: "character-sheet"`)

An anchor portrait of one character, full length on a plain backdrop, the sample that keeps the characters alike from scene to scene (ROADMAP «Опорные портреты персонажей»). Not a card: no staging.

| Field | Meaning |
|---|---|
| `kind` | `"character-sheet"` |
| `id`, `style`, `title` | as for a card |
| `character` | a key of `cast` (`man`, `pig`, `sheep`, `rooster`, `cow`) |
| `costume` | optional English sentence after the character's description (the Man is always dressed: give him one) |
| `promptExtra`, `promptOverride`, `references` | as for a card |

Rules: `kinds["character-sheet"]` of `prompt-assembly.json` — its own `sections` (the bible's `char.sheet` frame, the full description, colour and rendering), `references: "anchor_frames"` (the character's «опорные кадры» from CHARACTERS.md, `cast.<name>.anchor_frames`) and `output`: `orderOutput(order, style)` in `card-order.js` tells the card loop whether to crop to the card size and whether to run the style's pixel checks (for a sheet: neither; `visual` lists the checks for eyes), and `aspectRatio` the frame to ask the provider for instead of the settings' (a sheet: `2:3`; Nano Banana 2.1 answered 848×1264, Codex 1024×1536). Without checks nothing blocks, so `card make` stops after one attempt: run it again for another. The post-processing is the style's start for the model, untuned.

## Fragment markers in the bible

A fragment is marked with an HTML comment, invisible when the Markdown is rendered:

- inline, right before a code span: ``- Category 2: <!-- fragment: base.cat2 -->`a single [object] …` ``;
- alone on its line, right before a fenced block or a blockquote: the marker names that block.

A fenced block whose lines start with `[label]` is a list of items: unlabelled lines are always used, labelled ones when the rules select them (RENDERING style block, materials). A blockquote or plain fenced block is one text; hard line breaks become spaces; a leading `[label]` is its condition and is cut. Slots: `{name}` / `[name]` is a value from the order (map: `slots` in the rules), `{a | b}` / `[a / b]` is a choice (`pick` in the rules names the option by its text or a unique prefix).

## Assembly rules: `styles/<style>/prompt-assembly.json`

- `documents` — the bible files with fragments.
- `fields` — staging vocabulary, defaults, `required_when`; `forbid` — stagings the bible says to avoid.
- `cast` — characters: their fragment and their name in the reference index.
- `slots` — where a named slot's value comes from: an order path (`scene.time`), `$cast` (the scene's character names from their bible descriptions), or `{ field, map }` (a staging field mapped to words).
- `sections` — the prompt in the order of the bible's `PROMPTS.md`. A part is `{ fragment, when?, prefix?, pick?, items?, items_from?, drop_unfilled? }`, `{ template, when?, attach?, optional? }` (glue text written for the program) or `{ cast: true }`. `when` is an object whose keys list allowed staging values (all must match; `not` lists values none of which may match) or a list of such objects (any). A section with `required` must get a part, unless the order has `promptExtra`.
- `references` — how many reference cards to attach, the spec and index they are read from, cards never attached (`exclude`) and cards left out only for the orders a condition matches (`exclude_when`: `[{when, refs}]`), ranking weights, and the two notes that tell the model what the images are. `references.anchors` — the characters' anchor portraits (`styles/<style>/characters/<name>.png`): an order that matches `when` (a scene, category 5) gets one portrait per distinct scene character, attached first (`references` of the built prompt: `{ path, anchor }`, then the cards `{ path, ref }`); `max_images` is the provider limit (Codex `-i`: 5), and the style cards are cut so that portraits + cards fit (two characters and `count` 2 = 4 images, one character = 3); `intro`, `note_anchor` («Image N is the canonical look of the Man: copy its design exactly …») and `note_style` are the legend text, kept only here and put at the end of the prompt. Orders of other kinds and object cards get none. `buildPrompt` returns that note as `legend` too; the card loop passes it to the provider, and Codex, which otherwise writes its own generic legend before the brief («style references, do not copy their subjects»), then says nothing of its own: the prompt's note, the one that names the portraits, is said once.

Tests: `tests/style-prompt.test.mjs` checks that every fragment of the «Для промпта (англ.)» sections is marked, that every fragment, item and option the rules name exists, that the vocabulary matches the checks' `--help`, that every reference card's staging has a staging fragment and every graphic pattern its own fragment, and assembles the five pilot cards (`tests/style-pilot-orders.mjs`) and one order per staging added after the pilot.
