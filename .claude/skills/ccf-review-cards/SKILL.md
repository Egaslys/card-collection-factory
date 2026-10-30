---
name: ccf-review-cards
description: Review and fix factory cards — read the check report, look at each card against the style's checklist and for adequacy, confirm the hero outline or give a hero box, then recheck, adjust processing, edit or regenerate with a wish. Use after any card is made or imported, and when a person asks to check or fix cards.
---

# Review and fix cards

The agent checks its own result and follows the style's bible strictly — until the person says otherwise: their explicit word outranks any rule, and its check does not apply (`FACTORY/docs/plans/VISION.md`). `FACTORY` is the factory's folder; commands are `node FACTORY/ccf.mjs …`, `--help` for exact options. A card folder (`CARD_DIR`) is `collections/<collection>/cards/<card>/`; its files: header of `FACTORY/core/card/card-file.js`.

## 1. Read the checks

`ccf.mjs card check CARD_DIR --json` (free) runs the style's checks again on every attempt and chooses the best one again (a card chosen by a request stays chosen); the result is the same `CardReport` as `card make` (ccf-make-cards step 5), exit 1 while a blocking FAIL remains. The full result of one attempt: `attempts/<n>/check.json`. What PASS, WARN, FAIL, NOT_MEASURED, N/A and INFO mean: `styles/<style>/checks/README.md`, «Statuses». A WARN on a threshold the bible marks as proposed means "look", not "reject" (`styles/<style>/CHECKLIST.md`).

## 2. Settle the hero outline

`maskStatus` `auto`: the outline was cut in a box (the vision model's, or one you gave) and is trusted — its FAILs are blocking; still glance at `card.mask.png`, since an outline can take a glow plate behind the hero. When a FAIL has `needsMask: true`, or `maskStatus` is `proposal` or `not found` while outline checks apply, open `attempts/<n>/card.mask.png` (the outline drawn over the card) and record what you see:

```sh
node FACTORY/ccf.mjs card check CARD_DIR --attempt N --mask confirmed                      # the outline is the hero
node FACTORY/ccf.mjs card check CARD_DIR --attempt N --mask rejected --hero-box X0,Y0,X1,Y1  # it is not: the hero's box
```

The box is in card pixels (the card size: `styles/<style>/README.md`), drawn by eye around all of the hero, without glow, shadow or the surface under it. A box cuts a new outline in it (free; `card.hero.png`) and replaces the earlier verdict, so `--mask rejected` may be left out. Without an outline give the box alone. A confirmed outline re-tunes the processing and the checks run again; a FAIL that remains after this is real. Why outlines need eyes: `styles/<style>/checks/README.md`, «The hero outline: confirm before trusting».

## 3. Look at the card

With a key the vision model has already looked (`check.look`, the full answer in `attempts/<n>/look.json`): take its issues as leads, not as the review — on the trial set it caught a wrong backdrop every time but a missing costume item only in about half of the runs and no fine texture at all. Open `card.png` and answer every item with pass or fail and a reason:

- each entry of `chosenVisual` (document and check number): read that check in the document's checks section;
- the card order of `styles/<style>/CHECKLIST.md`: format and category, staging and backdrop, composition, colour, rendering, characters;
- **adequacy**: the image holds nothing that was not ordered and that the thing does not have — faces or eyes on fish and objects, extra objects, text or letters, a frame — unless the person asked for it;
- the order's `subject` is what is drawn, and the caption (`title`) names it.

An order of kind `character-sheet` has no pixel checks: its `chosenVisual` list is the whole review.

## 4. Fix — cheapest first

| What is wrong | Fix | Cost |
|---|---|---|
| the order's staging does not describe the card, which is fine | correct `order.staging` in `card.json`, then `card check CARD_DIR` | free |
| only brightness, saturation or sharpness | `card adjust CARD_DIR [--saturation X] [--brightness Y] [--sharpen A]` (bounds: `styles/<style>/processing.json`) | free |
| one local defect (a face on a fish, a wrong detail) | `card edit CARD_DIR --wish TEXT` — the card's model image goes back with the wish | one generation |
| subject, staging or composition wrong | `card regenerate CARD_DIR --wish TEXT`, or fix the order and `card make ORDER.json --collection ID --card CARD_ID` | generations |
| you draw with your own image tool | draw again, then `card import CARD_DIR IMAGE` | free |

`--wish` carries the person's words as they are; a fix of your own is one plain English sentence. `edit`, `regenerate` and `import` make the new attempt the card even when an earlier one passes more checks (a request outranks the rules); `card make` picks the best attempt by checks. After any fix, repeat steps 1–3. Paid fixes stay inside the cap the person agreed (ccf-make-cards step 1).

## 5. Report

Per card: passed as is, fixed (how), or still wrong (what, and why it was left), plus what the fixes spent. Report what failed as plainly as what passed.
