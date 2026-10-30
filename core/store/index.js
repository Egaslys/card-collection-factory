// The Store API over the factory's collections/ (core/README.md lists it; formats: core/store/README.md).
// For another folder (tests, an export elsewhere) use createStore({ root }).
import { createStore } from './store.js';

export { createStore } from './store.js';
export { slugify } from './ids.js';
export * from './layout.js';

/** @typedef {import('./store.js').Collection} Collection */
/** @typedef {import('./store.js').CardSet} CardSet */
/** @typedef {import('./store.js').Brief} Brief */
/** @typedef {import('./store.js').SetWindow} SetWindow */
/** @typedef {import('./store.js').CardSummary} CardSummary */
/** @typedef {import('./store.js').CollectionSummary} CollectionSummary */
/** @typedef {import('./watch.js').StoreEvent} StoreEvent */

const store = createStore();

export const {
  listCollections, createCollection, getCollection, updateCollection, deleteCollection,
  createSet, getSet, updateSet, deleteSet, setSlots, moveCard, deleteCard,
  newCardId, cardDir, listCards, exportItems, openFolder, watch,
} = store;
