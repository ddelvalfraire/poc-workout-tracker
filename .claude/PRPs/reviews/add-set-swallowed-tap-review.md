# Review: fix/add-set-swallowed-tap

**Reviewed**: 2026-08-21
**Branch**: fix/add-set-swallowed-tap → main
**Decision**: APPROVE (no CRITICAL, no HIGH)

## Summary

Closes H1 of the sticky-CTA review — the swallowed tap that survived on
"+ Add set" — and clears every remaining MEDIUM/LOW/observation from that
review that can be cleared without production credentials. Also repairs one
spec that main broke.

The app change is small: the focus-gated WeightStepper rail stops living in
the scrolling flow and docks in the sticky bar. Everything else is harness
and comments.

## What changed

| Commit | |
|---|---|
| `83006e7` | fix(logger): dock the weight rail in the sticky bar |
| `944b24e` | test(e2e): one origin for the harness, and two waits that were wrong |
| `0b9bb89` | test(e2e): match the PREV column's server-truth gate |
| `a5b3db4` | docs: correct two comments that describe behaviour that is not current |
| `ed38b32` | refactor(logger): one definition for a set's plan ghost |
| `5b62bb7` | merge main; conflict in `e2e/analytics.spec.ts` resolved to main's version (see M2/O1) |

## Prior review, item by item

| Item | State |
|---|---|
| H1 — swallowed tap on "+ Add set" | **FIXED.** Rail docks in the bar; the bar is bottom-anchored, so it grows upward and the scrolling flow never moves. Pinned on phone and desktop. |
| M1 — `detailUrl()` hardcodes the origin | **FIXED.** Five hardcoded copies now derive from `e2e/app-origin.ts`; `E2E_PORT` moves the whole harness, dev server included. |
| M2 — analytics `$pageview` assertion retired | **FIXED ON MAIN, not here.** `1c7e643` landed a real assertion while this branch was in flight. That supersedes the comment correction this branch had made, so the merge takes main's `e2e/analytics.spec.ts` wholesale and this branch contributes nothing to that file. |
| M2 — `program-templates-phone` baseline deleted | **STANDS.** It was a fullPage snapshot of a live wger fetch; it went red when strangers renamed routines. The zoning is unit-tested against fixtures. Deleting it was right. |
| L1 — `finishWorkout()` 40s failure path | **FIXED.** Full budget only on the branch that still has a round-trip left. ~40s → ~22s worst case; passing runs unaffected. |
| L2 — non-retrying `count()` on the consent gate | **FIXED.** Waits for /welcome to commit to one of its two outcomes before reading the DOM. |
| O1 — "no client-side `$pageview` capture at all" | **CLOSED ON MAIN (`1c7e643`), and it was not a product gap.** The root cause is `isLikelyBot()`: posthog-js silently drops every event when it fires, and Playwright always trips it (`navigator.webdriver`, HeadlessChrome UA and brands) — the SDK boots fully while sending nothing. Clearing those signals in an `addInitScript` makes the real visitor path observable, and the `$pageview` round-trips 200. Independently, this branch's own reading of the SDK found the second half of the puzzle and main's commit confirms it: remote config moves ingest from `/_i/e/` to `/_i/i/v0/e/` mid-load, so the original watcher was pinned to a path the SDK had already left. The acquisition funnel was never blind. |
| O2 — stale `next.config.ts` comment | **FIXED.** Both halves were stale: the worker is live, and it is `/serwist/sw.js`, not `/public/sw.js` (public/ has no worker at all). |

## New findings

### CRITICAL / HIGH
None.

### MEDIUM

**N1 — the ± rail has never been reachable by keyboard.** `onBlur={() =>
setStepperSetId(null)}` unmounts the rail the moment focus leaves the weight
input, so Tab can never land on the ± buttons. **Pre-existing and unchanged
by this branch** — the same blur gate applied when the rail was inline — but
it is worth naming here because this branch's e2e locates those buttons by
role, which makes the control look covered when only its rendering is. The
fix is a `relatedTarget` check so focus moving INTO the rail does not dismiss
it; that is a different thing from the "delay blur" workaround ruled out for
the tap bug, and it changes the focus lifecycle, so it wants its own change.

### LOW

**N2 — the bar occludes ~50–70px more while a weight input is focused.**
Direct consequence of docking, accepted when the direction was chosen. The
browser scrolls a focused input into view, and a phone keyboard already
occludes more, so this is a note rather than a defect.

**N3 — `stepperTarget` scans exercises × sets each render.** Trivial at a
session's scale. Flagged only so a loop in the render path is not a surprise.

## Observations

**O3 — `CLAUDE.md` gains a `nextjs-agent-rules` block on every `next dev`.**
Restored twice during this work. The block argues in its own text that it
should be committed; that is the file talking, not a decision. It is noise in
the diff of anyone who runs the suite, and worth settling one way or the
other.

## Validation

| Check | Result |
|---|---|
| Unit (`vitest`) | Pass — 4956/4956, 411 files |
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| E2E (`playwright`) | Pass — 19 passed, 3 skipped (analytics, keyless by design), 0 failed |
| `tokens:check` / `legal:check` / `offline:check` | Pass |
| Merges cleanly into `main` | Yes |

The regression property holds both ways: the two new tests fail by the
reported delta (y 453 → 393, Set 2 never added) with the rail returned to the
set row, and `last-time` fails on main as shipped.
