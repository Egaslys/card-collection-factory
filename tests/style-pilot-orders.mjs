// The five cards of the first pilot generation (theme "Lake fishing", 2026-10-30) expressed as
// card orders (core/style/card-order.js). The pilot assembled their prompts by hand; these orders
// let the program assemble them from the bible. Used by tests/style-prompt.test.mjs.

/** @type {Record<string, any>} */
const NO_SCENE = { characters: 0 };

export const PILOT_ORDERS = [
  {
    id: 'c1-bobber', style: 'scapes', title: 'Bobber',
    subject: 'a classic fishing bobber (float): a glossy red top half and a white bottom half, a short red antenna on top and a small metal eyelet at the bottom.',
    object: 'fishing bobber',
    palette: 'a red-and-white object on sky blue',
    staging: { category: 1, backdrop: 'field', pattern: 'rays', placement: 'floating_field', support: 'none', camera: 'eye_level', ...NO_SCENE, time: 'n/a', sky_top: false, material: 'glossy plastic' },
  },
  {
    id: 'c2-tackle-box', style: 'scapes', title: 'Tackle Box',
    subject: 'a closed fishing tackle box made of green plastic, with a carrying handle on top, two latches on the front and a slightly raised lid.',
    object: 'tackle box',
    palette: 'a green object on pink',
    staging: { category: 2, backdrop: 'field', pattern: 'plain_gradient', placement: 'resting', support: 'ephemeral', camera: 'eye_level', ...NO_SCENE, time: 'n/a', sky_top: false, material: 'glossy plastic', brand: 'house', brand_finish: 'sticker' },
  },
  {
    id: 'c3-catch-bucket', style: 'scapes', title: 'Catch',
    subject: 'a painted blue metal bucket with a wire handle, three cartoon fish (orange, silver-green, yellow) peeking out of the top with their tails up.',
    object: 'bucket',
    palette: 'a blue object on golden yellow',
    staging: { category: 3, backdrop: 'field', pattern: 'stripes_straight', stripes: 'vertical', placement: 'resting', support: 'fragment', surface: 'wood', camera: 'eye_level', ...NO_SCENE, time: 'n/a', sky_top: false, material: ['metal', 'wood'] },
  },
  {
    id: 'c4-rowboat', style: 'scapes', title: 'Rowboat',
    subject: 'a small wooden rowing boat painted orange-red with a white rim, two oars resting inside, pulled up on the shore of a calm lake.',
    object: 'rowing boat',
    place: 'lake shore',
    environment: 'a calm lake shore with reeds, the far shore with rounded pine trees',
    staging: { category: 4, backdrop: 'environment', pattern: 'n/a', placement: 'resting', support: 'ground', setting: 'outdoor', camera: 'eye_level', ...NO_SCENE, time: 'day', sky_top: true, material: 'wood' },
  },
  {
    id: 'c5-gone-fishing', style: 'scapes', title: 'Big Catch',
    place: 'small wooden dock on a calm lake',
    environment: 'a wooden dock on a calm lake, reeds, the far shore with rounded pine trees',
    staging: { category: 5, backdrop: 'environment', pattern: 'n/a', placement: 'resting', support: 'ground', camera: 'eye_level', characters: 2, time: 'golden', sky_top: false },
    scene: {
      theme: 'lake fishing',
      time: 'at sunset',
      action: 'sit on the dock fishing',
      item: 'rods',
      joke: "the Pig proudly lifts an old rubber boot on its fishing line, while the Man's bucket next to him is still empty",
      reactor: 'the Man',
      jokeObject: 'the boot',
      crop: 'waist',
      characters: [
        { name: 'man', costume: 'Costume: a khaki fishing vest over a checked shirt and a green bucket hat.' },
        { name: 'pig', costume: 'Here it wears only a small straw hat.' },
      ],
    },
  },
];
