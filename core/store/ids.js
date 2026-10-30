// Readable ids of collections, sets and cards: a slug of the title (Cyrillic transliterated), plus "-2", "-3", …
// when the slug is taken. An id is reserved by creating its folder, so two writers never get the same one.
import fs from 'node:fs';
import path from 'node:path';

/** What an id may look like: it becomes a folder name (the one rule; core/card takes its folders from the store). */
const ID_RE = /^[\w][\w.-]*$/;
const MAX_SLUG = 40;

/** @type {Record<string, string>} */
const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * @param {unknown} text
 * @param {string} fallback  used when the title has no letters or digits
 */
export function slugify(text, fallback) {
  const latin = [...String(text ?? '').toLowerCase()].map(ch => RU[ch] ?? ch).join('')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > MAX_SLUG) slug = slug.slice(0, MAX_SLUG).replace(/-[^-]*$/, '') || slug.slice(0, MAX_SLUG);
  return slug || fallback;
}

/**
 * Throws when `id` cannot be a folder name of the store (also stops paths like "../x").
 * @param {string} kind  for the message: «коллекция», «набор», «карточка»
 * @param {unknown} id
 * @returns {string}
 */
export function checkId(kind, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`Недопустимый id (${kind}): «${id}» — только латиница, цифры, «_», «-», «.».`);
  return id;
}

/**
 * Creates `<parent>/<slug>` (or `<slug>-2`, …) and returns the name taken.
 * @param {string} parent
 * @param {string} slug
 */
export function reserveId(parent, slug) {
  fs.mkdirSync(parent, { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? slug : `${slug}-${n}`;
    try {
      fs.mkdirSync(path.join(parent, id));
      return id;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
  }
}
