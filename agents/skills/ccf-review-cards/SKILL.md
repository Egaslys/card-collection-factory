---
name: ccf-review-cards
description: Review and fix factory cards — read the check report, look at each card against the style's checklist and for adequacy, confirm the hero outline or give a hero box, then recheck, adjust processing, edit or regenerate with a wish. Use after any card is made or imported, and when a person asks to check or fix cards.
---

# Review and fix cards

The agent checks its own result and follows the style's bible strictly — until the person says otherwise: their explicit word outranks any rule, and its check does not apply (`FACTORY/docs/plans/VISION.md`). `FACTORY` is the factory's folder; commands are `node FACTORY/ccf.mjs …`, `--help` for exact options. A card folder (`CARD_DIR`) is `collections/<collection>/cards/<card>/`; its files: header of `FACTORY/core/card/card-file.js`.

## 1. Read the checks

`ccf.mjs card check CARD_DIR --json` (free) runs the style's checks again on every attempt and chooses the best one again (a version chosen by a request or by `card choose` stays chosen); the result is the same `CardReport` as `card make` (ccf-make-cards step 5), exit 1 while a blocking FAIL remains. The full result of one attempt: `attempts/<n>/check.json`. What PASS, WARN, FAIL, NOT_MEASURED, N/A and INFO mean: `styles/<style>/checks/README.md`, «Statuses». A WARN on a threshold the bible marks as proposed means "look", not "reject" (`styles/<style>/CHECKLIST.md`).

## 2. Settle the hero outline

`maskStatus` `auto`: the outline was cut in a box (the vision model's, or one you gave) and is trusted — its FAILs are blocking; still glance at `card.mask.png`, since an outline can take a glow plate behind the hero. When a FAIL has `needsMask: true`, or `maskStatus` is `proposal` or `not found` while outline checks apply, open `attempts/<n>/card.mask.png` (the outline drawn over the card) and record what you see:

```sh
node FACTORY/ccf.mjs card check CARD_DIR --attempt N --mask confirmed                      # the outline is the hero
node FACTORY/ccf.mjs card check CARD_DIR --attempt N --mask rejected --hero-box X0,Y0,X1,Y1  # it is not: the hero's box
```

The box is in card pixels (the card size: `styles/<style>/README.md`), drawn by eye around all of the hero, without glow, shadow or the surface under it. A box cuts a new outline in it (free; `card.hero.png`) and replaces the earlier verdict, so `--mask rejected` may be left out. Without an outline give the box alone. A confirmed outline re-tunes the processing and the checks run again; a FAIL that remains after this is real. Why outlines need eyes: `styles/<style>/checks/README.md`, «The hero outline: confirm before trusting».

## 3. Look at the card

With a key the vision model has already looked (`check.look`, the full answer in `attempts/<n>/look.json`): take its issues as leads, not as the review. Measured on 22 cards (`CHANGELOG.md`, the models entry of 2026-10-30), it caught a wrong backdrop or wall colour and a missing costume item, but never a subject drawn as a near kind (a pier that reads as a bench) or fine texture (mesh). An empty `issues` list does not mean the card is right; no `look` at all means nothing looked.

Open `card.png` (zoom in on small creatures and faces) and go section by section, giving each a pass or fail with a reason:

- the card order of `styles/<style>/CHECKLIST.md`: format and category, staging and backdrop, composition, colour, rendering, characters. The entries of `chosenVisual` (document and check number) fall into these sections: read each in its document's checks section, but write a verdict per section, naming only the checks that fail — not one line per check;
- **adequacy**: the image holds nothing that was not ordered and that the thing does not have — a face on fish, animals or objects (mouth, smile, brows, expression; plain natural eyes on a fish or an animal are fine, eyes on an object are not), extra objects, text or letters, a frame — unless the person asked for it;
- the order's `subject` is what is drawn, and the caption (`title`) names it.

An order of kind `character-sheet` has no pixel checks: its `chosenVisual` list is the whole review.

## 4. Fix — cheapest first

| What is wrong | Fix | Cost |
|---|---|---|
| the order's staging does not describe the card, which is fine | correct `order.staging` in `card.json`, then `card check CARD_DIR` | free |
| only tone: brightness, saturation, sharpness, too-dark shadows | `card adjust CARD_DIR [--saturation X] [--brightness Y] [--sharpen A] [--shadows S]` (bounds: `styles/<style>/processing.json`); values set by hand are never tuned again — `card adjust CARD_DIR --reset` gives back the processing the program tunes | free |
| an earlier version was better | `card choose CARD_DIR --attempt N`: version N (attempt N) becomes the card; kept on recheck | free |
| one local defect (a face on a fish, a wrong detail) | `card edit CARD_DIR --wish TEXT [--attempt N]` — that version's model image goes back with the wish | one generation |
| subject, staging or composition wrong | `card regenerate CARD_DIR --wish TEXT`, or fix the order and `card make ORDER.json --collection ID --card CARD_ID` | generations |
| you draw with your own image tool | draw again, then `card import CARD_DIR IMAGE` | free |

`--wish` carries the person's words as they are; a fix of your own is one plain English sentence of what should be seen, not a prohibition. `edit`, `regenerate` and `import` make the new attempt the card even when an earlier one passes more checks (a request outranks the rules); `card make` picks the best attempt by checks. Every attempt stays as a version: when a fix came out worse, `card choose` the better version back — never re-import an old `model.png` for that. After any fix, repeat steps 1–3. Paid fixes stay inside the cap the person agreed (ccf-make-cards step 1).

## 5. Report

Per card: passed as is, fixed (how), or still wrong (what, and why it was left), plus what the fixes spent. Report what failed as plainly as what passed.
