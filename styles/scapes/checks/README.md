# Scapes checks — automated part of the bible's «Проверка»

For agents. `check-card.mjs` runs every check of the Scapes bible (`../*.md`, sections «Проверка») that pixels can answer, on finished 430 × 480 cards, and lists the rest for eyes. The order of checking and what the checks mean stay in the bible: [CHECKLIST.md](../CHECKLIST.md) and each document's «Проверка». This folder adds no rules of its own.

## Requirements

Node and the `sharp` package from the project root (`npm install`); `check-card.mjs` reads and writes images with it and needs no ffmpeg. Colour profiles embedded in a PNG are ignored when reading, as the bible's numbers were measured on the stored pixel values. `adjust-trial.mjs` applies the product's own post-processing (`core/image/adjust.js`) and needs no ffmpeg either. Both scripts take `--help` and refuse an unknown option before doing anything (`tools/cli-args.mjs`).

## Files

| File | What it is |
|---|---|
| `check-card.mjs` | The checker. Reads a spec (cards + the staging each was ordered with), prints PASS / WARN / FAIL per check with the value, the norm or limit and the bible document and check number, then the visual checklist. Imported as a module it runs nothing and exports `checkCard`, `restsOnUnconfirmedMask` and `CARD_SIZE` — the card loop (`core/card/check.js`) checks every generated attempt with them — and `processingMeasures` and `heroOutline` for the per-card post-processing search (`core/card/tune.js`; which checks and bounds: `../processing.json`). The value of each check that post-processing moves is read in one place (`VALUE_OF`), by both. |
| `measures.mjs` | The pixel measures. Each repeats the method that produced the bible's numbers, so a value is comparable with the bible's. |
| `thresholds.json` | Every number the checker compares against, by check id (`COLOUR.8a`, `COMPOSITION.3`, …), each citing its bible document and check number; the `visual` list; `method` parameters of the measurement, each with its source. |
| `reference-spec.json` | The control run: the 160 reference cards (`../references/card-NNN.png`) with their staging, whether the proposed hero outline was confirmed by eye, and the hero box confirmed by eye where it was not. Generated once from the analysis of the references; edit by hand only to fix an error. |
| `adjust-trial.mjs` | Tries post-generation adjustments on copies of cards with the product's own post-processing (`core/image/adjust.js`, settings from `../processing.json`) and prints the measures the adjustment step aims at. |

## Running

From the project root:

```
node styles/scapes/checks/check-card.mjs --summary --quiet --no-visual      # control run on the 160 references
node styles/scapes/checks/check-card.mjs --outlines --summary --quiet --no-visual   # the same with outlines cut in the boxes by eye (about 2 min)
node styles/scapes/checks/check-card.mjs --spec my-cards.json               # new cards
node styles/scapes/checks/check-card.mjs --spec my-cards.json --overlays /tmp/ov   # also write mask overlays
```

The spec format (fields `id`, `file`, `category`, `backdrop`, `pattern`, `placement`, `support`, `camera`, `characters`, `time`, `sky_top`, `hero_box`, `mask`, `ref`) is printed by `--help`. Paths in the spec are relative to the spec file. The staging values are the ones the card was ordered with: the checker picks the norms by them (for example `COMPOSITION.3` has one norm per backdrop, plus one for scenes with characters).

Statuses:

- `PASS` — inside the norm.
- `WARN` — outside the norm but inside the limit, or outside a threshold the bible marks as proposed: look by eye.
- `FAIL` — outside the limit or a hard rule: the card breaks the bible unless the person asked otherwise (the person's word outranks the bible).
- `NOT_MEASURED` — the measure could not be taken (no hero outline, no clear floor line, pattern too faint); the check goes to the visual list.
- `N/A` — the check does not apply to this staging.
- `INFO` — a guide the bible says never fails a card (`RENDERING.2`).

Exit code 1 when any FAIL is unexpected. Expected FAILs exist only on reference cards: cards the bible names as «избегать» (`avoid`), allowed exceptions it names (`exceptions`), and reference cards whose automatic pattern measure was found wrong by eye when the bible was written (`method.known_measure_failures`).

## The hero outline: confirm before trusting

Many checks need the hero separated from the backdrop. `measures.mjs` proposes an outline by flood fill from the frame border through the backdrop's tones; it gives up (no outline) on busy borders, tiny or huge heroes, heroes touching three edges, and most scenes. A proposed outline can still be wrong (it can take a shadow, a stand or the floor), so:

1. Run with `--overlays DIR` and open `DIR/<id>.mask.png` (the outline drawn over the card) for every card where a hero was found.
2. In the spec set `"mask": "confirmed"` when the outline is the hero, `"mask": "rejected"` when it is not.
3. For a rejected or missing outline, give `"hero_box": [x0, y0, x1, y1]` in pixels by eye: composition checks then use it; colour checks that need the hero's own pixels are not measured and go to the visual list.
4. Run again.

Until the mask is confirmed, a FAIL that rests on it carries the note "rests on an unconfirmed mask". On the references the outline was confirmed for 51 of 160 cards; all composition numbers of the bible were measured on boxes confirmed by eye.

A hero box alone fixes composition but leaves the hero-versus-backdrop colour checks unmeasured. The card loop therefore turns a box into an outline outside the checker: `core/card/hero.js` cuts the outline inside a box given by an agent or a person (GrabCut, `core/image/segment.js`), or inside a box from the vision model of the settings when nobody gives one, and passes it to `checkCard(card, { outline })`. The given outline replaces both the proposer's mask and the spec's `hero_box`; its confidence sets the mask status `auto` (trusted: cut in a box an agent or a person gave, or in a box the vision model gave on the card and on its mirror image alike, and not collapsed) or `proposal` (as above). An `auto` outline counts as confirmed: a FAIL resting on it is blocking and makes the loop regenerate. The outline-based norms were re-measured for this on all 81 abstract-backdrop references, the 38 without a confirmed outline getting the outline cut in their box by eye (2026-10-30): the bible's norms had been measured on the 51 confirmed outlines only, and three changes made the control run with outlines pass — COLOUR 8a, 9a, 9c and 10 give WARN instead of FAIL unless the hero floats on the field or hangs from above (`method.backdrop_colour_strict_placements`: a floor, a support or a wall enters the backdrop measures), the top band of COMPOSITION 11 counts from 38 px (`method.safe_zone_top_depth_px`) and its exceptions are the cards COMPOSITION 5 names; COLOUR 7 names #38 and lists #54 as a known measure failure (the outline takes its glow plate). That control run is `--outlines` (below) and must exit 0 too. The checks that read only the box (composition 2–5b, BACKGROUNDS 6c, 6d, 7a, 9) rest on the outline's box when it is trusted, as on a box by eye. `outlineFits(staging)` says where an outline is usable at all: on an abstract backdrop; in scenes and environments it takes sky and water between the characters, and only its box is used. Measured accuracy: `CHANGELOG.md`, entry of 2026-10-30 on the hero outline. The command line uses it only with `--outlines` (the outline cut in each abstract-backdrop card's `hero_box`, as the loop does with an agent's box).

## What is automated and what stays visual

Automated (where the staging makes them apply and the measure succeeds): format and frame (`BASE_RULES.1`); COLOUR 1–12, 14, 15 (hero-versus-backdrop checks 7–10 only on an abstract backdrop with a confirmed or trusted automatic outline); BACKGROUNDS 4 (pattern step and edge width), 6 (rays), 7 (rings), 8 (straight stripes), 9 (floor line); COMPOSITION 2–5 and 11 (11 only for the main mass against the top 40 px and the rounded top corners, which needs a confirmed or trusted automatic outline); RENDERING 2 (info), 3, 4, 6, 11, 16, 17.

Visual, printed per card from `thresholds.json` → `visual` plus every `NOT_MEASURED` check: staging and category, glow centre (BACKGROUNDS 5 — the bible gives no number), setting, night colours, number of things, crop, camera, tilt, volume, brand mark, key light, rim, soft forms and shadows, fine texture and wear, effects, all character checks, and faces, eyes and text inside the safe zone. Set and collection checks (SETS.md) are not covered.

## Keeping it in sync with the bible

- A number in a bible check and in `thresholds.json` must match. When a check changes in the bible, change `thresholds.json` in the same task and rerun the control run.
- The control run must exit 0, with and without `--outlines`: every reference card passes every check, except the cards the bible names (as «избегать» or as an exception). A new unexpected FAIL on a reference means the bible's threshold or the measure is wrong — fix one of them, do not add the card to a list the bible does not name.
- `thresholds.json` → `target` / `target_about` are the aims of the post-generation adjustment step that the bible states (RENDERING.md «Резкость при обработке», COLOUR.md section 5); `adjust-trial.mjs` prints them; they are not checks.

## Tuning the adjustment step

The settings are the settings object of `core/image/adjust.js` (brightness, saturation, sharpen amount and radius); their numbers live only in `../processing.json` (`neutral`, `start` per model, `sharpen_amount_max`). What the starting settings give and the targets are in the bible (RENDERING.md «Резкость при обработке: цель и начальные настройки» and COLOUR.md «5. Насыщенность и яркость после генерации»). Without `--trials` the script tries no adjustment, each model's starting settings, and each with sharpening at `sharpen_amount_max`; other trials start from `neutral` and override keys:

```
node styles/scapes/checks/adjust-trial.mjs --spec my-cards.json --out /tmp/adj \
  --trials 'none;sh0.3=sharpen=0.3;s1.3+sh0.3=saturation=1.3,sharpen=0.3'
```

It writes the adjusted copies to `--out` (the cards themselves are not changed) and prints overshoot, edge width, chroma, lightness, grey and white shares, grain and the backdrop colour per copy; `--ref-json` with a `check-card.mjs --json` output of the control run adds the reference spread of the same measures. Check the chosen copy with `check-card.mjs` afterwards.
