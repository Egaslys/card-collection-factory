// Names of the factory folder's files and folders, and the fixed values of a set. The layout and the formats are
// described once, in core/store/README.md; the card folder's own files belong to core/card/card-file.js.
import path from 'node:path';
import { ROOT } from '../settings.js';

export { CARD_FILE, FINAL_IMAGE } from '../card/card-file.js';

/** Where the factory keeps its collections (ignored by Git, VISION.md «Устройство и стек»). CCF_COLLECTIONS_DIR
 * replaces it and exists for tests only (a command line run over a temporary store). */
export const COLLECTIONS_DIR = process.env.CCF_COLLECTIONS_DIR ? path.resolve(process.env.CCF_COLLECTIONS_DIR) : path.join(ROOT, 'collections');
export const COLLECTION_FILE = 'collection.json';
export const SET_FILE = 'set.json';
export const SETS_DIR = 'sets';
export const CARDS_DIR = 'cards';
export const EXPORT_DIR = 'export';

/** Cards in a set window: 2 rows × 5 (styles/scapes/SETS.md, §2 and §4.1). */
export const SLOT_COUNT = 10;
/** The set window: its family and its colour template (styles/scapes/SETS.md, §4). */
export const WINDOW_KINDS = /** @type {const} */ (['large', 'small', 'grand']);
export const WINDOW_TEMPLATES = /** @type {const} */ (['blue', 'violet', 'crimson', 'orange']);
/** A new collection's style when the caller names none. */
export const DEFAULT_STYLE = 'scapes';
/** The folder of chosen single cards inside an export. */
export const EXPORT_CARDS_FOLDER = 'Карточки';
