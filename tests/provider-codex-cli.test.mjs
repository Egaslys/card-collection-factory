// core/providers/codex-cli.js with a mocked spawn: no real codex, no network.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { generateImage } from '../core/providers/codex-cli.js';
import { ProviderError } from '../core/providers/openrouter.js';
import { ROOT } from './root.mjs';

const CODEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/defaults.json'), 'utf8')).provider.codexCli;
const png = Buffer.from('fake-png');
const THREAD = 'thread-1';
const events = (...e) => e.map(x => JSON.stringify(x)).join('\n') + '\n';
const okEvents = events({ type: 'thread.started', thread_id: THREAD }, { type: 'turn.completed' });

// A fake process. `onSpawn(cmd, args, opts, input)` may write the picture into the fake Codex home. `codex login
// status` answers `login` (exit code; 0 = logged in) and is not counted in `calls`.
function mock({ stdout = okEvents, stderr = '', code = 0, hang = false, spawnError, onSpawn, login = 0 } = {}) {
  const calls = [];
  const logins = [];
  const spawnImpl = (cmd, args, opts) => {
    if (args[0] === 'login' && !spawnError) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      child.stdin = { on() {}, end() {} };
      logins.push({ cmd, args, opts });
      setImmediate(() => { child.stdout.emit('data', login ? 'Not logged in\n' : 'Logged in using ChatGPT\n'); child.emit('close', login); });
      return child;
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    let input = '';
    child.stdin = { on() {}, end(t) { input = t; } };
    const call = { cmd, args, opts, child, get input() { return input; } };
    calls.push(call);
    setImmediate(() => {
      if (spawnError) return child.emit('error', spawnError);
      if (hang) return;
      onSpawn?.(call);
      child.stdout.emit('data', stdout);
      child.stderr.emit('data', stderr);
      child.emit('close', code);
    });
    return child;
  };
  return { calls, logins, spawnImpl };
}
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-test-home-'));
const putImage = (codexHome, name = 'exec-1.png', bytes = png) => {
  const dir = path.join(codexHome, 'generated_images', THREAD);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), bytes);
};

test('generateImage: аргументы, подсказка, результат; образцы как файлы, рабочая папка удаляется', async () => {
  const codexHome = home();
  const m = mock({ onSpawn: () => putImage(codexHome) });
  const r = await generateImage({ settings: CODEX, model: 'gpt-x', prompt: 'a bobber', aspectRatio: '4:5', resolution: '1K', params: { q: 1 },
    references: [{ bytes: Buffer.from('abc'), mime: 'image/png' }, { path: '/abs/card.png' }], net: { spawnImpl: m.spawnImpl, codexHome } });
  const [c] = m.calls;
  assert.equal(c.cmd, 'codex');
  const { args } = c;
  assert.deepEqual(args.slice(0, 4), ['exec', '--skip-git-repo-check', '--json', '-s']);
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.equal(args[args.indexOf('-C') + 1], c.opts.cwd);
  assert.notEqual(path.resolve(c.opts.cwd), process.cwd());
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-x');
  assert.equal(args.at(-1), '-');
  const images = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
  assert.equal(images.length, 2);
  assert.ok(images[0].startsWith(c.opts.cwd) && images[0].endsWith('.png'));
  assert.equal(images[1], '/abs/card.png');
  assert.match(c.input, /BRIEF: a bobber Portrait image, aspect ratio 4:5\./);
  assert.match(c.input, /2 attached image/);
  assert.deepEqual(r.bytes, png);
  assert.equal(r.mime, 'image/png');
  assert.equal(r.model, 'gpt-x');
  assert.equal(r.cost, null);
  assert.equal(r.raw.threadId, THREAD);
  assert.equal(fs.existsSync(c.opts.cwd), false);
});

test('generateImage: без образцов и модели нет -i и -m, берётся самый новый файл', async () => {
  const codexHome = home();
  const m = mock({ onSpawn: () => { putImage(codexHome, 'old.png', Buffer.from('old')); fs.utimesSync(path.join(codexHome, 'generated_images', THREAD, 'old.png'), 1, 1); putImage(codexHome, 'new.webp', png); } });
  const r = await generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: m.spawnImpl, codexHome } });
  assert.ok(!m.calls[0].args.includes('-i') && !m.calls[0].args.includes('-m'));
  assert.doesNotMatch(m.calls[0].input, /attached image/);
  assert.equal(r.mime, 'image/webp');
  assert.equal(r.model, 'codex-default');
  assert.deepEqual(r.bytes, png);
});

test('generateImage: своя подпись к приложенной картинке (правка) заменяет подпись образцов стиля', async () => {
  const codexHome = home();
  const m = mock({ onSpawn: () => putImage(codexHome) });
  await generateImage({ settings: CODEX, prompt: 'make it blue', references: [{ path: '/abs/model.png' }], legend: 'The attached image is the card to edit.', net: { spawnImpl: m.spawnImpl, codexHome } });
  assert.match(m.calls[0].input, /The attached image is the card to edit\./);
  assert.doesNotMatch(m.calls[0].input, /style references/);
  assert.deepEqual(m.calls[0].args.flatMap((x, i, all) => (x === '-i' ? [all[i + 1]] : [])), ['/abs/model.png']);
});

test('generateImage: подпись, которую запрос уже говорит (портреты персонажей карточки), не повторяется и не заменяется общей', async () => {
  const codexHome = home();
  const m = mock({ onSpawn: () => putImage(codexHome) });
  const legend = 'Image 1 is the canonical look of the Man: copy its design exactly. Images 2–3 are style references.';
  await generateImage({ settings: CODEX, prompt: `A scene.\n\n${legend}`, references: [{ path: '/abs/man.png' }, { path: '/abs/a.png' }, { path: '/abs/b.png' }], legend, net: { spawnImpl: m.spawnImpl, codexHome } });
  assert.equal(m.calls[0].input.split(legend).length - 1, 1, 'подпись сказана один раз');
  assert.doesNotMatch(m.calls[0].input, /do not copy their subjects/);
});

test('generateImage: значения берутся из настроек вызывающего', async () => {
  const codexHome = home();
  const m = mock({ onSpawn: () => putImage(codexHome) });
  await generateImage({ prompt: 'p', settings: { ...CODEX, command: 'codex2', model: 'dm', reasoningEffort: 'high' }, net: { spawnImpl: m.spawnImpl, codexHome } });
  assert.equal(m.calls[0].cmd, 'codex2');
  assert.equal(m.calls[0].args[m.calls[0].args.indexOf('-m') + 1], 'dm');
  assert.ok(m.calls[0].args.includes('model_reasoning_effort="high"'));
});

test('generateImage: Codex не получает ключей сервисов фабрики — переменных keyEnvVar всех пресетов', async t => {
  const { keyEnvVars } = await import('../core/providers/preset.js');
  const vars = keyEnvVars(JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/defaults.json'), 'utf8')).provider);
  assert.deepEqual(vars, ['OPENROUTER_API_KEY', 'GEMINI_API_KEY']);
  const saved = Object.fromEntries(vars.map(v => [v, process.env[v]]));
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  for (const v of vars) process.env[v] = `secret-${v}`;
  const codexHome = home();
  const m = mock({ onSpawn: () => putImage(codexHome) });
  await generateImage({ prompt: 'p', settings: CODEX, withoutEnv: vars, net: { spawnImpl: m.spawnImpl, codexHome } });
  const env = m.calls[0].opts.env;
  for (const v of vars) assert.equal(env[v], undefined, v);
  assert.equal(env.PATH, process.env.PATH, 'остальное окружение (PATH, HOME, CODEX_HOME) — как у фабрики');
  assert.equal(process.env.OPENROUTER_API_KEY, 'secret-OPENROUTER_API_KEY', 'окружение самой фабрики не тронуто');
});

test('generateImage: ненулевой код выхода, ошибка в событиях, нет картинки', async () => {
  const codexHome = home();
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ code: 1, stderr: 'boom' }).spawnImpl, codexHome } }),
    e => e instanceof ProviderError && /^Codex CLI: не нарисовал картинку \(код выхода 1\)/.test(e.message) && /boom/.test(e.providerMessage) && e.kind === 'other');
  const bad = events({ type: 'thread.started', thread_id: THREAD }, { type: 'error', message: 'model is not supported when using Codex with a ChatGPT account' });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ stdout: bad }).spawnImpl, codexHome } }),
    e => e instanceof ProviderError && /not supported/.test(e.providerMessage));
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock().spawnImpl, codexHome } }), /картинка не создана/);
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ stdout: 'garbage\n' }).spawnImpl, codexHome } }), /thread\.started/);
});

test('generateImage: таймаут убивает процесс; нет команды — понятная ошибка', async () => {
  const m = mock({ hang: true });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: m.spawnImpl, timeoutMs: 20, codexHome: home() } }), e => e instanceof ProviderError && /не закончил/.test(e.message));
  assert.equal(m.logins.length, 1, 'вход проверен до запуска');
  assert.equal(m.calls[0].child.killed, true);
  assert.equal(fs.existsSync(m.calls[0].opts.cwd), false);
  const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ spawnError: enoent }).spawnImpl, codexHome: home() } }),
    e => /^Codex CLI не найден/.test(e.message) && e.kind === 'auth' && e.service === 'codex-cli');
});

test('generateImage: образец без пути и mime, путь с запятой — ошибки до запуска', async () => {
  const m = mock();
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', references: [{ bytes: Buffer.from('a') }], net: { spawnImpl: m.spawnImpl } }), /нет ни пути/);
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', references: [{ path: '/a,b.png' }], net: { spawnImpl: m.spawnImpl } }), /запят/);
  assert.equal(m.calls.length, 0);
});

test('generateImage: нет входа, лимит подписки — одна понятная строка, вид auth или billing, Codex не запускается без входа', async () => {
  const { keyProblemOf } = await import('../core/card/make.js');
  const codexHome = home();
  const out = mock({ login: 1 });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: out.spawnImpl, codexHome } }),
    e => e.kind === 'auth' && e.service === 'codex-cli' && /codex login/.test(e.message) && keyProblemOf(e)?.message === e.message);
  assert.equal(out.calls.length, 0, 'codex exec не запускался');
  // the session expired after the check: 401 in the events (as codex-cli 0.166.0 prints it)
  const expired = events({ type: 'thread.started', thread_id: THREAD }, { type: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header' }, { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ stdout: expired, code: 1 }).spawnImpl, codexHome } }), e => e.kind === 'auth' && /codex login/.test(e.message));
  const limit = events({ type: 'thread.started', thread_id: THREAD }, { type: 'turn.failed', error: { message: "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again at 5:04 PM." } });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ stdout: limit, code: 1 }).spawnImpl, codexHome } }),
    e => e.kind === 'billing' && /исчерпан лимит подписки/.test(e.message) && /try again at 5:04 PM/.test(e.message) && !e.message.includes('\n'));
});
