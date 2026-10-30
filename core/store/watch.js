// Live events of the store for the editor: whoever wrote a file (the editor, an agent, a person by hand), a watcher
// reports which collection, set or card changed. fs.watch (recursive) only says that something under a collection
// moved; shortly after, the watcher re-reads that collection's state (file times and sizes) and compares it with
// the last one, so the events are exact and one burst of writes gives one event per entity. Where recursive fs.watch
// is not available, or it fails, the whole folder is polled instead.
import fs from 'node:fs';
import path from 'node:path';
import { CARDS_DIR, CARD_FILE, COLLECTION_FILE, FINAL_IMAGE, SETS_DIR, SET_FILE } from './layout.js';
import { subdirs } from './files.js';

/**
 * @typedef {object} StoreEvent
 * @property {'collection'|'set'|'card'} type
 * @property {string} collectionId
 * @property {string} id  the collection's, set's or card's id
 * @property {'created'|'updated'|'deleted'} change
 */

/** @typedef {{debounceMs?: number, pollMs?: number, poll?: boolean}} WatchOptions */

const TYPES = /** @type {const} */ (['collection', 'set', 'card']);

/** @param {string} file @returns {string} mtime and size, or "-" when missing */
function stamp(file) {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

/**
 * State of one collection: key "type\0collection\0id" → stamp. A collection exists when collection.json does, a set
 * when set.json does, a card when its folder does (a reserved id, before the first card.json, is a card too).
 * @param {string} root
 * @param {string} c
 * @param {Map<string, string>} into
 */
function scanCollection(root, c, into) {
  const dir = path.join(root, c);
  const own = stamp(path.join(dir, COLLECTION_FILE));
  if (own !== '-') into.set(`collection\0${c}\0${c}`, own);
  for (const s of subdirs(path.join(dir, SETS_DIR))) {
    const st = stamp(path.join(dir, SETS_DIR, s, SET_FILE));
    if (st !== '-') into.set(`set\0${c}\0${s}`, st);
  }
  for (const k of subdirs(path.join(dir, CARDS_DIR))) {
    const cd = path.join(dir, CARDS_DIR, k);
    into.set(`card\0${c}\0${k}`, `${stamp(path.join(cd, CARD_FILE))}|${stamp(path.join(cd, FINAL_IMAGE))}`);
  }
}

/** @param {string} key */
const prefixOf = key => key.slice(key.indexOf('\0') + 1).split('\0')[0];

/**
 * @param {string} root  the collections folder (created when missing)
 * @param {(e: StoreEvent) => void} onEvent
 * @param {WatchOptions} [o]
 * @returns {() => void} stop
 */
export function watchStore(root, onEvent, { debounceMs = 150, pollMs = 1000, poll = false } = {}) {
  fs.mkdirSync(root, { recursive: true });
  /** @type {Map<string, string>} */
  let state = new Map();
  for (const c of subdirs(root)) scanCollection(root, c, state);

  /** Re-reads the given collections (all when null) and emits the differences. @param {Set<string>|null} only */
  function refresh(only) {
    // Collections not re-read keep their last state, so they give no events.
    const next = new Map(only === null ? [] : [...state].filter(([key]) => !only.has(prefixOf(key))));
    for (const c of only ?? subdirs(root)) scanCollection(root, c, next);
    /** @type {StoreEvent[]} */
    const events = [];
    /** @param {string} key @param {StoreEvent['change']} change */
    const add = (key, change) => {
      const [type, collectionId, id] = /** @type {[StoreEvent['type'], string, string]} */ (key.split('\0'));
      events.push({ type, collectionId, id, change });
    };
    for (const [key, value] of next) if (state.get(key) !== value) add(key, state.has(key) ? 'updated' : 'created');
    for (const key of state.keys()) if (!next.has(key)) add(key, 'deleted');
    state = next;
    events.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
    for (const e of events) {
      try { onEvent(e); } catch (err) { console.error('store watch: обработчик события упал:', err); }
    }
  }

  /** @type {Set<string>|null} */
  let dirty = new Set();
  /** @type {NodeJS.Timeout|undefined} */
  let timer;
  /** @param {string|null} c  a collection folder name, or null = everything */
  function touch(c) {
    if (c === null) dirty = null;
    else dirty?.add(c);
    // From the first touch, not the last: a long run of writes (a card being generated) still gives events.
    timer ??= setTimeout(() => { const only = dirty; dirty = new Set(); timer = undefined; refresh(only); }, debounceMs);
  }

  /** @type {fs.FSWatcher|undefined} */
  let watcher;
  /** @type {NodeJS.Timeout|undefined} */
  let poller;
  const startPolling = () => { poller ??= setInterval(() => refresh(null), pollMs); };
  if (poll) startPolling();
  else {
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, name) => {
        const rel = name ? String(name) : '';
        touch(rel ? rel.split(/[\\/]/)[0] : null);
      });
      watcher.on('error', () => { watcher?.close(); watcher = undefined; startPolling(); });
    } catch {
      startPolling(); // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM and the like
    }
  }

  return () => {
    watcher?.close();
    clearTimeout(timer);
    clearInterval(poller);
  };
}
