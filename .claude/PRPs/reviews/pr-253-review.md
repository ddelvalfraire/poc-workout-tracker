# PR Review #4: #253 — component a11y fixes + a11y gating

**Reviewed**: 2026-08-18
**Decision**: APPROVE

## Summary

Fourteen known violations fixed rather than recorded, and the enforcement moved
from a bespoke script to Storybook's supported path. Verified by breaking the
gate on purpose, not by trusting it.

## Findings

### The script deserved deleting

Six violations it never reported: every ops table scrolls horizontally with no
keyboard access. The script audited at the default browser width; the supported
runner honours the story's iPhone viewport, where the tables actually overflow.
A checker that measures the wrong viewport reports a clean bill of health for
the state nobody sees.

### The destructive fix is structural, not a nudge

No lightness of `--destructive` could fix the button, because the ink and the
tint were the same token: as alpha rises the background approaches the ink and
contrast tends to 1. Confirmed by search — no in-gamut (L, C) pair satisfies it
across the tint range. That is why this is a new token rather than a tweak, and
why the fix also covers the `hover:/30` state axe never measured.

### Two ARIA fixes were correctness, not lint

`aria-label` on a bare `<span>` is prohibited, which means assistive tech
DROPPED those names — the week summary and the error severity were not being
announced at all. Fixed with `role="img"` where the element is one graphic with
decorative children, and `role="textbox"` + `aria-multiline` on the editor,
which is the MDN-specified pairing for an editable multi-line region.

### Hermetic tests

Splitting Vitest into projects made Next's env loader read `.env.local` into
`process.env` for the whole run, so `push.test.ts` silently began testing the
configured path against the developer's real VAPID key. Worth stating plainly:
before this, the unit suite's result depended on a gitignored file. Now cleared
in setup.

## Style Dictionary — researched, and the answer is keep

The decision to research this came from my own claim in review #2 that a mature
tool's name transforms would have prevented the `2xl` identifier bug. **That
claim was wrong.** The evidence:

| Need | Style Dictionary 5.5.1 |
|---|---|
| OKLCH input | Works — it depends on `colorjs.io@^0.5.2`, the same library used here |
| Swift / Compose output | Mature — `color/ColorSwiftUI`, `color/composeColor`, `size/compose/remToDp` |
| sRGB gamut assertion | Not documented; would stay a custom transform |
| Valid identifier for a leading digit (`2xl`) | Not documented for any name transform — **it would not have caught the bug** |
| Withholding `unused` tokens from native | Supported via filters |

So migrating buys the platform formats and keeps the gamut assertion, the
identifier safety and the status filter as bespoke code anyway, plus a
dependency and a config layer. Recommendation: keep the hand-rolled emitters,
which are now under test for exactly the things Style Dictionary does not
promise. Revisit when a Swift or Kotlin app actually consumes them — that is
when the platform formats start paying for themselves.

## Remaining

**LOW — the `landmark-unique` waiver on `OpsHeader/BothStates`** is still the
right call (rendering one component twice necessarily duplicates its `<nav>`),
and it is now honoured by the runner rather than sitting in a JSON ledger.

**LOW — `npm test` is slower**: the story project boots a Chromium instance.
~12s for 223 stories locally, on top of the unit run.

## Validation Results

| Check | Result |
|---|---|
| Tests | Pass — 4034 (3811 unit + 223 story) |
| a11y | Pass — enforced at `error`, 0 violations |
| Gate proof | Fails on a stripped button label; passes when restored |
| Type check | Pass |
| Lint | Unchanged — 7 errors + 1 warning, all pre-existing in untouched files |
| `next build` | Pass |
| Token drift | Pass — all four outputs |
