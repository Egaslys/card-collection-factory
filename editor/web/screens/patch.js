// Updating a drawn screen in place after a live event (the screen's `update`): only what changed is replaced, so the
// focus, the hover and an open panel stay where the person left them.

/**
 * Replaces the element's content when its HTML changed since it was drawn (its `data-drawn`, see `drawn`) or patched.
 * @param {Element|null} el @param {string} html
 */
export function patchHtml(el, html) {
  if (!el) return;
  const box = /** @type {HTMLElement} */ (el);
  const h = hash(html);
  if (box.dataset.drawn === h) return;
  box.innerHTML = html;
  box.dataset.drawn = h;
}

/**
 * Makes the children of a list the given items, in order: a child whose key and HTML are unchanged is kept as it is
 * (with its focus and hover), a changed or new one is drawn, a gone one removed. Each item's HTML is one element.
 * @param {Element|null} list @param {{key: string, html: string}[]} items
 */
export function patchList(list, items) {
  if (!list) return;
  /** @type {Map<string, HTMLElement>} */
  const old = new Map();
  for (const c of /** @type {HTMLElement[]} */ ([...list.children])) if (c.dataset.key) old.set(c.dataset.key, c);
  let at = /** @type {Element|null} */ (list.firstElementChild);
  for (const { key, html } of items) {
    const h = hash(html);
    let el = old.get(key);
    if (!el || el.dataset.drawn !== h) {
      const t = document.createElement('template');
      t.innerHTML = html.trim();
      const fresh = /** @type {HTMLElement} */ (t.content.firstElementChild);
      fresh.dataset.key = key;
      fresh.dataset.drawn = h;
      if (el) el.replaceWith(fresh);
      el = fresh;
    }
    old.delete(key);
    if (el !== at) list.insertBefore(el, at);
    at = el.nextElementSibling;
  }
  for (const el of old.values()) el.remove();
  for (const c of [...list.children]) if (!(/** @type {HTMLElement} */ (c).dataset.key)) c.remove();
}

/** The keyed list markup a patchList starts from. @param {{key: string, html: string}[]} items */
export const keyed = items => items.map(({ key, html }) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = /** @type {HTMLElement} */ (t.content.firstElementChild);
  el.dataset.key = key;
  el.dataset.drawn = hash(html);
  return el.outerHTML;
}).join('');

/** The `data-drawn` attribute of a region drawn with this HTML, so that patchHtml knows it. @param {string} html */
export const drawn = html => `data-drawn="${hash(html)}"`;

/** A short fingerprint of a string (FNV-1a), to tell drawn HTML from new HTML. @param {string} s */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + s.length.toString(36);
}
