# Review: fix/sticky-cta-swallowed-tap

**Reviewed**: 2026-08-21
**Branch**: fix/sticky-cta-swallowed-tap → main
**Decision**: REQUEST CHANGES (one HIGH, pre-existing but in scope of the fix's own claim)

## Summary

Anchors the logger's sticky bar so focus-driven reflow cannot move it out from
under a tap, repairs nine e2e specs that had drifted from the UI, and fixes one
stale unit assertion. The app change is two Tailwind classes, pinned by a spec
that provably fails by the exact reported deltas without them.

The HIGH below is not introduced by this branch, but it is the same defect in a
second place, and this branch's own commit message claims to fix "the swallowed
tap" — so it needs a decision rather than silence.

## Findings

### CRITICAL
None.

### HIGH

**H1 — The same swallowed-tap bug survives on the inline "+ Add set" button.**
`src/app/workout/new/workout-logger.tsx`

The fix anchors the sticky bar, so nothing in the bar can be displaced. It does
nothing for content that sits *below* the WeightStepper rail inside the
scrolling flow — and "+ Add set" is exactly that.

Measured on this branch, phone viewport, weight field focused:

    + Add set  y 453 (focused) -> 393 (blurred)   delta -60
    one real click with focus still in the field: set 2 is never added

Same mechanism, same silence. `e2e/repeat.spec.ts` avoids it by adding both set
rows before filling either — a legitimate user order, and one that stays correct
however this is resolved, but the bug is still live for real users.

Fixing it properly is a design decision, not a mechanical change, because the
rail must stop affecting flow. Three viable directions, none free:

1. Reserve the rail's height on every set row. Bulletproof; costs ~60px per row
   (a 4-set exercise grows by 240px).
2. Reserve one rail-sized slot per exercise card, always present, and render the
   rail into it. Costs ~60px per card, but moves the rail off the focused row —
   it no longer "rides under whichever weight input holds focus".
3. Overlay the rail (absolute positioning). Zero reflow, but mousedown would
   land on a ± button instead of whatever is underneath — actively worse than a
   swallowed tap, since it would change the weight.

Recommend (2). Not applied here: it changes visible product design in a repo
with an explicit design contract, so it wants the owner's call.

### MEDIUM

**M1 — `detailUrl()` hardcodes the origin.** `e2e/logger.ts`
`http://localhost:3000` is duplicated from `use.baseURL` in playwright.config.
Pre-existing across the specs, but this helper is now the natural single place
to derive it. Not changed here to keep the diff to the failing tests.

**M2 — Two assertions were retired rather than fixed.** Both are documented at
their sites, both reduce coverage:
- `analytics`: the `$pageview` capture assertion. Locally the SDK issues
  `/_i/flags/` but never `/_i/e/`, within 12s of load or of a second navigation.
  See O1 below — this may be a real product gap, not a test artifact.
- `visual`: the `program-templates-phone` baseline, deleted. It was a fullPage
  snapshot of `listPublicTemplates()`, a live fetch of wger's public routines,
  so it went red whenever strangers renamed their routines. The zoning it was
  meant to guard is unit-tested against fixtures in `lib/wger-template-shelf.ts`.

### LOW

**L1 — `finishWorkout()` can take 40s to fail.** `e2e/logger.ts` — 20s race plus
a 20s assertion. Correct, just slow on the failure path.

**L2 — `acceptRequiredConsents()` uses a non-retrying `count()`.** `e2e/auth.ts` —
if `#consent-tos` were client-rendered, a transient 0 would skip consent. It is
server-rendered today, and the failure would be loud (the home gate bounces the
spec back to /welcome), so this is a note, not a defect.

## Observations (not defects in this branch)

**O1 — No client-side `$pageview` capture was observed at all.** Not a test
problem: `page.on('request')` saw zero POSTs to `/_i/e/` on a public app page,
across load and a second navigation, while `/_i/flags/` round-tripped fine.
Server-side capture (layer 1) and read-back (layer 3) both work. If the client
is genuinely not capturing pageviews, the acquisition funnel is blind.

**O2 — Stale comment in `next.config.ts`.** It says
"service-worker-register.tsx still registers /public/sw.js". It registers
`/serwist/sw.js`, and there is no file in `public/`. Left alone as out of scope.

## Validation

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Unit tests (`vitest`) | Pass — 4934/4934, 408 files |
| E2E (`playwright`) | Pass — 20/20 |
| `tokens:check` | Pass |
| `legal:check` | Pass |
| `offline:check` | Pass |
| Regression property | Verified — spec fails by the exact deltas with the two classes reverted |

## Files Reviewed

| File | Change |
|---|---|
| `src/app/workout/new/workout-logger.tsx` | Modified — the fix (2 classes + comments) |
| `src/db/save-program.test.ts` | Modified — stale assertion |
| `e2e/logger.ts` | Added — shared logger interactions |
| `e2e/sticky-cta.spec.ts` | Added — regression spec |
| `e2e/auth.ts` | Modified — consent gate detection |
| `e2e/{analytics,edit-delete,last-time,pr,programs,pwa,repeat,visual,workout}.spec.ts` | Modified — suite repair |
| `e2e/visual.spec.ts-snapshots/*.png` | 2 regenerated, 1 deleted |
