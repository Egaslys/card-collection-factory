// A local agent's way into a running editor: find it through its discovery file (.ccf/editor.json, written while
// the editor runs) and call its operations (editor/server/ops.js) over HTTP. The editor runs them in its own
// process, with its key: an agent without a key of its own can use a running editor's key, and the key never
// leaves the editor.
export { runningEditor as findEditor } from './server.mjs';

/**
 * Calls one operation of a running editor. A long operation (a job) is waited for until it ends.
 * @param {{url: string, token: string}} editor  from findEditor()
 * @param {string} op  a name of editor/server/ops.js OPS
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<unknown>} the operation's result; throws with the operation's message on failure
 */
export async function callEditor(editor, op, args = {}) {
  const headers = { 'x-ccf-token': editor.token, 'content-type': 'application/json' };
  const res = await fetch(`${editor.url}/api/op/${op}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Редактор ответил ${res.status}.`);
  if (!body.job) return body.result;
  let job = body.job;
  while (job.status === 'running') {
    const r = await fetch(`${editor.url}/api/jobs/${job.id}/wait`, { headers });
    job = await r.json();
    if (!r.ok) throw new Error(job.error ?? `Редактор ответил ${r.status}.`);
  }
  if (job.status !== 'done') throw new Error(job.error ?? `Задача «${job.title}» не завершилась (${job.status}).`);
  return job.result;
}
