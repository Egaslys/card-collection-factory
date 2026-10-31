// Names of the factory folder's files and folders, and the fixed values of a set. The layout and the formats are
// described once, in core/store/README.md; the card folder's own files belong to core/card/card-file.js.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../settings.js';
import { styleDirOf } from '../style/style.js';

export { CARD_FILE, FINAL_IMAGE } from '../card/card-file.js';

/** Where the factory keeps its collections (ignored by Git, VISION.md «Устройство и стек»). CCF_COLLECTIONS_DIR
 * replaces it and exists for tests only (a command line run over a temporary store). */
export const COLLECTIONS_DIR = process.env.CCF_COLLECTIONS_DIR ? path.resolve(process.env.CCF_COLLECTIONS_DIR) : path.join(ROOT, 'collections');
export const COLLECTION_FILE = 'collection.json';
export const SET_FILE = 'set.json';
export const SETS_DIR = 'sets';
export const CARDS_DIR = 'cards';
export const EXPORT_DIR = 'export';
/** The factory's export folder at the top of collections/ (an export of every collection). The underscore keeps it
 * apart from collection folders: a collection's id is a slug of its title and never starts with one. */
export const FACTORY_EXPORT_DIR = '_export';
/** The factory's spend ledger at the top of collections/: paid calls that no card records (plans, text help). */
export const SPEND_FILE = 'spend.jsonl';

/** Cards in a set window: 2 rows × 5 (styles/scapes/SETS.md, §2 and §4.1). */
export const SLOT_COUNT = 10;
/** The style's window geometry: the one source of the window kinds and their colour templates. */
export const WINDOWS_FILE = path.join('windows', 'windows.json');

/** @type {Map<string, any>} */
const windowsCache = new Map();
/** @param {string} style */
function windowsOf(style) {
  if (!windowsCache.has(style)) {
    const file = path.join(styleDirOf(style), WINDOWS_FILE);
    if (!fs.existsSync(file)) throw new Error(`У стиля «${style}» нет окон набора: ${path.relative(ROOT, file)}.`);
    windowsCache.set(style, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return windowsCache.get(style);
}

/**
 * The window kinds of a style (styles/<style>/windows/windows.json: the main window's `kind`, then its `families`).
 * @param {string} style @returns {string[]}
 */
export function windowKinds(style) {
  const g = windowsOf(style);
  return [g.kind, ...Object.keys(g.families ?? {})];
}

/**
 * The colour templates of one window kind, the first being the default (a family without its own `templates` has
 * the main window's colours under the same names).
 * @param {string} style @param {string} kind @returns {string[]}
 */
export function windowTemplates(style, kind) {
  const g = windowsOf(style);
  return Object.keys((kind === g.kind ? null : g.families?.[kind]?.templates) ?? g.templates);
}
/** A new collection's style when the caller names none. */
export const DEFAULT_STYLE = 'scapes';
/** The folder of chosen single cards inside an export. */
export const EXPORT_CARDS_FOLDER = 'Карточки';
/** The folder of the pool's cards (the cards in no set) inside an export: the editor calls the pool «Хранилище». */
export const EXPORT_POOL_FOLDER = 'Хранилище';
