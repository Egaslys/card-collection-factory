// Shared state of the editor's page; app.js fills in the functions when it starts.

/** @type {Set<() => void>} */
const selectionListeners = new Set();

/**
 * The cards a person picked (⌘/Ctrl-click on a thumbnail in the pool or a set) for «Выбранные карточки» in the
 * export: cards of one collection; picking in another collection starts over, and app.js clears it when the person
 * leaves the collection. Screens draw `has()` as the thumbnail's aria-selected and follow `onChange`.
 */
const selection = {
  /** @type {string|null} the collection the picked cards belong to */
  collectionId: null,
  /** @type {Set<string>} */
  ids: new Set(),
  /** @param {string} cardId */
  has: cardId => selection.ids.has(cardId),
  /** @param {string} collectionId @param {string} cardId */
  toggle(collectionId, cardId) {
    if (selection.collectionId !== collectionId) { selection.ids.clear(); selection.collectionId = collectionId; }
    if (!selection.ids.delete(cardId)) selection.ids.add(cardId);
    for (const fn of selectionListeners) fn();
  },
  clear() {
    if (!selection.ids.size && selection.collectionId === null) return;
    selection.ids.clear();
    selection.collectionId = null;
    for (const fn of selectionListeners) fn();
  },
  /** @param {() => void} fn @returns {() => void} off */
  onChange(fn) { selectionListeners.add(fn); return () => { selectionListeners.delete(fn); }; },
};

export const app = {
  /** @type {{source: string, envVar: string}} */
  key: { source: 'none', envVar: '' },
  /** whether Codex is ready to draw: null when it does not draw (editor/server/codex.js) @type {'ready'|'login'|'missing'|'error'|null} */
  codex: null,
  online: true,
  /** the route from the address, e.g. ['c', collectionId, 's', setId] */
  route: /** @type {string[]} */ ([]),
  /** @type {import('./app.js').Screen|null} */
  screen: null,
  selection,
  /** @type {(hash: string) => void} */
  go: () => {},
  /** redraws the current screen with fresh data @type {() => Promise<void>} */
  refresh: async () => {},
  /** @type {(collectionId: string, cardId: string) => void} */
  openCard: () => {},
};
