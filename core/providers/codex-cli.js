// Image provider that drives the Codex CLI (`codex exec`) logged in with a ChatGPT subscription:
// the image is drawn by Codex's built-in image generation tool, so there is no per-image payment.
// Same contract shape as openrouter.js generateImage. Facts it relies on (checked on codex-cli 0.166.0):
// `-i FILE` attaches reference images, `--json` prints JSONL events, and the picture is NOT in the events:
// Codex saves it to $CODEX_HOME/generated_images/<thread_id>/exec-<uuid>.png (the thread id is in the
// first `thread.started` event). Codex runs in a scratch directory, never in the project.
// Every value comes from the caller: the factory keeps them in settings/defaults.json (provider.codexCli).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderError } from './openrouter.js';

/** @type {Record<string, string>} */
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** @type {Record<string, string>} */
const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** @typedef {{timeoutMs?: number, spawnImpl?: typeof spawn, codexHome?: string}} CodexNet */
/**
 * @typedef {object} CodexSettings  the provider.codexCli settings
 * @property {string} command  the Codex CLI command
 * @property {string|null} model  orchestrating model; null = the model of the user's Codex config
 * @property {number} timeoutMs
 * @property {string} reasoningEffort
 * @property {string} sandbox
 * @property {string} promptTemplate  {refs} = legend of attached images (empty without references), {brief} = the prompt
 */

/**
 * Runs the command, feeds `input` to stdin, collects stdout and stderr. Kills the process on timeout.
 * @param {typeof spawn} spawnImpl @param {string} command @param {string[]} args @param {string} cwd @param {string} input @param {number} timeoutMs
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
function run(spawnImpl, command, args, cwd, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (/** @type {() => void} */ fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new ProviderError(`Codex не закончил за ${timeoutMs} мс, процесс остановлен.`)));
    }, timeoutMs);
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', (/** @type {NodeJS.ErrnoException} */ e) => finish(() => reject(new ProviderError(
      e.code === 'ENOENT' ? `Команда «${command}» не найдена: установите Codex CLI и войдите (codex login).` : `Не удалось запустить «${command}»: ${e.message}`))));
    child.on('close', code => finish(() => resolve({ code, stdout, stderr })));
    child.stdin?.on('error', () => { /* the process died early; its exit is reported by 'close' */ });
    child.stdin?.end(input);
  });
}

/**
 * Generates one image through `codex exec`. Arguments follow openrouter.js generateImage; `endpoint`/`apiKey`
 * do not exist here (Codex uses its own login), `resolution` is ignored, `params` is ignored.
 * @param {object} o
 * @param {CodexSettings} o.settings
 * @param {string} [o.model] Codex orchestrating model (`-m`); omitted: settings.model, then the user's Codex config
 * @param {string} o.prompt
 * @param {{bytes?: Uint8Array, path?: string, mime?: string}[]} [o.references] attached as `-i` files (at most 5 work in Codex's image tool)
 * @param {string} [o.aspectRatio] e.g. "4:5": Codex's image tool has no size parameter, so it is only said in the brief
 * @param {string} [o.legend] what the attached images are, said before the brief; default: style references whose
 *   subjects are not copied (an edit says instead that the attached image is the one to change)
 * @param {string} [o.resolution] ignored
 * @param {Record<string, unknown>} [o.params] ignored
 * @param {CodexNet} [o.net]
 * @returns {Promise<{bytes: Buffer, mime: string|undefined, model: string, cost: null, usage: undefined, raw: {threadId: string, file: string}}>}
 */
export async function generateImage({ settings: d, model, prompt, references = [], aspectRatio, legend: given, net = {} }) {
  const spawnImpl = net.spawnImpl ?? spawn;
  const codexHome = net.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccf-codex-'));
  try {
    const refPaths = [];
    for (const [i, ref] of references.entries()) {
      let file = ref.path ? path.resolve(ref.path) : '';
      if (!file) {
        const ext = EXT_BY_MIME[ref.mime ?? ''];
        if (!ext || !ref.bytes) throw new Error('У образца нет ни пути, ни байтов с известным mime.');
        file = path.join(scratch, `reference-${i + 1}${ext}`);
        await fs.promises.writeFile(file, ref.bytes);
      }
      if (file.includes(',')) throw new Error(`Codex делит значение -i по запятой: в пути образца не должно быть запятых (${file}).`);
      refPaths.push(file);
    }
    const legend = !refPaths.length ? ''
      : given ? `\n${given.trim()}\n`
      : `\nThe ${refPaths.length} attached image(s) are style references, in order: match their rendering style, lighting, colour treatment and composition conventions, but do not copy their subjects.\n`;
    const brief = aspectRatio ? `${prompt.trim()} Portrait image, aspect ratio ${aspectRatio}.` : prompt.trim();
    const text = d.promptTemplate.replace('{refs}', () => legend).replace('{brief}', () => brief);
    const m = model ?? d.model;
    const args = ['exec', '--skip-git-repo-check', '--json', '-s', d.sandbox, '-C', scratch, '-c', `model_reasoning_effort="${d.reasoningEffort}"`];
    if (m) args.push('-m', m);
    for (const f of refPaths) args.push('-i', f);
    args.push('-');

    const { code, stdout, stderr } = await run(spawnImpl, d.command, args, scratch, text, net.timeoutMs ?? d.timeoutMs);
    /** @type {string|undefined} */
    let threadId;
    /** @type {string[]} */
    const errors = [];
    for (const line of stdout.split('\n')) {
      /** @type {any} */
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'thread.started') threadId = e.thread_id;
      if (e.type === 'error' || e.type === 'turn.failed') errors.push(String(e.message ?? e.error?.message ?? e.error ?? '').slice(0, 400));
    }
    const fail = (/** @type {string} */ why) => new ProviderError(`Codex: ${why}`, { providerMessage: [...errors, stderr.trim().slice(-300)].filter(Boolean).join(' | ') });
    if (code !== 0) throw fail(`код выхода ${code}.`);
    if (errors.length) throw fail('ошибка во время генерации.');
    if (!threadId) throw fail('в выводе нет thread.started.');
    const dir = path.join(codexHome, 'generated_images', threadId);
    /** @type {string[]} */
    let files = [];
    try { files = (await fs.promises.readdir(dir)).filter(f => MIME_BY_EXT[path.extname(f).toLowerCase()]); } catch { /* no directory: Codex drew nothing */ }
    if (!files.length) throw fail('картинка не создана (модель ответила без вызова инструмента изображений).');
    const stats = await Promise.all(files.map(async f => ({ f, t: (await fs.promises.stat(path.join(dir, f))).mtimeMs })));
    const file = path.join(dir, stats.sort((a, b) => b.t - a.t)[0].f);
    return { bytes: await fs.promises.readFile(file), mime: MIME_BY_EXT[path.extname(file).toLowerCase()], model: m ?? 'codex-default', cost: null, usage: undefined, raw: { threadId, file } };
  } finally {
    await fs.promises.rm(scratch, { recursive: true, force: true });
  }
}
