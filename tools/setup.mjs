// ============================================================================
//  card-collection-factory — first-run setup (zero dependencies)
// ----------------------------------------------------------------------------
//  node tools/setup.mjs   checks Node, installs the packages when they are missing or stale,
//                         checks that `sharp` really loads on this machine.
//  Called by the launchers (run.command, run.sh, run.bat); safe to run again at any time.
// ============================================================================
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from './cli-args.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = path.join('node_modules', '.ccf-install.json');
const NODE_URL = 'https://nodejs.org';

/** Parses 'v22.18.0', '22.18' or '>=22.18' into [major, minor, patch]. */
export function parseVersion(text) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text));
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

/** Negative, 0 or positive, like a comparator. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `engines.node` is a single '>=X.Y' range; anything else is a project mistake, not a pass. */
export function nodeIsEnough(current, range) {
  const m = /^\s*>=\s*(\d+(?:\.\d+){0,2})\s*$/.exec(range || '');
  if (!m) throw new Error(`package.json: engines.node must look like ">=22.18", got ${JSON.stringify(range)}`);
  return compareVersions(current, m[1]) >= 0;
}

/** Hash of what decides which packages are needed. The lock file is not tracked, so it is not part of it. */
export function dependenciesHash(packageJsonText) {
  const { dependencies = {}, devDependencies = {}, engines = {} } = JSON.parse(packageJsonText);
  return crypto.createHash('sha256').update(JSON.stringify({ dependencies, devDependencies, engines })).digest('hex');
}

/**
 * Why the packages must be (re)installed, or null when they are up to date.
 * state = { hasModules, stamp (parsed JSON or null), hash, missing (package names absent from node_modules) }
 */
export function installReason({ hasModules, stamp, hash, missing }) {
  if (!hasModules) return 'папки node_modules нет';
  if (missing.length) return 'не хватает пакетов: ' + missing.join(', ');
  if (!stamp) return 'нет отметки прошлой установки';
  if (stamp.hash !== hash) return 'package.json изменился с прошлой установки';
  return null;
}

function npm(args, root) {
  // On Windows npm is a .cmd file, which needs a shell; the arguments are fixed, nothing user-supplied.
  const win = process.platform === 'win32';
  return spawnSync(win ? ['npm', ...args].join(' ') : 'npm', win ? [] : args, { cwd: root, stdio: 'inherit', shell: win });
}

function sharpLoads(root) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const { default: sharp } = await import('sharp'); await sharp({ create: { width: 2, height: 2, channels: 3, background: '#808080' } }).png().toBuffer(); console.log(sharp.versions.sharp);"],
    { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? { ok: true, version: r.stdout.trim() } : { ok: false, error: (r.stderr || String(r.error || '')).trim().split('\n').slice(0, 6).join('\n') };
}

/** Runs the whole setup; returns the exit code. Output is Russian: the reader is the author or a producer. */
export function setup({ root = ROOT, log = console.log, check = false } = {}) {
  const pkgText = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgText);

  if (!nodeIsEnough(process.version, pkg.engines?.node)) {
    log(`Версия Node.js ${process.version} слишком старая: нужна ${pkg.engines.node.replace('>=', '')} или новее.`);
    log(`Скачайте текущую версию (LTS) на ${NODE_URL}, установите и запустите файл снова.`);
    return 1;
  }
  log(`Node.js ${process.version}: подходит.`);

  const hash = dependenciesHash(pkgText);
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  let stamp = null;
  try { stamp = JSON.parse(fs.readFileSync(path.join(root, STAMP), 'utf8')); } catch { /* no stamp */ }
  const reason = installReason({
    hasModules: fs.existsSync(path.join(root, 'node_modules')),
    stamp, hash,
    missing: names.filter(n => !fs.existsSync(path.join(root, 'node_modules', n, 'package.json'))),
  });

  if (reason) {
    if (check) { log('Нужна установка: ' + reason + '.'); return 1; }
    log(`Ставлю пакеты (${reason}). Нужен интернет; первый раз это занимает до минуты.`);
    // --no-package-lock: the lock file is not tracked (a lock made on another OS can break the install
    // of sharp's platform binaries, npm bug 4828), so the versions come only from package.json.
    const r = npm(['install', '--no-package-lock', '--no-audit', '--no-fund'], root);
    if (r.status !== 0) {
      log('\nУстановка пакетов не удалась (причина — в сообщениях выше). Проверьте интернет и запустите файл снова.');
      return 1;
    }
    fs.writeFileSync(path.join(root, STAMP), JSON.stringify({ hash, node: process.version, platform: process.platform + '-' + process.arch }) + '\n');
  } else log('Пакеты уже установлены.');

  const sharp = sharpLoads(root);
  if (!sharp.ok) {
    log('\nБиблиотека sharp (работа с картинками) не запускается на этом компьютере (' + process.platform + '-' + process.arch + '):');
    log(sharp.error);
    log('Если папку проекта переносили с другого компьютера или другой системы, закройте программу, удалите папку node_modules и запустите файл снова.');
    return 1;
  }
  log(`sharp ${sharp.version}: работает.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = await cli({
    name: 'tools/setup.mjs',
    usage: ['tools/setup.mjs [--check]'],
    about: 'First-run setup: checks the Node.js version against package.json (engines), runs\n' +
      '`npm install --no-package-lock` when node_modules is missing, incomplete or older than package.json,\n' +
      'then checks that sharp loads and processes an image on this platform. Safe to run again.\n' +
      'Exit code: 0 — ready, 1 — not ready (the reason is printed in Russian), 2 — a wrong command line.',
    options: { check: { type: 'boolean', help: 'only report whether an install is needed and whether sharp loads; install nothing' } },
  });
  const code = setup({ check: values.check });
  if (code === 0) {
    console.log('\nУстановлено, готово.');
    console.log('Редактора и команд для агента пока нет: продукт ещё пишется, запускать нечего.');
  }
  process.exitCode = code;
}
