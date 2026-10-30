// The collection and export commands of ccf.mjs: list, create, show a collection, export card images. Thin callers of
// the Store API (core/store/index.js); same spec shape as core/set/cli.js. The store loads on demand.

const JSON_OPTION = { type: 'boolean', help: 'print the result as JSON (for an agent)' };
/** @param {string|undefined} v  ids separated by commas, or nothing */
const ids = v => v === undefined || /^[^,\s]+(,[^,\s]+)*$/.test(v);

/** @returns {Promise<typeof import('./index.js')>} */
const store = () => import('./index.js');

/** @param {any} v */
async function collectionList(v) {
  const list = await (await store()).listCollections();
  if (v.json) console.log(JSON.stringify(list, null, 2));
  else if (!list.length) console.log('Коллекций пока нет: "collection create --title …".');
  else for (const c of list) console.log(`${c.id} — «${c.title}»: наборов ${c.setCount}, карточек ${c.cardCount}${c.description ? `; ${c.description}` : ''}`);
  return 0;
}

/** @param {any} v */
async function collectionCreate(v) {
  const c = await (await store()).createCollection({ title: v.title, description: v.description ?? '' });
  if (v.json) console.log(JSON.stringify(c, null, 2));
  else console.log(`Коллекция создана: ${c.id} — «${c.title}»`);
  return 0;
}

/** @param {any} v @param {string[]} p */
async function collectionShow(v, [id]) {
  const { getCollection } = await store();
  const { collection, sets, pool } = await getCollection(id);
  const out = {
    id: collection.id, title: collection.title, description: collection.description, style: collection.style,
    sets: sets.map(s => ({
      id: s.id, number: s.number, title: s.title, variantGroup: s.variantGroup, hasPlan: !!s.plan,
      cards: s.slots.filter(Boolean).length, slots: s.slots,
    })),
    pool: pool.map(c => ({ id: c.id, title: c.title, status: c.status, blocking: c.checks?.blocking ?? null, image: c.image, cost: c.cost })),
  };
  if (v.json) { console.log(JSON.stringify(out, null, 2)); return 0; }
  console.log(`Коллекция ${out.id} — «${out.title}» (стиль ${out.style})${out.description ? `\n${out.description}` : ''}`);
  console.log(out.sets.length ? 'Наборы:' : 'Наборов нет.');
  for (const s of out.sets) console.log(`  №${s.number} ${s.id} — «${s.title}»: карточек ${s.cards} из ${s.slots.length}, ${s.hasPlan ? 'план есть' : 'плана нет'}`);
  console.log(out.pool.length ? 'Карточки вне наборов (пул):' : 'Пул карточек пуст.');
  for (const c of out.pool) console.log(`  ${c.id} — «${c.title}»: ${c.status}${c.blocking != null ? `, блокирующих FAIL ${c.blocking}` : ''}`);
  return 0;
}

/** @param {any} v */
async function exportCmd(v) {
  const { exportItems, openFolder } = await store();
  const r = await exportItems({
    collectionId: v.collection, setIds: v.set ? v.set.split(',') : undefined, cardIds: v.card ? v.card.split(',') : undefined,
    format: v.zip ? 'zip' : 'png',
  });
  if (v.open) await openFolder(r.path);
  if (v.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`Выгружено файлов: ${r.files}. ${v.zip ? 'Архив' : 'Папка'}: ${r.path}`);
    for (const s of r.skipped) console.log(`  пропущена ${s.id}: ${s.reason}`);
  }
  return 0;
}

export const storeCommands = {
  'collection list': {
    usage: ['ccf.mjs collection list [--json]'],
    about: 'Lists the collections of the factory: id, title, how many sets and cards.',
    options: { json: JSON_OPTION },
    run: collectionList,
  },
  'collection create': {
    usage: ['ccf.mjs collection create --title TEXT [--description TEXT] [--json]'],
    about: 'Creates an empty collection (its id is made from the title). Cards made without a set land in its pool.',
    options: {
      title: { type: 'string', value: 'TEXT', help: 'the collection title (required)' },
      description: { type: 'string', value: 'TEXT', help: 'what the collection is' },
      json: JSON_OPTION,
    },
    check: (/** @type {any} */ v) => !v.title?.trim() ? '--title is required' : null,
    run: collectionCreate,
  },
  'collection show': {
    usage: ['ccf.mjs collection show ID [--json]'],
    about: 'Shows a collection: its sets (number, id, title, cards made, whether a plan is saved) and the pool of cards that sit in no set.',
    options: { json: JSON_OPTION },
    positionals: { min: 1, max: 1, label: 'ID' },
    run: collectionShow,
  },
  export: {
    usage: ['ccf.mjs export --collection ID [--set ID,…] [--card ID,…] [--zip] [--open] [--json]'],
    about: `Copies card images out for the person under collections/<collection>/export/: a folder per set (cards in slot
order) and a folder for single cards, or one ZIP with --zip. Without --set and --card every set of the collection is
exported. Cards without a finished image are skipped and listed. --open shows the result in the file manager.`,
    options: {
      collection: { type: 'string', value: 'ID', help: 'the collection id (required)' },
      set: { type: 'string', value: 'ID,ID', help: 'only these sets' },
      card: { type: 'string', value: 'ID,ID', help: 'single cards of the collection (the pool or any set)' },
      zip: { type: 'boolean', help: 'one ZIP archive instead of folders' },
      open: { type: 'boolean', help: 'open the result in the file manager' },
      json: JSON_OPTION,
    },
    check: (/** @type {any} */ v) => !v.collection ? '--collection is required' : !ids(v.set) || !ids(v.card) ? '--set and --card are ids separated by commas' : null,
    run: exportCmd,
  },
};
