// The store: collections, their sets, the collection's card pool, moves between them, export and live events.
// Layout and formats: core/store/README.md (the one description). Every write of the product goes through here, so
// the editor's live view sees it. `createStore({ root })` gives the same operations over another folder (tests);
// core/store/index.js exports them over the factory's collections/.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { attemptCost, attemptDir, attemptSpend, busyOf, readCardFile } from '../card/card-file.js';
import { exists, readJson, subdirs, writeJsonAtomic } from './files.js';
import { checkId, reserveId, slugify } from './ids.js';
import {
  CARDS_DIR, CARD_FILE, COLLECTIONS_DIR, COLLECTION_FILE, DEFAULT_STYLE, EXPORT_CARDS_FOLDER, EXPORT_DIR, EXPORT_POOL_FOLDER, FACTORY_EXPORT_DIR, FINAL_IMAGE, SETS_DIR,
  SET_FILE, SLOT_COUNT, SPEND_FILE, windowKinds, windowTemplates,
} from './layout.js';
import { watchStore } from './watch.js';
import { writeZip } from './zip.js';

/**
 * @typedef {object} Collection  collection.json
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {Record<string, unknown>} fields  free-form fields of the collection (season, audience, …)
 * @property {string} style  styles/<style>
 * @property {string[]} sets  set ids in the collection's order
 * @property {string|null} [cover]  the card whose image is the collection's cover, chosen by a person; none or a card
 *   without an image: the first card in the first set (else any card) stands for it
 * @property {string} createdAt  ISO time
 * @property {string} updatedAt
 */

/**
 * @typedef {object} Brief  what the set was asked for, in the producer's words
 * @property {string} theme
 * @property {string} wishes
 * @property {number} variants  how many variants of the set were asked for
 */

/**
 * The set window; other keys (e.g. core/set's `layout`) are kept as given. Checked when written.
 * @typedef {{kind: string, template: string} & Record<string, unknown>} SetWindow  kind and template: of the style's
 *   windows.json (layout.js windowKinds, windowTemplates)
 */

/**
 * @typedef {object} CardSet  set.json; keys other than these (e.g. `plan` of core/set) are kept as they are
 * @property {string} id
 * @property {string} title
 * @property {number} number  the set's number in the collection (variants of one set share it)
 * @property {Brief} brief
 * @property {SetWindow} window
 * @property {(string|null)[]} slots  SLOT_COUNT card ids or null, in window order (row by row, left to right)
 * @property {string} variantGroup  sets with the same group are variants of one set; a new set's group is its own id
 * @property {unknown} [plan]  the set's plan (core/set), stored as given
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} CardSummary
 * @property {string} id
 * @property {string} title  the order's title, else its object, else the id
 * @property {string|null} image  absolute path of card.png; null while there is none
 * @property {'new'|'made'|'failed'} status  new: no attempt yet; made: card.png chosen; failed: attempts, none usable
 * @property {{blocking: number, warns: number, needsEyes: number, maskStatus: string}|null} checks  the chosen attempt's
 * @property {number} attempts
 * @property {number} cost  USD, sum of the known costs of the attempts: images, the vision model's calls and the text
 *   model's corrections (card-file.js attemptCost)
 * @property {{images: number, vision: number, text: number}} spend  the same split by kind (card-file.js attemptSpend)
 * @property {number} costUnknown  attempts whose cost the provider did not report
 * @property {string|null} model  the model that made the chosen version ("agent": an image handed in); null without one
 * @property {string|null} setId  the set the card sits in; null = in the pool
 * @property {number|null} slot  0-based index into that set's slots
 * @property {string|null} updatedAt  last change of card.json or card.png
 * @property {string[]} busy  the long operations running on the card now, in any process (card-file.js busyOf), e.g.
 *   "regenerate"; empty when none
 * @property {string} [error]  card.json could not be read
 */

/**
 * @typedef {object} CollectionSummary
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {number} setCount
 * @property {number} cardCount
 * @property {string|null} cover  image of the chosen cover card (collection.json `cover`), else of the first card in the
 *   first set, else of any card; null when none
 */

/** @typedef {{setId: string, slot: number}} Place */

/**
 * @typedef {object} SpendEntry  one paid call that no card records: a line of the factory's spend ledger (SPEND_FILE)
 * @property {string} at  ISO time
 * @property {string|null} collectionId  the collection it was for; null = none yet (the text of a new collection)
 * @property {'images'|'vision'|'text'} kind
 * @property {string} what  what it was for, e.g. "plan", "text-help"
 * @property {string} model
 * @property {number} usd
 */

/**
 * @typedef {object} Spend  USD by kind, known costs only
 * @property {number} images  the image models (an imported image and a free provider count 0)
 * @property {number} vision  the vision model: hero outlines and looks
 * @property {number} text  the text model: plans, text help, corrections of failed pictures
 * @property {number} total
 * @property {number} unknown  calls whose price the provider did not report
 */

/**
 * tools/trash.mjs, the project's one way to delete (checks the paths, then the OS trash). Imported by a computed URL
 * so the type check of core/ does not take in the untyped tools/; this is its contract.
 * @typedef {(paths: string[], o: {root?: string, roots?: string[], move?: (paths: string[]) => string}) => {ok: boolean, lines: string[]}} TrashFn
 */
const TRASH_MODULE = new URL('../../tools/trash.mjs', import.meta.url).href;
const loadTrash = async () => /** @type {{trash: TrashFn}} */ (await import(TRASH_MODULE)).trash;

const COLLECTION_KEYS =['title', 'description', 'fields', 'style', 'sets', 'cover'];
const PROTECTED_SET_KEYS = ['id', 'createdAt', 'updatedAt'];

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const now = () => new Date().toISOString();
/** @param {number} v  USD rounded to a millionth: sums of floats stay readable */
const round6 = v => Math.round(v * 1e6) / 1e6;

/** @param {string} what @param {unknown} v */
function text(what, v) {
  if (typeof v !== 'string') throw new Error(`${what}: нужна строка.`);
  return v;
}

/** @param {unknown} v */
function title(v) {
  if (typeof v !== 'string' || !v.trim()) throw new Error('Нужно название (непустая строка).');
  return v.trim();
}

/** @param {unknown} brief @param {Brief} [base] @returns {Brief} */
function checkBrief(brief = {}, base = { theme: '', wishes: '', variants: 1 }) {
  if (!isObject(brief)) throw new Error('Вводные набора (brief) — объект { theme, wishes, variants }.');
  const out = { ...base, ...brief };
  text('Тема набора (brief.theme)', out.theme);
  text('Пожелания (brief.wishes)', out.wishes);
  if (!Number.isInteger(out.variants) || out.variants < 1) throw new Error('Число вариантов (brief.variants) — целое от 1.');
  return out;
}

/**
 * The window of a set by its style's windows (layout.js windowKinds, windowTemplates). The kind defaults to the
 * style's main window; a template not given that does not belong to the kind (the kind changed, or the default)
 * becomes the kind's first.
 * @param {string} style @param {unknown} window @param {Partial<SetWindow>} [base] @returns {SetWindow}
 */
function checkWindow(style, window = {}, base = {}) {
  if (!isObject(window)) throw new Error('Окно набора (window) — объект { kind, template }.');
  const kinds = windowKinds(style);
  const out = /** @type {SetWindow} */ ({ kind: kinds[0], ...base, ...window });
  if (!kinds.includes(out.kind)) throw new Error(`Вид окна «${out.kind}» неизвестен: ${kinds.join(', ')}.`);
  const templates = windowTemplates(style, out.kind);
  if (!('template' in window) && !templates.includes(out.template)) out.template = templates[0];
  if (!templates.includes(out.template)) throw new Error(`Шаблон окна «${out.template}» у окна ${out.kind} неизвестен: ${templates.join(', ')}.`);
  return out;
}

/** @param {unknown} n */
function checkNumber(n) {
  if (!Number.isInteger(n) || /** @type {number} */ (n) < 1) throw new Error('Номер набора — целое от 1.');
  return /** @type {number} */ (n);
}

/** A file or folder name a person reads: no characters a file system refuses, no trailing dots or spaces. */
function fileName(/** @type {string} */ name, /** @type {string} */ fallback) {
  let s = String(name).replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s || fallback;
}

/** "name", "name (2)", … not yet in `used` (compared without case, as on macOS and Windows). */
function uniqueName(/** @type {Set<string>} */ used, /** @type {string} */ name, ext = '') {
  for (let n = 1; ; n++) {
    const candidate = (n === 1 ? name : `${name} (${n})`) + ext;
    if (!used.has(candidate.toLowerCase())) { used.add(candidate.toLowerCase()); return candidate; }
  }
}

/**
 * The sets a whole collection shows: of each variant group its chosen variant, or every variant when none is chosen.
 * @template {{id: string, variantGroup?: string, chosen?: boolean}} S @param {S[]} sets @returns {S[]}
 */
export function chosenVariants(sets) {
  /** @type {Map<string, S[]>} */
  const groups = new Map();
  for (const s of sets) groups.set(s.variantGroup ?? s.id, [...(groups.get(s.variantGroup ?? s.id) ?? []), s]);
  return [...groups.values()].flatMap(vs => (vs.some(v => v.chosen) ? vs.filter(v => v.chosen) : vs));
}

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const stampName = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

/**
 * @param {object} [o]
 * @param {string} [o.root]  the collections folder; the factory's collections/ by default
 * @param {(paths: string[]) => string} [o.trashMove]  replaces the OS trash (tests); see tools/trash.mjs
 * @param {typeof nodeSpawn} [o.spawn]  replaces child_process.spawn for openFolder (tests)
 * @param {NodeJS.Platform} [o.platform]
 */
export function createStore({ root = COLLECTIONS_DIR, trashMove, spawn = nodeSpawn, platform = process.platform } = {}) {
  root = path.resolve(root);

  const collectionDir = (/** @type {string} */ c) => path.join(root, checkId('коллекция', c));
  const setDir = (/** @type {string} */ c, /** @type {string} */ s) => path.join(collectionDir(c), SETS_DIR, checkId('набор', s));

  /**
   * Where core/card writes the card (the folder may not exist yet).
   * @param {string} collectionId @param {string} cardId
   */
  const cardDir = (collectionId, cardId) => path.join(collectionDir(collectionId), CARDS_DIR, checkId('карточка', cardId));

  /** @param {string} c @returns {Collection} */
  function readCollection(c) {
    const file = path.join(collectionDir(c), COLLECTION_FILE);
    if (!exists(file)) throw new Error(`Коллекции «${c}» нет (${file}).`);
    return readJson(file);
  }
  /** @param {Collection} col */
  const writeCollection = col => writeJsonAtomic(path.join(collectionDir(col.id), COLLECTION_FILE), col);

  /** @param {string} c @param {string} s @returns {CardSet} */
  function readSet(c, s) {
    const file = path.join(setDir(c, s), SET_FILE);
    if (!exists(file)) throw new Error(`Набора «${s}» в коллекции «${c}» нет.`);
    return readJson(file);
  }
  /** @param {string} c @param {CardSet} set */
  const writeSet = (c, set) => writeJsonAtomic(path.join(setDir(c, set.id), SET_FILE), set);

  /** The collection's sets: first in its order, then any not listed there, by number. @param {string} c @param {Collection} col */
  function allSets(c, col = readCollection(c)) {
    const ids = subdirs(path.join(collectionDir(c), SETS_DIR)).filter(s => exists(path.join(setDir(c, s), SET_FILE)));
    const listed = col.sets.filter(s => ids.includes(s));
    const rest = ids.filter(s => !listed.includes(s));
    const sets = [...listed, ...rest].map(s => readSet(c, s));
    const tail = sets.slice(listed.length).sort((a, b) => a.number - b.number);
    return [...sets.slice(0, listed.length), ...tail];
  }

  /** @param {CardSet[]} sets @returns {Map<string, Place>} */
  function placesOf(sets) {
    const places = new Map();
    for (const set of sets) set.slots.forEach((id, slot) => { if (id) places.set(id, { setId: set.id, slot }); });
    return places;
  }

  /** @param {string} c */
  const cardIds = c => {
    const dir = path.join(collectionDir(c), CARDS_DIR);
    return subdirs(dir).sort((a, b) => birth(path.join(dir, a)) - birth(path.join(dir, b)) || a.localeCompare(b));
  };
  /** @param {string} p */
  const birth = p => { const s = fs.statSync(p); return s.birthtimeMs || s.ctimeMs; };

  /** The model original of a card's chosen version, or null. @param {string} c @param {string} k */
  function originalOf(c, k) {
    const dir = cardDir(c, k);
    let card;
    try { card = readCardFile(dir); } catch { return null; }
    const a = card?.attempts.find(x => x.n === card.chosen);
    const file = a?.original ? path.join(attemptDir(dir, a.n), a.original) : null;
    return file && exists(file) ? file : null;
  }

  /** @param {string} c @param {string} k @param {Place|undefined} place @returns {CardSummary} */
  function summary(c, k, place) {
    const dir = cardDir(c, k);
    const png = path.join(dir, FINAL_IMAGE);
    const times = [png, path.join(dir, CARD_FILE)].map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } });
    const latest = Math.max(...times);
    /** @type {CardSummary} */
    const out = {
      id: k, title: k, image: null, status: 'new', checks: null, attempts: 0, cost: 0, spend: { images: 0, vision: 0, text: 0 }, costUnknown: 0, model: null,
      setId: place?.setId ?? null, slot: place?.slot ?? null, updatedAt: latest ? new Date(latest).toISOString() : null, busy: busyOf(dir).map(b => b.what),
    };
    let card;
    try { card = readCardFile(dir); } catch (e) { out.error = `card.json не читается: ${/** @type {Error} */ (e).message}`; return out; }
    if (!card) return out;
    out.title = card.order?.title || card.order?.object || k;
    out.attempts = card.attempts.length;
    for (const a of card.attempts) {
      if (a.cost == null) out.costUnknown++;
      out.cost += attemptCost(a);
      const sp = attemptSpend(a);
      out.spend.images += sp.images;
      out.spend.vision += sp.vision;
      out.spend.text += sp.text;
    }
    out.cost = round6(out.cost);
    out.spend = { images: round6(out.spend.images), vision: round6(out.spend.vision), text: round6(out.spend.text) };
    const chosen = card.attempts.find(a => a.n === card.chosen);
    out.model = chosen?.model ?? null;
    if (chosen && exists(png)) {
      out.status = 'made';
      out.image = png;
      const ch = chosen.check;
      if (ch) out.checks = { blocking: ch.blocking, warns: ch.warns, needsEyes: ch.needsEyes ?? ch.fails.length - ch.blocking, maskStatus: ch.maskStatus };
    } else if (card.attempts.length) out.status = 'failed';
    return out;
  }

  const ledger = () => path.join(root, SPEND_FILE);
  /** @returns {SpendEntry[]} the ledger; a line that does not read is skipped */
  function readLedger() {
    let text = '';
    try { text = fs.readFileSync(ledger(), 'utf8'); } catch { return []; }
    return text.split('\n').flatMap(l => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
  }
  /** @param {string} c @param {Spend} into */
  function addCollectionSpend(c, into) {
    for (const k of cardIds(c)) {
      const sum = summary(c, k, undefined);
      into.images += sum.spend.images;
      into.vision += sum.spend.vision;
      into.text += sum.spend.text;
      into.unknown += sum.costUnknown;
    }
  }

  /** @param {string} p */
  async function toTrash(p) {
    // Only inside the collections folder, never the folder itself.
    const r = (await loadTrash())([p], { root, roots: [root], move: trashMove });
    if (!r.ok) throw new Error('Не удалось убрать в корзину:\n' + r.lines.join('\n'));
  }

  /**
   * Places all cards so that each sits in at most one slot: `changes` maps set id → its new slots; any other set
   * holding one of the cards placed there loses it. Writes only the sets that changed.
   * @param {string} c @param {CardSet[]} sets @param {Map<string, (string|null)[]>} changes
   */
  function applySlots(c, sets, changes) {
    const placed = new Set([...changes.values()].flat().filter(Boolean));
    const t = now();
    for (const set of sets) {
      const before = JSON.stringify(set.slots);
      const slots = changes.get(set.id) ?? set.slots.map(id => (id && placed.has(id) ? null : id));
      if (JSON.stringify(slots) !== before) writeSet(c, { ...set, slots, updatedAt: t });
    }
  }

  /** @param {string} c @param {unknown} slots */
  function checkSlots(c, slots) {
    if (!Array.isArray(slots) || slots.length !== SLOT_COUNT) throw new Error(`Слоты набора — массив из ${SLOT_COUNT} id карточек или null.`);
    const seen = new Set();
    for (const id of slots) {
      if (id === null) continue;
      if (!exists(cardDir(c, id))) throw new Error(`Карточки «${id}» в коллекции «${c}» нет.`);
      if (seen.has(id)) throw new Error(`Карточка «${id}» стоит в наборе дважды.`);
      seen.add(id);
    }
    return /** @type {(string|null)[]} */ (slots);
  }

  return {
    root,
    cardDir,

    /** @returns {Promise<CollectionSummary[]>} oldest first; folders without collection.json are not collections */
    async listCollections() {
      const out = [];
      for (const c of subdirs(root)) {
        if (!exists(path.join(root, c, COLLECTION_FILE))) continue;
        const col = readCollection(c);
        const sets = allSets(c, col);
        const cards = cardIds(c);
        let cover = null;
        for (const id of [col.cover, ...sets.flatMap(s => s.slots), ...cards]) {
          if (id && exists(path.join(cardDir(c, id), FINAL_IMAGE))) { cover = path.join(cardDir(c, id), FINAL_IMAGE); break; }
        }
        out.push({ id: col.id, title: col.title, description: col.description, setCount: sets.length, cardCount: cards.length, cover, createdAt: col.createdAt });
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(({ createdAt, ...rest }) => rest);
    },

    /**
     * @param {{title: string, description?: string, fields?: Record<string, unknown>, style?: string}} o
     * @returns {Promise<Collection>}
     */
    async createCollection({ title: t, description = '', fields = {}, style = DEFAULT_STYLE }) {
      const name = title(t);
      text('Описание коллекции', description);
      if (!isObject(fields)) throw new Error('Поля коллекции (fields) — объект.');
      const id = reserveId(root, slugify(name, 'collection'));
      for (const d of [CARDS_DIR, SETS_DIR]) fs.mkdirSync(path.join(root, id, d), { recursive: true });
      const at = now();
      /** @type {Collection} */
      const col = { id, title: name, description, fields, style: text('Стиль', style), sets: [], createdAt: at, updatedAt: at };
      writeCollection(col);
      return col;
    },

    /** @param {string} collectionId @returns {Promise<{collection: Collection, sets: CardSet[], pool: CardSummary[]}>} */
    async getCollection(collectionId) {
      const collection = readCollection(collectionId);
      const sets = allSets(collectionId, collection);
      const places = placesOf(sets);
      const pool = cardIds(collectionId).filter(k => !places.has(k)).map(k => summary(collectionId, k, undefined));
      return { collection, sets, pool };
    },

    /**
     * Keys: title, description, fields (replaced as a whole), style, sets (the new order: the same set ids), cover (a
     * card id of the collection, or null for the first card).
     * @param {string} collectionId @param {Partial<Collection>} patch @returns {Promise<Collection>}
     */
    async updateCollection(collectionId, patch) {
      const col = readCollection(collectionId);
      if (!isObject(patch)) throw new Error('Изменения коллекции — объект.');
      for (const key of Object.keys(patch)) if (!COLLECTION_KEYS.includes(key)) throw new Error(`Коллекция: поле «${key}» менять нельзя или его нет (можно: ${COLLECTION_KEYS.join(', ')}).`);
      const next = { ...col, ...patch, updatedAt: now() };
      if ('title' in patch) next.title = title(patch.title);
      if ('description' in patch) text('Описание коллекции', patch.description);
      if ('style' in patch) text('Стиль', patch.style);
      if ('fields' in patch && !isObject(patch.fields)) throw new Error('Поля коллекции (fields) — объект.');
      if ('cover' in patch && patch.cover !== null && !(typeof patch.cover === 'string' && exists(cardDir(collectionId, patch.cover)))) throw new Error(`Обложка — карточка этой коллекции, а «${patch.cover}» в ней нет.`);
      if ('sets' in patch) {
        const have = allSets(collectionId, col).map(s => s.id).sort();
        if (!Array.isArray(patch.sets) || JSON.stringify([...patch.sets].sort()) !== JSON.stringify(have)) {
          throw new Error(`Порядок наборов — все id наборов коллекции ровно по разу: ${have.join(', ')}.`);
        }
      }
      writeCollection(next);
      return next;
    },

    /** Moves the collection's folder (sets, cards, exports) to the OS trash. @param {string} collectionId */
    async deleteCollection(collectionId) {
      readCollection(collectionId);
      await toTrash(collectionDir(collectionId));
    },

    /**
     * Other keys of `o` (e.g. `plan`) are stored in set.json as given.
     * @param {string} collectionId
     * @param {{title: string, brief?: Partial<Brief>, window?: Partial<SetWindow>, number?: number, variantGroup?: string, plan?: unknown} & Record<string, unknown>} o
     * @returns {Promise<CardSet>}
     */
    async createSet(collectionId, o) {
      const col = readCollection(collectionId);
      if (!isObject(o)) throw new Error('Набор: нужен объект { title, brief, window }.');
      const { title: t, brief, window, number, variantGroup, slots, ...extra } = o;
      for (const key of PROTECTED_SET_KEYS) if (key in extra) throw new Error(`Набор: поле «${key}» задаёт хранилище.`);
      const name = title(t);
      const b = checkBrief(brief);
      const w = checkWindow(col.style, window);
      const sets = allSets(collectionId, col);
      const n = number === undefined ? Math.max(0, ...sets.map(s => s.number)) + 1 : checkNumber(number);
      const id = reserveId(path.join(collectionDir(collectionId), SETS_DIR), slugify(name, 'set'));
      const at = now();
      /** @type {CardSet} */
      const set = {
        id, title: name, number: n, brief: b, window: w, slots: Array(SLOT_COUNT).fill(null),
        variantGroup: variantGroup === undefined ? id : text('Группа вариантов', variantGroup), ...extra, createdAt: at, updatedAt: at,
      };
      writeSet(collectionId, set);
      if (slots !== undefined) applySlots(collectionId, [...sets, set], new Map([[id, checkSlots(collectionId, slots)]]));
      writeCollection({ ...col, sets: [...col.sets.filter(s => s !== id), id], updatedAt: at });
      return readSet(collectionId, id);
    },

    /** @param {string} collectionId @param {string} setId @returns {Promise<CardSet>} */
    async getSet(collectionId, setId) {
      readCollection(collectionId);
      return readSet(collectionId, setId);
    },

    /**
     * Merges `patch` into set.json: brief and window key by key (checked), slots as in setSlots, any other key
     * (e.g. `plan`) replaced as given; keys not in the patch are kept. id, createdAt, updatedAt cannot be set.
     * @param {string} collectionId @param {string} setId @param {Record<string, unknown>} patch
     * @returns {Promise<CardSet>}
     */
    async updateSet(collectionId, setId, patch) {
      const col = readCollection(collectionId);
      const set = readSet(collectionId, setId);
      if (!isObject(patch)) throw new Error('Изменения набора — объект.');
      for (const key of PROTECTED_SET_KEYS) if (key in patch) throw new Error(`Набор: поле «${key}» задаёт хранилище.`);
      const { slots, ...rest } = patch;
      const next = { ...set, ...rest, updatedAt: now() };
      if ('title' in rest) next.title = title(rest.title);
      if ('brief' in rest) next.brief = checkBrief(rest.brief, set.brief);
      if ('window' in rest) next.window = checkWindow(col.style, rest.window, set.window);
      if ('number' in rest) checkNumber(rest.number);
      if ('variantGroup' in rest) text('Группа вариантов', rest.variantGroup);
      writeSet(collectionId, next);
      if (slots !== undefined) applySlots(collectionId, allSets(collectionId, col), new Map([[setId, checkSlots(collectionId, slots)]]));
      return readSet(collectionId, setId);
    },

    /** Trashes the set's folder; its cards stay in the collection's pool. @param {string} collectionId @param {string} setId */
    async deleteSet(collectionId, setId) {
      const col = readCollection(collectionId);
      readSet(collectionId, setId);
      await toTrash(setDir(collectionId, setId));
      writeCollection({ ...col, sets: col.sets.filter(s => s !== setId), updatedAt: now() });
    },

    /**
     * Puts the cards into the set's slots; a card placed here leaves any other set it was in.
     * @param {string} collectionId @param {string} setId @param {(string|null)[]} slots @returns {Promise<CardSet>}
     */
    async setSlots(collectionId, setId, slots) {
      const sets = allSets(collectionId);
      if (!sets.some(s => s.id === setId)) readSet(collectionId, setId); // throws "no such set"
      applySlots(collectionId, sets, new Map([[setId, checkSlots(collectionId, slots)]]));
      return readSet(collectionId, setId);
    },

    /**
     * Moves a card to a set's slot (0-based) or back to the pool. A card already in the target slot swaps places
     * with the moved one: it takes the moved card's old slot, or goes to the pool when the moved card came from it.
     * @param {string} collectionId @param {string} cardId @param {Place | {pool: true}} to
     * @returns {Promise<CardSummary>}
     */
    async moveCard(collectionId, cardId, to) {
      if (!exists(cardDir(collectionId, cardId))) throw new Error(`Карточки «${cardId}» в коллекции «${collectionId}» нет.`);
      const sets = allSets(collectionId);
      const from = placesOf(sets).get(cardId);
      /** @type {Map<string, (string|null)[]>} */
      const changes = new Map();
      const slotsOf = (/** @type {string} */ s) => changes.get(s) ?? [.../** @type {CardSet} */ (sets.find(x => x.id === s)).slots];
      if ('pool' in to && to.pool) {
        if (from) changes.set(from.setId, slotsOf(from.setId).map(id => (id === cardId ? null : id)));
      } else {
        const { setId, slot } = /** @type {Place} */ (to);
        if (!sets.some(s => s.id === setId)) readSet(collectionId, setId);
        if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) throw new Error(`Слот — целое от 0 до ${SLOT_COUNT - 1}.`);
        const target = slotsOf(setId);
        const other = target[slot];
        if (from) {
          const source = from.setId === setId ? target : slotsOf(from.setId);
          source[from.slot] = other && other !== cardId ? other : null;
          if (from.setId !== setId) changes.set(from.setId, source);
        }
        target[slot] = cardId;
        changes.set(setId, target);
      }
      if (changes.size) applySlots(collectionId, sets, changes);
      return summary(collectionId, cardId, placesOf(allSets(collectionId)).get(cardId));
    },

    /** Removes the card from its set and trashes its folder (with every attempt). @param {string} collectionId @param {string} cardId */
    async deleteCard(collectionId, cardId) {
      const dir = cardDir(collectionId, cardId);
      if (!exists(dir)) throw new Error(`Карточки «${cardId}» в коллекции «${collectionId}» нет.`);
      const sets = allSets(collectionId);
      const from = placesOf(sets).get(cardId);
      if (from) {
        const slots = /** @type {CardSet} */ (sets.find(s => s.id === from.setId)).slots.map(id => (id === cardId ? null : id));
        applySlots(collectionId, sets, new Map([[from.setId, slots]]));
      }
      await toTrash(dir);
    },

    /**
     * A new card id from the card's title (or any text), unique in the collection; its folder is created at once,
     * so two parallel callers never get the same id.
     * @param {string} collectionId @param {string} base @returns {string}
     */
    newCardId(collectionId, base) {
      readCollection(collectionId);
      return reserveId(path.join(collectionDir(collectionId), CARDS_DIR), slugify(base, 'card'));
    },

    /**
     * all cards of the collection (oldest first), or one set's in slot order, or the pool's (cards in no set).
     * @param {string} collectionId @param {{setId?: string, pool?: boolean}} [o] @returns {Promise<CardSummary[]>}
     */
    async listCards(collectionId, { setId, pool } = {}) {
      const sets = allSets(collectionId);
      const places = placesOf(sets);
      if (setId !== undefined) {
        const set = sets.find(s => s.id === setId) ?? readSet(collectionId, setId);
        return set.slots.flatMap((k, slot) => (k && exists(cardDir(collectionId, k)) ? [summary(collectionId, k, { setId, slot })] : []));
      }
      return cardIds(collectionId).filter(k => !pool || !places.has(k)).map(k => summary(collectionId, k, places.get(k)));
    },

    /**
     * Records a paid call that no card records (a plan, a text help) in the factory's spend ledger (SPEND_FILE): one
     * line appended, so writers in several processes do not overwrite each other. A cost of 0 or an unknown one
     * (null) is recorded too: the latter counts as unknown.
     * @param {string|null} collectionId
     * @param {{kind: SpendEntry['kind'], what: string, model: string, usd: number|null}} entry
     */
    async recordSpend(collectionId, { kind, what, model, usd }) {
      if (collectionId != null) readCollection(collectionId);
      if (!['images', 'vision', 'text'].includes(kind)) throw new Error(`Вид расхода «${kind}» неизвестен: images, vision или text.`);
      fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(ledger(), JSON.stringify({ at: now(), collectionId: collectionId ?? null, kind, what: String(what), model: String(model), usd }) + '\n');
    },

    /**
     * What was spent, by kind: for one collection — its cards' attempts (card.json) and its lines of the ledger; with
     * no collection — the factory: every collection there is now, and the ledger's lines of none. A deleted
     * collection's spend is not counted.
     * @param {{collectionId?: string}} [o] @returns {Promise<Spend>}
     */
    async spend({ collectionId } = {}) {
      /** @type {Spend} */
      const out = { images: 0, vision: 0, text: 0, total: 0, unknown: 0 };
      const ids = collectionId != null ? (readCollection(collectionId), [collectionId]) : subdirs(root).filter(c => exists(path.join(root, c, COLLECTION_FILE)));
      for (const c of ids) addCollectionSpend(c, out);
      const counted = new Set(ids);
      for (const e of readLedger()) {
        if (collectionId != null ? e.collectionId !== collectionId : e.collectionId != null && !counted.has(e.collectionId)) continue;
        if (typeof e.usd !== 'number') { out.unknown++; continue; }
        if (e.kind === 'images' || e.kind === 'vision' || e.kind === 'text') out[e.kind] += e.usd;
      }
      for (const k of /** @type {const} */ (['images', 'vision', 'text'])) out[k] = round6(out[k]);
      out.total = round6(out.images + out.vision + out.text);
      return out;
    },

    /**
     * Copies card images out for a person: in the export folder a folder per collection, in it a folder per set
     * («03 Title», cards «01 Title.png» in slot order), «Хранилище» for the pool's cards (`pool`: the cards in no
     * set) and «Карточки» for the chosen single cards. A whole collection (no setIds, no cardIds, pool not `true`) is
     * the chosen variant of each set (every variant of a set none of whose variants is chosen) and, unless `pool` is
     * false, its pool; `pool: true` alone is the pool alone. No collectionId = every collection of the factory, each
     * whole, into the factory's export folder (FACTORY_EXPORT_DIR); a collection's own export goes to its export/.
     * `originals`: next to each card the image as its chosen version's model returned it («… (оригинал).<ext>»).
     * Cards without an image are skipped and listed.
     * @param {{collectionId?: string, setIds?: string[], cardIds?: string[], pool?: boolean, originals?: boolean, format?: 'png'|'zip', name?: string}} o
     * @returns {Promise<{path: string, files: number, skipped: {id: string, reason: string}[]}>}
     */
    async exportItems({ collectionId, setIds, cardIds: chosen, pool, originals = false, format = 'png', name }) {
      if (format !== 'png' && format !== 'zip') throw new Error(`Формат выгрузки «${format}» неизвестен: png или zip.`);
      if (collectionId == null && (setIds || chosen)) throw new Error('Наборы и карточки выгружаются из одной коллекции: назовите её.');
      const ids = collectionId != null ? [collectionId] : subdirs(root).filter(c => exists(path.join(root, c, COLLECTION_FILE)));
      if (!ids.length) throw new Error('Коллекций пока нет: выгружать нечего.');
      /** @type {{name: string, source: string}[]} */
      const entries = [];
      /** @type {{id: string, reason: string}[]} */
      const skipped = [];
      const tops = new Set();
      for (const c of ids) {
        const col = readCollection(c);
        const sets = allSets(c, col);
        const whole = !setIds && !chosen && pool !== true;
        const pickSets = setIds ?? (whole ? chosenVariants(sets).map(s => s.id) : []);
        const top = uniqueName(tops, fileName(col.title, col.id));
        const folders = new Set();
        /** @param {string} folder @param {Set<string>} used @param {string} k @param {string} prefix */
        const add = (folder, used, k, prefix) => {
          const s = summary(c, k, undefined);
          if (!s.image) { skipped.push({ id: k, reason: 'нет готовой картинки' }); return; }
          entries.push({ name: `${top}/${folder}/${uniqueName(used, fileName(prefix + s.title, k), '.png')}`, source: s.image });
          const original = originals ? originalOf(c, k) : null;
          if (original) entries.push({ name: `${top}/${folder}/${uniqueName(used, fileName(`${prefix}${s.title} (оригинал)`, k), path.extname(original).toLowerCase())}`, source: original });
        };
        for (const s of pickSets) {
          const set = sets.find(x => x.id === s) ?? readSet(c, s);
          const folder = uniqueName(folders, fileName(`${pad(set.number)} ${set.title}`, set.id));
          const used = new Set();
          set.slots.forEach((k, slot) => { if (k) add(folder, used, k, `${pad(slot + 1)} `); });
        }
        if (pool === true || (whole && pool !== false)) {
          const places = placesOf(sets);
          const loose = cardIds(c).filter(k => !places.has(k));
          const folder = uniqueName(folders, EXPORT_POOL_FOLDER);
          const used = new Set();
          for (const k of loose) add(folder, used, k, '');
        }
        if (chosen?.length) {
          const folder = uniqueName(folders, EXPORT_CARDS_FOLDER);
          const used = new Set();
          for (const k of chosen) {
            if (!exists(cardDir(c, k))) throw new Error(`Карточки «${k}» в коллекции «${c}» нет.`);
            add(folder, used, k, '');
          }
        }
      }
      if (!entries.length) throw new Error('Выгружать нечего: у выбранных карточек нет готовых картинок.');

      const exportDir = collectionId != null ? path.join(collectionDir(collectionId), EXPORT_DIR) : path.join(root, FACTORY_EXPORT_DIR);
      fs.mkdirSync(exportDir, { recursive: true });
      const taken = new Set(fs.readdirSync(exportDir).map(f => f.toLowerCase().replace(/\.zip$/, '')));
      const base = uniqueName(taken, fileName(name ?? stampName(), 'export'));
      if (format === 'zip') {
        const file = path.join(exportDir, base + '.zip');
        writeZip(file, entries);
        return { path: file, files: entries.length, skipped };
      }
      const out = path.join(exportDir, base);
      for (const e of entries) {
        const dest = path.join(out, ...e.name.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(e.source, dest);
      }
      return { path: out, files: entries.length, skipped };
    },

    /** Where exports go: a collection's export/, or the factory's export folder (no collectionId). @param {string} [collectionId] */
    exportDir(collectionId) {
      return collectionId != null ? path.join(collectionDir(collectionId), EXPORT_DIR) : path.join(root, FACTORY_EXPORT_DIR);
    },

    /** Opens a folder (or shows a file) in the OS file manager. @param {string} target */
    async openFolder(target) {
      if (!exists(target)) throw new Error(`Нет такой папки: ${target}`);
      const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open';
      const child = spawn(command, [path.resolve(target)], { detached: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', e => reject(new Error(`Не удалось открыть папку (${command}): ${e.message}`)));
      });
      child.unref();
    },

    /**
     * Calls `onEvent` for every created, updated or deleted collection, set or card, whoever wrote it.
     * @param {(e: import('./watch.js').StoreEvent) => void} onEvent
     * @param {import('./watch.js').WatchOptions} [o]
     * @returns {() => void} stop
     */
    watch(onEvent, o) {
      return watchStore(root, onEvent, o);
    },
  };
}
