---
name: ccf-editor
description: Develop the factory's web editor — editor/server.mjs (the local server, its JSON API over core operations, jobs, the key, live events), editor/web/ (the page) and editor/design-system/. Use before changing anything under editor/, or when an agent needs a running editor's operations.
---

# Develop the editor

The editor is for the person: check the work at a glance, rearrange cards, adjust a card, change settings, generate without an agent (`docs/plans/VISION.md`: its sections on the web application and on how the product is used — nesting, live updates, the key, export, the feel). It is being built now: read the current files before relying on this skill, they win where the two differ.

## Parts

| Path | What |
|---|---|
| `editor/server.mjs` | the local server: `node editor/server.mjs [--port N] [--open COLLECTION[/SET]] [--no-browser]` runs it in the foreground (the launchers `run.command`, `run.sh`, `run.bat` do this); `node ccf.mjs editor [--open …] [--no-browser] [--port N] \| --stop` runs it in the background for an agent (output in `.ccf/editor.log`). Listens on 127.0.0.1 only; every API call carries this run's token. Its header lists what it serves; `startEditor()` and `runningEditor()` for code |
| `editor/server/ops.js` | one entry per core operation, mapping the request's JSON to the core call; `job: true` = long, run by `jobs.js`. The live list: `GET /api/ops` of a running editor |
| `editor/server/jobs.js` | long operations: progress to every page, waiting, cancelling through an `AbortSignal` |
| `editor/server/key.js` | the key: permanent from the environment / `.env`, temporary only in this process's memory; the page sees only its status (permanent, temporary, none), never any part of the key |
| `editor/remote.js` | an agent's way in: `findEditor()` reads `.ccf/editor.json` (exists while the editor runs, ignored by Git), `callEditor(editor, op, args, {onLog, signal})` runs an operation with the editor's key and waits for a job; `hereOrInEditor()` is how the paid `ccf.mjs` commands run here or, with no key here, in the editor — a paid op's arguments must cover its command's options |
| `editor/web/` | the page: `app.js` (top bar, router collections → collection → set, the card as a panel, live updates), `api.js`, `state.js`, `ui.js`, `window.js` (a set over the style's window template in the window of its kind — set.json `window.kind`: the main window or a `families` entry such as small or grand —, geometry, frames and stars from `styles/<style>/windows/windows.json`), `screens/`, `panels/`, `editor.css` |
| `editor/design-system/` | the accepted look: `DESIGN.md` is the single source of every value, `tokens.js` turns it into CSS variables, `components.css` holds the controls; `README.md` for a person; its open decisions at the end of `DESIGN.md` |

## Invariants

- **Product logic lives in core.** An editor feature that needs a new capability is a core operation first (ccf-core), then its `ccf.mjs` command, then its entry in `ops.js`: the agent can do everything the person can.
- **The preview equals the card**: the page imports `core/image/adjust.js` itself (the server's shared files), never a copy.
- **The page shows what the checks say**: the card panel's counts come from `check.needsEyes` (not recomputed from `fails`), and the vision model's issues (`look.issues`), or that it found none, are shown — all for the version the panel shows (every attempt is a version; arrows flip them, the "make it the card" button is `chooseAttempt`). Spend is shown split by kind (`spend` op: images, text, vision) in the top bar and per version in the card panel; the key is shown only as a status. Free-text fields carry the text help (`textHelp`/`bindTextHelp` in `ui.js`, op `draftText`). Settings screen: `look.use` and `vision.model` in its own section (the vision model on or off, and which model).
- **Live**: the page follows the store's events (`/api/events`), so whatever an agent writes appears by itself.
- **The key never leaves the editor process**: not to disk, not to logs, not to the page.
- **Look**: every value comes from `DESIGN.md` through `tokens.js`; markup uses the classes of `components.css` (and `editor.css`); nothing loads from the network. Neutral grey around cards, green for the one primary action per screen, light and dark themes.
- No build and no framework; texts a person reads are Russian, code comments English.

## Check

- `node tools/check.mjs` must pass.
- A real scenario: start `node editor/server.mjs --no-browser --port 0` (when an editor already runs, it only prints that one's address and starts nothing), open the printed address in a browser (Playwright MCP: `agents/README.md`, «Optional MCP examples»), click through the changed screens in both themes, and watch a change made from the terminal (`ccf.mjs`) appear on the open page. Stop the server you started.
- Update `MAP.md` and `CHANGELOG.md` when a part is added or moved.

- Tests: `tests/editor-server.test.mjs` (access, files, settings writer, `ccf.mjs editor` options, `callEditor` against a fake editor).

TODO: hosting the editor for several people (VISION) is not built.
