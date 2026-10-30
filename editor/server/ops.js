// The operations the editor exposes: one entry per core operation, called by the page and by agents
// (POST /api/op/<name>, editor/remote.js). Each entry only maps the request's JSON to the core call; the product's
// logic lives in core/. `job: true` entries run as jobs (server/jobs.js): long, with progress.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../core/store/index.js';
import { COLLECTIONS_DIR, EXPORT_DIR } from '../../core/store/index.js';
import { loadSettings, readLocalSettings, saveLocalSettings, ROOT } from '../../core/settings.js';
import { readCardFile, attemptDir, attemptSpend, ATTEMPT_FILES } from '../../core/card/card-file.js';
import { PRESETS, PRESET_TITLES, apiOf, presetOf, runSettings } from '../../core/providers/preset.js';
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
  return { summary, order: file.order, chosen: file.chosen, chosenBy: file.chosenBy ?? 'checks', attempts, dir, processing: { neutral: style.neutral, bounds: style.bounds, sharpenMax: style.sharpen_amount_max } };
}

/** @type {Record<string, Op>} */
export const OPS = {
  // ---------- status and settings ----------
  // key: the key of the settings' preset; keys: of every preset (the settings screen shows the one chosen there)
  health: { run: async () => { settings(); return { ok: true, key: keyStatus() }; } },
  getSettings: { run: async () => { const s = settings(); return { settings: s, local: readLocalSettings(), key: keyStatus(), keys: keysOf(s) }; } },
  saveSettings: { run: async ({ patch }) => { saveLocalSettings(need('patch', patch)); const s = settings(); return { settings: s, local: readLocalSettings(), key: keyStatus(), keys: keysOf(s) }; } },
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
      return regenerateCard({ dir: cardDirOf(a), wish: a.wish, settings: s, provider: await providerOf(s, a), limits: a.limits, signal, onProgress: cardProgress(progress) });
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
    job: true,
    title: a => `План набора «${a.theme}»`,
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress }) => {
      const { planSetInto } = await import('../../core/set/make.js');
      return planSetInto({
        collection: a.collectionId, ...(a.save !== undefined ? { save: !!a.save } : {}), theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants,
        window: a.window, scenes: a.scenes, template: a.template, maxSpendUsd: a.maxSpendUsd, settings: settings(), apiKey: keyOrThrow(), progress,
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
    job: true,
    title: () => 'План коллекции: 16 наборов',
    scope: a => ({ collectionId: a.collectionId }),
    spentOf: r => r?.spent ?? null,
    run: async (a, { progress }) => {
      const { planCollectionInto } = await import('../../core/set/make.js');
      return planCollectionInto({
        collection: a.collectionId, title: a.title, theme: need('theme', a.theme), wishes: a.wishes, variants: a.variants, only: a.only,
        maxSpendUsd: a.maxSpendUsd, settings: settings(), apiKey: keyOrThrow(), progress,
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
        const r = /** @type {any} */ (await OPS.makeSet.run({ collectionId: a.collectionId, setId, provider: a.provider, model: a.model }, ctx));
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
      const made = /** @type {any} */ (await OPS.makeCollection.run({ collectionId: a.collectionId, provider: a.provider, model: a.model }, ctx));
      const warnings = [
        ...plan.sets.filter((/** @type {any} */ s) => !s.set).map((/** @type {any} */ s) => `Набор №${s.number ?? '?'} «${s.plan?.title ?? ''}» не спланирован: ${s.errors[0] ?? 'модель не дала плана'}`),
        ...plan.errors, ...made.skipped.map((/** @type {string} */ s) => `Пропущен набор ${s}`),
      ];
      return { plan, made, spent: plan.spent + made.spent, warnings };
    },
  },
};
