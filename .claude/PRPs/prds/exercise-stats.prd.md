# Exercise Stats — per-exercise history, records & trend

## Problem Statement

A lifter mid-session wants to know "what did I do last time / is this an all-time PR?" for the exercise in front of them, and outside the gym wants to browse any exercise's long-term story. Today an exercise's history is siloed inside each program block's stats page — nothing stitches performance across programs, restarts, clones, or ad-hoc workouts, so the most basic training questions are unanswerable in the UI.

## Evidence

- Program stats (`/programs/[id]/stats`) compute PRs only relative to a block baseline (`src/db/program-stats.ts:268`) — "heaviest I've ever benched" does not exist anywhere.
- The logger already ghost-fills last performance (`get_last_performance`), proving the mid-session lookback need; it just stops at one prior session.
- Strong and Hevy both converged on the identical pattern (tap exercise name mid-workout → detail view with History/Charts/Records; same view reachable from an exercise library) — strong prior that this is the load-bearing surface for a tracker.

## Proposed Solution

One feature, two entry points. A per-exercise stats surface computed all-time across every completed workout: session-grouped history, all-time records, and an e1RM trend. Mid-workout, tapping the exercise's name opens a bottom sheet (History + Records, "View full stats →" link) — zero new chrome on the logger, consistent with the existing plate/rest/exercise sheet idiom. Outside the workout, a standalone `/exercises` searchable library leads to `/exercises/[source]/[id]` detail pages rendering the full view including the trend chart. The sheet and page share the same data payload and view components. Live PR detection rides on the same all-time-best query: completing a set that beats the record gets flagged inline in the logger.

## Key Hypothesis

We believe an always-reachable per-exercise stats view will replace out-of-app history archaeology (scrolling old workouts, guessing PRs) for the app's user. We'll know we're right when mid-workout "what's my best?" questions are answered via the sheet without leaving the session, and PR sets are recognized at the moment they happen.

## What We're NOT Building

- **Duration/distance records & charts** — duration-mode sets show in plain history, but best time/distance/pace records land with the cardio feature (schema already supports it; scoped out to keep v1 lean).
- **Per-program filtering on the detail page** — v1 is all-time only; block-scoped analysis already exists at `/programs/[id]/stats`.
- **Exercise instructions/media ("About" tab)** — wger descriptions are a separate enrichment; this feature is performance data.
- **Editing history from the stats view** — history rows link to `/workout/[id]`; edits stay on the workout surfaces.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Mid-workout stats access | Sheet opens from any logger exercise without pausing/discarding the session | Manual + e2e |
| All-time correctness | Records match hand-computed values across logging types (bodyweight, assisted, machine-null-weight) | Unit tests on derive functions |
| PR detection | A set beating the all-time e1RM is flagged in-session, once, on completion | Unit + manual |
| Detail page load | History paginated; no unbounded all-time query in the request path | Code review |

## Open Questions

- [ ] Trend chart granularity on the detail page: per-session points vs. weekly best (per-session proposed; sparkline downsamples).
- [ ] Does the `/exercises` library list every catalog exercise or only exercises with logged history? (Proposed: history-first list with search over the full catalog.)
- [ ] PR detection tie-breaking: strictly-greater e1RM only (matches `derivePR`'s strictly-greater rule) — confirm same rule for heaviest-weight and rep records.

---

## Users & Context

**Primary User**
- **Who**: The app's owner-lifter (sole user of this POC), training off programs plus occasional ad-hoc sessions.
- **Current behavior**: Relies on ghost values for the immediately previous session; scrolls old workouts or program stats to reconstruct anything older.
- **Trigger**: Mid-set rest ("what's my best here?") and between-session planning ("how has this lift moved across blocks?").
- **Success state**: Tap the exercise name → answer in under two seconds, without risking the active session.

**Job to Be Done**
When I'm resting between sets (or planning at home), I want to see this exercise's full history and records, so I can pick the right load and know when I've set a PR.

**Non-Users**
Multi-user/social concerns (leaderboards, sharing) — out of scope for a single-user POC.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | All-time exercise history query keyed on composite `(source, wgerExerciseId)` | Identity discipline — custom id 42 must not pollute wger #42 |
| Must | Records derive: best e1RM, heaviest weight, most reps, best session volume (reps_weight) | The feature's core answer |
| Must | Mid-workout sheet: recent history + records + link out, opened by tapping exercise name | The no-bloat entry point |
| Must | `/exercises` library (search) + `/exercises/[source]/[id]` detail page | "Reachable outside" requirement |
| Must | Live PR detection on set completion in the logger | Rides the same all-time-best data; the moment of delight |
| Should | e1RM trend chart on the detail page (sparkline) | Long-term story; primitives exist |
| Should | Paginated session-grouped history tab | Unbounded all-time query is the one real footgun |
| Could | "Last 3 sessions" summary block in the sheet | Cheap once history query exists |
| Won't | Duration/distance records, About tab, per-program filters | See "NOT building" |

### MVP Scope

Phases 1–4 below, in order. The hypothesis is testable after Phase 3 (both entry points live); Phase 4 (PR detection) completes v1 per scope decision.

### User Flow

1. **In-session**: logger → tap exercise name → sheet (records at top, recent sessions below) → optional "View full stats →" → detail page → back, session intact (draft persistence already survives navigation).
2. **Outside**: app nav → `/exercises` → search/pick → detail page (records, trend chart, paginated history) → history row → `/workout/[id]`.
3. **PR moment**: complete a set beating all-time e1RM → inline PR flag on the set row.

---

## Technical Approach

**Feasibility**: HIGH — every hard sub-problem already has a solved twin in the codebase.

**Architecture Notes**
- **Identity**: filter on composite `(source, wger_exercise_id)` everywhere (`workout_exercises.source`, schema.ts:52). Same discipline as `exercise-alternatives`.
- **Query shape**: flat join `sets → workout_exercises → workouts` filtered by `userId`, `completedAt IS NOT NULL`, `sets.completed = true`, composite exercise match. Completed-only counting is a standing invariant (provenance rule).
- **Index**: add composite `(wger_exercise_id, source)` index on `workout_exercises` in the same migration — this feature inverts the access path (exercise-first) and the column is currently unindexed.
- **Scoring**: extract the per-set effective-load/e1RM scorer from `program-stats.ts` into a shared lib (alongside `one-rep-max.ts`) rather than re-derive. Never read raw `sets.weight` — semantics vary by `logging_type` (bodyweight-added, assisted-subtracted, ignored/null machine stacks). Reps-fallback and null-weight handling come with it.
- **Aggregation pattern**: flat SQL select → pure TypeScript derive functions (per-session best set → records + trend points), matching the `program-stats.ts` / `stats-view.ts` style. Pure, unit-testable.
- **UI reuse**: bottom sheet follows `plate-sheet`/`rest-sheet`; library search reuses the exercise picker's machinery; trend renders via `sparkline.ts`.
- **PR detection**: logger loads the exercise's current all-time best (piggybacks the sheet payload or last-performance fetch); comparison is a pure function on the completed set; strictly-greater wins (mirrors `derivePR`).

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scorer extraction subtly changes program-stats results | M | Extract with characterization tests first; program-stats' existing tests must pass unchanged |
| Unbounded history payload on long-lived accounts | M | Paginate history; records/trend computed from a capped or aggregated query |
| PR flag misfires for non-reps_weight or null-weight sets | M | PR detection gated to reps_weight, e1rm-scorable sets only; unit-test the gate |
| Logger touch-target conflict (name tap vs. replace button) | L | Name tap is a distinct hit area; replace icon unchanged |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Data layer | Exercise-stats query, records/trend derive functions, index migration (scorer already shared in `lib/one-rep-max.ts`) | complete | - | - | [plan](../plans/completed/exercise-stats-data-layer.plan.md) · [report](../reports/exercise-stats-data-layer-report.md) |
| 2 | Library + detail page | `/exercises` search list and `/exercises/[source]/[id]` full stats page | complete | with 3 | 1 | [plan](../plans/completed/exercise-stats-pages.plan.md) · [report](../reports/exercise-stats-pages-report.md) |
| 3 | Logger sheet | Tap-name → History/Records sheet with link-out | complete | with 2 | 1 | [plan](../plans/completed/exercise-stats-logger-sheet.plan.md) · [report](../reports/exercise-stats-logger-sheet-report.md) |
| 4 | PR detection | Inline all-time-PR flag on set completion | in-progress | - | 1, 3 | [plan](../plans/exercise-stats-pr-detection.plan.md) |

### Phase Details

**Phase 1: Data layer**
- **Goal**: One correct, reusable source of truth for per-exercise all-time stats.
- **Scope**: Extract per-set scorer from `program-stats.ts` (characterization tests; program-stats tests unchanged); `src/db/exercise-history.ts` query keyed on `(source, id)` + completed-only; pure derive functions for records, per-session bests, trend points; migration adding `(wger_exercise_id, source)` index.
- **Success signal**: Derive functions unit-tested across logging types; existing program-stats suite green.

**Phase 2: Library + detail page**
- **Goal**: The standalone surface.
- **Scope**: `/exercises` (searchable, history-first list), `/exercises/[source]/[id]` (records, sparkline trend, paginated session-grouped history linking to `/workout/[id]`). Shared view components consumable by the sheet.
- **Success signal**: Any logged exercise browsable end-to-end; duration-mode exercises show history without records.

**Phase 3: Logger sheet**
- **Goal**: The zero-bloat in-session entry point.
- **Scope**: Exercise name becomes tappable; bottom sheet (existing sheet idiom) with records + recent sessions + "View full stats →"; session/draft untouched by open/navigate.
- **Success signal**: Sheet opens mid-session without pausing/discarding; replace flow unaffected.

**Phase 4: PR detection**
- **Goal**: Recognize the PR at the moment it happens.
- **Scope**: All-time-best preload per logger exercise; pure comparison on set completion (reps_weight, e1rm-scorable only, strictly-greater); inline flag on the set row.
- **Success signal**: Beating the record flags exactly once; non-scorable sets never flag.

### Parallelism Notes

Phases 2 and 3 both consume Phase 1's data layer and touch disjoint surfaces (new routes vs. the logger), so they can run as parallel PRs. Phase 4 waits for 3 because it edits the same logger set-completion path.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| In-session entry point | Tap exercise name → bottom sheet | Hamburger menu per exercise; new toolbar icon | Industry-converged (Strong, Hevy); zero added chrome |
| Sheet scope | History + Records + link-out | Full tabs w/ chart in sheet | Lean logger, one query; chart lives on the page |
| Library in v1 | Yes, `/exercises` + detail | Detail pages only | "Reachable outside" met fully; search machinery exists |
| Metric modes | reps_weight records only | All modes | Cardio records belong to the cardio feature; history still shows all modes |
| PR detection | In v1 | Follow-up PR | User decision; same data, one moment of value |
| Stats scope | All-time | Per-program filters | Block-scoped view already exists at program stats |

---

## Research Summary

**Market Context**
Strong and Hevy both open a full exercise detail (About/History/Charts/Records) from a mid-workout name tap without pausing the session, and expose the same view from a profile-level exercise library. Records tracked: heaviest weight, projected/true 1RM, best set/session volume, most reps, best duration. (Sources: help.strongapp.io/article/237, hevyapp.com/features/exercise-performance, help.hevyapp.com article 35382889578135.)

**Technical Context**
Schema already carries everything needed (composite exercise identity, logging types, duration/distance columns). Program stats prove the scoring/aggregation pattern (`src/db/program-stats.ts`); the logger proves the sheet idiom and last-performance fetch. Missing pieces are the exercise-first index, the all-time query, and the two surfaces.

---

*Generated: 2026-07-15*
*Status: DRAFT - needs validation*
