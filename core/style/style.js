// Loads what the prompt assembly needs from a style folder: the assembly rules
// (prompt-assembly.json), the marked fragments of the bible documents, and the reference cards
// with their staging (the checks' spec) and characters (the reference index).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragments } from './fragments.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ASSEMBLY_FILE = 'prompt-assembly.json';

/** @typedef {import('./fragments.js').Fragment} Fragment */
/** @typedef {Record<string, unknown[]>} ConditionObject */
/** @typedef {ConditionObject | ConditionObject[]} Condition */
/** @typedef {{field?: string, path?: string, map?: Record<string, string>, when?: Condition}} Pick */
/** @typedef {{label: string, when?: Condition}} ItemRule */
/**
 * @typedef {object} PartRule
 * @property {string} [fragment]
 * @property {string} [template]
 * @property {boolean} [cast]
 * @property {Condition} [when]
 * @property {string} [prefix]
 * @property {Pick[]} [pick]
 * @property {ItemRule[]} [items]
 * @property {string} [items_from]
 * @property {boolean} [attach]
 * @property {boolean} [optional]
 * @property {boolean} [drop_unfilled]
 */
/** @typedef {{name: string, join?: string, required?: boolean, parts: PartRule[]}} SectionRule */
/** @typedef {{values?: unknown[], values_from?: string, list?: boolean, required?: boolean, required_when?: ConditionObject[], default?: unknown}} FieldRule */
/** @typedef {string | {field: string, map: Record<string, string>}} SlotSource */
/**
 * @typedef {object} ReferenceRules
 * @property {number} count
 * @property {string} spec
 * @property {string} index
 * @property {string} index_cast_column
 * @property {number[]} exclude
 * @property {{when: Condition, refs: number[]}[]} [exclude_when]  cards left out only for the orders matching `when`
 * @property {Record<string, number>} weights
 * @property {string} note_style
 * @property {string} note_cast
 * @property {AnchorRules} [anchors]  the characters' anchor portraits attached to a scene
 */
/**
 * @typedef {object} AnchorRules
 * @property {string} dir  folder of the anchor images inside the style
 * @property {string} file  file name, {name} = the cast key
 * @property {Condition} when  the orders that get anchors
 * @property {number} max_images  the provider's limit of attached images (anchors + style cards)
 * @property {string} intro
 * @property {string} note_anchor
 * @property {string} note_style
 */
/**
 * @typedef {object} Assembly
 * @property {string[]} documents
 * @property {Record<string, FieldRule>} fields
 * @property {{when: ConditionObject, message: string}[]} forbid
 * @property {Record<string, {fragment: string, index_name: string, anchor_frames?: number[]}>} cast
 * @property {Record<string, SlotSource>} slots
 * @property {SectionRule[]} sections  the sections of an ordinary card
 * @property {ReferenceRules} references
 * @property {Record<string, KindRules>} [kinds]  order kinds other than an ordinary card, by `order.kind`
 * @property {UnseenRules} [unseen_stagings]  stagings the reference cards never show need the person's request
 */
/**
 * @typedef {object} UnseenRules
 * @property {string[]} fields  the staging fields whose combination must occur on a reference card
 * @property {{field: string, values: unknown[], when?: Condition}[]} same  values counted as one
 * @property {{field: string, when?: Condition}[]} any  fields that do not matter under the condition
 * @property {{when: Condition, source: string}[]} allowed  stagings the author allowed without a reference
 */
/** @typedef {{doc: string, check: number, what: string}} VisualCheck */
/**
 * What the program does with an order's image after generation.
 * @typedef {object} OrderOutput
 * @property {boolean} crop  cut and scale to the card size (false: keep the model's frame)
 * @property {boolean} checks  run the style's pixel checks
 * @property {string} [aspectRatio]  the frame to ask the provider for, e.g. "2:3" (default: the provider settings')
 * @property {VisualCheck[]} visual  what to check by eye when the pixel checks do not run
 */
/**
 * @typedef {object} KindRules
 * @property {'anchor_frames'} references  where the reference cards come from: the order's character's anchor_frames
 * @property {OrderOutput} output
 * @property {SectionRule[]} sections
 */
/** @typedef {{ref: number, path: string, staging: Record<string, unknown>, cast: string[]}} ReferenceCard */
/**
 * @typedef {object} Style
 * @property {string} dir
 * @property {Assembly} assembly
 * @property {Map<string, Fragment>} fragments
 * @property {ReferenceCard[]} references
 */

/**
 * The folder of a style by name: styles/<name> in the repository.
 * @param {string} name
 */
export function styleDirOf(name) {
  return path.join(REPO_ROOT, 'styles', name);
}

/**
 * Reads a style folder. Throws a readable error when a file or a fragment is missing or broken.
 * @param {string} styleDir
 * @returns {Style}
 */
export function loadStyle(styleDir) {
  const dir = path.resolve(styleDir);
  const assemblyFile = path.join(dir, ASSEMBLY_FILE);
  if (!fs.existsSync(assemblyFile)) throw new Error(`В стиле ${dir} нет ${ASSEMBLY_FILE}: программе не из чего собрать запрос.`);
  /** @type {Assembly} */
  const assembly = JSON.parse(fs.readFileSync(assemblyFile, 'utf8'));
  /** @type {Map<string, Fragment>} */
  const fragments = new Map();
  for (const doc of assembly.documents) {
    for (const f of parseFragments(fs.readFileSync(path.join(dir, doc), 'utf8'), doc)) {
      const seen = fragments.get(f.id);
      if (seen) throw new Error(`Фрагмент «${f.id}» помечен дважды: ${seen.file}:${seen.line} и ${f.file}:${f.line}`);
      fragments.set(f.id, f);
    }
  }
  return { dir, assembly, fragments, references: readReferences(dir, assembly) };
}

/**
 * Reference cards: staging from the checks' spec, characters from the reference index table.
 * @param {string} dir
 * @param {Assembly} assembly
 * @returns {ReferenceCard[]}
 */
function readReferences(dir, assembly) {
  const rules = assembly.references;
  const specFile = path.join(dir, rules.spec);
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const castByRef = readIndexCast(path.join(dir, rules.index), rules.index_cast_column, assembly.cast);
  return spec.cards.map((/** @type {any} */ c) => ({
    ref: c.ref,
    path: path.resolve(path.dirname(specFile), c.file),
    staging: c,
    cast: castByRef.get(c.ref) || [],
  }));
}

/**
 * Parses the reference index table (Markdown) for the character column.
 * @param {string} file
 * @param {string} column  header of the characters column
 * @param {Assembly['cast']} cast
 * @returns {Map<number, string[]>}
 */
function readIndexCast(file, column, cast) {
  /** @type {Map<string, string>} */
  const idByName = new Map(Object.entries(cast).map(([id, c]) => [c.index_name, id]));
  const cells = (/** @type {string} */ row) => row.split('|').slice(1, -1).map(s => s.trim());
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.startsWith('|'));
  const header = rows.find(r => cells(r).includes(column));
  if (!header) throw new Error(`${file}: нет столбца «${column}»`);
  const col = cells(header).indexOf(column);
  /** @type {Map<number, string[]>} */
  const out = new Map();
  for (const row of rows) {
    const c = cells(row);
    const m = c[0]?.match(/^\[(\d+)\]/);
    if (!m) continue;
    const names = (c[col] || '').split(',').map(s => s.trim()).filter(Boolean);
    const ids = names.map(n => {
      const id = idByName.get(n);
      if (!id) throw new Error(`${file}: эталон №${m[1]}: неизвестный персонаж «${n}»`);
      return id;
    });
    out.set(Number(m[1]), ids);
  }
  return out;
}
