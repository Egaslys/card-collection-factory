---
version: alpha
name: Card Factory Editor
description: >-
  Design system of the card factory's web editor, adapted from the author's "Monolith" design code: its token
  format, type system, spacing and radius scales, controls, two themes, sparing glass and Do / Don't discipline,
  without its portfolio identity. Neutral grey air so card colours are judged honestly, the brand green for the
  one primary action, the brand blue for selection, focus and progress, the brand red for errors.
  Every colour token has a dark twin with the `-dark` suffix.
colors:
  # air — the page and the surfaces cards are judged against; a faint cool grey, no warm cast
  background: "#F3F4F8"
  background-dark: "#141518"
  surface: "#FFFFFF"
  surface-dark: "#1D1F23"
  surface-sunken: "#E8E9EE"
  surface-sunken-dark: "#26282D"
  line: "#D8D8D8"
  line-dark: "#34373D"
  line-strong: "#84898F"
  line-strong-dark: "#6E747C"
  # ink — neutral dark greys, never black
  ink-1: "#1D2025"
  ink-1-dark: "#ECEDF0"
  ink-2: "#454A52"
  ink-2-dark: "#B6BAC2"
  ink-3: "#5F656E"
  ink-3-dark: "#8C929B"
  ink-4: "#919194"
  ink-4-dark: "#5D6169"
  # action — brand green: the one primary action per screen; PASS in its ink and tint
  accent: "#28D223"
  accent-dark: "#28D223"
  accent-hover: "#05BE00"
  accent-hover-dark: "#05BE00"
  on-accent: "#1D2025"
  on-accent-dark: "#141518"
  accent-ink: "#177814"
  accent-ink-dark: "#28D223"
  accent-tint: "#DDF8DC"
  accent-tint-dark: "#1F4323"
  # state — brand blue: selection, focus, progress, links; never carries text as a fill
  state: "#2683FA"
  state-dark: "#2683FA"
  state-ink: "#1E66C3"
  state-ink-dark: "#5BA2FC"
  state-tint: "#DCEBFE"
  state-tint-dark: "#1F334E"
  # warning — amber, derived (the brand palette has none): WARN
  warning: "#F5B026"
  warning-dark: "#F5B026"
  warning-ink: "#8E5E00"
  warning-ink-dark: "#F5B026"
  warning-tint: "#FDF2DC"
  warning-tint-dark: "#483C24"
  # error — brand red: errors, FAIL, failed generations
  error: "#FF5B5B"
  error-dark: "#FF5B5B"
  error-ink: "#B83C3C"
  error-ink-dark: "#FF7676"
  error-tint: "#FFE5E5"
  error-tint-dark: "#4A2B2E"
typography:
  display:
    fontFamily: Unbounded
    fontSize: 72px
    fontWeight: 300
    lineHeight: 72px
    letterSpacing: -0.01em
  display-mobile:
    fontFamily: Unbounded
    fontSize: 44px
    fontWeight: 300
    lineHeight: 48px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Unbounded
    fontSize: 40px
    fontWeight: 400
    lineHeight: 48px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Unbounded
    fontSize: 30px
    fontWeight: 400
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Unbounded
    fontSize: 28px
    fontWeight: 400
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md-mobile:
    fontFamily: Unbounded
    fontSize: 24px
    fontWeight: 400
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Unbounded
    fontSize: 20px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm-mobile:
    fontFamily: Unbounded
    fontSize: 18px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: -0.01em
  number-lg:
    fontFamily: Unbounded
    fontSize: 32px
    fontWeight: 400
    lineHeight: 40px
    letterSpacing: -0.02em
    fontFeature: "'tnum' 1"
  number-md:
    fontFamily: Unbounded
    fontSize: 28px
    fontWeight: 400
    lineHeight: 36px
    letterSpacing: -0.02em
    fontFeature: "'tnum' 1"
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
  body-lg-mobile:
    fontFamily: Geist
    fontSize: 17px
    fontWeight: 400
    lineHeight: 26px
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  button-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 600
    lineHeight: 20px
  button-md:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 600
    lineHeight: 20px
  button-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 600
    lineHeight: 20px
  label-md:
    fontFamily: Science Gothic
    fontSize: 11px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.07em
    fontVariation: "'wdth' 150"
  data-md:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    fontFeature: "'tnum' 1"
  data-sm:
    fontFamily: Geist Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0.02em
    fontFeature: "'tnum' 1"
rounded:
  xs: 4px
  sm: 8px
  md: 16px
  panel: 20px
  lg: 24px
  xl: 32px
  full: 9999px
spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s5: 24px
  s6: 32px
  s7: 48px
  s8: 64px
  s9: 96px
  s10: 128px
  page: 1200px
  columns: 12
  columns-mobile: 4
  gutter: 24px
  gutter-mobile: 16px
  margin: 48px
  margin-tablet: 24px
  margin-mobile: 16px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    height: 40px
    padding: 16px
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-disabled:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-4}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    height: 40px
    padding: 16px
  button-text:
    textColor: "{colors.state-ink}"
    typography: "{typography.button-md}"
  button-sm:
    typography: "{typography.button-sm}"
    height: 32px
    padding: 12px
  button-lg:
    typography: "{typography.button-lg}"
    height: 48px
    padding: 20px
  focus-ring:
    backgroundColor: "{colors.state}"
    size: 2px
  top-bar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    height: 48px
    padding: 4px
  segment-shell:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.panel}"
    height: 40px
    padding: 4px
  segment:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    typography: "{typography.button-sm}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 12px
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    rounded: "{rounded.lg}"
    padding: 16px
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: 12px
  field-border:
    backgroundColor: "{colors.line-strong}"
    size: 1px
  field-error:
    textColor: "{colors.error-ink}"
    backgroundColor: "{colors.error-ink}"
  field-label:
    textColor: "{colors.ink-2}"
    typography: "{typography.body-sm}"
  field-hint:
    textColor: "{colors.ink-3}"
    typography: "{typography.body-sm}"
  slider-track:
    backgroundColor: "{colors.surface-sunken}"
    height: 4px
  slider-fill:
    backgroundColor: "{colors.state}"
  slider-thumb:
    backgroundColor: "{colors.surface}"
    size: 20px
  card-thumb:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.sm}"
    width: 172px
  card-thumb-selected:
    backgroundColor: "{colors.state}"
    size: 2px
  badge:
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 20px
    padding: 8px
  badge-pass:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent-ink}"
  badge-warn:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.warning-ink}"
  badge-fail:
    backgroundColor: "{colors.error-tint}"
    textColor: "{colors.error-ink}"
  window-frame:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.xl}"
    padding: 8px
  progress:
    backgroundColor: "{colors.surface-sunken}"
    height: 4px
  progress-fill:
    backgroundColor: "{colors.state}"
  queue-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-1}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px
  log-row:
    textColor: "{colors.ink-2}"
    typography: "{typography.data-md}"
  label:
    textColor: "{colors.ink-3}"
    typography: "{typography.label-md}"
  link:
    textColor: "{colors.state-ink}"
  drop-marker:
    backgroundColor: "{colors.state}"
    size: 3px
---

# Card Factory Editor — design system

The design system of the card factory's web editor. This file is the single source of truth. The YAML front
matter holds the standard design.md tokens (colors, typography, rounded, spacing, components). Values the format
has no slot for — fonts, elevation, glass, motion — live in fenced ` ```json x-tokens ` blocks inside the
sections below; design.md consumers ignore them, `tokens.js` reads both. The front matter is read by a small
YAML subset (`front-matter.js`: nested maps, quoted or bare scalars, `>-` blocks, comments; no lists or flow
syntax) — keep to it; anything outside it fails loudly with a line number.

**Origin.** Adapted from the author's "Monolith" design code. Kept: the token format and CSS variable names, the
typography system and fonts, the spacing and radius scales and the concentric rule, buttons and segmented
controls, two themes, glass used sparingly, Do / Don't and live contrast reporting, the live board. Dropped: the
portfolio identity — the eye, the ship, drawn stars, grain and paper glass, warm paper, the scene, punches, HUD,
spec tiles, contact card, all portfolio texts. Added: everything the editor needs (see *Editor patterns*).

**Themes.** Light by default; dark is the second theme. Every colour token `name` has a twin `name-dark`. A
consumer renders light by default and switches to the `-dark` set under `[data-theme="dark"]` on `<html>`; the
user switches the theme.

**Breakpoints.** Typography tokens with the `-mobile` suffix replace their base at `max-width: 640px`. Spacing
`margin-tablet` applies at `max-width: 900px`, `margin-mobile` and `gutter-mobile` at `max-width: 640px`.

## Overview

A quiet, functional tool for one job: look at many cards together, judge them, fix a few. The cards are the only
saturated thing on screen; the interface stays neutral grey around them so their colour reads true, and it uses
colour only to say something: green — the one thing to do next, blue — what is selected or in progress, amber
and red — what needs attention. "Understandable to a person off the street": plain Russian words, one primary
action per screen, every state (empty, loading, error) says what happened and what to do.

Principles carried over from Monolith:

- **Every element has a purpose and a result.** No purpose, no element.
- **Symmetric precision.** Paddings, edges and strokes are symmetric and fitted to each other at every size.
- **No black anywhere.** The darkest value is a neutral dark grey.

## Colors

Each colour has exactly one job (see *Colour jobs*). Accents carry up to three steps: a fill (non-text UI), an
ink (text and icons on the air) and a tint (the quiet background of a status badge or a selected row).

- **Background (#F3F4F8 · dark #141518):** the page, and the air behind every card grid. The brand's light grey;
  it carries a faint cool cast (CIELAB C\* ≈ 2.1, b\* ≈ −2.1), the derived surfaces follow it. No warm or
  tinted surface ever sits behind a card.
- **Surface (#FFFFFF · #1D1F23):** panels, fields, queue rows, the secondary button.
- **Surface sunken (#E8E9EE · #26282D):** tracks, segment shells, empty slots, skeletons, the card well under a
  loading image.
- **Line (#D8D8D8 · #34373D):** hairline dividers; decoration only, never the only edge of a control.
  **Line strong (#84898F · #6E747C):** the edge of a field or a slider thumb — ≥ 3:1 against surface and background.
- **Ink 1–4:** headings and body; secondary text; captions and labels; decoration and disabled only (ink-4 is
  below 4.5:1 by design — never for text a person must read).
- **Accent (#28D223, hover #05BE00):** the brand green. The fill of the **one** primary action per screen. Text
  on it is `on-accent` (dark ink, 8.04:1; on hover 6.51:1), never white (2.03:1 fails). **Accent ink (#177814 ·
  #28D223)** is green text — the PASS word; **accent tint** is the PASS badge.
- **State (#2683FA):** the brand blue — selection ring, focus ring, progress and slider fill, drop marker, the
  "working" dot. A fill only, never under text (white on it is 3.68:1). **State ink (#1E66C3 · #5BA2FC)** — links
  and text buttons; **state tint** — a selected row, a drop zone.
- **Warning (#F5B026):** amber, derived — the brand palette has no yellow. WARN badge (ink + tint), warning dot.
- **Error (#FF5B5B):** the brand red — FAIL, a failed generation, a field error. As text always **error ink
  (#B83C3C · #FF7676)**; the fill alone fails as text on the light background (2.77:1).

Text contrast, WCAG 2.2 (the example recomputes every pair live from these tokens). Light on background / surface
/ surface-sunken: ink-1 14.86 / 16.34 / 13.47, ink-2 8.12 / 8.92 / 7.36, ink-3 5.35 / 5.88 / 4.85, accent-ink
5.12 / 5.63 / 4.64, state-ink 5.10 / 5.61 / 4.63, warning-ink 5.09 / 5.60 / 4.62, error-ink 5.10 / 5.60 / 4.62.
Dark: ink-1 15.60 / 14.10 / 12.60, ink-2 9.38 / 8.48 / 7.58, ink-3 5.83 / 5.27 / 4.71, accent-ink 8.98 / 8.12 /
7.26, state-ink 6.97 / 6.30 / 5.63, warning-ink 9.67 / 8.74 / 7.81, error-ink 7.05 / 6.37 / 5.69. Badges, ink on
its tint, light / dark: PASS 4.96 / 5.48, WARN 5.04 / 5.71, FAIL 4.69 / 4.84, state 4.64 / 4.88. On the green:
on-accent 8.04 (dark theme 8.98); white 2.03 — rejected. Non-text: the green button against the light background
is 1.85:1 — the button is identified by its label, not by its edge; focus and selection rings (state) are 3.35:1
on background and 3.68:1 on surface.

## Typography

One characteristic voice used short; everything long is a neutral grotesque; data is mono. All four families
carry Cyrillic and are bundled as files in `fonts/` (Latin and Cyrillic subsets, variable weight) — no network.

- **Headlines and numbers — Unbounded 300/400:** screen titles, set names, big counters (tabular figures).
  `display` is for a start screen only; a working screen starts at `headline-md`.
- **Labels — Science Gothic, `wdth` 150, 600, UPPERCASE, +7% tracking:** section labels and the PASS / WARN /
  FAIL badges. Short words only: it is wide, so never a sentence and never a control's label.
- **Text and controls — Geist 400/600;** **data — Geist Mono** with tabular figures: values of sliders, costs,
  times, the log, so numbers do not jump.

```json x-tokens
{
  "fonts": [
    { "family": "Unbounded", "weight": "300 500", "files": { "latin": "fonts/unbounded-latin.woff2", "cyrillic": "fonts/unbounded-cyrillic.woff2" } },
    { "family": "Science Gothic", "weight": "500 800", "stretch": "100% 200%", "files": { "latin": "fonts/science-gothic-latin.woff2", "cyrillic": "fonts/science-gothic-cyrillic.woff2" } },
    { "family": "Geist", "weight": "400 600", "files": { "latin": "fonts/geist-latin.woff2", "cyrillic": "fonts/geist-cyrillic.woff2" } },
    { "family": "Geist Mono", "weight": "400 500", "files": { "latin": "fonts/geist-mono-latin.woff2", "cyrillic": "fonts/geist-mono-cyrillic.woff2" } }
  ],
  "fontSubsets": {
    "latin": "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "cyrillic": "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"
  },
  "uppercase": ["label-md"]
}
```

## Layout

One 4-point spacing scale `s1`–`s10` for every gap: 4 icon to label · 8 shell padding of concentric containers,
gap between thumbnails on phones · 12 label to value, field padding · 16 panel padding, gap between thumbnails,
mobile margin · 24 desktop gutter · 32 between groups · 48 page margin · 64 section head to content · 96 between
blocks · 128 between sections. A working screen of the editor is fluid (margin 48 / 24 / 16) — the card grid
uses the whole width; `page` (1200) is the reading width of text pages and of this board. Paddings are symmetric.

## Elevation & Depth

Depth is quiet: panels are separated from the background by their surface colour and a hairline, not by heavy
shadows. Shadows are neutral grey. `raised` — panels and rows that sit on the background; `float` — what
floats over content (the top bar, the selection bar, a dragged card, a menu); `highlight` — the 1px inner top
light of a raised control.

```json x-tokens
{
  "elevation": {
    "light": {
      "raised": "0 1px 2px rgb(20 22 26 / 0.06)",
      "float": "0 1px 2px rgb(20 22 26 / 0.06), 0 12px 32px -12px rgb(20 22 26 / 0.22)",
      "highlight": "inset 0 1px 0 rgb(255 255 255 / 0.7)"
    },
    "dark": {
      "raised": "0 1px 2px rgb(0 0 0 / 0.3)",
      "float": "0 1px 2px rgb(0 0 0 / 0.3), 0 12px 32px -12px rgb(0 0 0 / 0.6)",
      "highlight": "inset 0 1px 0 rgb(255 255 255 / 0.06)"
    }
  }
}
```

## Shapes

Soft geometric, as in Monolith: pills for buttons and segmented controls, generous radii for panels. Scale `xs`
4 (focus, ticks), `sm` 8 (fields, card thumbnails, small actions), `md` 16 (segments, queue rows), `lg` 24
(panels, the top bar), `xl` 32 (the set window frame), `panel` 20 (the 40px segment shell), `full` (buttons,
badges). **Concentric rule:** a nested shape near a corner has r(inner) = r(outer) − padding — window frame 32 −
8 = panel 24 − 16 = field 8; segment shell 20 − 4 = segment 16; top bar 24 − 4 = control 20 (a 40px pill).
Pills sit only in pill shells or free.

## Components

- **Buttons** — L 48 / M 40 / S 32, pills. Primary: brand green with dark ink, **one per screen** (the next
  step: "Собрать набор", "Сохранить"). Secondary: surface with a 1px `line` edge (the label identifies it). Text button:
  state ink, underlined. Icon button: square to its height. States: hover darkens the green to `accent-hover`,
  pressed moves 1px down, focus is a 2px state ring with 2px offset, disabled is sunken with ink-4.
- **Top bar** — sticky, h 48, p 4, r 24; glass over the scrolling grid. Left: where you are (collection → set);
  right: theme, settings, the one primary action of the screen.
- **Segmented control** — shell h 40 p 4 r 20, segments h 32 r 16; the pressed segment is a raised surface.
- **Fields** — h 40, r 8, p 12, 1px line-strong edge (≥ 3:1), label above in ink-2, hint below in ink-3. Focus:
  2px state ring. Error: the edge and the message in error ink, the message says what to do. Textarea grows.
  **Key field**: a password input with "show"; the hint says the key is not stored.
- **Sliders** — label, value in data-md (tabular), reset icon; track 4px sunken, fill state, thumb 20px surface
  with a line-strong edge. Reset is disabled while the value is neutral; a changed value shows a state dot.
- **Badges** — PASS / WARN / FAIL: label type on the status tint in status ink, pill h 20.
- **Panel** — surface, r 24, p 16, hairline edge, `raised`.

## Editor patterns

- **Card thumbnail** — the card image at an exact fraction of 430 × 480 (default 0.4 → 172 × 192) on a sunken
  well, r 8, never cropped, never covered: number, caption and the check badge sit **under** the image. Selected:
  a 2px state ring outside the image with a 2px gap and a check mark in the caption row. Drag: a grip appears in
  the caption row on hover and focus; the dragged card lifts (`float`, slight scale), its old place stays as a
  sunken ghost, a 3px state marker shows where it will land.
- **Card grid** — auto-fill columns of the thumbnail width, gap 16 (8 on phones, two columns). Order is reading
  order: row by row, left to right — the same as the slots of a set window.
- **Set window preview** — a frame (sunken, r 32, p 8) that shows the set in the style's window template: the
  template image is supplied by the style and fills the frame; slots are positioned over it from the template's
  geometry. Until a template image is given, the frame draws a neutral schematic window (title strip, 2 × 5
  slots, set number). Above it a segmented switcher of the four templates — blue, purple, crimson, orange —
  each with a swatch whose colour comes from the template, not from this file.
- **Processing panel** — the card at full 430 × 480 beside three sliders: sharpness, saturation, brightness;
  "Сбросить всё" as a text button. The preview is computed by the product's own processing code (the same as the
  final card); this design system only lays it out.
- **Generation queue** — one row per card: thumbnail or placeholder, caption, status word, attempt "2 / 3",
  progress, cost in data type; a summary line "spent of the ceiling". Statuses: queued (ink-3, hollow dot),
  working (state, pulsing dot), done (accent ink), failed (error ink, with "Повторить").
- **Log** — time, a status dot, the message; mono, newest at the bottom, scrolls inside its panel.
- **Settings form** — provider (segmented), endpoint, generation model, editor model, key (key field), attempts
  and the spending ceiling; one primary "Сохранить".
- **Theme and wishes** — the theme of the set (field), free wishes (textarea), number of variants (segmented),
  one primary "Собрать набор".
- **Variant comparison** — the variants side by side, each a column with its 10 thumbnails in window order
  (2 × 5), a summary of checks, and "Выбрать" (secondary); the chosen one gets the state ring. On phones the
  variants stack.
- **States** — empty: what is missing and the one action that fixes it; loading: sunken skeletons of the real
  shapes, a slow shimmer (none with reduced motion); error: error ink headline, what happened in plain words,
  "Повторить".

## Do's and Don'ts

- Do use the green fill for exactly one action per screen; don't use it for decoration, selection or progress.
- Don't put white text on the green (2.03:1); use `on-accent`.
- Don't put any text on a blue, amber or red fill; use the ink on the background or the ink on its tint.
- Do keep everything behind and around cards neutral grey; don't put a card on a tinted, warm or saturated
  surface — it changes how its colour reads.
- Don't cover the card image with UI — badges, numbers and grips go under it; don't crop or round it beyond
  r 8; show it at an exact fraction of 430 × 480.
- Do put glass only over moving content (the grid scrolling under the top bar); over a flat area use a solid
  surface; never keep glass permanently over a card being judged.
- Don't make a glass panel with text more transparent than its `clear` fill; never ink-3 on glass.
- Don't use black — not for text, not for shadows' base colour.
- Do say every state in plain Russian with the action that fixes it; don't show a bare error code.
- Do keep nested corners concentric.

## Colour jobs

| Job | Token | Share of a screen |
|---|---|---|
| Air — the page, panels | background, surface | most |
| Ink — text | ink-1…4 | text only |
| Cards — the content | the card images | the largest coloured area |
| Action — one per screen | accent | one button |
| State — selection, progress | state | rings, bars |
| Attention — WARN, FAIL | warning, error | badges, messages |

## Glass

Used sparingly: the sticky top bar and the floating selection bar, both over the scrolling grid. Plain frosted
glass — Monolith's grain, fibre and etch are dropped. `saturate` stays at 100% so the glass never brightens the
cards it passes over.

| | Clear — top bar, selection bar | Thick — a menu over the grid |
|---|---|---|
| Fill | surface 78% (dark 80%) | surface 90% (dark 90%) |
| Backdrop | `blur(20px)` | `blur(28px)` |
| Edge | the hairline line token | same |
| Fallback | surface 96% when `backdrop-filter` is missing | same |

```json x-tokens
{
  "glass": {
    "common": { "blur-clear": "20px", "blur-thick": "28px", "saturate": "100%", "fallback-fill": "0.96" },
    "light": { "clear-fill": "0.78", "thick-fill": "0.9" },
    "dark": { "clear-fill": "0.8", "thick-fill": "0.9" }
  }
}
```

## Motion

Motion explains, it never decorates. Durations `t1` 120ms (hover, press), `t2` 240ms (state changes, progress,
reorder), `t3` 480ms (a panel appearing) on one ease-out curve; `shimmer` — the skeleton's slow pass.
`prefers-reduced-motion` reduces every duration to 1ms and stops the shimmer.

```json x-tokens
{
  "motion": {
    "t1": "120ms",
    "t2": "240ms",
    "t3": "480ms",
    "ease": "cubic-bezier(.2, .7, .2, 1)",
    "shimmer": "1600ms"
  }
}
```

## Decisions

Agent's calls in this adaptation, waiting for the author (the author's own decisions are not repeated here):

1. **Background kept exactly as given (#F3F4F8)** although it is faintly cool (C\* ≈ 2.1); a strictly neutral
   grey of the same lightness would be #F4F4F4.
2. **PASS uses the green ink and tint**, not the green fill — the fill stays the one action.
3. **Amber for WARN is derived** (#F5B026) — the brand palette has no yellow.
4. **Second theme is called dark** (`-dark`, `data-theme="dark"`), as the author named it; Monolith said muted.
5. **Fields have r 8**, buttons stay pills (concentric with the r 24 panel and p 16).
6. **The Science Gothic label voice is kept for labels and badges only**; segment and control texts are Geist.
