// A valid set plan (core/set/plan.js) for the tests of core/set: «Lake Fishing» in the large window with two scenes.
// Built from the pilot orders (tests/style-pilot-orders.mjs) plus cards of the other stagings.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './root.mjs';

const NO = { characters: 0, camera: 'eye_level' };

/** @param {string} title @param {string} object @param {Record<string, unknown>} staging @param {Record<string, unknown>} [more] */
const item = (title, object, staging, more = {}) => ({
  title, object, subject: `a ${object}, simple rounded shapes, clean colours.`, ...more, staging: { ...NO, ...staging },
});

/** @param {string} title @param {string} item @param {string[]} chars */
const scene = (title, item, chars) => ({
  title, place: 'small wooden dock on a calm lake', environment: 'a wooden dock on a calm lake, reeds, rounded pine trees',
  staging: { preset: 'scene', characters: chars.length, time: 'golden', sky_top: false },
  scene: {
    theme: 'lake fishing', time: 'at sunset', action: 'sit on the dock fishing', item, joke: 'an old boot comes up on the line',
    reactor: 'the Man', jokeObject: 'the boot', crop: 'waist', characters: chars.map(name => ({ name, costume: 'A green bucket hat.' })),
  },
});

/** @returns {any} a fresh copy of the plan */
export function lakePlan() {
  /** @type {[number, string, string, string, Record<string, any>][]} */
  const rows = [
    [1, 'fishing bobber', 'silver', 'sky blue', item('Bobber', 'fishing bobber', { preset: 'field', pattern: 'rays', material: 'glossy plastic' }, { palette: 'a red-and-white object on sky blue' })],
    [1, 'tackle box', 'silver', 'pink', item('Tackle Box', 'tackle box', { preset: 'smooth-floor', pattern: 'plain_gradient', material: 'glossy plastic' }, { palette: 'a green object on pink' })],
    [2, 'bait bucket', 'silver', 'golden yellow', item('Bait Bucket', 'bait bucket', { preset: 'surface-patch', surface: 'wood', pattern: 'stripes_straight', stripes: 'vertical', material: ['metal', 'wood'] }, { palette: 'a blue object on golden yellow' })],
    [2, 'rowing boat', 'silver', '', item('Rowboat', 'rowing boat', { preset: 'environment', setting: 'outdoor', material: 'wood' }, { place: 'lake shore', environment: 'a calm lake shore with reeds' })],
    [3, 'landing net', 'silver', 'mint green', item('Landing Net', 'landing net', { preset: 'field', pattern: 'rings', material: 'wood' }, { palette: 'a brown object on mint green' })],
    [3, 'lake map', 'silver', '', item('Lake Map', 'paper map of a lake', { preset: 'full-frame', surface: 'wood', material: 'wood' })],
    [4, 'thermos', 'silver', 'teal', item('Thermos', 'thermos', { preset: 'floor-or-furniture', wall: 'stripes', floor: 'wood', pattern: 'stripes_straight', stripes: 'vertical', material: 'metal' }, { palette: 'a red object on teal' })],
    [4, 'fishing hut', 'silver', '', item('Fishing Hut', 'fishing hut', { preset: 'environment', setting: 'outdoor', material: 'wood' }, { place: 'lake shore', environment: 'a lake shore with pine trees' })],
  ];
  const slots = rows.map(([stars, kind, frame, hue, order]) => ({ stars, frame, kind, ...(hue ? { hue } : {}), order: { style: 'scapes', ...order } }));
  slots.push({ stars: 5, frame: 'gold', kind: 'big catch', props: ['fishing rod', 'old boot', 'bait bucket'], order: { style: 'scapes', ...scene('Big Catch', 'rods', ['man', 'pig']) } });
  slots.push({ stars: 5, frame: 'gold', kind: 'nap on the dock', props: ['folding chair', 'fishing rod'], order: { style: 'scapes', ...scene('Dock Nap', 'rod', ['cow']) } });
  return {
    style: 'scapes', title: 'Lake Fishing', theme: 'Рыбалка на озере', angle: 'a quiet day of fishing on a forest lake, from tackle to the dock',
    window: { layout: 'large' }, slots,
  };
}

/** The start of the self-check request (set-rules.json prompt.glue.review, up to its first slot). */
const REVIEW_START = JSON.parse(fs.readFileSync(path.join(ROOT, 'styles/scapes/set-rules.json'), 'utf8')).prompt.glue.review.split('{')[0];

/** Whether a fake text model's conversation is the plan's self-check. @param {any[]} messages */
export const isReview = messages => String(messages.at(-1)?.content ?? '').startsWith(REVIEW_START);

/**
 * A fake planning model that answers the self-check itself (`problems`, at `cost`), so the wrapped model sees only
 * planning calls. @param {(messages: any[]) => Promise<{text: string, cost: number|null}>} model
 * @param {{problems?: string[], cost?: number}} [o]
 */
export const withReview = (model, { problems = [], cost = 0 } = {}) =>
  async (/** @type {any[]} */ messages) => (isReview(messages) ? { text: JSON.stringify({ problems }), cost } : model(messages));

/** The lake plan made distinct by a tag (title, item kinds, props, captions): another set or variant that passes. */
export function tagged(/** @type {string} */ tag) {
  const p = lakePlan();
  p.title = `Lake ${tag}`;
  p.slots.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    s.kind = `${s.kind} ${tag}`;
    if (s.props) s.props = s.props.map((/** @type {string} */ x) => `${x} ${tag}`);
    s.order.title = `${tag}${'abcdefghij'[i]}card`;
  });
  return p;
}
