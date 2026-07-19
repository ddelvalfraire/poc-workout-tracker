# PR Review: #88 — fix: active-logger quick fixes

**Reviewed**: 2026-07-18
**Author**: ddelvalfraire
**Branch**: fix/logger-quick-fixes → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
Four small, well-scoped UX fixes in the live logger. Logic verified against both
`previousChipLabel` call sites; the `?from=` back-navigation param is whitelisted
to in-app `/workout/*` paths so it can never become an arbitrary redirect. One
portability issue found during review (WebKit collapsing a synchronous `select()`
after pointer-initiated focus) was fixed in-branch with an rAF deferral.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
- ~~`select()` called synchronously in `onFocus` is collapsed by the subsequent
  mouseup on WebKit (the app's primary platform is an iOS PWA)~~ — **fixed in
  f21d8a4** via `requestAnimationFrame` deferral in both handlers.

### LOW
- `previousChipLabel` returning null for reps-only ghosts on `weight_reps` also
  disables the chip's tap-to-fill for plan rep-ranges without a load. Intended
  trade-off (the user explicitly asked for the dash); the set-circle
  tap-to-accept and the input placeholder still carry the ghost.
- Collapse button uses `aria-expanded` without `aria-controls`; matches the
  existing collapsed-card button pattern, acceptable for now.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint (changed files) | Pass (repo-wide lint fails from pre-existing `.claude/worktrees` copies) |
| Tests | Pass — 87 files, 1287 tests |
| Build | Pass |

## Files Reviewed
- src/lib/format.ts — Modified (previousChipLabel loggingType param)
- src/lib/format.test.ts — Modified (new partial/bodyweight cases)
- src/app/workout/new/workout-logger.tsx — Modified (chip call sites, collapse button, select-on-focus)
- src/app/workout/new/stats-sheet.tsx — Modified (?from= link)
- src/app/exercises/[source]/[id]/page.tsx — Modified (validated backHref + pagination)
