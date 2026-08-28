# PR Review: #329 — fix(logger): the bar picker says "bar" once, and the live headline says something

**Reviewed**: 2026-08-28
**Author**: ddelvalfraire
**Branch**: claude/weights-workout-display-issues-3f9a1f → main
**Decision**: APPROVE (after fixes applied in-branch)

## Summary

Two copy/markup fixes, 39/28 lines across two files. No logic, no data, no
network, no auth surface touched. One real gap found — the rendered fact the
PR exists to fix had no test — and one naming risk in the catalog. Both fixed
in-branch; everything else is clean.

## Findings

### CRITICAL
None. The diff contains no credentials, no user input handling, no queries,
no `dangerouslySetInnerHTML`, no new dependency.

### HIGH
None.

### MEDIUM

1. **`plate-sheet.tsx` — the fix had no regression guard.** The whole PR is a
   claim about rendered markup ("the pill prints a bare number, the legend
   carries the word"), and nothing asserted it. `plate-sheet.test.ts` covers
   only the pure helpers; the message-level assertions in
   `session-surfaces-copy.test.tsx` would still pass if the pill went back to
   printing `{weight} {unit} bar`, because that message is still in the
   catalog — it is the aria-label now.
   **Fixed**: added a `PlateSheet bar picker` block to
   `session-surfaces-copy.test.tsx` that renders the real sheet and pins three
   facts — legend says "Bar (kg)", the pill's text node is `20`, each pill's
   accessible name is still "20 kg bar". Mutation-checked: reverting the pill
   to the full phrase fails the first test, restoring it passes.

2. **`messages/en.json` — `barLegend` sat one letter from `barsLegend`.** Two
   near-identical keys in one namespace ("Bar (kg)" for the picker, "Bars
   (kg)" for the gear editor) is a trap for a translator working the catalog
   without the screen.
   **Fixed**: renamed to `barPickerLegend`, and the component comment now
   states why one is singular (you pick one) and the other plural (you own
   several).

### LOW

3. **`StatusHero.headline.live` now duplicates `context.driftFallback`** —
   both read "Pick up where you left off." Verified harmless, not changed:
   `home-status.ts:186` sets the priority order `live > done > block > program
   > drift > fresh` with "Each state owns the screen alone", so the two can
   never render together. Worth remembering if that precedence ever softens.

4. **Build not verified locally.** `npm run build` cannot run in this worktree
   — `node_modules/next` is absent (worktree has a partial install). The
   change is JSX + a JSON string, and `tsc` is clean, so the risk is
   negligible; CI is the backstop.

## Notes on what was checked and found clean

- **A11y**: the `<fieldset>/<legend>` pair now gives the picker a group name
  it never had (net improvement), and matches `GearPillGroup` directly below.
  WCAG 2.5.3 Label in Name holds — the accessible name "20 kg bar" contains
  the visible label "20". The `No bar` pill keeps its visible text and gained
  `whitespace-nowrap` so the one remaining worded pill can't wrap either.
- **Design system**: no colour, radius, spacing or type literal added; pills
  reuse the existing class string verbatim. `npm run tokens:check` clean on
  all four generated targets. No new card shell (DESIGN.md de-card rules).
- **i18n**: no new bare literal — `i18n:report` holds at 19 literals across 13
  files, none in the changed file. `barOption` is still referenced (as the
  aria-label), so no orphaned key.
- **Immutability, error handling, nesting, file size**: unchanged by this diff.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Tests (`vitest run`) | Pass — 483 files, 5961 tests |
| Tokens (`tokens:check`) | Pass |
| i18n (`i18n:report`) | Pass — no new literals |
| Build (`next build`) | Skipped — no `next` in this worktree's node_modules |

## Files Reviewed

- `src/app/workout/new/plate-sheet.tsx` — Modified
- `messages/en.json` — Modified
- `src/app/workout/new/session-surfaces-copy.test.tsx` — Modified (added by this review)
