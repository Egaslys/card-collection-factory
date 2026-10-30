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

// A fake process. `onSpawn(cmd, args, opts, input)` may write the picture into the fake Codex home.
function mock({ stdout = okEvents, stderr = '', code = 0, hang = false, spawnError, onSpawn } = {}) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
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
  return { calls, spawnImpl };
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

test('generateImage: ненулевой код выхода, ошибка в событиях, нет картинки', async () => {
  const codexHome = home();
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ code: 1, stderr: 'boom' }).spawnImpl, codexHome } }),
    e => e instanceof ProviderError && /код выхода 1/.test(e.message) && /boom/.test(e.providerMessage));
  const bad = events({ type: 'thread.started', thread_id: THREAD }, { type: 'error', message: 'model is not supported when using Codex with a ChatGPT account' });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ stdout: bad }).spawnImpl, codexHome } }),
    e => e instanceof ProviderError && /not supported/.test(e.providerMessage));
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock().spawnImpl, codexHome } }), /картинка не создана/);
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ stdout: 'garbage\n' }).spawnImpl, codexHome } }), /thread\.started/);
});

test('generateImage: таймаут убивает процесс; нет команды — понятная ошибка', async () => {
  const m = mock({ hang: true });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: m.spawnImpl, timeoutMs: 20, codexHome: home() } }), e => e instanceof ProviderError && /не закончил/.test(e.message));
  assert.equal(m.calls[0].child.killed, true);
  assert.equal(fs.existsSync(m.calls[0].opts.cwd), false);
  const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', net: { spawnImpl: mock({ spawnError: enoent }).spawnImpl, codexHome: home() } }), /не найдена/);
});

test('generateImage: образец без пути и mime, путь с запятой — ошибки до запуска', async () => {
  const m = mock();
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', references: [{ bytes: Buffer.from('a') }], net: { spawnImpl: m.spawnImpl } }), /нет ни пути/);
  await assert.rejects(generateImage({ settings: CODEX, prompt: 'p', references: [{ path: '/a,b.png' }], net: { spawnImpl: m.spawnImpl } }), /запят/);
  assert.equal(m.calls.length, 0);
});
