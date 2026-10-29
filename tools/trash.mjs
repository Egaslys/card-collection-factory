// ============================================================================
//  card-collection-factory — move files and folders to the OS trash
// ----------------------------------------------------------------------------
//  node tools/trash.mjs <path> [<path> ...]
//
//  The sanctioned way for an agent to delete (AGENTS.md: always use the trash).
//  Every path must exist and lie strictly inside an allowed root; if any path
//  fails the check, nothing is touched. A symbolic link is trashed itself, never
//  its target. Exit code: 0 — all trashed, 1 — refused or failed, 2 — usage.
//
//  macOS: /usr/bin/trash (ships with macOS 15 and later). Linux: gio trash.
//  Windows: the shell's Recycle Bin through SHFileOperation with FOF_ALLOWUNDO and
//  full paths only — Microsoft documents that a path without its folder is
//  deleted permanently even with that flag; FOF_WANTNUKEWARNING makes Windows
//  warn instead of silently destroying an item that cannot be recycled.
// ============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from './cli-args.mjs';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Linux trashes through gio, which minimal systems (servers, WSL, containers) lack.
// agent-doctor prints the same hint before the first deletion needs it.
export const GIO_INSTALL_HINT = 'Install gio: Debian/Ubuntu — sudo apt install libglib2.0-bin; ' +
  'Fedora — sudo dnf install glib2; Arch — sudo pacman -S glib2.';

// The allowed roots — the only place this list lives. Changing it is the author's call.
export function allowedRoots(root = PROJECT_ROOT) {
  return [
    root, // the project; its root itself and .git are refused
    // Claude Code session scratch folders.
    process.platform === 'win32' ? path.join(os.tmpdir(), 'claude') : '/tmp/claude-' + os.userInfo().uid,
  ];
}

// macOS and Windows file systems are case-insensitive by default.
const key = p => (process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p);
const relative = (from, to) => path.relative(key(from), key(to));
const inside = (child, parent) => {
  const rel = relative(parent, child);
  return rel !== '' && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
};

/** Resolves and checks paths; returns the full paths to trash and the reasons for refusals. */
export function checkPaths(paths, { cwd = process.cwd(), root = PROJECT_ROOT, roots = allowedRoots(root) } = {}) {
  const real = p => fs.realpathSync.native(p);
  const realRoots = roots.flatMap(r => { try { return [real(r)]; } catch { return []; } });
  const project = real(root);
  const checked = [], errors = [];
  for (const p of paths) {
    if (/[*?]/.test(p)) { errors.push('REFUSED (wildcards are not allowed): ' + p); continue; }
    const abs = path.resolve(cwd, p);
    let full;
    try {
      fs.lstatSync(abs);
      // The parent is resolved, the name is not: a link is trashed, not followed.
      full = path.join(real(path.dirname(abs)), path.basename(abs));
    } catch { errors.push('REFUSED (does not exist): ' + abs); continue; }
    if (realRoots.some(r => key(r) === key(full))) { errors.push('REFUSED (an allowed root itself): ' + full); continue; }
    if (!realRoots.some(r => inside(full, r))) {
      errors.push('REFUSED (outside the allowed roots): ' + full + '\n  allowed: ' + realRoots.join('; '));
      continue;
    }
    if (inside(full, project) && relative(project, full).split(path.sep)[0] === '.git') {
      errors.push('REFUSED (Git data): ' + full);
      continue;
    }
    checked.push(full);
  }
  return { checked, errors };
}

const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
if (-not ('CcfRecycleBin' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CcfRecycleBin {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEOPSTRUCT {
    public IntPtr hwnd;
    public uint wFunc;
    public string pFrom;
    public string pTo;
    public ushort fFlags;
    [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
    public IntPtr hNameMappings;
    public string lpszProgressTitle;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern int SHFileOperation(ref SHFILEOPSTRUCT op);
  public static int Delete(string fullPath) {
    SHFILEOPSTRUCT op = new SHFILEOPSTRUCT();
    op.wFunc = 0x0003;                // FO_DELETE
    op.pFrom = fullPath + "\\0\\0";   // the list must be double-null terminated
    op.fFlags = 0x4454;               // ALLOWUNDO | NOCONFIRMATION | SILENT | NOERRORUI | WANTNUKEWARNING
    return SHFileOperation(ref op);
  }
}
'@
}
foreach ($p in ($env:CCF_TRASH_PATHS | ConvertFrom-Json)) { [void][CcfRecycleBin]::Delete($p) }
`;

/** Moves checked full paths with the platform's trash; throws when the tool is missing. */
function moveToTrash(paths) {
  let r;
  if (process.platform === 'darwin') {
    r = spawnSync('/usr/bin/trash', paths, { encoding: 'utf8' });
    if (r.error) throw new Error('/usr/bin/trash is not available (it ships with macOS 15 and later): ' + r.error.message);
  } else if (process.platform === 'win32') {
    const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
    r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8', env: { ...process.env, CCF_TRASH_PATHS: JSON.stringify(paths) } });
    if (r.error) throw new Error('powershell.exe is not available: ' + r.error.message);
  } else {
    r = spawnSync('gio', ['trash', '--', ...paths], { encoding: 'utf8' });
    if (r.error) throw new Error('gio is not available: ' + r.error.message + '\n' + GIO_INSTALL_HINT);
  }
  return (r.stderr || '').trim();
}

const exists = p => { try { fs.lstatSync(p); return true; } catch { return false; } };

/**
 * Trashes the paths after checking all of them. `move` replaces the platform tool in tests.
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function trash(paths, { cwd, root, roots, move = moveToTrash } = {}) {
  const { checked, errors } = checkPaths(paths, { cwd, root, roots });
  if (errors.length) return { ok: false, lines: [...errors, 'Nothing was trashed.'] };
  if (!checked.length) return { ok: false, lines: ['No paths given.'] };
  let detail = '';
  try { detail = move(checked); } catch (e) { return { ok: false, lines: [e.message, 'Nothing was trashed.'] }; }
  // The tool's exit code is not trusted: what is still on disk was not trashed.
  const lines = checked.map(p => (exists(p) ? 'FAILED: ' : 'TRASHED: ') + p);
  if (detail && lines.some(l => l.startsWith('FAILED'))) lines.push(detail);
  return { ok: lines.every(l => l.startsWith('TRASHED')), lines };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals } = await cli({
    name: 'tools/trash.mjs',
    usage: ['tools/trash.mjs <path> [<path> ...]'],
    about: () => 'The sanctioned way for an agent to delete: moves files and folders to the OS trash.\n' +
      'Every path must exist and lie strictly inside an allowed root; if any path fails the check,\n' +
      'nothing is touched. A symbolic link is trashed itself, never its target. A path that starts\n' +
      'with "-" goes after "--". Exit code: 0 — all trashed, 1 — refused or failed, 2 — usage.\n' +
      'Allowed roots: ' + allowedRoots().join('; '),
    options: {},
    positionals: { min: 1, max: Infinity, label: '<path>' },
  });
  const result = trash(positionals);
  (result.ok ? console.log : console.error)(result.lines.join('\n'));
  process.exitCode = result.ok ? 0 : 1;
}
