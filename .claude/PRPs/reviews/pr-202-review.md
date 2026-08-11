# PR Review: #202 — feat: rolling e1RM anchors rpe-target loads (RPE plan slice 1)

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/rpe-slice-1-rolling-e1rm → main
**Decision**: APPROVE

## Summary
The plan's smallest slice: a pure windowed e1RM replaces the monotonic all-time best as the rpe-target anchor. Blast radius verified single-scheme (`e1rmKg` has exactly one consumer). Query extension is additive.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
- **Documented behavior, not a defect**: if every qualifying set across the whole 5-session window carries RIR > 3, the rolling e1RM is null and rpe-target loads go ghost (no target) where the old `bestSet` produced a stale value. This is silence-over-corruption by design — an rpe-target scheme prescribes at ~RPE 8 (RIR ~2), so five consecutive all-easy sessions is pathological — but if it bites in practice, the fallback (face-value inclusion of far-from-failure sets, accepting underestimation) is a one-line change.

### LOW
- Session ordering keys on `startedAt` (consistent with the query's own `before` comparison); a backdated workout moves its window position, same accepted exposure as the autoreg history window.

## Correctness notes
- RIR credit uses `estimate1RM(reps + rir, weight)`, inheriting the reps===1 no-inflation contract (pinned in tests).
- Warmups, incomplete sets, reps > 12, RIR > 3 excluded; amrap/backoff included — amrap sets are the highest-quality e1RM evidence.
- No-effort rows count at face value: users who never touch the chips keep identical-shaped (windowed) targets; nobody's targets vanish for not logging RPE.
- Per-session top selected by credited e1RM, then newest-5 average — a bad recent stretch lowers the signal (pinned by the window-eviction test).

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Lint | Pass |
| Tests | Pass (3,045 / 211 files; 8 new) |

## Files Reviewed
- `src/lib/rolling-e1rm.ts` / `.test.ts` — Added
- `src/db/workouts.ts` — history query +5 additive columns
- `src/db/programs.ts` — bestSet → rollingE1rm swap in deriveDayPrescription
- `src/db/instantiate-program.test.ts` — fixture enrichment (same expectations)
