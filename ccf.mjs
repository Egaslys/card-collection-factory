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
import { SLOT_COUNT } from './core/store/layout.js';
import { setCommands } from './core/set/cli.js';
import { storeCommands } from './core/store/cli.js';
import { getCredits, listImageModels, loadApiKey } from './core/providers/openrouter.js';

const NAME = 'ccf.mjs';
const JSON_OPTION = { type: 'boolean', help: 'print the result as JSON (for an agent)' };
const RUN_OPTIONS = {
  provider: { type: 'string', value: 'NAME', help: 'openrouter | codex-cli: the image provider of this run (default: settings provider.use)' },
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
  : v.provider !== undefined && !['openrouter', 'codex-cli'].includes(v.provider) ? '--provider must be openrouter or codex-cli' : null;
/** @param {any} v */
const placeError = v => (v.set === undefined) !== (v.slot === undefined) ? '--set and --slot go together'
  : v.slot !== undefined && !(Number.isInteger(+v.slot) && +v.slot >= 1 && +v.slot <= SLOT_COUNT) ? `--slot must be a whole number from 1 to ${SLOT_COUNT}` : null;
/** @param {any} v */
const wishError = v => !v.wish?.trim() ? '--wish is required: what to change, in words' : null;
/** @param {any} v */
const attemptError = v => v.attempt !== undefined && !(Number.isInteger(+v.attempt) && +v.attempt > 0) ? '--attempt must be a whole number above 0' : null;

const COMMANDS = {
  'card make': {
    usage: [`${NAME} card make ORDER.json --collection ID [--card ID] [--set ID --slot N] [--provider NAME] [--attempts N] [--max-spend USD] [--json]`],
    about: `Makes one card from an order (a JSON CardOrder: core/style/card-order.js): the prompt is assembled from the
style's phrases, the image is generated, cropped to the card, post-processed and checked by the style's automatic
checks. While a check FAILs, the card is generated again, up to the attempt limit and the spend cap (settings/,
or the options below). A FAIL that rests on an unconfirmed hero outline does not cause a regeneration: look at
attempts/<n>/card.mask.png and run "card check".
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
    usage: [`${NAME} card regenerate CARD_DIR --wish TEXT [--provider NAME] [--attempts N] [--max-spend USD] [--json]`],
    about: `Generates the card again from its order with the person's wish added to the prompt as it is (the order's
promptExtra, or its promptOverride when it has one). One attempt unless --attempts says more; the new attempt
becomes the card even when an earlier one passes more checks (the person's word outranks the rules).`,
    options: { wish: WISH_OPTION, ...RUN_OPTIONS, json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => wishError(v) ?? runError(v),
    run: cardRegenerate,
  },
  'card edit': {
    usage: [`${NAME} card edit CARD_DIR --wish TEXT [--attempt N] [--provider NAME] [--attempts N] [--max-spend USD] [--json]`],
    about: `Edits the card's image: the model image of the chosen attempt (or --attempt N) is sent to the provider as the
input image with the wish (settings card.editPrompt). The answer is cropped, post-processed and checked as a new
attempt, which becomes the card. One attempt unless --attempts says more.`,
    options: { wish: WISH_OPTION, attempt: ATTEMPT_OPTION, ...RUN_OPTIONS, json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => wishError(v) ?? attemptError(v) ?? runError(v),
    run: cardEdit,
  },
  'card adjust': {
    usage: [`${NAME} card adjust CARD_DIR [--attempt N] [--saturation X] [--brightness Y] [--sharpen A] [--json]`],
    about: `Sets the post-processing of the chosen attempt (or --attempt N) by hand: the card is drawn again from
prepared.png with the given values (the others stay), the values are kept as set by hand (never tuned again) and
the checks run again. The chosen attempt stays chosen. Nothing is generated or paid.`,
    options: {
      attempt: ATTEMPT_OPTION,
      saturation: { type: 'string', value: 'X', help: 'saturation multiplier, 1 = unchanged' },
      brightness: { type: 'string', value: 'Y', help: 'levels added to brightness (0..255 scale), 0 = unchanged' },
      sharpen: { type: 'string', value: 'A', help: 'sharpening amount, 0 = none' },
      json: JSON_OPTION,
    },
    positionals: { min: 1, max: 1, label: 'CARD_DIR' },
    check: (/** @type {any} */ v) => attemptError(v)
      ?? (v.saturation === undefined && v.brightness === undefined && v.sharpen === undefined ? 'give at least one of --saturation, --brightness, --sharpen' : null)
      ?? (v.saturation !== undefined && !(+v.saturation >= 0) ? '--saturation must be a number, 0 or more' : null)
      ?? (v.brightness !== undefined && !Number.isFinite(+v.brightness) ? '--brightness must be a number' : null)
      ?? (v.sharpen !== undefined && !(+v.sharpen >= 0) ? '--sharpen must be a number, 0 or more' : null),
    run: cardAdjust,
  },
  'card import': {
    usage: [`${NAME} card import CARD_DIR IMAGE [--json]`, `${NAME} card import ORDER.json IMAGE --collection ID [--set ID --slot N] [--json]`],
    about: `Takes in an image an agent drew with its own tool (its built-in image generation): as a new attempt of a
card (CARD_DIR), or as a new card of the collection made from an order (ORDER.json). The image is cropped,
post-processed and checked like a generated one; the attempt's model is "agent", its cost 0. It becomes the card.`,
    options: { collection: { type: 'string', value: 'ID', help: 'with ORDER.json: the collection id' }, ...PLACE_OPTIONS, json: JSON_OPTION },
    positionals: { min: 2, max: 2, label: 'CARD_DIR|ORDER.json IMAGE' },
    check: (/** @type {any} */ v) => placeError(v) ?? (v.set && !v.collection ? '--set needs --collection (an order)' : null),
    run: cardImport,
  },
  'card prompt': {
    usage: [`${NAME} card prompt ORDER.json [--json]`],
    about: `For an agent that draws with its own image tool: prints the prompt the program assembles for the order,
the style reference images to attach, the frame, and the next step (draw, then "card import"). Nothing is generated
or paid.`,
    options: { json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'ORDER.json' },
    run: cardPrompt,
  },
  'card check': {
    usage: [`${NAME} card check CARD_DIR [--attempt N [--mask confirmed|rejected] [--hero-box X0,Y0,X1,Y1]] [--json]`],
    about: `Runs the style's checks again on a card's attempts (for example after the staging in card.json was
corrected) and chooses the best attempt again. With --attempt, only that attempt; --mask and --hero-box record
what a person or an agent saw on attempts/<n>/card.mask.png: confirmed = the outline is the hero, rejected =
it is not (then give --hero-box, the hero's box in card pixels).`,
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
    about: 'Lists the image models of the OpenRouter-compatible endpoint in the settings (provider.openrouter;\nkey from the environment or .env).',
    options: { json: JSON_OPTION },
    run: models,
  },
  credits: {
    usage: [`${NAME} credits [--json]`],
    about: 'Shows the balance of the OpenRouter-compatible account in the settings (provider.openrouter).',
    options: { json: JSON_OPTION },
    run: credits,
  },
  ...setCommands,
  ...storeCommands,
};

// ---------- commands ----------

/** @param {string} file */
const readOrder = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
/** @param {any} v the set slot of the command line (1-based) as the store's place (0-based) */
const placeOf = v => (v.set ? { setId: v.set, slot: +v.slot - 1 } : undefined);
/** @param {any} v @param {import('./core/settings.js').Settings} settings */
async function runOf(v, settings) {
  const { providerFrom } = await import('./core/card/make.js');
  return {
    settings,
    provider: providerFrom({ ...settings.provider, use: v.provider ?? settings.provider.use }),
    limits: { attempts: v.attempts && +v.attempts, maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined },
  };
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
  return finish(v, await makeCard({ order, collection: v.collection, card: v.card, place: placeOf(v), ...await runOf(v, loadSettings()) }));
}

/** @param {any} v @param {string[]} p */
async function cardRegenerate(v, [dir]) {
  const { regenerateCard } = await import('./core/card/make.js');
  return finish(v, await regenerateCard({ dir: path.resolve(dir), wish: v.wish, ...await runOf(v, loadSettings()) }));
}

/** @param {any} v @param {string[]} p */
async function cardEdit(v, [dir]) {
  const { editCard } = await import('./core/card/make.js');
  return finish(v, await editCard({ dir: path.resolve(dir), wish: v.wish, n: v.attempt && +v.attempt, ...await runOf(v, loadSettings()) }));
}

/** @param {any} v @param {string[]} p */
async function cardAdjust(v, [dir]) {
  const { adjustCard } = await import('./core/card/make.js');
  /** @param {string|undefined} x */
  const num = x => (x === undefined ? undefined : +x);
  return finish(v, await adjustCard({ dir: path.resolve(dir), n: v.attempt && +v.attempt, saturation: num(v.saturation), brightness: num(v.brightness), sharpen: num(v.sharpen) }), false);
}

/** @param {any} v @param {string[]} p */
async function cardImport(v, [target, image]) {
  const { importImage } = await import('./core/card/make.js');
  const isCard = fs.statSync(path.resolve(target)).isDirectory();
  if (isCard && (v.collection || v.set)) throw new Error('--collection, --set и --slot нужны только с заказом (ORDER.json), не с папкой карточки.');
  if (!isCard && !v.collection) throw new Error('С заказом нужна коллекция: --collection ID.');
  const where = isCard ? { dir: path.resolve(target) } : { order: readOrder(target), collection: v.collection, place: placeOf(v) };
  return finish(v, await importImage({ image: path.resolve(image), ...where, settings: loadSettings() }), false);
}

/** @param {any} v @param {string[]} p */
async function cardPrompt(v, [orderFile]) {
  const { orderPrompt } = await import('./core/card/make.js');
  const r = await orderPrompt({ order: readOrder(orderFile), settings: loadSettings() });
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
  const provider = openrouterSettings();
  const list = await listImageModels({ endpoint: provider.endpoint, apiKey: loadApiKey({ envVar: provider.keyEnvVar }) });
  if (v.json) console.log(JSON.stringify(list, null, 2));
  else {
    console.log(`Модели изображений у ${provider.endpoint} (${list.length}); в настройках: ${provider.model}`);
    for (const m of list) console.log(`  ${m.id === provider.model ? '*' : ' '} ${m.id}${m.name ? ` — ${m.name}` : ''}${m.pricing ? `  цена: ${JSON.stringify(m.pricing)}` : ''}`);
  }
  return 0;
}

/** @param {any} v */
async function credits(v) {
  const provider = openrouterSettings();
  const c = await getCredits({ endpoint: provider.endpoint, apiKey: loadApiKey({ envVar: provider.keyEnvVar }) });
  if (v.json) console.log(JSON.stringify(c, null, 2));
  else console.log(`Баланс у ${provider.endpoint}: осталось $${c.remaining.toFixed(2)} (всего $${c.total.toFixed(2)}, потрачено $${c.used.toFixed(2)})`);
  return 0;
}

/** models and credits ask the OpenRouter-compatible endpoint, whichever provider generates (Codex has neither). */
const openrouterSettings = () => loadSettings().provider.openrouter;

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

/** @param {import('./core/card/make.js').CardReport} r */
function printReport(r) {
  console.log(`Карточка ${r.id}: ${r.dir}`);
  for (const w of r.warnings) console.log(`Внимание: ${w}`);
  for (const a of r.attempts) {
    console.log(`\nПопытка ${a.n} — ${a.model}, ${usd(a.cost)}`);
    if (a.fallbackFrom) console.log(`  основная модель ${a.fallbackFrom.model} не справилась (${a.fallbackFrom.error.message}) — попытку сделала запасная`);
    if (a.error) console.log(`  ОШИБКА (${a.error.stage === 'generate' ? 'генерация' : 'обработка'}): ${a.error.message}`);
    if (a.check) {
      const eyes = a.check.fails.length - a.check.blocking;
      console.log(`  проверки: блокирующих FAIL ${a.check.blocking}, FAIL на неподтверждённом контуре ${eyes}, WARN ${a.check.warns}; контур героя: ${a.check.maskStatus}`);
      for (const f of a.check.fails) console.log(`  FAIL ${f.id} ${f.title}: ${fmt(f.value)}${f.threshold ? `  | ${f.threshold}` : ''}${f.note ? `  — ${f.note}` : ''}${f.needsMask ? '  [нужен взгляд на контур]' : ''}`);
    }
    for (const [k, p] of Object.entries(a.files)) console.log(`  ${k}: ${p}`);
  }
  if (r.stop) console.log(`\nОстановка: ${STOP_TEXT[r.stop]}. Потрачено в этом запуске ${usd(r.spent ?? 0)} (потолок $${r.limits?.maxSpendUsd}, попыток ${r.attempts.length} из ${r.limits?.attempts}).`);
  if (r.chosen == null) { console.log('Выбрать нечего: ни одна попытка не дошла до проверок.'); return; }
  const c = r.chosenCheck;
  console.log(`Выбрана попытка ${r.chosen}${c ? ` (блокирующих FAIL ${c.blocking}, на неподтверждённом контуре ${c.fails.length - c.blocking}, WARN ${c.warns})` : ''}: ${r.image}`);
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
    console.log([`Usage:`, ...Object.values(COMMANDS).map(c => '  node ' + c.usage[0]), '',
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
