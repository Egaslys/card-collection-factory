#!/usr/bin/env node
// ============================================================================
//  card-collection-factory — the factory's commands for an agent (and a person) in the terminal
// ----------------------------------------------------------------------------
//  node ccf.mjs --help                 the commands
//  node ccf.mjs <command> --help       one command's options
//
//  Every command is a thin call of a core operation (core/): the editor server calls the same ones.
//  The card commands load their modules on demand, so --help works before the packages are installed.
//  Output is for a person by default; --json prints the operation's result as JSON for an agent.
//  Exit code: 0 — done, 1 — the operation failed or the card still has blocking FAILs, 2 — a wrong command line.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { cli, usageError } from './tools/cli-args.mjs';
import { loadSettings } from './core/settings.js';
import { CARDS_DIR, COLLECTIONS_DIR, SLOT_COUNT } from './core/store/layout.js';
import { setCommands } from './core/set/cli.js';
import { storeCommands } from './core/store/cli.js';
import { loadApiKey } from './core/providers/openrouter.js';
import { PRESETS, PRESET_TITLES, apiOf, presetOf, runSettings } from './core/providers/preset.js';

const NAME = 'ccf.mjs';
const JSON_OPTION = { type: 'boolean', help: 'print the result as JSON (for an agent)' };
const RUN_OPTIONS = {
  provider: { type: 'string', value: 'NAME', help: `${PRESETS.join(' | ')} | codex-cli: who draws this run — that service\n(its key; its vision model too) or Codex (default: settings provider.use, provider.preset)` },
  model: { type: 'string', value: 'ID', help: 'the image model of this run at the service (default: settings provider.<preset>.model);\nnot with --provider codex-cli' },
  attempts: { type: 'string', value: 'N', help: 'attempt limit of this run (default: make — settings card.attempts; a request — 1)' },
  'max-spend': { type: 'string', value: 'USD', help: 'spend cap of this run in USD (default: settings card.maxSpendUsd)' },
};
const PLACE_OPTIONS = {
  set: { type: 'string', value: 'ID', help: 'put the card into this set of the collection (with --slot)' },
  slot: { type: 'string', value: 'N', help: `the slot of the set, 1–${SLOT_COUNT} in window order` },
};
const WISH_OPTION = { type: 'string', value: 'TEXT', help: "the person's wish, in their words (required)" };
const ATTEMPT_OPTION = { type: 'string', value: 'N', help: 'this attempt (default: the chosen one)' };

/** @param {any} v */
const runError = v => v.attempts !== undefined && !(Number.isInteger(+v.attempts) && +v.attempts > 0) ? '--attempts must be a whole number above 0'
  : v['max-spend'] !== undefined && !(+v['max-spend'] >= 0) ? '--max-spend must be a number of USD, 0 or more'
  : v.provider !== undefined && ![...PRESETS, 'codex-cli'].includes(v.provider) ? `--provider must be ${PRESETS.join(', ')} or codex-cli`
  : v.model !== undefined && v.provider === 'codex-cli' ? '--model goes with a service provider (Codex draws with its own model)' : null;
/** @param {any} v */
const placeError = v => (v.set === undefined) !== (v.slot === undefined) ? '--set and --slot go together'
  : v.slot !== undefined && !(Number.isInteger(+v.slot) && +v.slot >= 1 && +v.slot <= SLOT_COUNT) ? `--slot must be a whole number from 1 to ${SLOT_COUNT}` : null;
/** @param {any} v */
const wishError = v => !v.wish?.trim() ? '--wish is required: what to change, in words' : null;
/** @param {any} v */
const attemptError = v => v.attempt !== undefined && !(Number.isInteger(+v.attempt) && +v.attempt > 0) ? '--attempt must be a whole number above 0' : null;

const COMMANDS = {
  'card make': {
    usage: [`${NAME} card make ORDER.json --collection ID [--card ID] [--set ID --slot N] [--provider NAME] [--model ID] [--attempts N] [--max-spend USD] [--json]`],
    about: `Makes one card from an order (a JSON CardOrder: core/style/card-order.js): the prompt is assembled from the
style's phrases, the image is generated, cropped to the card, post-processed and checked by the style's automatic
checks. While a check FAILs, the card is generated again, up to the attempt limit and the spend cap (settings/,
or the options below). With the key of the run's service, the vision model of the settings finds the hero's box (the outline is
cut in it: attempts/<n>/card.hero.png, trusted when its two looks agree) and looks at the card against the order
(attempts/<n>/look.json); its blocking problems also cause a regeneration. A FAIL that rests on an outline nobody
trusts does not: look at attempts/<n>/card.mask.png and run "card check".
The card is new in the collection's pool (collections/<collection>/cards/<card>/, the id from the order's id);
--card continues an existing card of the collection instead (the order replaces its order, attempts are appended).
--set and --slot put the card into a set's slot (1–${SLOT_COUNT}, window order; a card already there goes back to the pool
or swaps places).
An order of kind "character-sheet" (an anchor portrait, core/style/README.md) keeps the model's frame, skips the
pixel checks and stops after one attempt: run it again for another; the checks for eyes are printed.`,
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      card: { type: 'string', value: 'ID', help: 'an existing card of the collection to continue' },
      ...PLACE_OPTIONS,
      ...RUN_OPTIONS,
      json: JSON_OPTION,
    },
    positionals: { min: 1, max: 1, label: 'ORDER.json' },
    check: (/** @type {any} */ v) => !v.collection ? '--collection is required' : placeError(v) ?? runError(v),
    run: cardMake,
  },
  'card regenerate': {
    usage: [`${NAME} card regenerate CARD_DIR --wish TEXT [--provider NAME] [--model ID] [--attempts N] [--max-spend USD] [--json]`],
    about: `Generates the card again from its order with the person's wish added to the prompt as it is (the order's
promptExtra, or its promptOverride when it has one). One attempt unless --attempts says more; the new attempt
becomes the card even when an earlier one passes more checks (the person's word outranks the rules).`,
    options: { wish: WISH_OPTION, ...RUN_OPTIONS, json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => wishError(v) ?? runError(v),
    run: cardRegenerate,
  },
  'card edit': {
    usage: [`${NAME} card edit CARD_DIR --wish TEXT [--attempt N] [--provider NAME] [--model ID] [--attempts N] [--max-spend USD] [--json]`],
    about: `Edits the card's image: the model image of the chosen attempt (or --attempt N) is sent to the provider as the
input image with the wish (settings card.editPrompt). The answer is cropped, post-processed and checked as a new
attempt, which becomes the card. One attempt unless --attempts says more.`,
    options: { wish: WISH_OPTION, attempt: ATTEMPT_OPTION, ...RUN_OPTIONS, json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => wishError(v) ?? attemptError(v) ?? runError(v),
    run: cardEdit,
  },
  'card adjust': {
    usage: [`${NAME} card adjust CARD_DIR [--attempt N] [--saturation X] [--brightness Y] [--sharpen A] [--shadows S] [--json]`, `${NAME} card adjust CARD_DIR [--attempt N] --reset [--json]`],
    about: `Sets the post-processing of the chosen attempt (or --attempt N) by hand: the card is drawn again from
prepared.png with the given values (the others stay), the values are kept as set by hand (never tuned again) and
the checks run again. --reset gives the attempt back the processing the program finds by itself (tuned again from
the same start on the same hero outline, as after its generation). The chosen attempt stays chosen. Nothing is
generated or paid.`,
    options: {
      attempt: ATTEMPT_OPTION,
      saturation: { type: 'string', value: 'X', help: 'saturation multiplier, 1 = unchanged' },
      brightness: { type: 'string', value: 'Y', help: 'levels added to brightness (0..255 scale), 0 = unchanged' },
      sharpen: { type: 'string', value: 'A', help: 'sharpening amount, 0 = none' },
      shadows: { type: 'string', value: 'S', help: 'shadow lift: levels added to black, fading out by mid-grey; 0 = none' },
      reset: { type: 'boolean', help: "the program's own processing again, instead of values set by hand" },
      json: JSON_OPTION,
    },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => attemptError(v)
      ?? (v.reset && (v.saturation !== undefined || v.brightness !== undefined || v.sharpen !== undefined || v.shadows !== undefined) ? '--reset goes without --saturation, --brightness, --sharpen, --shadows' : null)
      ?? (!v.reset && v.saturation === undefined && v.brightness === undefined && v.sharpen === undefined && v.shadows === undefined ? 'give at least one of --saturation, --brightness, --sharpen, --shadows, or --reset' : null)
      ?? (v.shadows !== undefined && !(+v.shadows >= 0) ? '--shadows must be a number, 0 or more' : null)
      ?? (v.saturation !== undefined && !(+v.saturation >= 0) ? '--saturation must be a number, 0 or more' : null)
      ?? (v.brightness !== undefined && !Number.isFinite(+v.brightness) ? '--brightness must be a number' : null)
      ?? (v.sharpen !== undefined && !(+v.sharpen >= 0) ? '--sharpen must be a number, 0 or more' : null),
    run: cardAdjust,
  },
  'card import': {
    usage: [`${NAME} card import CARD_DIR IMAGE [--json]`, `${NAME} card import ORDER.json IMAGE --collection ID [--set ID --slot N] [--json]`],
    about: `Takes in an image an agent drew with its own tool (its built-in image generation): as a new attempt of a
card (CARD_DIR), or as a new card of the collection made from an order (ORDER.json). The image goes through every
step a generated one does: cropped, its hero outline found by the vision model, post-processing tuned, the style's
checks, the vision model's look against the order (with the key of the run's service here, or a running editor's; without one
the vision steps are skipped with a warning). The attempt's model is "agent", its image cost 0 (the vision calls are
counted). It becomes the card.`,
    options: { collection: { type: 'string', value: 'ID', help: 'with ORDER.json: the collection id' }, ...PLACE_OPTIONS, json: JSON_OPTION },
    positionals: { min: 2, max: 2, label: 'CARD_DIR|ORDER.json IMAGE' },
    check: (/** @type {any} */ v) => placeError(v) ?? (v.set && !v.collection ? '--set needs --collection (an order)' : null),
    run: cardImport,
  },
  'card choose': {
    usage: [`${NAME} card choose CARD_DIR --attempt N [--json]`],
    about: `Makes version N of the card (attempt N, attempts/<N>/) the card: its picture becomes card.png and the set
window shows it. The choice is kept when the checks run again; a later regenerate, edit, import or make chooses anew.
Nothing is generated or paid.`,
    options: { attempt: { type: 'string', value: 'N', help: 'the version to make the card (required)' }, json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => v.attempt === undefined ? '--attempt is required' : attemptError(v),
    run: cardChoose,
  },
  'card prompt': {
    usage: [`${NAME} card prompt ORDER.json [--json]`],
    about: `For an agent that draws with its own image tool: prints the prompt the program assembles for the order,
the style reference images to attach, the frame, and the next step (draw, then "card import"). An order taken from
a set plan works too (a staging given as a preset is expanded, a missing id is a temporary one). Nothing is
generated or paid.`,
    options: { json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'ORDER.json' },
    run: cardPrompt,
  },
  'card check': {
    usage: [`${NAME} card check CARD_DIR [--attempt N [--mask confirmed|rejected] [--hero-box X0,Y0,X1,Y1]] [--json]`],
    about: `Runs the style's checks again on a card's attempts (for example after the staging in card.json was
corrected) and chooses the best attempt again. With --attempt, only that attempt; --mask and --hero-box record
what a person or an agent saw on attempts/<n>/card.mask.png: confirmed = the outline is the hero, rejected =
it is not (then give --hero-box, the hero's box in card pixels). A --hero-box cuts a new outline in that box (free)
and replaces the earlier verdict on the outline. The vision model is not asked again.`,
    options: {
      attempt: { type: 'string', value: 'N', help: 'only this attempt' },
      mask: { type: 'string', value: 'confirmed|rejected', help: 'the proposed hero outline of the attempt is / is not the hero' },
      'hero-box': { type: 'string', value: 'X0,Y0,X1,Y1', help: 'the hero box drawn by eye, px' },
      json: JSON_OPTION,
    },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => v.attempt !== undefined && !(Number.isInteger(+v.attempt) && +v.attempt > 0) ? '--attempt must be a whole number above 0'
      : v.mask !== undefined && !['confirmed', 'rejected'].includes(v.mask) ? '--mask must be confirmed or rejected'
      : v['hero-box'] !== undefined && !/^\d+,\d+,\d+,\d+$/.test(v['hero-box']) ? '--hero-box must be X0,Y0,X1,Y1 in whole pixels'
      : (v.mask || v['hero-box']) && v.attempt === undefined ? '--mask and --hero-box need --attempt' : null,
    run: cardCheck,
  },
  models: {
    usage: [`${NAME} models [--json]`],
    about: 'Lists the models of the service in the settings (provider.preset; key from the environment or .env):\nOpenRouter — the image models with prices; Google AI Studio — every model that answers generateContent\n(its listing does not say which draw).',
    options: { json: JSON_OPTION },
    run: models,
  },
  credits: {
    usage: [`${NAME} credits [--json]`],
    about: 'Shows the balance of the account of the service in the settings (provider.preset). Only OpenRouter\nreports it; Google AI Studio has no balance call.',
    options: { json: JSON_OPTION },
    run: credits,
  },
  editor: {
    usage: [`${NAME} editor [--open COLLECTION[/SET]] [--no-browser] [--port N]`, `${NAME} editor --stop`],
    about: `Starts the factory's editor in the background (127.0.0.1) and opens it in the browser, or opens the one already
running; prints its address and returns. --open shows a collection or one of its sets. While the editor runs and
holds a key, the paid commands here use it when there is no key in the environment or .env (the key stays in the
editor). --stop stops the running editor.`,
    options: {
      open: { type: 'string', value: 'COLLECTION[/SET]', help: 'open this collection or set' },
      'no-browser': { type: 'boolean', help: 'do not open the browser (the address is printed)' },
      port: { type: 'string', value: 'N', help: 'port of a new editor (default: settings editor.port)' },
      stop: { type: 'boolean', help: 'stop the running editor' },
    },
    check: (/** @type {any} */ v) => v.stop && (v.open || v.port || v['no-browser']) ? '--stop goes alone'
      : v.port !== undefined && !(Number.isInteger(+v.port) && +v.port >= 0 && +v.port < 65536) ? '--port must be a port number' : null,
    run: editor,
  },
  'cards make': {
    usage: [`${NAME} cards make --collection ID --theme TEXT --count N [--scenes N] [--wishes TEXT] [--provider NAME] [--model ID] [--max-spend USD] [--json]`],
    about: `Makes loose cards on a theme into the collection's pool, outside any set: the text model of the settings
(set.plan) writes N card orders from the style's set fragments and checks them by the style (each order, its category
by its staging, no item kind twice; the mix of categories only warns), then every card is made as "card make" does,
a few at a time (settings set.parallel). Planning needs the key of the run's service (here or in a running editor) whatever draws
the cards; its cost is recorded as text. With plan errors no card is made and the errors are printed.`,
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      theme: { type: 'string', value: 'TEXT', help: 'what the cards are about, in any language (required)' },
      count: { type: 'string', value: 'N', help: 'how many cards (required)' },
      scenes: { type: 'string', value: 'N', help: 'how many of them are scenes with characters (default 0)' },
      wishes: { type: 'string', value: 'TEXT', help: "the person's free wishes, carried into every card's order" },
      provider: RUN_OPTIONS.provider,
      model: RUN_OPTIONS.model,
      'max-spend': { type: 'string', value: 'USD', help: 'spend cap of the cards in USD (default: settings set.maxSpendUsd; each card also\nwithin card.maxSpendUsd)' },
      json: JSON_OPTION,
    },
    check: (/** @type {any} */ v) => !v.collection ? '--collection is required' : !v.theme?.trim() ? '--theme is required'
      : !(Number.isInteger(+v.count) && +v.count >= 1) ? '--count must be a whole number from 1'
      : v.scenes !== undefined && !(Number.isInteger(+v.scenes) && +v.scenes >= 0 && +v.scenes <= +v.count) ? '--scenes must be a whole number from 0 to --count'
      : runError(v),
    run: cardsMake,
  },
  ...setCommands,
  ...storeCommands,
};

// ---------- commands ----------

/** @param {string} file */
const readOrder = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
/** @param {any} v the set slot of the command line (1-based) as the store's place (0-based) */
const placeOf = v => (v.set ? { setId: v.set, slot: +v.slot - 1 } : undefined);
/** The settings and provider of a run (`--provider`, `--model`): the run's service also looks at its cards. @param {any} v @param {import('./core/settings.js').Settings} all */
async function runOf(v, all) {
  const { providerFrom } = await import('./core/card/make.js');
  const settings = { ...all, provider: runSettings(all.provider, v) };
  return { settings, provider: providerFrom(settings.provider, { model: v.model }), limits: limitsOf(v) };
}
/** The limits of the command line, as core/card takes them. @param {any} v */
const limitsOf = v => ({ attempts: v.attempts && +v.attempts, maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined });
/**
 * A paid card operation: here, or in a running editor with its key when there is no key here (editor/remote.js).
 * @template T
 * @param {any} v @param {import('./core/settings.js').Settings} settings
 * @param {string} op @param {() => Record<string, unknown>} args @param {() => Promise<T>} here
 */
async function paid(v, settings, op, args, here) {
  const { hereOrInEditor } = await import('./editor/remote.js');
  const run = runSettings(settings.provider, v);
  return hereOrInEditor({ needsKey: run.use === 'api', envVar: presetOf(run).keyEnvVar, op, args, here });
}
/** A card folder as the editor names it. @param {string} dir */
function cardOf(dir) {
  const [collectionId, cards, cardId, ...rest] = path.relative(COLLECTIONS_DIR, path.resolve(dir)).split(path.sep);
  if (cards !== CARDS_DIR || !cardId || rest.length) throw new Error(`Редактор работает с карточками коллекций, а эта папка не в ${path.join(COLLECTIONS_DIR, '<коллекция>', CARDS_DIR, '<карточка>')}: ${dir}`);
  return { collectionId, cardId };
}
/** @param {any} v @param {import('./core/card/make.js').CardReport} report @param {boolean} [paid] */
function finish(v, report, paid = true) {
  if (v.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.chosenCheck?.blocking === 0 && (!paid || report.stop !== 'provider-error') ? 0 : 1;
}

/** @param {any} v @param {string[]} p */
async function cardMake(v, [orderFile]) {
  const order = readOrder(orderFile);
  const { makeCard } = await import('./core/card/make.js');
  const settings = loadSettings();
  return finish(v, await paid(v, settings, 'makeCard',
    () => ({ order, collectionId: v.collection, cardId: v.card, place: placeOf(v), provider: v.provider, model: v.model, limits: limitsOf(v) }),
    async () => makeCard({ order, collection: v.collection, card: v.card, place: placeOf(v), ...await runOf(v, settings) })));
}

/** @param {any} v */
async function cardsMake(v) {
  const settings = loadSettings();
  const { hereOrInEditor } = await import('./editor/remote.js');
  const a = { collectionId: v.collection, theme: v.theme, wishes: v.wishes, count: +v.count, scenes: v.scenes !== undefined ? +v.scenes : 0, provider: v.provider, model: v.model, maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined };
  /** @type {any} */
  const r = await hereOrInEditor({
    needsKey: true, envVar: presetOf(runSettings(settings.provider, v)).keyEnvVar, op: 'makeCards', args: () => a,
    here: async () => {
      const { makeCardsInto } = await import('./core/set/cards.js');
      const { settings: s, provider } = await runOf(v, settings);
      return makeCardsInto({ collection: a.collectionId, theme: a.theme, wishes: a.wishes, count: a.count, scenes: a.scenes, maxSpendUsd: a.maxSpendUsd, settings: /** @type {any} */ (s), provider, progress: msg => console.error(msg) });
    },
  });
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const e of r.plan.errors) console.log(`ошибка плана: ${e}`);
    for (const w of r.plan.warnings) console.log(`предупреждение: ${w}`);
    for (const c of r.cards) console.log(`${c.result.padEnd(9)} ${c.card ?? '—'}  «${c.title}»${c.blocking != null ? `  блокирующих FAIL ${c.blocking}` : ''}${c.error ? `  ${c.error}` : ''}`);
    console.log(`Потрачено $${r.spent.toFixed(4)} (из них план $${r.planSpent.toFixed(4)}).`);
  }
  return !r.plan.errors.length && r.cards.every((/** @type {any} */ c) => c.result === 'made' && c.blocking === 0) ? 0 : 1;
}

/** @param {any} v @param {string[]} p */
async function cardRegenerate(v, [dir]) {
  const { regenerateCard } = await import('./core/card/make.js');
  const settings = loadSettings();
  return finish(v, await paid(v, settings, 'regenerateCard',
    () => ({ ...cardOf(dir), wish: v.wish, provider: v.provider, model: v.model, limits: limitsOf(v) }),
    async () => regenerateCard({ dir: path.resolve(dir), wish: v.wish, ...await runOf(v, settings) })));
}

/** @param {any} v @param {string[]} p */
async function cardEdit(v, [dir]) {
  const { editCard } = await import('./core/card/make.js');
  const settings = loadSettings();
  return finish(v, await paid(v, settings, 'editCard',
    () => ({ ...cardOf(dir), wish: v.wish, n: v.attempt && +v.attempt, provider: v.provider, model: v.model, limits: limitsOf(v) }),
    async () => editCard({ dir: path.resolve(dir), wish: v.wish, n: v.attempt && +v.attempt, ...await runOf(v, settings) })));
}

/** @param {any} v @param {string[]} p */
async function cardAdjust(v, [dir]) {
  const { adjustCard } = await import('./core/card/make.js');
  /** @param {string|undefined} x */
  const num = x => (x === undefined ? undefined : +x);
  return finish(v, await adjustCard({
    dir: path.resolve(dir), n: v.attempt && +v.attempt, saturation: num(v.saturation), brightness: num(v.brightness), sharpen: num(v.sharpen), shadows: num(v.shadows),
    ...(v.reset ? { reset: true, settings: loadSettings() } : {}),
  }), false);
}

/** @param {any} v @param {string[]} p */
async function cardChoose(v, [dir]) {
  const { chooseAttempt } = await import('./core/card/make.js');
  return finish(v, await chooseAttempt({ dir: path.resolve(dir), n: +v.attempt }), false);
}

/** @param {any} v @param {string[]} p */
async function cardImport(v, [target, image]) {
  const { importImage } = await import('./core/card/make.js');
  const isCard = fs.statSync(path.resolve(target)).isDirectory();
  if (isCard && (v.collection || v.set)) throw new Error('--collection, --set и --slot нужны только с заказом (ORDER.json), не с папкой карточки.');
  if (!isCard && !v.collection) throw new Error('С заказом нужна коллекция: --collection ID.');
  const where = isCard ? { dir: path.resolve(target) } : { order: readOrder(target), collection: v.collection, place: placeOf(v) };
  const settings = loadSettings();
  const { hereOrInEditor } = await import('./editor/remote.js');
  const { visionFrom } = await import('./core/card/make.js');
  // the vision steps need the key: here, else in a running editor with its key, else here without them
  return finish(v, await hereOrInEditor({
    needsKey: true, optional: true, envVar: presetOf(settings.provider).keyEnvVar, op: 'importImage',
    args: () => ({ image: path.resolve(image), ...(isCard ? cardOf(target) : { collectionId: v.collection, order: where.order, place: where.place }) }),
    here: () => importImage({ image: path.resolve(image), ...where, settings, vision: visionFrom(settings.provider) }),
  }), false);
}

/** @param {any} v @param {string[]} p */
async function cardPrompt(v, [orderFile]) {
  const { orderPrompt } = await import('./core/card/make.js');
  const { readyOrder } = await import('./core/set/plan.js');
  const r = await orderPrompt({ order: readyOrder(readOrder(orderFile)), settings: loadSettings() });
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`Запрос (prompt):\n${r.prompt}\n\nПропорция: ${r.aspectRatio}`);
    if (r.references.length) console.log(`Приложить образцы, в этом порядке:\n${r.references.map(f => '  ' + f).join('\n')}`);
    console.log(`\nДальше: ${r.next}`);
  }
  return 0;
}

/** @param {any} v @param {string[]} p */
async function cardCheck(v, [dir]) {
  const review = v.mask || v['hero-box'] ? { ...(v.mask ? { mask: v.mask } : {}), ...(v['hero-box'] ? { hero_box: v['hero-box'].split(',').map(Number) } : {}) } : undefined;
  const { recheckCard } = await import('./core/card/make.js');
  const report = await recheckCard({ dir: path.resolve(dir), n: v.attempt && +v.attempt, review });
  if (v.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.chosenCheck?.blocking === 0 ? 0 : 1;
}

/** @param {any} v */
async function models(v) {
  const provider = presetOf(loadSettings().provider);
  /** @type {{id: string, name?: string, pricing?: object}[]} */
  const list = await apiOf(provider.name).listImageModels({ endpoint: provider.endpoint, apiKey: loadApiKey({ envVar: provider.keyEnvVar }) });
  if (v.json) console.log(JSON.stringify(list, null, 2));
  else {
    const what = provider.name === 'google' ? 'Модели с generateContent' : 'Модели изображений';
    console.log(`${what} у ${PRESET_TITLES[provider.name]} (${provider.endpoint}, ${list.length}); в настройках: ${provider.model}`);
    for (const m of list) console.log(`  ${m.id === provider.model ? '*' : ' '} ${m.id}${m.name ? ` — ${m.name}` : ''}${m.pricing ? `  цена: ${JSON.stringify(m.pricing)}` : ''}`);
  }
  return 0;
}

/** @param {any} v */
async function credits(v) {
  const provider = presetOf(loadSettings().provider);
  const getCredits = apiOf(provider.name).getCredits;
  if (!getCredits) throw new Error(`${PRESET_TITLES[provider.name]} не сообщает баланс через API: расходы смотрите в кабинете сервиса.`);
  const c = await getCredits({ endpoint: provider.endpoint, apiKey: loadApiKey({ envVar: provider.keyEnvVar }) });
  if (v.json) console.log(JSON.stringify(c, null, 2));
  else console.log(`Баланс у ${provider.endpoint}: осталось $${c.remaining.toFixed(2)} (всего $${c.total.toFixed(2)}, потрачено $${c.used.toFixed(2)})`);
  return 0;
}

/** @param {any} v */
async function editor(v) {
  const { DISCOVERY_FILE, openBrowser, pageUrl, runningEditor } = await import('./editor/server.mjs');
  const running = await runningEditor();
  if (v.stop) {
    if (!running) { console.log('Редактор не запущен.'); return 0; }
    process.kill(running.pid, 'SIGTERM');
    console.log(`Редактор остановлен (${running.url}).`);
    return 0;
  }
  if (running) {
    const target = pageUrl(running.url, v.open);
    if (!v['no-browser'] && loadSettings().editor.openBrowser) openBrowser(target);
    console.log(`Редактор уже запущен: ${target}`);
    return 0;
  }
  // the editor runs on after this command returns; what it prints goes to its log next to the discovery file
  const log = path.join(path.dirname(DISCOVERY_FILE), 'editor.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const out = fs.openSync(log, 'w');
  const { spawn } = await import('node:child_process');
  const args = ['editor/server.mjs', ...(v.port !== undefined ? ['--port', v.port] : []), ...(v.open ? ['--open', v.open] : []), ...(v['no-browser'] ? ['--no-browser'] : [])];
  const child = spawn(process.execPath, args, { cwd: import.meta.dirname, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  fs.closeSync(out);
  for (let i = 0; i < EDITOR_START_TRIES; i++) {
    await new Promise(r => setTimeout(r, EDITOR_START_STEP_MS));
    const ed = await runningEditor();
    if (ed && ed.pid === child.pid) {
      console.log(`Редактор запущен: ${pageUrl(ed.url, v.open)}\nОн работает в фоне; остановить — node ${NAME} editor --stop. Журнал: ${log}`);
      return 0;
    }
    if (child.exitCode !== null) break;
  }
  throw new Error(`Редактор не запустился — см. журнал ${log}`);
}
const EDITOR_START_TRIES = 50;
const EDITOR_START_STEP_MS = 200;

// ---------- output ----------

const STOP_TEXT = {
  passed: 'последняя попытка прошла автоматические проверки (блокирующих FAIL нет)',
  attempts: 'исчерпан лимит попыток',
  budget: 'следующий вызов мог бы превысить потолок расходов',
  'provider-error': 'ошибка провайдера (записана в попытке)',
  'cost-unknown': 'провайдер не сообщил цену — потолок расходов не соблюсти, генерация остановлена',
  cancelled: 'запуск отменён',
};

/** @param {unknown} v */
const fmt = v => (typeof v === 'number' ? String(+v.toFixed(3)) : Array.isArray(v) ? `[${v.join(', ')}]` : String(v ?? 'n/a'));
/** @param {number|null} c */
const usd = c => (c == null ? 'цена неизвестна' : `$${c.toFixed(4)}`);

/** The vision model's verdict for a person. */
const LOOK_TEXT = { ok: 'карточка соответствует заказу', fix: 'есть замечания', unknown: 'ответа нет' };

/** @param {import('./core/card/make.js').CardReport} r */
function printReport(r) {
  console.log(`Карточка ${r.id}: ${r.dir}`);
  for (const w of r.warnings) console.log(`Внимание: ${w}`);
  for (const a of r.attempts) {
    console.log(`\nПопытка ${a.n} — ${a.model}, ${usd(a.cost)}`);
    if (a.fallbackFrom) console.log(`  основная модель ${a.fallbackFrom.model} не справилась (${a.fallbackFrom.error.message}) — попытку сделала запасная`);
    if (a.error) console.log(`  ОШИБКА (${a.error.stage === 'generate' ? 'генерация' : 'обработка'}): ${a.error.message}`);
    if (a.check) {
      const eyes = a.check.needsEyes ?? a.check.fails.length - a.check.blocking;
      console.log(`  проверки: блокирующих ${a.check.blocking}, FAIL на неподтверждённом контуре ${eyes}, WARN ${a.check.warns}; контур героя: ${a.check.maskStatus}`);
      for (const f of a.check.fails) console.log(`  FAIL ${f.id} ${f.title}: ${fmt(f.value)}${f.threshold ? `  | ${f.threshold}` : ''}${f.note ? `  — ${f.note}` : ''}${f.needsMask ? '  [нужен взгляд на контур]' : ''}`);
      const look = a.check.look;
      if (look) console.log(`  смотрящая модель: ${LOOK_TEXT[look.verdict]}`);
      for (const i of look?.issues ?? []) console.log(`  ${i.blocking ? 'НЕ ТАК' : 'взгляд'} ${i.id ?? i.kind}: ${i.what}`);
    }
    for (const [k, p] of Object.entries(a.files)) console.log(`  ${k}: ${p}`);
  }
  if (r.stop) console.log(`\nОстановка: ${STOP_TEXT[r.stop]}. Потрачено в этом запуске ${usd(r.spent ?? 0)} (потолок $${r.limits?.maxSpendUsd}, попыток ${r.attempts.length} из ${r.limits?.attempts}).`);
  if (r.chosen == null) { console.log('Выбрать нечего: ни одна попытка не дошла до проверок.'); return; }
  const c = r.chosenCheck;
  console.log(`Выбрана попытка ${r.chosen}${c ? ` (блокирующих ${c.blocking}, FAIL на неподтверждённом контуре ${c.needsEyes ?? c.fails.length - c.blocking}, WARN ${c.warns})` : ''}: ${r.image}`);
  if (r.chosenVisual.length) {
    console.log(`Проверить глазами (попытка ${r.chosen}):`);
    for (const x of r.chosenVisual) console.log(`  - [${x.doc} #${x.check}] ${x.what}`);
  }
}

// ---------- run (last: the commands use the constants above) ----------

const args = process.argv.slice(2);
const command = Object.keys(COMMANDS).find(c => c.split(' ').every((w, i) => args[i] === w));
if (!command) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log([`Usage:`, ...Object.values(COMMANDS).flatMap(c => c.usage.map(u => '  node ' + u)), '',
      'The factory\'s commands. Settings: settings/defaults.json, personal changes in settings/local.json.',
      `One command's options: node ${NAME} <command> --help`].join('\n'));
    process.exit(0);
  }
  await usageError({ name: NAME, usage: [`${NAME} <command> …`] }, `unknown command: ${args.slice(0, 2).join(' ')}`);
}
const spec = { name: `${NAME} ${command}`, ...COMMANDS[/** @type {keyof typeof COMMANDS} */ (command)] };
const { values, positionals } = await cli(spec, args.slice(String(command).split(' ').length));
try {
  process.exitCode = await spec.run(values, positionals);
} catch (/** @type {any} */ e) {
  console.error(`Ошибка: ${e?.message ?? e}`);
  process.exitCode = 1;
}
