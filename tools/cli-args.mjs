// ============================================================================
//  card-collection-factory — the shared command line of the runnable scripts
// ----------------------------------------------------------------------------
//  Every runnable script of tools/ and the editor server declares its options
//  here and calls `cli(spec)` before it does anything else:
//   - --help / -h prints the script's help and exits 0, before any work;
//   - an unknown option, a missing or bad value, an unexpected positional
//     prints one error line and the usage line, and exits 2, before any work.
//  Why: most scripts used to ignore unknown flags, so `--help` on a server
//  started it and opened a browser, and `--help` on the builder ran a build.
//
//  spec = {
//    name:    'tools/x.mjs',                 the script as it is run from the project root
//    usage:   ['tools/x.mjs [--flag]', …],   usage lines without the leading `node `
//    about:   'what it does …',              paragraphs of the help (may be a function)
//    options: { 'no-open': { type: 'boolean', help: '…' },
//               port: { type: 'string', value: 'N', help: '…' },
//               wait: { type: 'string', value: 'S', optional: '540', help: '…' } },
//    positionals: { min: 0, max: 1 },        omitted: no positionals at all
//    emptyHelp: true,                        no arguments at all prints the help (exit 0)
//    check(values, positionals) → error text or null — the script's own rules
//  }
//  `optional` makes the value of a string option optional: a bare `--wait`
//  (last, or followed by another option) means `--wait=540`.
// ============================================================================
import { parseArgs } from 'node:util';

const HELP_OPTION = { type: 'boolean', short: 'h', help: 'this help' };

/** The help text of a spec. */
export function helpText(spec) {
  const lines = ['Usage:', ...spec.usage.map(u => '  node ' + u)];
  const about = typeof spec.about === 'function' ? spec.about() : spec.about;
  if (about) lines.push('', about.trimEnd());
  const options = Object.entries({ ...spec.options, help: HELP_OPTION });
  const label = ([name, o]) => (o.short ? '-' + o.short + ', ' : '') + '--' + name +
    (o.type === 'string' ? (o.optional !== undefined ? '[=' + (o.value || 'VALUE') + ']' : ' ' + (o.value || 'VALUE')) : '');
  const width = Math.max(...options.map(o => label(o).length));
  lines.push('', 'Options:');
  for (const option of options) {
    const [first, ...rest] = String(option[1].help || '').split('\n');
    lines.push('  ' + label(option).padEnd(width) + '  ' + first);
    for (const more of rest) lines.push('  ' + ' '.repeat(width) + '  ' + more);
  }
  return lines.join('\n');
}

/**
 * Parses without side effects: { help } (text to print, exit 0), { error } (one line, exit 2)
 * or { values, positionals }.
 */
export function parseCli(spec, args) {
  const ownArgs = args.indexOf('--') < 0 ? args : args.slice(0, args.indexOf('--'));
  if (ownArgs.includes('--help') || ownArgs.includes('-h') || (spec.emptyHelp && !args.length)) return { help: helpText(spec) };
  const options = {};
  for (const [name, o] of Object.entries(spec.options || {})) options[name] = { type: o.type, ...(o.short ? { short: o.short } : {}) };
  const expanded = args.map((arg, i) => {
    if (i >= ownArgs.length) return arg;
    const o = arg.startsWith('--') ? spec.options?.[arg.slice(2)] : null;
    const next = args[i + 1];
    return o && o.optional !== undefined && (next === undefined || next.startsWith('-')) ? arg + '=' + o.optional : arg;
  });
  const limits = spec.positionals || { min: 0, max: 0 };
  let parsed;
  try {
    parsed = parseArgs({ args: expanded, options, strict: true, allowPositionals: limits.max > 0 });
  } catch (error) {
    // parseArgs adds a hint about '--' to an unknown option: the usage line and --help say enough.
    return { error: String(error.message).split('\n')[0].replace(/\. To specify a positional argument.*$/, '') };
  }
  const values = { ...parsed.values }, positionals = parsed.positionals;
  if (positionals.length < (limits.min || 0)) return { error: 'missing argument: ' + (limits.label || 'expected at least ' + limits.min) };
  if (positionals.length > limits.max) return { error: 'unexpected argument: ' + positionals[limits.max] };
  const problem = spec.check ? spec.check(values, positionals) : null;
  if (problem) return { error: problem };
  return { values, positionals };
}

function write(stream, text) {
  return new Promise(resolve => stream.write(text + '\n', () => resolve()));
}

/** Prints the error line and the usage line, then exits 2. */
export async function usageError(spec, message) {
  await write(process.stderr, spec.name + ': ' + message + '\nUsage: node ' + spec.usage[0] + '   (all options: node ' + spec.name + ' --help)');
  process.exit(2);
}

/** parseCli for the running script: prints and exits on help (0) or a usage error (2), otherwise returns the parsed arguments. */
export async function cli(spec, args = process.argv.slice(2)) {
  const result = parseCli(spec, args);
  if (result.help) { await write(process.stdout, result.help); process.exit(0); }
  if (result.error) await usageError(spec, result.error);
  return result;
}
