// A valid set plan (core/set/plan.js) for the tests of core/set: «Lake Fishing» in the large window with two scenes.
// Built from the pilot orders (tests/style-pilot-orders.mjs) plus cards of the other stagings.

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
