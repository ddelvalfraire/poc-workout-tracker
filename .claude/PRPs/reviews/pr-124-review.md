# PR Review: #124 — feat: goals + streaks

**Reviewed**: 2026-07-31
**Author**: ddelvalfraire
**Branch**: feat/goals-streaks → main
**Decision**: APPROVE (published as COMMENT — author cannot approve own PR)

## Summary
The facts-about-targets philosophy held: every progress read reuses an
existing truth (e1RM records/trend, bodyweight denorm, completed workouts vs
scheduled weekdays) — no parallel stats. The streak truth table covers the
degenerate cases that usually bite (zero-training weeks never extend even
under grace; current week counts only elapsed scheduled days; empty schedule
honest-empties). Grace is the user's per-goal setting as directed, default
forgiving. Achievement is fails-soft and idempotent at the SQL level
(achieved_at IS NULL), so the push fires exactly once and can never fail a
workout save. Pace projection stays silent over speculative (slope/points/
horizon gates). The targetWeeks deviation is correct — without it a
consistency goal is unachievable, which the seam requires. list_goals lands
in the auto-run read tier with the partition test updated.

## Findings

### CRITICAL / HIGH / MEDIUM
None

### LOW
- Client-local display weeks vs UTC server achievement weeks — documented
  accepted drift; a boundary-hour finish may celebrate a week early/late by
  timezone; cosmetic at present scale.
- Denormalized exercise_name on strength goals won't follow a catalog
  rename — consistent with workout_exercises' existing denorm choice.
- MAX_ACTIVE_GOALS=20 is unconfigurable — fine as an abuse guard.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass |
| Tests | Pass — 124 files, 1830 tests (60 new) |
| Build | Pass (/goals emits) |
| Migration | Generated only (0029); applied with 0028 at deploy |

## Files Reviewed
- src/db/schema.ts, drizzle/0029_*, src/db/goals.ts(+test)
- src/lib/goal-input.ts, goal-progress.ts, goals.ts (+tests) — validation, streaks, pace
- src/app/goals/* — page, create, actions
- src/app/workout/actions.ts, src/app/actions.ts — achievement seams
- src/app/page.tsx, workout/[id]/page.tsx, exercises/[source]/[id]/page.tsx,
  components/streak-chip.tsx, charts/trend-chart.tsx — surfaces
- src/lib/mcp/goal-tools.ts(+test), tools.ts, coach/tool-policy.ts — MCP
