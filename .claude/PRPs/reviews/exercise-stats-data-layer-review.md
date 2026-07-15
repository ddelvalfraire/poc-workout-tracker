# Review: Exercise Stats — Phase 1: Data Layer (local, pre-commit)

**Reviewed**: 2026-07-15
**Branch**: feat/exercise-stats-data-layer (uncommitted)
**Decision**: APPROVE (after fixes below applied)

## Summary
New read-only module `src/db/exercise-stats.ts` + tests + composite index migration. Scoring semantics verified consistent with `one-rep-max.ts` / `program-stats.ts` (effective-load scoring, strictly-greater ties, completed-only, tonnage rule, userId scoping on every query). Independent reviewer pass found 3 MEDIUM + 2 LOW; all MEDIUMs fixed in-place before commit.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM (all FIXED)
1. **Unstable pagination order** — `getExerciseSessions` ordered only by `startedAt` desc; ties could duplicate/drop sessions across pages. Fixed: `orderBy(desc(startedAt), desc(id))`.
2. **`mostReps` not metric-mode-gated** — a duration row carrying stray reps (write path doesn't forbid it) could claim the all-time rep record. Fixed: rep record now reps_weight-only, matching the load records; test added.
3. **NaN/Infinity pass through the pagination clamp** — `Math.min/max` propagate NaN into `.limit()/.offset()`. Fixed: `Number.isFinite` normalization with defaults; test added.

### LOW
4. **Cross-exercise isolation of the set-row query untested** — assessed as already covered: the suite asserts via PgDialect introspection that the set query's WHERE carries the composite `(id, source)` params; the mocked harness cannot verify actual row filtering. No change.
5. **Defensive null guards on `name`/`loggingType` look load-bearing but aren't** (inner join + NOT NULL columns). Comment added marking them defensive-only.

## Validation Results

| Check | Result |
|---|---|
| Type check (build + reviewer's tsc --noEmit) | Pass |
| Lint (changed files) | Pass — 0 errors, 0 warnings |
| Tests | Pass — 67 files / 1001 tests (18 new) |
| Build | Pass |

## Files Reviewed
- `src/db/exercise-stats.ts` — Added
- `src/db/exercise-stats.test.ts` — Added
- `src/db/schema.ts` — Modified (index)
- `drizzle/0014_peaceful_namor.sql` + meta — Added (generated)
