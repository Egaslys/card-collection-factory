// The operations the editor exposes: one entry per core operation, called by the page and by agents
// (POST /api/op/<name>, editor/remote.js). Each entry only maps the request's JSON to the core call; the product's
// logic lives in core/. `job: true` entries run as jobs (server/jobs.js): long, with progress.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../core/store/index.js';
import { COLLECTIONS_DIR } from '../../core/store/index.js';
import { loadSettings, readLocalSettings, saveLocalSettings, ROOT } from '../../core/settings.js';
import { readCardFile, attemptDir, attemptSpend, ATTEMPT_FILES } from '../../core/card/card-file.js';
import { PRESETS, PRESET_TITLES, apiOf, presetOf, runSettings } from '../../core/providers/preset.js';
import { clearTemporaryKey, currentKey, initKey, keyStatus, setTemporaryKey } from './key.js';

/**
 * @typedef {object} Op
 * @property {(args: any, ctx: {progress: (text: string, o?: any) => void, signal: AbortSignal, editor?: {running: () => number, stop: () => void}}) => Promise<unknown>} run
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

/** The settings, with the key's variable of their preset selected again (the preset may have been changed). */
function settings() {
  const s = /** @type {any} */ (loadSettings());
  initKey(presetOf(s.provider).keyEnvVar);
  return s;
}

/** The key of each preset: whether there is one and of which kind. @param {any} s */
const keysOf = s => Object.fromEntries(PRESETS.map(n => [n, { ...keyStatus(presetOf(s.provider, n).keyEnvVar), title: PRESET_TITLES[n] }]));

/**
 * The key of a preset's service (default: the settings') or a message a person can act on.
 * @param {any} [provider]  provider settings (a run's)
 */
function keyOrThrow(provider = settings().provider) {
  const p = presetOf(provider);
  const key = currentKey(p.keyEnvVar);
  if (!key) throw new Error(`Нет ключа ${PRESET_TITLES[p.name]}: введите временный ключ в настройках редактора или положите постоянный в файл .env проекта (${p.keyEnvVar}=…).`);
  return key;
}

/** The settings of a run: its `provider` (a service or codex-cli) and `model` over the settings'. @param {any} s @param {{provider?: string, model?: string}} [run] */
const runOf = (s, run = {}) => ({ ...s, provider: runSettings(s.provider, run) });

/**
 * The image provider of a run, with the editor's key of the run's service: the settings', or the run's `provider` and `model`.
 * @param {any} s @param {{provider?: string, model?: string}} [run]
 */
async function providerOf(s, run = {}) {
  const { providerFrom } = await import('../../core/card/make.js');
  const p = runOf(s, run).provider;
  return providerFrom(p, p.use === 'api' ? { apiKey: keyOrThrow(p), model: run.model } : { model: run.model, apiKey: currentKey(presetOf(p).keyEnvVar) ?? undefined });
}

/** A card's folder in a collection. @param {{collectionId: string, cardId: string}} a */
const cardDirOf = a => store.cardDir(need('collectionId', a.collectionId), need('cardId', a.cardId));

/** core/card's progress of a run as a journal line, with the step as data the page words. @param {(t: string, o?: any) => void} progress */
const cardProgress = progress => (/** @type {{stage: string, n: number|null, done: number, of: number, spent: number}} */ e) =>
  progress(e.stage === 'generate' ? `попытка ${e.n}: генерация` : e.stage === 'process' ? `попытка ${e.n}: обработка и проверки` : `попыток сделано ${e.done} из ${e.of}`,
    { total: e.spent, say: { k: 'attempt', stage: e.stage, n: e.n, done: e.done, of: e.of } });

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
 * One card in full for the card panel: its summary, its order, every attempt (a version of the card) with its files,
 * its spend by kind and the full results of its checks (`details`, from check.json).
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
    /** @type {{results: any[], visual: any[]}|null} */
    let details = null;
    if (files.check) {
      const c = JSON.parse(fs.readFileSync(files.check, 'utf8'));
      details = { results: c.results ?? [], visual: c.visual ?? [] };
    }
    const { prompt, ...rest } = x;
    return { ...rest, files, spend: attemptSpend(x), details };
  });
  const style = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles', file.order.style, 'processing.json'), 'utf8'));
  return { summary, order: file.order, chosen: file.chosen, chosenBy: file.chosenBy ?? 'checks', attempts, dir, processing: { neutral: style.neutral, bounds: style.bounds, manual: style.manual ?? {}, sharpenMax: style.sharpen_amount_max } };
}

/** The models of each service and endpoint, read once while the editor runs (listModels). @type {Map<string, Promise<any>>} */
const modelCache = new Map();

/**
 * Sets with what their window shows: `shown.places` (each place's stars, frame, scene) and `shown.choices` (what a
 * person may set on that window kind), from core/set/places.js. @param {any[]} sets @param {string} style
 */
async function withPlaces(sets, style) {
  const { placesOf, placeChoices } = await import('../../core/set/places.js');
  return sets.map(s => ({ ...s, shown: { places: placesOf(s, style), choices: placeChoices(style, s.window.kind) } }));
}

/** @type {Record<string, Op>} */
export const OPS = {
  // ---------- status and settings ----------
  // key: the key of the settings' preset; keys: of every preset (the settings screen shows the one chosen there)
  health: { run: async () => { settings(); return { ok: true, key: keyStatus() }; } },
  getSettings: { run: async () => { const s = settings(); return { settings: s, local: readLocalSettings(), key: keyStatus(), keys: keysOf(s) }; } },
  // reset: dotted paths back to their default (the page's emptied fields)
  saveSettings: { run: async ({ patch, reset }) => { saveLocalSettings(need('patch', patch), { reset: Array.isArray(reset) ? reset.map(String) : [] }); const s = settings(); return { settings: s, local: readLocalSettings(), key: keyStatus(), keys: keysOf(s) }; } },
  // preset: whose key (default: the settings'); the answer is that key's status
  setKey: { run: async ({ key, preset }) => { const s = settings(); const v = presetOf(s.provider, preset ?? s.provider.preset).keyEnvVar; setTemporaryKey(key, v); return keyStatus(v); } },
  clearKey: { run: async ({ preset } = {}) => { const s = settings(); const v = presetOf(s.provider, preset ?? s.provider.preset).keyEnvVar; clearTemporaryKey(v); return keyStatus(v); } },
  checkKey: {
    // OpenRouter: the balance; Google has no balance call, so its key is checked by listing the models (free)
    run: async ({ preset } = {}) => {
      const s = settings();
      const o = presetOf(s.provider, preset ?? s.provider.preset);
      const p = { ...s.provider, preset: o.name };
      const api = apiOf(o.name);
      try {
        const net = { timeoutMs: 15000 };
        if (api.getCredits) return { key: keyStatus(o.keyEnvVar), credits: await api.getCredits({ endpoint: o.endpoint, apiKey: keyOrThrow(p), net }) };
        const models = await api.listImageModels({ endpoint: o.endpoint, apiKey: keyOrThrow(p), net });
        return { key: keyStatus(o.keyEnvVar), credits: null, models: models.length, hasModel: models.some(m => m.id === o.model) };
      } catch (/** @type {any} */ e) {
        if (e?.status === 400 || e?.status === 401 || e?.status === 403) throw new Error(`Ключ не подошёл: ${o.endpoint} его не принял. Проверьте, что ключ вставлен целиком и не отозван.`);
        throw e;
      }
    },
  },

  // the service's models for the settings' dropdowns, by field (image, vision, text); read once per service and
  // endpoint while the editor runs (refresh: read again). OpenRouter lists without a key; Google needs one.
  listModels: {
    run: async ({ preset, refresh } = {}) => {
      const s = settings();
      const o = presetOf(s.provider, preset ?? s.provider.preset);
      const at = `${o.name} ${o.endpoint}`;
      if (refresh || !modelCache.has(at)) {
        const key = currentKey(o.keyEnvVar);
        if (!key && o.name !== 'openrouter') throw new Error(`Список моделей ${PRESET_TITLES[o.name]} приходит только с ключом: введите ключ, а пока впишите id модели сами.`);
        const { listModels, modelsFor } = await import('../../core/providers/catalog.js');
        const all = listModels(o.name, { endpoint: o.endpoint, apiKey: key ?? '', net: { timeoutMs: 15000 } });
        const slim = (/** @type {import('../../core/providers/catalog.js').CatalogModel[]} */ ms) => ms.map(m => ({ id: m.id, ...(m.name ? { name: m.name } : {}) }));
        modelCache.set(at, all.then(ms => ({ image: slim(modelsFor(ms, 'image')), vision: slim(modelsFor(ms, 'vision')), text: slim(modelsFor(ms, 'text')) })));
        modelCache.get(at)?.catch(() => modelCache.delete(at));
      }
      return { preset: o.name, ...(await modelCache.get(at)) };
    },
  },
  // stops this editor cleanly (the page's «Выключить редактор»); with jobs running only when `force`
  stopEditor: {
    run: async ({ force } = {}, ctx) => {
      const running = ctx.editor?.running() ?? 0;
      if (running && !force) return { stopped: false, running };
      ctx.editor?.stop();
      return { stopped: true, running };
    },
  },

  // ---------- store ----------
  listCollections: { run: async () => store.listCollections() },
  createCollection: { run: async ({ title, description, fields, style }) => store.createCollection({ title: need('title', title), description: description ?? '', ...(fields ? { fields } : {}), ...(style ? { style } : {}) }) },
  getCollection: { run: async ({ collectionId }) => { const r = await store.getCollection(need('collectionId', collectionId)); return { ...r, sets: await withPlaces(r.sets, r.collection.style) }; } },
  updateCollection: { run: async ({ collectionId, patch }) => store.updateCollection(need('collectionId', collectionId), need('patch', patch)) },
  deleteCollection: { run: async ({ collectionId }) => store.deleteCollection(need('collectionId', collectionId)) },
  createSet: { run: async ({ collectionId, ...set }) => store.createSet(need('collectionId', collectionId), set) },
  getSet: { run: async ({ collectionId, setId }) => (await withPlaces([await store.getSet(need('collectionId', collectionId), need('setId', setId))], (await store.getCollection(collectionId)).collection.style))[0] },
  updateSet: { run: async ({ collectionId, setId, patch }) => store.updateSet(need('collectionId', collectionId), need('setId', setId), need('patch', patch)) },
  deleteSet: { run: async ({ collectionId, setId }) => store.deleteSet(need('collectionId', collectionId), need('setId', setId)) },
  // a place of a set window: stars and frame (core/set/places.js); one card for an empty place
  setPlace: {
    run: async ({ collectionId, setId, slot, stars, frame }) => {
      const { setPlace } = await import('../../core/set/places.js');
      return setPlace({ collection: need('collectionId', collectionId), set: need('setId', setId), slot: Number(need('slot', slot)), ...(stars !== undefined ? { stars } : {}), ...(frame ? { frame } : {}) });
    },
  },
  setCardTitle: {
    run: async a => {
      const { setCardTitle } = await import('../../core/card/make.js');
      return setCardTitle({ dir: cardDirOf(a), title: need('title', a.title) });
    },
  },
  fillPlace: {
    job: true, cancellable: true,
    title: a => `Карточка для места ${Number(a.slot) + 1}`,
    // the place too: the set screen knows which empty place is being generated
    scope: a => ({ collectionId: a.collectionId, setId: a.setId, slot: Number(a.slot) }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = runOf(settings(), a);
      const { fillPlace } = await import('../../core/set/places.js');
      return fillPlace({
        collection: need('collectionId', a.collectionId), set: need('setId', a.setId), slot: Number(need('slot', a.slot)), ...(a.about ? { about: String(a.about) } : {}),
        settings: s, provider: await providerOf(s), apiKey: currentKey(presetOf(s.provider).keyEnvVar) ?? undefined, signal, progress,
      });
    },
  },
  setSlots: { run: async ({ collectionId, setId, slots }) => store.setSlots(need('collectionId', collectionId), need('setId', setId), need('slots', slots)) },
  moveCard: {
    run: async ({ collectionId, cardId, setId, slot, pool }) => store.moveCard(need('collectionId', collectionId), need('cardId', cardId),
      pool ? { pool: true } : { setId: need('setId', setId), slot: need('slot', slot) }),
  },
  deleteCard: { run: async ({ collectionId, cardId }) => store.deleteCard(need('collectionId', collectionId), need('cardId', cardId)) },
  listCards: { run: async ({ collectionId, setId, pool }) => store.listCards(need('collectionId', collectionId), { ...(setId ? { setId } : {}), ...(pool ? { pool: true } : {}) }) },
  // no collectionId: every collection; pool: true / false / absent (core/store exportItems)
  exportItems: {
    run: async ({ collectionId, setIds, cardIds, pool, originals, format, name }) => store.exportItems({
      ...(collectionId ? { collectionId } : {}), setIds, cardIds, ...(typeof pool === 'boolean' ? { pool } : {}), originals: !!originals, format: format ?? 'png', ...(name ? { name } : {}),
    }),
  },
  // exports: the export folder (of the collection, or of the factory without one); else a path inside the collection
  openFolder: {
    run: async ({ collectionId, path: target, exports }) => {
      let p;
      if (exports) { p = store.exportDir(collectionId || undefined); fs.mkdirSync(p, { recursive: true }); }
      else if (!collectionId && target && path.resolve(target).startsWith(store.exportDir() + path.sep)) p = path.resolve(target);
      else p = insideCollection(collectionId, target);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) p = path.dirname(p);
      await store.openFolder(p);
      return { path: p };
    },
  },

  spend: { run: async ({ collectionId }) => store.spend(collectionId ? { collectionId } : {}) },

  // ---------- text help (core/text) ----------
  draftText: {
    run: async ({ kind, notes, context, collectionId }) => {
      const { draftText } = await import('../../core/text/draft.js');
      return draftText({ kind: need('kind', kind), notes, context, collectionId: collectionId ?? null, settings: settings(), apiKey: keyOrThrow() });
    },
  },

  // ---------- one card (core/card) ----------
  getCard: { run: getCard },
  proposeCardWish: {
    run: async a => {
      const { proposeCardWish, textFrom } = await import('../../core/card/make.js');
      const s = settings();
      const text = /** @type {import('../../core/card/fix.js').TextCall} */ (textFrom(s.provider, { apiKey: keyOrThrow() }));
      return proposeCardWish({ dir: cardDirOf(a), n: a.n, notes: a.notes, language: a.language, collectionId: a.collectionId, settings: s, text });
    },
  },
  makeCard: {
    job: true, cancellable: true,
    title: a => `Карточка «${a.order?.title ?? a.order?.id ?? ''}»`,
    scope: a => ({ collectionId: a.collectionId, ...(a.cardId ? { cardId: a.cardId } : {}) }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { makeCard } = await import('../../core/card/make.js');
      return makeCard({
        order: need('order', a.order), collection: need('collectionId', a.collectionId), card: a.cardId, place: a.place,
        settings: s, provider: await providerOf(s, a), limits: a.limits, signal, onProgress: cardProgress(progress),
      });
    },
  },
  regenerateCard: {
    job: true, cancellable: true,
    title: a => `Перегенерация карточки`,
    scope: a => ({ collectionId: a.collectionId, cardId: a.cardId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { regenerateCard } = await import('../../core/card/make.js');
      return regenerateCard({ dir: cardDirOf(a), wish: a.wish, n: a.n, settings: s, provider: await providerOf(s, a), limits: a.limits, signal, onProgress: cardProgress(progress) });
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
      return editCard({ dir: cardDirOf(a), wish: a.wish, n: a.n, settings: s, provider: await providerOf(s, a), limits: a.limits, signal, onProgress: cardProgress(progress) });
    },
  },
  adjustCard: {
    run: async a => {
      const { adjustCard } = await import('../../core/card/make.js');
      return adjustCard({ dir: cardDirOf(a), n: a.n, saturation: a.saturation, brightness: a.brightness, sharpen: a.sharpen, shadows: a.shadows, ...(a.reset ? { reset: true, settings: settings() } : {}) });
    },
  },
  chooseAttempt: {
    run: async a => {
      const { chooseAttempt } = await import('../../core/card/make.js');
      return chooseAttempt({ dir: cardDirOf(a), n: Number(need('n', a.n)) });
    },
  },
  recheckCard: {
    run: async a => {
      const { recheckCard } = await import('../../core/card/make.js');
      return recheckCard({ dir: cardDirOf(a), n: a.n, review: a.review });
    },
  },
  importImage: {
    // the page sends the image as base64 (data URL), written to a temporary file for core/card and removed; a local
    // agent (ccf.mjs card import) sends the image's path. A card of the collection (cardId), or a new card from an
    // order (order, place). The vision steps run with the editor's key when it holds one.
    run: async ({ collectionId, cardId, data, image, order, place }) => {
      const s = settings();
      const { importImage, visionFrom } = await import('../../core/card/make.js');
      const where = cardId ? { dir: cardDirOf({ collectionId, cardId }) } : { order: need('order', order), collection: need('collectionId', collectionId), place };
      const run = (/** @type {string} */ file) => importImage({ image: file, ...where, settings: s, vision: visionFrom(s.provider, { apiKey: currentKey(presetOf(s.provider).keyEnvVar) }) });
      if (image) return run(path.resolve(String(image)));
      const m = String(need('data', data)).match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!m) throw new Error('Картинка должна быть PNG, JPEG или WebP.');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-import-'));
      const file = path.join(tmp, `image.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
      try {
        fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
        return await run(file);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },

  // ---------- sets and collections (core/set) ----------
  planSet: {
    job: true, cancellable: true,
    title: a => `План набора «${a.theme}»`,
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const { planSetInto } = await import('../../core/set/make.js');
      return planSetInto({
        collection: a.collectionId, ...(a.save !== undefined ? { save: !!a.save } : {}), theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants,
        window: a.window, scenes: a.scenes, template: a.template, maxSpendUsd: a.maxSpendUsd, settings: settings(), apiKey: keyOrThrow(), signal, progress,
      });
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
        collection: need('collectionId', a.collectionId), ...(a.plan ? { plan: a.plan } : { set: need('setId', a.setId) }), settings: s, provider: await providerOf(s, a),
        redo: !!a.redo, only: a.only, signal, progress, limits: { ...a.limits, ...(a.maxSpendUsd !== undefined ? { maxSpendUsd: a.maxSpendUsd } : {}) },
      });
    },
  },
  planCollection: {
    job: true, cancellable: true,
    title: () => 'План коллекции',
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const { planCollectionInto } = await import('../../core/set/make.js');
      return planCollectionInto({
        collection: a.collectionId, title: a.title, theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants, only: a.only, mode: a.mode,
        maxSpendUsd: a.maxSpendUsd, settings: settings(), apiKey: keyOrThrow(), signal, progress,
      });
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
        collection: need('collectionId', a.collectionId), numbers: a.numbers, settings: s, provider: await providerOf(s, a), signal, progress,
        limits: { ...a.limits, ...(a.maxSpendUsd !== undefined ? { maxSpendUsd: a.maxSpendUsd } : {}) },
      });
    },
  },

  makeCards: {
    job: true, cancellable: true,
    title: a => `Карточки «${a.theme}»`,
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = runOf(settings(), a);
      const { makeCardsInto } = await import('../../core/set/cards.js');
      return makeCardsInto({
        collection: need('collectionId', a.collectionId), theme: need('theme', a.theme), wishes: a.wishes, count: Number(need('count', a.count)),
        scenes: Number(a.scenes ?? 0), maxSpendUsd: a.maxSpendUsd, settings: s, provider: await providerOf(s), apiKey: keyOrThrow(s.provider), signal, progress,
      });
    },
  },

  // ---------- one button: the plan, then its cards (core/set/make.js buildSet, buildCollection) ----------
  // Caps (runCap, a safety net the page does not show): every set, each variant included, keeps set.maxSpendUsd;
  // maxSpendUsd caps the cards of the whole run (default: that × the sets planned); planMaxSpendUsd the planning.
  buildSet: {
    job: true, cancellable: true,
    title: a => `Набор «${a.theme}»`,
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { buildSet } = await import('../../core/set/make.js');
      return buildSet({
        collection: need('collectionId', a.collectionId), theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants,
        window: a.window, scenes: a.scenes, template: a.template, settings: s, provider: await providerOf(s, a), apiKey: keyOrThrow(),
        maxSpendUsd: a.maxSpendUsd, planMaxSpendUsd: a.planMaxSpendUsd, limits: a.limits, signal, progress,
      });
    },
  },
  buildCollection: {
    job: true, cancellable: true,
    title: a => (a.mode === 'variants' ? 'Коллекция: ещё по варианту каждого набора' : 'Коллекция: недостающие наборы'),
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress, signal }) => {
      const s = settings();
      const { buildCollection } = await import('../../core/set/make.js');
      return buildCollection({
        collection: a.collectionId, title: a.title, theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants, only: a.only, mode: a.mode,
        settings: s, provider: await providerOf(s, a), apiKey: keyOrThrow(),
        maxSpendUsd: a.maxSpendUsd, planMaxSpendUsd: a.planMaxSpendUsd, limits: a.limits, signal, progress,
      });
    },
  },
};
