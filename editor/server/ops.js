// The operations the editor exposes: one entry per core operation, called by the page and by agents
// (POST /api/op/<name>, editor/remote.js). Each entry only maps the request's JSON to the core call; the product's
// logic lives in core/. `job: true` entries run as jobs (server/jobs.js): long, with progress.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../core/store/index.js';
import { COLLECTIONS_DIR, EXPORT_DIR } from '../../core/store/index.js';
import { loadSettings, readLocalSettings, saveLocalSettings, ROOT } from '../../core/settings.js';
import { readCardFile, attemptDir, ATTEMPT_FILES } from '../../core/card/card-file.js';
import { clearTemporaryKey, currentKey, initKey, keyStatus, setTemporaryKey } from './key.js';

/**
 * @typedef {object} Op
 * @property {(args: any, ctx: {progress: (text: string, o?: any) => void, signal: AbortSignal}) => Promise<unknown>} run
 * @property {boolean} [job]  long: runs as a job
 * @property {(args: any) => string} [title]  the job's title for a person
 * @property {(args: any) => {collectionId?: string, setId?: string, cardId?: string}} [scope]
 * @property {(result: any) => number|null} [spentOf]
 * @property {boolean} [cancellable]  the core operation takes the job's AbortSignal
 */

/** @param {string} name @param {unknown} v */
const need = (name, v) => {
  if (v === undefined || v === null || v === '') throw new Error(`Не хватает поля «${name}».`);
  return v;
};

/** The settings, with the key's variable read again (it may have been changed in the settings). */
function settings() {
  const s = /** @type {any} */ (loadSettings());
  initKey(s.provider.openrouter.keyEnvVar);
  return s;
}

/** The OpenRouter key or a message a person can act on. */
function keyOrThrow() {
  const key = currentKey();
  if (!key) throw new Error('Нет ключа OpenRouter: введите временный ключ в настройках редактора или положите постоянный в файл .env проекта.');
  return key;
}

/** The image provider of the settings (or `use`), with the editor's key. @param {any} s @param {string} [use] */
async function providerOf(s, use) {
  const { providerFrom } = await import('../../core/card/make.js');
  const p = { ...s.provider, use: use ?? s.provider.use };
  return providerFrom(p, p.use === 'openrouter' ? { apiKey: keyOrThrow() } : {});
}

/** A card's folder in a collection. @param {{collectionId: string, cardId: string}} a */
const cardDirOf = a => store.cardDir(need('collectionId', a.collectionId), need('cardId', a.cardId));

/** core/card's progress of a run as a journal line. @param {(t: string, o?: any) => void} progress */
const cardProgress = progress => (/** @type {{stage: string, n: number|null, done: number, of: number, spent: number}} */ e) =>
  progress(e.stage === 'generate' ? `попытка ${e.n}: генерация` : e.stage === 'process' ? `попытка ${e.n}: обработка и проверки` : `попыток сделано ${e.done} из ${e.of}`, { total: e.spent });

/**
 * A path inside one collection's folder, or an error (nothing outside collections/ is opened).
 * @param {string} collectionId @param {string} [target]
 */
function insideCollection(collectionId, target) {
  const base = path.resolve(COLLECTIONS_DIR, need('collectionId', collectionId));
  const p = path.resolve(target ?? base);
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error('Открыть можно только папку внутри коллекции.');
  return p;
}

/**
 * One card in full for the card panel: its summary, its order, every attempt with its files, and the full check
 * results of the chosen attempt.
 * @param {{collectionId: string, cardId: string}} a
 */
async function getCard(a) {
  const dir = cardDirOf(a);
  const file = readCardFile(dir);
  if (!file) throw new Error(`Карточки «${a.cardId}» нет в коллекции.`);
  const summary = (await store.listCards(a.collectionId)).find(c => c.id === a.cardId) ?? null;
  const attempts = file.attempts.map(x => {
    const adir = attemptDir(dir, x.n);
    /** @type {Record<string, string>} */
    const files = {};
    for (const [k, name] of Object.entries({ ...ATTEMPT_FILES, original: x.original ?? '' })) if (name && fs.existsSync(path.join(adir, name))) files[k] = path.join(adir, name);
    const { prompt, ...rest } = x;
    return { ...rest, files };
  });
  /** @type {{results: any[], visual: any[]}|null} */
  let check = null;
  if (file.chosen != null) {
    const f = path.join(attemptDir(dir, file.chosen), ATTEMPT_FILES.check);
    if (fs.existsSync(f)) {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      check = { results: c.results ?? [], visual: c.visual ?? [] };
    }
  }
  const style = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles', file.order.style, 'processing.json'), 'utf8'));
  return { summary, order: file.order, chosen: file.chosen, attempts, check, dir, processing: { neutral: style.neutral, bounds: style.bounds, sharpenMax: style.sharpen_amount_max } };
}

/** @type {Record<string, Op>} */
export const OPS = {
  // ---------- status and settings ----------
  health: { run: async () => { settings(); return { ok: true, key: keyStatus() }; } },
  getSettings: { run: async () => ({ settings: settings(), local: readLocalSettings(), key: keyStatus() }) },
  saveSettings: { run: async ({ patch }) => { saveLocalSettings(need('patch', patch)); return { settings: settings(), local: readLocalSettings(), key: keyStatus() }; } },
  setKey: { run: async ({ key }) => { settings(); setTemporaryKey(key); return keyStatus(); } },
  clearKey: { run: async () => { settings(); clearTemporaryKey(); return keyStatus(); } },
  checkKey: {
    run: async () => {
      const o = settings().provider.openrouter;
      const { getCredits } = await import('../../core/providers/openrouter.js');
      try {
        return { key: keyStatus(), credits: await getCredits({ endpoint: o.endpoint, apiKey: keyOrThrow(), net: { timeoutMs: 15000 } }) };
      } catch (/** @type {any} */ e) {
        if (e?.status === 401 || e?.status === 403) throw new Error(`Ключ не подошёл: ${o.endpoint} его не принял. Проверьте, что ключ вставлен целиком и не отозван.`);
        throw e;
      }
    },
  },

  // ---------- store ----------
  listCollections: { run: async () => store.listCollections() },
  createCollection: { run: async ({ title, description, fields, style }) => store.createCollection({ title: need('title', title), description: description ?? '', ...(fields ? { fields } : {}), ...(style ? { style } : {}) }) },
  getCollection: { run: async ({ collectionId }) => store.getCollection(need('collectionId', collectionId)) },
  updateCollection: { run: async ({ collectionId, patch }) => store.updateCollection(need('collectionId', collectionId), need('patch', patch)) },
  deleteCollection: { run: async ({ collectionId }) => store.deleteCollection(need('collectionId', collectionId)) },
  createSet: { run: async ({ collectionId, ...set }) => store.createSet(need('collectionId', collectionId), set) },
  getSet: { run: async ({ collectionId, setId }) => store.getSet(need('collectionId', collectionId), need('setId', setId)) },
  updateSet: { run: async ({ collectionId, setId, patch }) => store.updateSet(need('collectionId', collectionId), need('setId', setId), need('patch', patch)) },
  deleteSet: { run: async ({ collectionId, setId }) => store.deleteSet(need('collectionId', collectionId), need('setId', setId)) },
  setSlots: { run: async ({ collectionId, setId, slots }) => store.setSlots(need('collectionId', collectionId), need('setId', setId), need('slots', slots)) },
  moveCard: {
    run: async ({ collectionId, cardId, setId, slot, pool }) => store.moveCard(need('collectionId', collectionId), need('cardId', cardId),
      pool ? { pool: true } : { setId: need('setId', setId), slot: need('slot', slot) }),
  },
  deleteCard: { run: async ({ collectionId, cardId }) => store.deleteCard(need('collectionId', collectionId), need('cardId', cardId)) },
  listCards: { run: async ({ collectionId, setId, pool }) => store.listCards(need('collectionId', collectionId), { ...(setId ? { setId } : {}), ...(pool ? { pool: true } : {}) }) },
  exportItems: {
    run: async ({ collectionId, setIds, cardIds, format, name }) => store.exportItems({ collectionId: need('collectionId', collectionId), setIds, cardIds, format: format ?? 'png', ...(name ? { name } : {}) }),
  },
  openFolder: {
    run: async ({ collectionId, path: target, exports }) => {
      let p = insideCollection(collectionId, target);
      if (exports) { p = path.join(insideCollection(collectionId), EXPORT_DIR); fs.mkdirSync(p, { recursive: true }); }
      if (fs.existsSync(p) && fs.statSync(p).isFile()) p = path.dirname(p);
      await store.openFolder(p);
      return { path: p };
    },
  },

  // ---------- one card (core/card) ----------
  getCard: { run: getCard },
  regenerateCard: {
    job: true, cancellable: true,
    title: a => `Перегенерация карточки`,
    scope: a => ({ collectionId: a.collectionId, cardId: a.cardId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { regenerateCard } = await import('../../core/card/make.js');
      return regenerateCard({ dir: cardDirOf(a), wish: a.wish, settings: s, provider: await providerOf(s, a.provider), signal, onProgress: cardProgress(progress) });
    },
  },
  editCard: {
    job: true, cancellable: true,
    title: a => `Правка карточки`,
    scope: a => ({ collectionId: a.collectionId, cardId: a.cardId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { editCard } = await import('../../core/card/make.js');
      return editCard({ dir: cardDirOf(a), wish: a.wish, n: a.n, settings: s, provider: await providerOf(s, a.provider), signal, onProgress: cardProgress(progress) });
    },
  },
  adjustCard: {
    run: async a => {
      const { adjustCard } = await import('../../core/card/make.js');
      return adjustCard({ dir: cardDirOf(a), n: a.n, saturation: a.saturation, brightness: a.brightness, sharpen: a.sharpen });
    },
  },
  recheckCard: {
    run: async a => {
      const { recheckCard } = await import('../../core/card/make.js');
      return recheckCard({ dir: cardDirOf(a), n: a.n, review: a.review });
    },
  },
  importImage: {
    // the page sends the image as base64 (data URL); it is written to a temporary file for core/card and removed
    run: async ({ collectionId, cardId, name, data }) => {
      const m = String(need('data', data)).match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!m) throw new Error('Картинка должна быть PNG, JPEG или WebP.');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-import-'));
      const file = path.join(tmp, `image.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
      try {
        fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
        const { importImage } = await import('../../core/card/make.js');
        return await importImage({ image: file, dir: cardDirOf({ collectionId, cardId }), settings: settings() });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },

  // ---------- sets and collections (core/set) ----------
  planSet: {
    job: true,
    title: a => `План набора «${a.theme}»`,
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress }) => {
      const { planSetInto } = await import('../../core/set/make.js');
      return planSetInto({ collection: need('collectionId', a.collectionId), theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants, window: a.window, template: a.template, settings: settings(), apiKey: keyOrThrow(), progress });
    },
  },
  makeSet: {
    job: true, cancellable: true,
    title: () => 'Карточки набора',
    scope: a => ({ collectionId: a.collectionId, setId: a.setId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { makeSet } = await import('../../core/set/make.js');
      return makeSet({
        collection: need('collectionId', a.collectionId), set: need('setId', a.setId), settings: s, provider: await providerOf(s, a.provider),
        redo: !!a.redo, only: a.only, signal, progress, limits: { ...(a.maxSpendUsd !== undefined ? { maxSpendUsd: a.maxSpendUsd } : {}) },
      });
    },
  },
  planCollection: {
    job: true,
    title: () => 'План коллекции: 16 наборов',
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress }) => {
      const { planCollectionInto } = await import('../../core/set/make.js');
      return planCollectionInto({ collection: need('collectionId', a.collectionId), theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants, settings: settings(), apiKey: keyOrThrow(), progress });
    },
  },
  makeCollection: {
    job: true, cancellable: true,
    title: () => 'Карточки всех наборов коллекции',
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { makeCollection } = await import('../../core/set/make.js');
      return makeCollection({
        collection: need('collectionId', a.collectionId), numbers: a.numbers, settings: s, provider: await providerOf(s, a.provider), signal, progress,
        limits: { ...(a.maxSpendUsd !== undefined ? { maxSpendUsd: a.maxSpendUsd } : {}) },
      });
    },
  },

  // ---------- one button: the plan, then its cards ----------
  buildSet: {
    job: true, cancellable: true,
    title: a => `Набор «${a.theme}»`,
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, ctx) => {
      const plan = /** @type {any} */ (await OPS.planSet.run(a, ctx));
      ctx.progress('План готов — делаю карточки', { total: plan.spent });
      const ids = plan.plans.map((/** @type {any} */ p) => p.set).filter(Boolean);
      if (!ids.length) throw new Error(`План не получился: ${plan.plans.flatMap((/** @type {any} */ p) => p.errors).slice(0, 3).join('; ') || 'модель не дала плана'}`);
      // a variant whose plan kept failing the rules is not made: say so, not only in the journal
      const warnings = plan.plans.filter((/** @type {any} */ p) => !p.set).map((/** @type {any} */ p) => `Вариант «${p.plan?.title ?? a.theme}» не получился: ${p.errors[0] ?? 'модель не дала плана'}`);
      for (const w of warnings) ctx.progress(w);
      const sets = [];
      let spent = plan.spent;
      for (const setId of ids) {
        if (ctx.signal.aborted) break;
        const r = /** @type {any} */ (await OPS.makeSet.run({ collectionId: a.collectionId, setId, provider: a.provider }, ctx));
        spent += r.spent;
        sets.push(r);
      }
      return { plan, sets, spent, warnings };
    },
  },
  buildCollection: {
    job: true, cancellable: true,
    title: () => 'Коллекция целиком: 16 наборов',
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, ctx) => {
      const plan = /** @type {any} */ (await OPS.planCollection.run(a, ctx));
      ctx.progress('План коллекции готов — делаю карточки', { total: plan.spent });
      if (ctx.signal.aborted) return { plan, made: null, spent: plan.spent };
      const made = /** @type {any} */ (await OPS.makeCollection.run({ collectionId: a.collectionId, provider: a.provider }, ctx));
      const warnings = [
        ...plan.sets.filter((/** @type {any} */ s) => !s.set).map((/** @type {any} */ s) => `Набор №${s.number ?? '?'} «${s.plan?.title ?? ''}» не спланирован: ${s.errors[0] ?? 'модель не дала плана'}`),
        ...plan.errors, ...made.skipped.map((/** @type {string} */ s) => `Пропущен набор ${s}`),
      ];
      return { plan, made, spent: plan.spent + made.spent, warnings };
    },
  },
};
