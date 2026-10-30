// The set and collection commands of ccf.mjs (planning, checking, making, the sheet). ccf.mjs merges `setCommands`
// into its command table: each entry has the shape of tools/cli-args.mjs specs plus `run(values, positionals)` →
// exit code. Heavy modules (sharp, the card loop) load on demand, so --help works before the packages are installed.
import fs from 'node:fs';
import path from 'node:path';
import { PRESETS, presetOf, runSettings } from '../providers/preset.js';
import { loadSettings } from '../settings.js';
import { validatePlan } from './plan.js';

const JSON_OPTION = { type: 'boolean', help: 'print the result as JSON (for an agent)' };
const PROVIDER = { type: 'string', value: 'NAME', help: `${PRESETS.join(' | ')} | codex-cli: who draws this run — that service\n(its key; its vision model too) or Codex (default: settings provider.use, provider.preset)` };
const MAKE_OPTIONS = {
  provider: PROVIDER,
  model: { type: 'string', value: 'ID', help: 'the image model of this run at the service (default: settings provider.<preset>.model);\nnot with --provider codex-cli' },
  parallel: { type: 'string', value: 'N', help: 'cards made at the same time (default: settings set.parallel)' },
  'max-spend': { type: 'string', value: 'USD', help: 'spend cap in USD (set make: of the set, default settings set.maxSpendUsd;\ncollection make: of the whole run, each set also keeps set.maxSpendUsd)' },
  attempts: { type: 'string', value: 'N', help: 'attempt limit of each card (default: settings card.attempts)' },
  json: JSON_OPTION,
};
const PLAN_OPTIONS = {
  wishes: { type: 'string', value: 'TEXT', help: "the producer's free wishes, in their words" },
  variants: { type: 'string', value: 'N', help: 'how many variants of each set (default 1)' },
  'max-spend': { type: 'string', value: 'USD', help: 'spend cap of the planning in USD (default: settings set.plan.maxSpendUsd)' },
  json: JSON_OPTION,
};

/** @param {string|undefined} v */
const whole = v => v === undefined || (Number.isInteger(+v) && +v > 0);
/** @param {string|undefined} v */
const list = v => (v === undefined ? undefined : v.split(',').map(Number));
/** @param {string|undefined} v */
const listOk = v => v === undefined || /^\d+(,\d+)*$/.test(v);
/** @param {any} v */
const makeError = v => !whole(v.parallel) ? '--parallel must be a whole number above 0'
  : !whole(v.attempts) ? '--attempts must be a whole number above 0'
  : v['max-spend'] !== undefined && !(+v['max-spend'] >= 0) ? '--max-spend must be a number of USD, 0 or more'
  : v.provider !== undefined && ![...PRESETS, 'codex-cli'].includes(v.provider) ? `--provider must be ${PRESETS.join(', ')} or codex-cli`
  : v.model !== undefined && v.provider === 'codex-cli' ? '--model goes with a service provider (Codex draws with its own model)' : null;

/** The settings with the `set` key (settings/defaults.json). */
const settingsOf = () => /** @type {import('../settings.js').Settings & {set: import('./planner.js').SetSettings}} */ (loadSettings());

/** The limits of the command line, as core/set takes them. @param {any} v */
const limitsOf = v => ({ parallel: v.parallel && +v.parallel, maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined, attempts: v.attempts && +v.attempts });

/** The settings and the image provider of a run (`--provider`, `--model`): the run's service also looks at its cards. @param {any} v */
async function providerOf(v) {
  const all = settingsOf();
  const settings = { ...all, provider: runSettings(all.provider, v) };
  const { providerFrom } = await import('../card/make.js');
  return { settings, provider: providerFrom(settings.provider, { model: v.model }) };
}

/**
 * A paid run here, or in a running editor with its key when there is no key here (editor/remote.js).
 * @template T
 * @param {{needsKey: boolean, op: string, args: () => Record<string, unknown>, here: () => Promise<T>, signal?: AbortSignal}} o
 * @param {{provider?: string, model?: string}} [v]  the run's --provider and --model: whose key it needs
 */
async function paid(o, v = {}) {
  // a URL, not a literal path: the editor stays outside core's type check (tsconfig.json include)
  /** @type {{hereOrInEditor: (o: any) => Promise<T>}} */
  const { hereOrInEditor } = await import(new URL('../../editor/remote.js', import.meta.url).href);
  return hereOrInEditor({ ...o, envVar: presetOf(runSettings(settingsOf().provider, v)).keyEnvVar });
}
/** @param {any} v the image provider of the run needs the service's key */
const imagesNeedKey = v => runSettings(settingsOf().provider, v).use === 'api';

/** @param {string} msg */
const progress = msg => console.error(`… ${msg}`);

/** The first Ctrl+C stops queueing new cards (the cards in progress finish); a second one ends the process. */
function interruptible() {
  const ac = new AbortController();
  process.once('SIGINT', () => { console.error('… остановка: новые карточки не начинаются, начатые доделываются (Ctrl+C ещё раз — выйти сразу)'); ac.abort(); process.once('SIGINT', () => process.exit(130)); });
  return ac.signal;
}
/** @param {number} c */
const usd = c => `$${c.toFixed(4)}`;

/** @param {{errors: string[], warnings: string[]}} v @param {string} indent */
function printVerdict(v, indent = '  ') {
  for (const e of v.errors) console.log(`${indent}ОШИБКА: ${e}`);
  for (const w of v.warnings) console.log(`${indent}внимание: ${w}`);
}

/** @param {import('./plan.js').SetPlan} p */
const planLine = p => `«${p.title}»${p.variant ? `, вариант ${p.variant.n}` : ''} — окно ${p.window.layout}, сцен ${p.slots.filter(s => Number(s.order?.staging?.characters ?? 0) > 0).length}, угол: ${p.angle}`;

/** @param {any} v */
async function setPlan(v) {
  const { planSetInto } = await import('./make.js');
  const o = {
    save: !!v.save, theme: v.theme, wishes: v.wishes, variants: v.variants && +v.variants,
    window: v.window, scenes: v.scenes !== undefined ? +v.scenes : undefined, template: v.template, maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined,
  };
  const r = await paid({
    needsKey: true, op: 'planSet', args: () => ({ ...o, collectionId: v.collection }),
    here: () => planSetInto({ ...o, collection: v.collection, settings: settingsOf(), progress }),
  });
  for (const p of r.plans) {
    if (!v.out || !p.plan) continue;
    fs.mkdirSync(path.resolve(v.out), { recursive: true });
    const file = path.resolve(v.out, `${String(p.plan.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}${p.plan.variant ? `-v${p.plan.variant.n}` : ''}.json`);
    fs.writeFileSync(file, JSON.stringify(p.plan, null, 2) + '\n');
    /** @type {any} */ (p).file = file;
  }
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const [i, p] of r.plans.entries()) {
      console.log(p.plan ? planLine(p.plan) : `вариант ${i + 1}: плана нет`);
      const file = /** @type {any} */ (p).file;
      console.log(`  ответов модели: ${p.rounds}${file ? `; файл: ${file}` : ''}${p.set ? `; набор в коллекции: ${p.set}` : ''}`);
      printVerdict(p);
    }
    console.log(`Планирование: вызовов ${r.calls}, потрачено ${usd(r.spent)}.`);
  }
  return r.plans.every(p => !p.errors.length) ? 0 : 1;
}

/** @param {any} v @param {string[]} files */
async function setCheck(v, files) {
  const plans = files.map(f => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')));
  const store = v.collection ? await import('../store/index.js') : null;
  /** @type {any[]} */
  const out = [];
  for (const [i, plan] of plans.entries()) {
    let ctx = { registry: /** @type {any[]} */ ([]), titles: /** @type {string[]} */ ([]), variants: /** @type {any[]} */ ([]), warnings: /** @type {string[]} */ ([]) };
    if (store) { const { collectionContext } = await import('./make.js'); ctx = await collectionContext(store, v.collection, plan); }
    const siblings = plans.filter((p, j) => j !== i && p.variant && p.variant.group === plan.variant?.group);
    const r = validatePlan(plan, { ...ctx, variants: [...ctx.variants, ...siblings] });
    out.push({ file: files[i], title: plan.title, errors: r.errors, warnings: [...ctx.warnings, ...r.warnings] });
  }
  if (v.json) console.log(JSON.stringify(out, null, 2));
  else for (const r of out) { console.log(`${r.file}: «${r.title}» — ${r.errors.length ? `ошибок ${r.errors.length}` : 'ошибок нет'}`); printVerdict(r); }
  return out.every(r => !r.errors.length) ? 0 : 1;
}

/** @param {any} v @param {string[]} files */
async function setSave(v, [file]) {
  const { saveSetPlan } = await import('./make.js');
  const { set, warnings } = await saveSetPlan({ collection: v.collection, plan: JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) });
  if (v.json) console.log(JSON.stringify({ set: set.id, number: set.number, title: set.title, warnings }, null, 2));
  else {
    console.log(`План сохранён набором ${set.id} (№${set.number}, «${set.title}») в коллекции ${v.collection}; карточек пока нет: "set make --set ${set.id}".`);
    printVerdict({ errors: [], warnings });
  }
  return 0;
}

/** @param {any} v */
async function collectionCheck(v) {
  const store = await import('../store/index.js');
  const { validateCollection } = await import('./plan.js');
  const { sets } = await store.getCollection(v.collection);
  const plans = /** @type {import('./plan.js').SetPlan[]} */ (sets.map(s => s.plan).filter(Boolean));
  const noPlan = sets.filter(s => !s.plan).map(s => `набор «${s.title}» без плана: в проверку коллекции не вошёл`);
  const r = validateCollection(plans, { complete: !v.partial });
  const out = { collection: v.collection, plans: plans.length, errors: r.errors, warnings: [...noPlan, ...r.warnings], sets: r.sets };
  if (v.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Коллекция ${v.collection}: планов ${plans.length}${v.partial ? ' (неполная коллекция допустима)' : ''} — ${out.errors.length ? `ошибок ${out.errors.length}` : 'ошибок нет'}`);
    printVerdict(out);
    for (const s of r.sets) if (s.errors.length || s.warnings.length) { console.log(`  «${s.title}»:`); printVerdict(s, '    '); }
  }
  return out.errors.length ? 1 : 0;
}

/** @param {import('./make.js').SetReport} r */
function printSet(r) {
  console.log(`Набор «${r.title}» (${r.set}): потрачено ${usd(r.spent)} из потолка $${r.maxSpendUsd}`);
  for (const w of r.warnings) console.log(`  внимание: ${w}`);
  const what = { made: 'сделана', kept: 'уже была', skipped: 'пропущена: потолок расходов набора', failed: 'ошибка', cancelled: 'отменена' };
  for (const s of r.slots) console.log(`  ${s.slot}. ${s.title}: ${what[s.result]}${s.card ? ` [${s.card}]` : ''}${s.blocking != null ? `, блокирующих FAIL ${s.blocking}` : ''}${s.stop ? `, остановка: ${s.stop}` : ''}${s.error ? ` — ${s.error}` : ''}`);
}

/** @param {import('./make.js').SetReport} r */
const setOk = r => r.slots.every(s => s.result === 'kept' || (s.result === 'made' && s.blocking === 0));

/** @param {any} v @param {string[]} files */
async function setMake(v, files) {
  const { makeSet } = await import('./make.js');
  const plan = files[0] ? JSON.parse(fs.readFileSync(path.resolve(files[0]), 'utf8')) : undefined;
  const signal = interruptible();
  const r = await paid({
    needsKey: imagesNeedKey(v), signal, op: 'makeSet',
    args: () => ({ collectionId: v.collection, ...(plan ? { plan } : { setId: v.set }), provider: v.provider, model: v.model, only: list(v.slots), redo: !!v.redo, limits: limitsOf(v) }),
    here: async () => makeSet({
      collection: v.collection, ...(plan ? { plan } : { set: v.set }), ...await providerOf(v), only: list(v.slots), redo: !!v.redo, progress, signal, limits: limitsOf(v),
    }),
  }, v);
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else printSet(r);
  return setOk(r) ? 0 : 1;
}

/** @param {any} v */
async function setSheetCmd(v) {
  const { setSheet } = await import('./sheet.js');
  const r = await setSheet({ collection: v.collection, set: v.set, out: path.resolve(v.out) });
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else console.log(`Лист набора: ${r.path}${r.missing.length ? ` (нет картинки в слотах ${r.missing.join(', ')})` : ''}`);
  return 0;
}

/** @param {any} v */
async function collectionPlan(v) {
  const { planCollectionInto } = await import('./make.js');
  const o = { title: v.title, theme: v.theme, wishes: v.wishes, variants: v.variants && +v.variants, only: list(v.only), maxSpendUsd: v['max-spend'] !== undefined ? +v['max-spend'] : undefined };
  const r = await paid({
    needsKey: true, op: 'planCollection', args: () => ({ ...o, collectionId: v.collection }),
    here: () => planCollectionInto({ ...o, collection: v.collection, settings: settingsOf(), progress }),
  });
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`Коллекция ${r.collection}:`);
    for (const s of r.sets) { console.log(`  №${s.number} «${s.plan?.title}»: ${s.set ? `план сохранён (${s.set})` : 'план не сохранён'}`); printVerdict(s, '    '); }
    printVerdict(r);
    console.log(`Планирование: вызовов ${r.calls}, потрачено ${usd(r.spent)}.`);
  }
  return r.sets.every(s => s.set) && !r.errors.length ? 0 : 1;
}

/** @param {any} v */
async function collectionMake(v) {
  const { makeCollection } = await import('./make.js');
  const signal = interruptible();
  const r = await paid({
    needsKey: imagesNeedKey(v), signal, op: 'makeCollection',
    args: () => ({ collectionId: v.collection, numbers: list(v.sets), provider: v.provider, model: v.model, limits: limitsOf(v) }),
    here: async () => makeCollection({ collection: v.collection, numbers: list(v.sets), ...await providerOf(v), progress, signal, limits: limitsOf(v) }),
  }, v);
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const s of r.sets) printSet(s);
    for (const s of r.skipped) console.log(`Пропущен набор ${s}`);
    console.log(`Всего потрачено ${usd(r.spent)}.`);
  }
  return r.sets.every(setOk) && !r.skipped.length ? 0 : 1;
}

const PLAN_ABOUT = `The plan is a SetPlan (core/set/README.md): the set's theme, angle and window, and for each of its 10 slots the
stars, the frame, the item kind and the card order. It is checked by the style's set rules (styles/<style>/SETS.md,
as data in set-rules.json) and every order by the style's card rules.`;

export const setCommands = {
  'set plan': {
    usage: ['ccf.mjs set plan --theme TEXT [--wishes TEXT] [--variants N] [--window LAYOUT] [--scenes N] [--template COLOUR] [--collection ID [--save]] [--out DIR] [--max-spend USD] [--json]'],
    about: `Plans a set with the text model of the settings (set.plan; the editor's path when no agent writes the plan):
the prompt is assembled from the style's set fragments (SETS.md «Для промпта»), the answer is checked and its errors
are sent back to the model (settings set.plan.repairs). With --collection the plan is checked against the
collection's other sets (no repeated item kinds or captions); --save puts each plan without errors into the
collection as a set (no cards yet: "set make --set"). --out writes the plans as JSON files.
${PLAN_ABOUT}`,
    options: {
      theme: { type: 'string', value: 'TEXT', help: 'the set theme (required)' },
      ...PLAN_OPTIONS,
      window: { type: 'string', value: 'LAYOUT', help: 'a window layout of set-rules.json (default: large; a whole set in the large window)' },
      scenes: { type: 'string', value: 'N', help: 'character scenes at the end (default: the smallest the window allows)' },
      template: { type: 'string', value: 'COLOUR', help: 'the window colour template' },
      collection: { type: 'string', value: 'ID', help: 'the collection the set belongs to' },
      save: { type: 'boolean', help: 'put the plans into the collection as sets' },
      out: { type: 'string', value: 'DIR', help: 'write the plans as JSON files into this folder' },
    },
    check: (/** @type {any} */ v) => !v.theme ? '--theme is required' : !whole(v.variants) ? '--variants must be a whole number above 0'
      : v.scenes !== undefined && !(Number.isInteger(+v.scenes) && +v.scenes >= 0) ? '--scenes must be a whole number, 0 or more'
      : v.save && !v.collection ? '--save needs --collection' : !v.save && !v.out && !v.json ? 'give --out DIR, --save (with --collection) or --json: where the plans go' : null,
    run: setPlan,
  },
  'set check': {
    usage: ['ccf.mjs set check PLAN.json … [--collection ID] [--json]'],
    about: `Checks set plans written by an agent (or edited by a person). Several files of one variant group are checked
as variants of each other. With --collection, also against the collection's other sets.
${PLAN_ABOUT}`,
    options: { collection: { type: 'string', value: 'ID', help: 'the collection the set belongs to' }, json: JSON_OPTION },
    positionals: { min: 1, max: 32, label: 'PLAN.json' },
    run: setCheck,
  },
  'set save': {
    usage: ['ccf.mjs set save PLAN.json --collection ID [--json]'],
    about: `Saves a set plan written by an agent as a new set of the collection, without making any card (cards: "set make
--set ID"). The plan is checked as in "set check --collection" and is refused with its errors if it does not pass.
${PLAN_ABOUT}`,
    options: { collection: { type: 'string', value: 'ID', help: 'the collection id (required)' }, json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'PLAN.json' },
    check: (/** @type {any} */ v) => !v.collection ? '--collection is required' : null,
    run: setSave,
  },
  'set make': {
    usage: ['ccf.mjs set make PLAN.json --collection ID [options]', 'ccf.mjs set make --collection ID --set ID [--slots 1,2,…] [--redo] [options]'],
    about: `Makes the cards of a set: with PLAN.json the plan is checked and saved as a new set of the collection; with --set
the set's saved plan is used. Each card goes through the card loop ("card make") and into its slot as soon as it is
made; slots that already hold a made card are kept (--redo makes them again). Cards are made --parallel at a time
under one spend cap for the set. Ctrl+C stops starting new cards; the cards in progress finish.`,
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      set: { type: 'string', value: 'ID', help: 'a set of the collection with a saved plan' },
      slots: { type: 'string', value: 'N,N', help: 'only these slots (1–10)' },
      redo: { type: 'boolean', help: 'make again the slots that already hold a made card' },
      ...MAKE_OPTIONS,
    },
    positionals: { min: 0, max: 1, label: 'PLAN.json' },
    check: (/** @type {any} */ v, /** @type {string[]} */ p) => !v.collection ? '--collection is required' : !p.length === !v.set ? 'give either PLAN.json or --set ID'
      : !listOk(v.slots) ? '--slots must be numbers separated by commas' : makeError(v),
    run: setMake,
  },
  'set sheet': {
    usage: ['ccf.mjs set sheet --collection ID --set ID --out FILE.png [--json]'],
    about: 'Writes a sheet of the set: its cards in window order with stars, frame and caption — to look at the set as a whole.',
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      set: { type: 'string', value: 'ID', help: 'the set id (required)' },
      out: { type: 'string', value: 'FILE', help: 'the PNG to write (required)' },
      json: JSON_OPTION,
    },
    check: (/** @type {any} */ v) => !v.collection || !v.set || !v.out ? '--collection, --set and --out are required' : null,
    run: setSheetCmd,
  },
  'collection plan': {
    usage: ['ccf.mjs collection plan --theme TEXT (--collection ID | --title TEXT) [--wishes TEXT] [--variants N] [--only N,N] [--max-spend USD] [--json]'],
    about: `Plans a whole collection with the text model: the theme is split into its set themes (set-rules.json
collection.sets; the last one the grand set), then every set is planned in order with the window and scene count of its place (the reference collection's
curve, SETS.md 1.4), against the sets before it. Plans without errors are saved into the collection as sets (no
cards yet: "collection make"). Without --collection a new collection is created (title --title, description the theme).`,
    options: {
      theme: { type: 'string', value: 'TEXT', help: 'the collection theme (required)' },
      collection: { type: 'string', value: 'ID', help: 'an existing collection to plan into' },
      title: { type: 'string', value: 'TEXT', help: 'the title of a new collection' },
      only: { type: 'string', value: 'N,N', help: 'plan only these places of the collection (1–16)' },
      ...PLAN_OPTIONS,
    },
    check: (/** @type {any} */ v) => !v.theme ? '--theme is required' : !whole(v.variants) ? '--variants must be a whole number above 0' : !listOk(v.only) ? '--only must be numbers separated by commas' : null,
    run: collectionPlan,
  },
  'collection check': {
    usage: ['ccf.mjs collection check --collection ID [--partial] [--json]'],
    about: `Checks the saved plans of a collection as a whole (the check "collection plan" runs at its end): each set against
the others (registry, titles, captions), 16 sets with the grand set last, and more scenes in the last five regular sets
than in the first five. With --partial a collection that is not complete yet is allowed (no "16 sets" error), for
planning set by set.`,
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      partial: { type: 'boolean', help: 'the collection is not complete yet: do not demand all 16 sets' },
      json: JSON_OPTION,
    },
    check: (/** @type {any} */ v) => !v.collection ? '--collection is required' : null,
    run: collectionCheck,
  },
  'collection make': {
    usage: ['ccf.mjs collection make --collection ID [--sets N,N] [options]'],
    about: 'Makes the cards of the collection\'s planned sets in their order (by number), or only the given set numbers.',
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      sets: { type: 'string', value: 'N,N', help: 'only these set numbers' },
      ...MAKE_OPTIONS,
    },
    check: (/** @type {any} */ v) => !v.collection ? '--collection is required' : !listOk(v.sets) ? '--sets must be numbers separated by commas' : makeError(v),
    run: collectionMake,
  },
};
