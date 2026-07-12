# PR Review: #37 — fix: only completed sessions consume a program day / advance the week

**Reviewed**: 2026-07-09 · **Branch**: fix/completed-days-count → main
**Decision**: REQUEST CHANGES (soft) → resolved (fixed in 6fffc34)

## Summary
Fix verified correct and complete: the two patched queries (`getNextProgramDay` logged set, `nextProgramWeek` daysDone) are the only sites inferring day-progress from workout rows; `nextProgramWeek`'s current-week max deliberately stays unfiltered so an in-progress instantiation pins the week; no cycleComplete edge cases with mixed rows.

## Findings
- **HIGH [FIXED]**: the select mock ignored `where()` predicates — a dropped `isNotNull(completedAt)` would ship silently (how the original bug escaped). The harness now captures predicates and walks drizzle queryChunks (columns as leaves, avoiding table back-reference false positives); tests assert daysDone and the logged set filter on `completed_at`, and that `current` deliberately does not. Full `getNextProgramDay` rotation test added.
- **MEDIUM (follow-up ticket)**: a >TTL abandoned row lets the hero re-offer the same day → possible duplicate unfinished rows for one (day, week). Correct trade for program integrity; the Unfinished section holds them and the conflict dialog covers the fresh case.
- **MEDIUM (follow-up ticket, pre-existing)**: `getExerciseHistoryBefore`/`getLastPerformance` don't exclude uncompleted sessions' sets from prescriptions/e1RM comparisons.
- **LOW**: `current = max(programWeek)` unfiltered — verified correct by design.

## Validation
tsc / lint / build pass; 16/16 in the extended file; 828 on merged main.
