// Generate ordinary native skill files from agents/skills; preserve edits and foreign files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cli } from './cli-args.mjs';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['.claude/skills', '.agents/skills'];
const MANIFEST = 'agents/manifest.json';
const BINARY = /\.(?:bin|glb|fbx|png|jpe?g|gif|webp|ico|wav|mp3|ogg|woff2?|ttf|otf|zip|gz|pdf|wasm)$/i;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
function textFile(rel, bytes) {
  if (BINARY.test(rel) || bytes.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

async function safePath(root, rel) {
  if (!rel || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..') || path.isAbsolute(rel)) {
    throw new Error('Unsafe generated path: ' + rel);
  }
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlink refused: ' + rel);
    } catch (e) { if (e.code === 'ENOENT') break; throw e; }
  }
  return path.join(root, rel);
}

async function readOptional(root, rel) {
  const full = await safePath(root, rel);
  try { return await fs.readFile(full); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function sources(root) {
  const files = new Map();
  const skillRoot = await safePath(root, 'agents/skills');
  const skills = [];
  // Git keeps no empty folder: a project without skills yet has no agents/skills at all.
  let entries;
  try { entries = (await fs.readdir(skillRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en')); }
  catch (e) { if (e.code === 'ENOENT') return { files, skills }; throw e; }
  async function walk(rel) {
    const full = await safePath(root, rel);
    const entries = (await fs.readdir(full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.isFile() && entry.name === '.DS_Store') continue;
      const source = rel + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symlink refused: ' + source);
      if (entry.isDirectory()) await walk(source);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(await safePath(root, source));
        const text = textFile(source, bytes);
        const content = text ? normalize(bytes) : bytes;
        files.set(source, { content, text, sha256: digest(content) });
      } else throw new Error('Regular files required: ' + source);
    }
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === '.DS_Store') continue;
    if (!entry.isDirectory() || !/^ccf-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) {
      throw new Error('Expected a skill directory ccf-*: agents/skills/' + entry.name);
    }
    const source = 'agents/skills/' + entry.name;
    await walk(source);
    const head = files.get(source + '/SKILL.md')?.content.toString('utf8').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    if (!head || !head[1].split('\n').includes('name: ' + entry.name) || !/^description: \S/m.test(head[1])) {
      throw new Error('Skill metadata must match directory and include description: ' + source + '/SKILL.md');
    }
    skills.push(entry.name);
  }
  return { files, skills };
}

export async function syncAgents({ root = PROJECT_ROOT, write = false } = {}) {
  root = path.resolve(root);
  const { files, skills } = await sources(root);
  const desired = { version: 1, files: {} };
  const content = new Map();
  for (const target of TARGETS) {
    for (const [source, data] of files) {
      const rel = target + '/' + source.slice('agents/skills/'.length);
      desired.files[rel] = { source, sha256: data.sha256, text: data.text };
      content.set(rel, data.content);
    }
  }
  const oldBytes = await readOptional(root, MANIFEST);
  const old = oldBytes ? JSON.parse(oldBytes.toString('utf8')) : { version: 1, files: {} };
  if (old.version !== 1 || !old.files || Array.isArray(old.files)) throw new Error('Unsupported agents/manifest.json');
  for (const [rel, record] of Object.entries(old.files)) {
    if (!TARGETS.some(t => rel.startsWith(t + '/ccf-')) ||
        !/^agents\/skills\/ccf-[^/]+\//.test(record.source || '') ||
        typeof record.text !== 'boolean' || !/^[a-f0-9]{64}$/.test(record.sha256 || '')) {
      throw new Error('Invalid ownership record in manifest: ' + rel);
    }
    await safePath(root, rel);
  }
  const errors = [], conflicts = [], changes = [];
  for (const rel of [...new Set([...Object.keys(old.files), ...Object.keys(desired.files)])].sort()) {
    const previous = old.files[rel], next = desired.files[rel];
    const bytes = await readOptional(root, rel);
    const matches = record => bytes !== null && record && digest(record.text ? normalize(bytes) : bytes) === record.sha256;
    if (bytes !== null && !matches(previous) && !matches(next)) {
      conflicts.push(`Manual or unowned file: ${rel}; move its edits to ${(next || previous).source} before sync.`);
    }
    if (next ? !matches(next) : bytes !== null) {
      changes.push(rel);
      errors.push(`${next ? 'Missing or stale' : 'Obsolete generated'}: ${rel}; source ${(next || previous).source}`);
    }
  }
  const manifest = Buffer.from(JSON.stringify(desired, null, 2) + '\n');
  const manifestChanged = oldBytes === null || !normalize(oldBytes).equals(manifest);
  if (manifestChanged) errors.push('Stale agents/manifest.json; run node tools/sync-agents.mjs --write.');
  if (conflicts.length) return { ok: false, errors: [...conflicts, ...errors], skills, changed: [] };
  if (!write) return { ok: errors.length === 0, errors, skills, changed: changes };

  // Preflight all paths before the first mutation. Only manifest-owned files may be removed.
  for (const rel of [...changes, MANIFEST]) await safePath(root, rel);
  for (const rel of changes) {
    const full = path.join(root, rel);
    if (content.has(rel)) {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content.get(rel));
    } else {
      await fs.unlink(full);
      let dir = path.dirname(full);
      const stop = path.join(root, rel.startsWith('.claude/') ? TARGETS[0] : TARGETS[1]);
      while (dir !== stop) {
        try { await fs.rmdir(dir); } catch (e) { if (e.code === 'ENOTEMPTY' || e.code === 'ENOENT') break; throw e; }
        dir = path.dirname(dir);
      }
    }
  }
  if (manifestChanged) await fs.writeFile(path.join(root, MANIFEST), manifest);
  return { ok: true, errors: [], skills, changed: changes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = await cli({
    name: 'tools/sync-agents.mjs',
    usage: ['tools/sync-agents.mjs --check|--write [--root PROJECT]'],
    about: 'Native skill files (.claude/skills, .agents/skills) are generated from the editable sources in\n' +
      'agents/skills; agents/manifest.json records what was generated. --check compares and writes nothing;\n' +
      '--write regenerates, keeps foreign files and refuses to overwrite a native file edited by hand\n' +
      '(move the edit to the source first). Exit code: 0 — consistent/updated, 1 — problems listed.',
    options: {
      check: { type: 'boolean', help: 'compare the native copies with the sources; write nothing' },
      write: { type: 'boolean', help: 'regenerate the native copies' },
      root: { type: 'string', value: 'PROJECT', help: 'project to work on (default: this one)' },
    },
    check: v => (v.check === true) === (v.write === true) ? 'give exactly one of --check and --write' : null,
  });
  try {
    const result = await syncAgents({ root: values.root ?? PROJECT_ROOT, write: values.write === true });
    if (!result.ok) { console.error(result.errors.join('\n')); process.exitCode = 1; }
    else console.log(`Skills: ${result.skills.length}; ${values.check ? 'consistent' : 'updated ' + result.changed.length + ' files'}.`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
