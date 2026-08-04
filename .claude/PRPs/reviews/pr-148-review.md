# PR Review: #148 — feat: verdicts + deltas (UI audit Arc B)

**Reviewed**: 2026-08-03
**Author**: ddelvalfraire
**Branch**: feat/verdicts-deltas → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The honesty discipline held under celebration pressure, which is this
arc's real risk. The PR-comparison extraction (compareExercises) kept
the exact composite-identity and like-beats-like scoring rules and is
now the single source for both the headline and the goal logic — no
second scoring truth was minted. The most-consistent-month claim only
renders when strictly true; deload weeks render hollow with a DL tag
so a planned light week can never read as slacking; sparkline volt
dots mark new running maxes only (baseline unmarked), keeping volt =
achievement. The arc's one query addition (previous same-name
completed workout) is documented at both the helper and call site and
skipped for unnamed workouts. kg-unit identity is protected in the
delta display (1dp rounding so Epley decimals never leak). The
workout share-card route mirrors the pr-card route's auth/404/header
discipline and is tested. HistoryList reuse resolved with one additive
optional prop — home renders byte-identical.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- "SHOWING UP." renders even at low adherence — the context sentence
  carries the honest percentage; acceptable, revisit copy on feedback.
- Days-left suffix correctly restricted to calendar mode (meaningless
  in a rolling window) — noted as intentional.
- Stat-tile dt/dd order fixed via CSS order utilities — a drive-by
  validity fix inside a touched component, acceptable scope.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 168 files, 2343 tests (62 new) |
| Build | Pass |
| Migration | None |

## Files Reviewed
- src/app/stats/page.tsx, volume-view.ts, plan-bullet-list.tsx,
  window-toggle.tsx, src/lib/volume-window.ts — Modified/Added
- src/app/workout/[id]/page.tsx, summary-view.ts(+test) — Modified/Added
- src/db/workouts.ts — getPreviousCompletedWorkout (documented read)
- src/app/api/cards/workout/[id]/route.tsx(+test), lib/cards/card-data.ts
- src/app/history/page.tsx, history-view.ts(+test), history-list.tsx
- src/app/programs/[id]/stats/page.tsx, stats-view.ts — Modified
