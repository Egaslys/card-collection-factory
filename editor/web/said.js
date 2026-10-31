// What core and the server write for a person — errors, warnings, the jobs' journal lines — in the page's language.
// They come with their message as data (core/say.js: a `code` and its `params`; a journal line's `say`). In Russian
// the page shows core's own text: it is the one source of the Russian wording, the same text agents and the terminal
// read. In English it words the code here. A code or a line this table does not know shows core's text as it is,
// and what a model or a service wrote (a reply, a plan's error) is shown as written inside the English sentence.
import { fill, lang } from './i18n.js';

/** @typedef {{code: string, params?: Record<string, any>}} Said */

const SAVED = ' What is made is saved.';

/** English words of core's codes; a function where the sentence depends on its params. @type {Record<string, string | ((p: Record<string, any>) => string)>} */
const EN = {
  'key.auth': p => `Problem with the key: the service did not accept it (wrong, revoked or without access). The service replied: ${p.reply} Replace the key and run again.${p.saved ? SAVED : ''}`,
  'key.billing': p => `Problem with the key: the service is out of money, billing is not enabled or the daily quota is used up. The service replied: ${p.reply} Top up or replace the key and run again.${p.saved ? SAVED : ''}`,
  'key.none': 'No {service} key: enter a temporary key in the editor\'s settings or put a permanent one in the project\'s .env file ({envVar}=…).',
  'key.rejected': 'The key did not work: {endpoint} did not accept it. Check that the whole key is pasted and that it is not revoked.',
  'key.empty': 'Empty key: paste the whole key.',
  'key.spaces': 'The key has spaces or line breaks: paste it as one line.',
  'models.needKey': 'The {service} model list comes only with a key: enter the key, and meanwhile type the model id yourself.',
  'image.badType': 'The picture must be PNG, JPEG or WebP.',
  'codex.login': p => `Codex CLI is not signed in to a ChatGPT account (or the sign-in is out of date): run “codex login” in a terminal and start again.${p.saved ? SAVED : ''}`,
  'codex.limit': p => `Codex CLI: the ChatGPT subscription limit is used up, or the plan has no Codex${p.when ? ` (Codex says: ${p.when})` : ''}. Wait until the limit renews, or draw through a service with a key (settings: who draws the pictures).${p.saved ? SAVED : ''}`,
  'codex.missing': p => `Codex CLI was not found (command “${p.command}”): install Codex CLI and sign in to it with “codex login”.${p.saved ? SAVED : ''}`,
  'codex.timeout': 'Codex CLI did not finish in {seconds} s: the process was stopped.',
  'codex.start': 'Could not start “{command}”: {reason}',
  'codex.failed': p => `Codex CLI did not draw the picture.${p.reply ? ` Codex says: ${p.reply}` : ''}`,
  'provider.http': 'The service answered HTTP {status}: {reply}',
  'provider.timeout': 'The service did not answer in {seconds} s.',
  'provider.network': 'Network: {reason}',
  'provider.noImage': p => `The service answered without a picture${p.reply ? ` (${p.reply})` : ''}.`,
  'provider.noText': p => `The model answered without text${p.reply ? ` (${p.reply})` : ''}.`,
  'plan.failed': 'The plan did not work out: {reasons}',
  'plan.cancelled': 'Planning stopped on request: no new model calls.',
  'plan.cap': 'Planning stopped: ${spent} spent of the ${cap} cap (settings set.plan.maxSpendUsd).',
  'plan.noPrice': 'The text model did not report its price: the spend cap cannot be kept, planning stopped.',
  'plan.splitFailed': 'The model did not split the collection\'s theme into sets: {reasons}',
  'plan.variantFailed': p => `Variant “${p.title}” did not work out: ${p.reason ?? 'the model gave no plan'}`,
  'plan.setFailed': p => `Set №${p.number ?? '?'}${p.title ? ` “${p.title}”` : ''} is not planned: ${p.reason ?? 'the model gave no plan'}`,
  'plan.interrupted': p => `Planning was cut short${p.of ? ` (variants with a plan: ${p.planned} of ${p.of})` : ''}: ${p.reasonCode ? saidText({ code: p.reasonCode, params: p }, p.reason) : p.reason}`,
  'set.skipped': p => `Set “${p.title}” (№${p.number}) skipped: ${({ cancelled: 'cancelled', key: 'not started, no access to the service', noPlan: 'it has no plan', cap: 'the run\'s spend cap is used up' })[/** @type {string} */ (p.why)] ?? p.why}`,
  'pick.cap': 'Choosing the best version by the vision model was skipped: it does not fit the spend cap (${cap}); chosen by the checks.',
  'pick.failed': 'The vision model did not choose a version: {reason}',
  'wish.nothingFound': 'The checks and the vision model found nothing in this version: write in the field what you want changed, and the model will word it.',
  'wish.noAnswer': 'The text model did not suggest a wish: try again.',
  'wish.empty': 'The wish is empty: write what to change.',
  'title.empty': 'The caption is empty: write what to call the card.',
  'text.empty': 'The field is empty and there is nothing to suggest a text from: write your thoughts as they are, and the model will make a text of them.',
  'text.noAnswer': 'The text model answered with an empty text: try again.',
  'store.noCollection': 'Collection “{id}” does not exist.',
  'store.noSet': 'Set “{id}” is not in the collection.',
  'store.noCard': 'Card “{id}” is not in the collection.',
  'store.noTitle': 'A name is needed.',
  'store.trashFailed': 'Could not move to the trash:\n{lines}',
  'export.noCollections': 'There are no collections yet: nothing to export.',
  'export.nothing': 'Nothing to export: the chosen cards have no finished pictures.',
  'card.locked': 'Another operation has been changing the card for over {seconds} s ({file}). If its process is gone, delete this file.',
  'place.taken': 'Place {n} is taken: remove the card from it first.',
  'cards.count': 'How many cards: a whole number from 1 to {max} per run (settings set.cards.maxCount).',
  'cards.scenes': 'Scenes with characters: a whole number from 0 to {max}.',
  'job.notFound': 'No such job: the editor may have been restarted.',
  'job.notCancellable': 'This job cannot be stopped midway: wait for it to finish.',
};

/**
 * A message of core or the server in the page's language: in Russian (or for a code not known here) `text`, core's
 * own words; in English the code's words with its params.
 * @param {Said|null|undefined} said @param {string} text
 */
export function saidText(said, text) {
  const w = said && lang() === 'en' ? EN[said.code] : undefined;
  if (!w) return text;
  const p = said?.params ?? {};
  return typeof w === 'function' ? w(p) : fill(w, p);
}

// ---------- the jobs' journal («What happened»): a line's `say` (editor/server/jobs.js Say) ----------

const money = (/** @type {number} */ v) => `$${v.toFixed(4)}`;
/** «03 “Title”» — a card of a set by its slot, or a loose card by its title. @param {any} s */
const card = s => `${s.slot != null ? `slot ${s.slot}: ` : ''}“${s.title}”`;
/** @param {any} s */
const step = s => (s.stage === 'generate' ? `attempt ${s.done + 1} of ${s.of}: drawing` : s.stage === 'process' ? `attempt ${s.done + 1} of ${s.of}: processing and checks` : `attempts made: ${s.done} of ${s.of}`);

/** @type {Record<string, (s: any) => string>} */
const CARD = {
  start: s => `${card(s)} — drawing`,
  kept: s => `${card(s)} — already made`,
  skipped: s => `${card(s)} — skipped: the spend cap`,
  cancelled: s => `${card(s)} — ${s.why === 'key' ? 'not started: no access to the service' : 'cancelled'}`,
  failed: s => `${card(s)} — error: ${saidText(s.errorSaid, s.error ?? '')}`,
  made: s => {
    const noAccess = s.stop === 'key' ? ': no access to the service (the key, the Codex sign-in or the limit)' : '';
    const what = !s.image ? `no picture${noAccess}` : s.fresh === false
      ? (s.drawn ? 'new versions drawn, but an earlier one stayed the card' : `no new picture${noAccess}; the earlier card stayed`)
      : `done${s.blocking != null ? ` (blocking FAILs: ${s.blocking})` : ''}`;
    return `${card(s)} — ${what}${s.spent != null ? `, ${money(s.spent)}` : ''}`;
  },
};

/** @type {Record<string, (s: any) => string>} */
const PLAN = {
  planning: s => (s.count != null ? `plan: ${s.count} ${s.count === 1 ? 'card' : 'cards'} “${s.title}”` : `planning the set “${s.title}”`),
  planned: s => `${s.number != null ? `№${s.number} ` : ''}“${s.title}”: ${s.set ? `plan saved (${s.set})` : 'plan ready'}`,
  invalid: s => (s.title ? `${s.number != null ? `№${s.number} ` : ''}“${s.title}”: errors: ${s.errors}` : `the plan did not pass the check (${s.errors})${s.error ? `: ${s.error}` : ''}`),
};

/** @type {Record<string, (s: any) => string>} */
const NOTE = {
  planDone: () => 'Plan ready — making the cards',
  collectionPlanDone: () => 'Collection plan ready — making the cards',
  setStart: s => `set №${s.number} “${s.title}”`,
  setPlanning: s => `set ${s.number} of ${s.of}: “${s.title}”${s.variant ? ' — one more variant' : ''} (window ${s.layout}, scenes: ${s.scenes})`,
};

/**
 * A journal line in the page's language: core's text in Russian or when the line has no data; else its words.
 * @param {{text: string, say?: any}} l
 */
export function logText(l) {
  const s = l.say;
  if (!s || lang() !== 'en') return l.text;
  const w = s.k === 'attempt' ? (/** @type {any} */ x) => `${x.title ? `${card(x)} — ` : ''}${step(x)}`
    : s.k === 'card' ? CARD[s.status] : s.k === 'plan' ? PLAN[s.status] : s.k === 'note' ? NOTE[s.code]
      : s.k === 'stopping' ? () => 'Stopping: finishing the step under way…' : null;
  if (s.k === 'said') return saidText(s, l.text);
  return w ? w(s) : l.text;
}
