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
import { getCredits, listImageModels, loadApiKey } from './core/providers/openrouter.js';

const NAME = 'ccf.mjs';
const JSON_OPTION = { type: 'boolean', help: 'print the result as JSON (for an agent)' };

const COMMANDS = {
  'card make': {
    usage: [`${NAME} card make ORDER.json --collection NAME --set NAME [--attempts N] [--max-spend USD] [--json]`],
    about: `Makes one card from an order (a JSON CardOrder: core/style/card-order.js): the prompt is assembled from the
style's phrases, the image is generated, cropped to the card, post-processed and checked by the style's automatic
checks. While a check FAILs, the card is generated again, up to the attempt limit and the spend cap (settings/,
or the options below). A FAIL that rests on an unconfirmed hero outline does not cause a regeneration: look at
attempts/<n>/card.mask.png and run "card check". The card folder is
collections/<collection>/sets/<set>/cards/<order id>/; running again appends attempts to it.`,
    options: {
      collection: { type: 'string', value: 'NAME', help: 'collection folder name (required)' },
      set: { type: 'string', value: 'NAME', help: 'set folder name (required)' },
      attempts: { type: 'string', value: 'N', help: 'attempt limit of this run (default: settings card.attempts)' },
      'max-spend': { type: 'string', value: 'USD', help: 'spend cap of this run in USD (default: settings card.maxSpendUsd)' },
      json: JSON_OPTION,
    },
    positionals: { min: 1, max: 1, label: 'ORDER.json' },
    check: (/** @type {any} */ v) => !v.collection || !v.set ? '--collection and --set are required'
      : v.attempts !== undefined && !(Number.isInteger(+v.attempts) && +v.attempts > 0) ? '--attempts must be a whole number above 0'
      : v['max-spend'] !== undefined && !(+v['max-spend'] >= 0) ? '--max-spend must be a number of USD, 0 or more' : null,
    run: cardMake,
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
};

// ---------- commands ----------

/** @param {any} v @param {string[]} p */
async function cardMake(v, [orderFile]) {
  const order = JSON.parse(fs.readFileSync(path.resolve(orderFile), 'utf8'));
  const settings = loadSettings();
  const { makeCard, providerFrom } = await import('./core/card/make.js');
  const report = await makeCard({
    order, collection: v.collection, set: v.set, settings,
    provider: providerFrom(settings.provider),
    limits: { attempts: v.attempts && +v.attempts, maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined },
  });
  if (v.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.chosenCheck?.blocking === 0 && report.stop !== 'provider-error' ? 0 : 1;
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
