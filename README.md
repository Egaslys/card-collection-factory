# card-collection-factory

https://github.com/user-attachments/assets/1af58977-3d07-4b69-bd25-e77fdd36f560

[English](README.md) | [Русский](README.ru.md)

A factory of collectible card collections. You name a theme and say what you would like, and the factory draws the cards in one art style and lays them out into sets: a collection holds 16 sets, a set is 10 cards in a game window. You can work in the web editor yourself, or ask an AI agent (Claude Code or Codex) to make a set for you; the agent can do everything the editor does.

## What you need

- A computer with macOS, Windows or Linux.
- [Node.js](https://nodejs.org), the LTS version (22.18 or newer).
- A key to an AI service that draws the pictures: OpenRouter or Google AI Studio (see «The key» below). Instead of a service, the pictures can be drawn by Codex CLI under your Codex subscription.

## Install and start

Download the project (clone it or unpack the zip) and double-click the launcher for your system in the project folder:

- macOS: `run.command`. If macOS will not open it («unidentified developer»): Apple menu → System Settings → Privacy & Security, scroll to Security, click Open Anyway and enter your password; then double-click the file again. If it does not start as a program, open Terminal in the project folder and run `chmod +x run.command run.sh`.
- Windows: `run.bat`. If Windows says it «protected your PC», click More info → Run anyway.
- Linux: `run.sh` (from the file manager, or `./run.sh` in a terminal).

On the first start the launcher checks Node.js and installs what is missing. If Node.js is not found, it tells you where to get it.

Then the editor opens in your browser. It is a site on your own computer (an address like `http://127.0.0.1:4870`), visible only to you. Keep the launcher window open while you work.

## The key

The factory works through one AI service at a time; you choose it in the editor: Settings → Service.

- **OpenRouter** — one key to models of many companies, paid per call from your OpenRouter balance. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys).
- **Google AI Studio** — Google's models directly, billed by Google. Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

There are two ways to give the factory a key:

- **For now:** paste it in Settings → Service. It works at once and lives while the editor runs; it is not saved anywhere.
- **For good:** create a file named `.env` in the project folder with one line: `OPENROUTER_API_KEY=your-key` for OpenRouter or `GEMINI_API_KEY=your-key` for Google AI Studio. The factory reads it on every start. Never share this file.

The top bar of the editor shows on every screen whether there is a key, and what has been spent so far.

## Who draws the pictures

In Settings → Generation you choose who draws:

- **The service's model** — through your key; every picture is paid.
- **Codex CLI** — free per picture under your Codex subscription (GPT Image only). Note: **with Codex CLI chosen, the factory itself starts Codex in the background on your computer** and gives it each picture to draw; you do not need to open Codex. It only has to be installed and signed in once. Set plans and the model's look at cards still go through the service and its key.

  On Windows, drawing through Codex has not been tried. Install Codex with the installer from its site (the PowerShell command in [the Codex CLI docs](https://learn.chatgpt.com/docs/codex/cli)) rather than through npm. If something goes wrong, open the factory's folder in Codex and ask it to find the problem and fix it.

## The editor

- **Collections** — the first screen. «New collection»: a title and what the collection is about; it starts empty.
- **A collection** — its description and cover («Description»), its sets in game windows, and the **Pool** with every card of the collection. «Create a set» generates a set on a theme or lets you gather one yourself from the pool's cards; «Generate all sets» fills the whole collection with one button; «Create cards» in the pool makes loose cards on a theme. Drag cards with the mouse from the pool into the places of a set, between places and back.
- **A set** — its window in one of four colours, its variants side by side (the chosen one goes to the export), and its settings. Click a place to set its stars, frame and caption; an empty place can be filled from the pool or generated.
- **A card** — click it to open its panel: what the style checks found, its versions, and ways to redo it or fix the picture.
- **Generation** — while something is being made, the top bar says so; click it to see each card's progress in plain words and to stop a long run.
- **Settings** (top right): the service and its key, who draws, the models (picked from the service's own list), attempts per card, theme and language.

The editor speaks English and Russian (RU / EN in the top bar); captions on the cards are not translated. Light and dark themes are next to it.

## Export

The «Export» button at the top left works on every screen and suggests what fits the screen: every collection, this collection, this set or the cards you selected (⌘ or Ctrl + click a card). You get PNG pictures in folders (collection → sets → cards) or one ZIP archive; you can add the pool and the original pictures in full size. «Open the export folder» shows the result.

The files go to the project's `collections` folder: a collection's export to `collections/<collection>/export/`, the export of every collection to `collections/_export/`.

## Work through your agent

Open the project folder in Claude Code or Codex and ask in plain words, for example: «make a set about fishing on a lake» or «make 20 cards about a space kitchen». The agent follows the project's skills `ccf-make-sets`, `ccf-make-cards` and `ccf-review-cards`, checks the cards and fixes the weak ones. You can also work from another folder: tell the agent where the factory is.

The agent uses the same key — from `.env`, or the one in the running editor. Whatever it makes appears in the open editor by itself.

## Stopping the editor

- In the editor: Settings → «Switch the editor off» (at the bottom).
- Or close the launcher window (or press Ctrl+C in it).

From a terminal in the project folder the editor can also be started in the background with `node ccf.mjs editor` and stopped with `node ccf.mjs editor --stop`.

## License

The code and documents are under the MIT license — see [LICENSE](LICENSE). The reference card images in `styles/scapes/references/` are not covered by it: they belong to their owners and are included only as style references.
