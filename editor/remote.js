// A local agent's way into a running editor: find it through its discovery file (.ccf/editor.json, written while
// the editor runs) and call its operations (editor/server/ops.js) over HTTP. The editor runs them in its own
// process, with its key: an agent without a key of its own can use a running editor's key, and the key never
// leaves the editor.
import { loadApiKey } from '../core/providers/openrouter.js';
import { runningEditor } from './server.mjs';

export { runningEditor as findEditor };

/** How long one /wait request holds while a caller follows a job's journal. */
const FOLLOW_MS = 5000;

/**
 * Calls one operation of a running editor. A long operation (a job) is waited for until it ends.
 * @param {{url: string, token: string}} editor  from findEditor()
 * @param {string} op  a name of editor/server/ops.js OPS
 * @param {Record<string, unknown>} [args]
 * @param {{onLog?: (text: string) => void, signal?: AbortSignal}} [o]
 *   onLog: each new line of the job's journal; signal: aborting it cancels the job (the call still waits for its end)
 * @returns {Promise<unknown>} the operation's result; throws with the operation's message on failure
 */
export async function callEditor(editor, op, args = {}, { onLog, signal } = {}) {
  const headers = { 'x-ccf-token': editor.token, 'content-type': 'application/json' };
  const res = await fetch(`${editor.url}/api/op/${op}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Редактор ответил ${res.status}.`);
  if (!body.job) return body.result;
  let job = body.job;
  const cancel = () => fetch(`${editor.url}/api/jobs/${job.id}/cancel`, { method: 'POST', headers }).catch(() => {});
  if (signal?.aborted) await cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  /** the journal's last line already passed on (the journal keeps only its newest lines) */
  let seen = '';
  const follow = () => {
    if (!onLog) return;
    const lines = job.log.map((/** @type {{at: string, text: string}} */ l) => ({ key: l.at + l.text, text: l.text }));
    const from = lines.findIndex((/** @type {{key: string}} */ l) => l.key === seen) + 1;
    for (const l of lines.slice(from)) onLog(l.text);
    if (lines.length) seen = lines[lines.length - 1].key;
  };
  try {
    follow();
    while (job.status === 'running') {
      const r = await fetch(`${editor.url}/api/jobs/${job.id}/wait${onLog ? `?timeout=${FOLLOW_MS}` : ''}`, { headers });
      job = await r.json();
      if (!r.ok) throw new Error(job.error ?? `Редактор ответил ${r.status}.`);
      follow();
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  if (job.status !== 'done') throw new Error(job.error ?? `Задача «${job.title}» не завершилась (${job.status}).`);
  return job.result;
}

/**
 * Runs an operation here, or — when it needs the OpenRouter key, there is none here and an editor is running — in
 * the editor, with the editor's key. The terminal commands (ccf.mjs) call their operations through this.
 * @template T
 * @param {object} o
 * @param {boolean} o.needsKey  the run calls OpenRouter (an image or text model)
 * @param {string} o.envVar  the key's variable (settings provider.openrouter.keyEnvVar)
 * @param {string} o.op  the editor's operation (editor/server/ops.js)
 * @param {() => Record<string, unknown>} o.args  its arguments (built only when the call goes to the editor)
 * @param {() => Promise<T>} o.here  the same operation in this process
 * @param {AbortSignal} [o.signal]  the caller's stop; without one, Ctrl+C cancels the editor's job
 * @returns {Promise<T>}
 */
export async function hereOrInEditor({ needsKey, envVar, op, args, here, signal }) {
  if (!needsKey || keyHere(envVar)) return here();
  const editor = await runningEditor();
  if (!editor) {
    throw new Error(`Нет ключа ${envVar}. Положите постоянный ключ в файл .env проекта или запустите редактор (node ccf.mjs editor) и введите временный ключ в его настройках: тогда команда выполнится в редакторе с его ключом.`);
  }
  const call = args();
  console.error(`… ключа здесь нет: выполняю в запущенном редакторе (${editor.url}) с его ключом`);
  let stop = signal;
  if (!stop) {
    const ac = new AbortController();
    process.once('SIGINT', () => {
      console.error('… отменяю задачу в редакторе: начатый шаг доделывается (Ctrl+C ещё раз — выйти сразу)');
      ac.abort();
      process.once('SIGINT', () => process.exit(130));
    });
    stop = ac.signal;
  }
  return /** @type {T} */ (await callEditor(editor, op, call, { onLog: t => console.error(`… ${t}`), signal: stop }));
}

/** @param {string} envVar */
function keyHere(envVar) {
  try { loadApiKey({ envVar }); return true; } catch { return false; }
}
