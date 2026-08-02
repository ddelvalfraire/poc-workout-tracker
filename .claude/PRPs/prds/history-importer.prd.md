# History Importer — Strong & Hevy CSV → first-class training history

## Problem Statement

The single biggest switching cost for a lifter is years of history locked in
Strong or Hevy. Both apps export CSV. An importer converts that cost into a
switching reason: PRs, e1RM trends, Prev chips, and autoreg evidence light
up on day one. Direct user ask (2026-08-02): "work on importer".

## Source formats (header-driven, versions drift — parse defensively)

**Strong** (one row per set):
`Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps,
Distance, Seconds, Notes, Workout Notes, RPE` — dates local ("2024-01-15
17:32:11"), Weight in the account's display unit (file carries no unit
column — the user picks kg/lb at import), warm-ups appear as Set Order "W",
Duration like "1h 12m".

**Hevy** (one row per set):
`title, start_time, end_time, description, exercise_title, superset_id,
exercise_notes, set_index, set_type (normal|warmup|failure|dropset),
weight_kg (or weight_lbs by account), reps, distance_km, duration_seconds,
rpe`.

Synthetic example rows only in fixtures; never commit a real export.

## Mapping decisions

- Workout: name ← title/Workout Name; startedAt ← parsed wall time stored
  as-is (v1: no timezone reconciliation — history precision at the day
  level is what stats need; documented). completedAt ← start + Duration
  (Strong) / end_time (Hevy); spans clamp to ≤ 6h (the
  formatWorkoutDuration plausibility rule).
- Sets: reps + weight → canonical kg (unit from the header when the file
  declares it, else the import-time picker); warmup markers → setType
  'warmup' (never scores — matches app semantics); Hevy failure/dropset →
  'working'; Seconds/duration_seconds → metricMode 'duration'; distance →
  skipped with a per-row reason (cardio import is a non-goal v1). All
  imported sets are completed=true (these apps only log performed sets).
- Notes: workout + exercise notes land in the #92 columns. RPE dropped
  (workout sets don't store actual RPE — documented).
- NO program provenance (programDayId null) — imports are quick-log
  history; trained-only week/rotation logic untouched.

## Exercise matching (the hard part)

1. Normalize (lowercase, extract parenthetical equipment qualifiers as
   tokens, collapse whitespace/punctuation).
2. Exact/normalized match against the merged catalog (wger + user customs).
3. Curated alias table for top Strong/Hevy naming patterns ("Bench Press
   (Barbell)" → Barbell Bench Press, …) — a tested pure map, grown over
   time.
4. Unmatched → AUTO-CREATE a custom exercise (source 'custom', named
   verbatim) so no performed set is ever dropped; the preview lists these
   prominently. Cap: ≤ 100 created customs per import (abuse guard).

## Flow (forced-confirm)

1. /settings → Import history: file input (≤ 20MB), source auto-detected
   from headers, unit picker only when the file doesn't declare one.
2. **Dry-run preview** (server parse, nothing written): workout count,
   date range, set count, matched vs to-be-created exercises (named),
   skipped rows with reasons.
3. **Confirm import** → import_batches row (id, userId, source, fileName,
   workoutCount, setCount, createdAt) + workouts.importBatchId (nullable,
   migration) stamped on every imported workout. Duplicate guard: a
   workout whose (startedAt, name) already exists for the user is skipped
   and counted.
4. **Undo**: "Remove this import" deletes the batch's workouts; created
   customs are LEFT in place (deleting could orphan re-logged history —
   documented).

## What We're NOT Building (v1)

Cardio/distance import, per-set RPE, routine/template import, other
formats (Garmin/Fitbod), timezone reconciliation, export (separate
feature), Hevy superset reconstruction (workouts don't store supersets —
dropped + noted in preview).

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Fidelity | Real Strong + Hevy exports round-trip with zero dropped performed sets (skips only for documented reasons) | Synthetic fixture suites + manual dogfood file |
| Stats light-up | Imported history feeds Prev/e1RM/PRs with no extra work | Existing completed-only reads; manual check |
| Reversible | Undo removes exactly the batch's workouts | Batch tests |
| Honest preview | Preview counts == confirmed import counts | Shared dry-run/commit code path |

## Open Questions

- [ ] Multi-file/incremental imports — the duplicate guard covers overlap;
  formal "sync" is out.
