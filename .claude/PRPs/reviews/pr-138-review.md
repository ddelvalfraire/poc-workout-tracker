# PR Review: #138 — feat: trophies

**Reviewed**: 2026-08-02
**Author**: ddelvalfraire
**Branch**: feat/trophies → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The two properties that make trophies trustworthy both hold. Once-ever:
ON CONFLICT (user_id, kind) DO NOTHING RETURNING serves as idempotency and
push gate in one primitive — no race can double-push. Retroactive-quiet:
attribution demands the triggering fact involve the just-finished workout
(record's workoutId, count crossing, tonnage delta, streak
recompute-without-this-workout), strictly tighter than the goals session
window, so imports and feature-ship backfills can only ever stamp silently.
The canonical-lift map is curated with per-exclusion rationale (RDL ≠
deadlift, incline ≠ bench, barbell-only OHP per the resolved open
question) and shares the importer's normalizer for customs — one
normalization truth. Boundary math tested at entry precision. Cost
discipline: earned families skip reads forever; the lifetime-tonnage
aggregate is transparently the one expensive read and self-retires.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Trophy names stay lb-culture for kg users ("315 Squat Club") with
  unit-correct context lines — a deliberate branding call, noted.
- Streak trophies use grace 1 fixed (goals default) rather than any
  per-goal setting — reasonable; revisit only on feedback.
- MCP exposure deferred (coach can't see trophies) — follow-up noted.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 149 files, 2105 tests (42 new) |
| Build | Pass (/trophies emits) |
| Migration | Generated only (0032); apply at deploy |

## Files Reviewed
- src/lib/trophy-kinds.ts, trophies.ts (+test) — kinds, rules, composition
- src/db/trophies.ts(+test), schema.ts, drizzle/0032_*
- src/app/trophies/page.tsx, workout/[id]/page.tsx, goals/page.tsx
- src/app/workout/actions.ts, src/db/import.ts — seam wiring
- src/lib/import/match.ts — normalizer export
