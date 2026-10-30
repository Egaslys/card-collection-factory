// Shared state of the editor's page; app.js fills in the functions when it starts.

export const app = {
  /** @type {{source: string, envVar: string, hint: string|null}} */
  key: { source: 'none', envVar: '', hint: null },
  online: true,
  /** the route from the address, e.g. ['c', collectionId, 's', setId] */
  route: /** @type {string[]} */ ([]),
  /** @type {import('./app.js').Screen|null} */
  screen: null,
  /** @type {(hash: string) => void} */
  go: () => {},
  /** redraws the current screen with fresh data @type {() => Promise<void>} */
  refresh: async () => {},
  /** @type {(collectionId: string, cardId: string) => void} */
  openCard: () => {},
};
