// Reader of DESIGN.md: the YAML front matter (design.md tokens) and the ```json x-tokens blocks.
//
// The front matter is read by a deliberately small YAML subset, so the design system needs no parser package
// and no network: nested maps by indentation (spaces only), `key: value`, `key:` opening a map, full-line and
// trailing `#` comments, scalars as "double" or 'single' quoted strings, numbers or bare strings, and a folded
// block `key: >-` whose more-indented lines are joined with spaces. Anything else (lists, flow maps, anchors,
// literal blocks, tabs) is refused with the line number, so DESIGN.md cannot silently drift out of the subset.
// Works in the browser and in Node (no DOM, no imports).

/**
 * @param {string} text  the whole DESIGN.md
 * @returns {{ tokens: Record<string, any>, ext: Record<string, any>, body: string }}
 */
export function readDesign(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fm) throw new Error('DESIGN.md: no front matter between the first two "---" lines');
  const tokens = parseYamlSubset(fm[1]);
  const body = text.slice(fm[0].length);
  /** @type {Record<string, any>} */
  const ext = {};
  for (const m of body.matchAll(/```json x-tokens\r?\n([\s\S]*?)```/g)) {
    try { Object.assign(ext, JSON.parse(m[1])); } catch (e) { throw new Error('DESIGN.md: an x-tokens block is not valid JSON: ' + /** @type {Error} */ (e).message); }
  }
  return { tokens, ext, body };
}

/** @param {string} src @returns {Record<string, any>} */
export function parseYamlSubset(src) {
  const lines = src.split(/\r?\n/);
  /** @type {Record<string, any>} */
  const root = {};
  /** @type {{ indent: number, obj: Record<string, any> }[]} */
  const stack = [{ indent: -1, obj: root }];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const where = `DESIGN.md front matter, line ${i + 2}`; // +1 for the opening "---", +1 for 1-based
    if (/\t/.test(raw)) throw new Error(`${where}: tabs are not allowed, indent with spaces`);
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const m = line.trim().match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (!m) throw new Error(`${where}: outside the supported YAML subset: "${raw.trim()}"`);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const [, key, rest] = m;
    if (key in parent) throw new Error(`${where}: duplicate key "${key}"`);
    if (rest === undefined) { parent[key] = {}; stack.push({ indent, obj: parent[key] }); continue; }
    if (rest === '>-' || rest === '>') {
      const parts = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].length - lines[i + 1].trimStart().length > indent)) {
        i++; if (lines[i].trim()) parts.push(lines[i].trim());
      }
      parent[key] = parts.join(' ');
      continue;
    }
    parent[key] = scalar(rest.trim(), where);
  }
  return root;
}

/** @param {string} s @param {string} where */
function scalar(s, where) {
  if (s.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) throw new Error(`${where}: unterminated double-quoted string`);
    return s.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  if (s.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(s)) throw new Error(`${where}: unterminated single-quoted string`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[[{&*|!-]\s?/.test(s) && !/^-?\d/.test(s)) throw new Error(`${where}: "${s}" is outside the supported YAML subset`);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  return s;
}

/** Drops a `#` comment that is not inside quotes. @param {string} line */
function stripComment(line) {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}
