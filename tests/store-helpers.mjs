// Shared setup of the store tests: a store over a temporary folder, the trash replaced by a stub (a test run must
// not fill the user's trash), and a card written the way core/card writes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../core/store/index.js';

/** @param {import('node:test').TestContext} t */
export function tempStore(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const trashed = [];
  const trashMove = paths => { trashed.push(...paths); for (const p of paths) fs.rmSync(p, { recursive: true }); return ''; };
  return { root, trashed, store: createStore({ root, trashMove, ...options }) };
}

/**
 * Writes card.json (and card.png unless `image: false`) into the store's folder for the card.
 * @returns {Buffer|null} the image bytes
 */
export function writeCard(store, collectionId, cardId, { title = cardId, image = true, costs = [0.04], chosen = 1, check } = {}) {
  const dir = store.cardDir(collectionId, cardId);
  fs.mkdirSync(dir, { recursive: true });
  const attempts = costs.map((cost, i) => ({ n: i + 1, at: '2026-10-30T10:00:00.000Z', model: 'm', prompt: 'p', references: [], cost, ...(check ? { check } : {}) }));
  fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ order: { id: cardId, style: 'scapes', title }, attempts, chosen: image ? chosen : null }));
  if (!image) return null;
  const bytes = Buffer.from(`PNG of ${cardId} `.repeat(50));
  fs.writeFileSync(path.join(dir, 'card.png'), bytes);
  return bytes;
}
