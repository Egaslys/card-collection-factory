// The models a service offers, for a person choosing them in the settings: every model with what it takes in and gives
// out, so the image, vision and text fields each list the models that fit. Listing is free on both services.
// OpenRouter (GET {endpoint}/models?output_modalities=all) states each model's input and output modalities. The Gemini
// API (GET {endpoint}/models, pages of up to 1000 through nextPageToken) states only the methods a model supports, so the kinds
// are read from Google's model ids: a Gemini model takes text and images; one whose id names an image ("…-image…",
// "nano-banana") also draws them. Models without generateContent (embeddings, Imagen's predict) are left out: the factory
// calls generateContent.
import { request } from './openrouter.js';

/**
 * @typedef {object} CatalogModel
 * @property {string} id  as the settings take it
 * @property {string} [name]  the service's display name
 * @property {string[]} input  modalities it takes: text, image, …
 * @property {string[]} output  modalities it gives: text, image, …
 */

/** The longest list one Gemini page may hold (its documented cap). */
const GEMINI_PAGE = '1000';
/** Pages read at most: a guard against a service that keeps returning a page token. */
const MAX_PAGES = 20;

/**
 * @param {'openrouter'|'google'} preset
 * @param {{endpoint: string, apiKey: string, net?: import('./openrouter.js').NetOptions}} o
 * @returns {Promise<CatalogModel[]>}  sorted by id
 */
export async function listModels(preset, { endpoint, apiKey, net = {} }) {
  /** @type {CatalogModel[]} */
  let out = [];
  if (preset === 'openrouter') {
    // without output_modalities=all the list leaves out the models that only draw
    const json = await request({ endpoint, apiKey, route: '/models', query: { output_modalities: 'all' }, ...net });
    out = (json.data ?? []).map((/** @type {any} */ m) => ({
      id: String(m.id), name: m.name, input: m.architecture?.input_modalities ?? ['text'], output: m.architecture?.output_modalities ?? ['text'],
    }));
  } else {
    let token = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await request({ endpoint, apiKey, auth: 'x-goog-api-key', route: '/models', query: { pageSize: GEMINI_PAGE, ...(token ? { pageToken: token } : {}) }, ...net });
      for (const m of json.models ?? []) {
        if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
        const id = String(m.name).replace(/^models\//, '');
        const draws = /image|nano-banana/i.test(id);
        out.push({ id, name: m.displayName, input: ['text', 'image'], output: draws ? ['image', 'text'] : ['text'] });
      }
      token = json.nextPageToken ?? '';
      if (!token) break;
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The models of a catalog that fit a field of the settings.
 * @param {CatalogModel[]} models @param {'image'|'vision'|'text'} kind
 *   image: draws images; vision: looks at an image and answers in text; text: answers in text
 */
export const modelsFor = (models, kind) => models.filter(m => (kind === 'image' ? m.output.includes('image')
  : m.output.includes('text') && !m.output.includes('image') && (kind === 'text' || m.input.includes('image'))));
