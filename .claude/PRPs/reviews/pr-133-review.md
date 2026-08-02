# PR Review: #133 — feat: Strong/Hevy CSV history importer

**Reviewed**: 2026-08-02
**Author**: ddelvalfraire
**Branch**: feat/history-importer → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
This feature eats untrusted user files, and the boundaries hold: 20MB cap,
header-driven format detection (422 on unknown), hand-rolled RFC-4180 parser
tested against the classic edges (quoted commas/newlines, escaped quotes,
BOM, CRLF, unterminated quotes), user-scoped single-use Redis tokens so a
foreign token is a cache miss (410), full guard ladders on all three routes.
Correctness spine is the shared plan path: commit re-plans against the
cached raw parse, so preview counts equal committed counts by construction
and duplicates are re-detected at commit time. Two subtle bugs were caught
during the build itself (undo ordering vs the SET NULL FK; custom-create
convergence via onConflictDoNothing + re-read). Deviations are argued, not
slipped: truncate-not-reject on over-cap notes (refusing a file over one
long note drops performed history) and batch-row-first commit (mid-import
failure still leaves an undo handle).

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Wall times stored as UTC-naive per PRD — imported evening workouts can
  land on an adjacent UTC day for stats' day-bucketing; documented v1
  trade, revisit with timezone work.
- guessCategory fallback 'Chest' for created customs is arbitrary but
  user-editable afterward; documented.
- Redis unavailability 503s preview (no degraded path) — acceptable: the
  flow is stateful by design and Redis is already load-bearing for coach.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 145 files, 2015 tests (~100 new, all fixtures synthetic) |
| Build | Pass (3 routes + /settings/import emit) |
| Migration | Generated only (0030); apply at deploy |

## Files Reviewed
- src/lib/import/* (+7 test files) — csv/detect/strong/hevy/match/types/set-builder/preview-cache
- src/db/import.ts(+test), schema.ts, drizzle/0030_*
- src/app/api/import/{preview,commit,[batchId]}/route.ts(+tests)
- src/app/settings/import/*, settings/page.tsx
