// Image provider that drives the Codex CLI (`codex exec`) logged in with a ChatGPT subscription:
// the image is drawn by Codex's built-in image generation tool, so there is no per-image payment.
// Same contract shape as openrouter.js generateImage. Facts it relies on (checked on codex-cli 0.166.0):
// `-i FILE` attaches reference images, `--json` prints JSONL events, and the picture is NOT in the events:
// Codex saves it to $CODEX_HOME/generated_images/<thread_id>/exec-<uuid>.png (the thread id is in the
// first `thread.started` event). Codex runs in a scratch directory, never in the project.
// Every value comes from the caller: the factory keeps them in settings/defaults.json (provider.codexCli).
// Codex runs a model that runs commands: it gets the environment without the factory's service keys (`withoutEnv`,
// the callers pass every preset's keyEnvVar), so nothing it runs can read them.
// Failures a person must act on are ProviderErrors of kind auth or billing with `service` "codex-cli" and a one-line
// message saying what to do; they stop a run over many cards (core/card/make.js keyProblemOf). Checked on codex-cli
// 0.166.0 (2026-10-31): `codex login status` answers at once — exit 0 and «Logged in using ChatGPT», or exit 1 and
// «Not logged in» — so it is asked before every run; without a login `codex exec` retries 401 Unauthorized for about
// 30 s and exits 1 with `error` / `turn.failed` events. The usage-limit and plan texts are taken from the strings of
// the Codex binary («You've hit your usage limit…», «Usage limit reached», «out of credits», «To use Codex with your
// ChatGPT plan, upgrade to Plus»); a real limit was not reproduced.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderError } from './openrouter.js';
import { said } from '../say.js';

/** @type {Record<string, string>} */
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** @type {Record<string, string>} */
const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

const SERVICE = 'codex-cli';
const LOGIN_TEXT = 'Codex CLI не вошёл в аккаунт ChatGPT (или вход устарел): выполните в терминале «codex login» и запустите снова.';
const AUTH_SIGNS = /401 Unauthorized|not logged in|missing bearer|sign in again|reauthenticate|refresh token|token (has )?expired|log ?in again/i;
const LIMIT_SIGNS = /usage limit|hit your usage|out of credits|spend cap|quota exceeded|upgrade to (plus|pro)|purchase more credits/i;

/**
 * What a failure text of Codex means for a person, or null when it is none of the known kinds.
 * @param {string} text  Codex's error events and stderr
 * @returns {{kind: 'auth'|'billing', message: string, said: import('../say.js').Said}|null}
 */
export function failureOf(text) {
  if (LIMIT_SIGNS.test(text)) {
    const when = text.match(/try again (?:at|in) [^.,|"]+/i)?.[0];
    return { kind: 'billing', message: `Codex CLI: исчерпан лимит подписки ChatGPT или в тарифе нет Codex${when ? ` (Codex пишет: ${when})` : ''}. Дождитесь, когда лимит обновится, или рисуйте через сервис с ключом (настройки: кто рисует картинки).`, said: said('codex.limit', { when: when ?? null }) };
  }
  if (AUTH_SIGNS.test(text)) return { kind: 'auth', message: LOGIN_TEXT, said: said('codex.login') };
  return null;
}

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
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
function run(spawnImpl, command, args, cwd, input, timeoutMs, env) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (/** @type {() => void} */ fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new ProviderError(`Codex CLI не закончил за ${Math.round(timeoutMs / 1000)} с: процесс остановлен.`, { service: SERVICE, said: said('codex.timeout', { seconds: Math.round(timeoutMs / 1000) }) })));
    }, timeoutMs);
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', (/** @type {NodeJS.ErrnoException} */ e) => finish(() => reject(new ProviderError(
      e.code === 'ENOENT' ? `Codex CLI не найден (команда «${command}»): установите Codex CLI и войдите в него командой «codex login».` : `Не удалось запустить «${command}»: ${e.message}`,
      e.code === 'ENOENT' ? { kind: 'auth', service: SERVICE, said: said('codex.missing', { command }) } : { service: SERVICE, said: said('codex.start', { command, reason: e.message }) }))));
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
 * @param {string} [o.legend] what the attached images are, said before the brief, or nothing when the prompt already
 *   contains it; default: style references whose subjects are not copied (an edit says instead that the attached
 *   image is the one to change; a card's prompt names its anchor portraits and style cards itself)
 * @param {string} [o.resolution] ignored
 * @param {Record<string, unknown>} [o.params] ignored
 * @param {string[]} [o.withoutEnv]  environment variables Codex does not get: the factory's service keys
 * @param {CodexNet} [o.net]
 * @returns {Promise<{bytes: Buffer, mime: string|undefined, model: string, cost: null, usage: undefined, raw: {threadId: string, file: string}}>}
 */
export async function generateImage({ settings: d, model, prompt, references = [], aspectRatio, legend: given, withoutEnv = [], net = {} }) {
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
    // the legend is said once: a prompt that already says what the images are (core/style buildPrompt) gets no second one
    const legend = !refPaths.length || (given && prompt.includes(given.trim())) ? ''
      : given ? `\n${given.trim()}\n`
      : `\nThe ${refPaths.length} attached image(s) are style references, in order: match their rendering style, lighting, colour treatment and composition conventions, but do not copy their subjects.\n`;
    const brief = aspectRatio ? `${prompt.trim()} Portrait image, aspect ratio ${aspectRatio}.` : prompt.trim();
    const text = d.promptTemplate.replace('{refs}', () => legend).replace('{brief}', () => brief);
    const m = model ?? d.model;
    const args = ['exec', '--skip-git-repo-check', '--json', '-s', d.sandbox, '-C', scratch, '-c', `model_reasoning_effort="${d.reasoningEffort}"`];
    if (m) args.push('-m', m);
    for (const f of refPaths) args.push('-i', f);
    args.push('-');

    const env = { ...process.env };
    for (const k of withoutEnv) delete env[k];
    // not logged in: say so at once (codex exec would retry for half a minute and then fail)
    const login = await run(spawnImpl, d.command, ['login', 'status'], scratch, '', net.timeoutMs ?? d.timeoutMs, env);
    if (login.code !== 0) throw new ProviderError(LOGIN_TEXT, { kind: 'auth', service: SERVICE, said: said('codex.login'), providerMessage: `${login.stdout} ${login.stderr}`.trim().slice(0, 300) });
    const { code, stdout, stderr } = await run(spawnImpl, d.command, args, scratch, text, net.timeoutMs ?? d.timeoutMs, env);
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
    const providerMessage = [...errors, stderr.trim().slice(-300)].filter(Boolean).join(' | ');
    const known = failureOf(providerMessage);
    if (known) throw new ProviderError(known.message, { kind: known.kind, service: SERVICE, providerMessage, said: known.said });
    // the last error event is the one the run ended on (the earlier ones are its retries)
    const last = errors.at(-1)?.slice(0, 200) ?? null;
    const wrote = last ? ` Codex пишет: ${last}` : '';
    // a failure without a known kind: the page says «Codex did not draw the picture» with what Codex wrote
    const fail = (/** @type {string} */ why) => new ProviderError(`Codex CLI: ${why}`, { providerMessage, service: SERVICE, said: said('codex.failed', { reply: last }) });
    if (code !== 0) throw fail(`не нарисовал картинку (код выхода ${code}).${wrote}`);
    if (errors.length) throw fail(`ошибка во время генерации.${wrote}`);
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
