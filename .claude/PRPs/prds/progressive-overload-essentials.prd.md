# Progressive Overload Essentials

## Problem Statement

People who train with weights need to see what they lifted last time to know whether to add weight or reps today — progressive overload is the entire point of structured training. The current app records workouts but shows nothing during logging, forces every session to be rebuilt from scratch, never surfaces a personal best, and is kg-only. A lifter can log here, but they can't *train* here — so they'll keep using Hevy/Strong instead.

## Evidence

- Every major strength-training app (Hevy, Strong, FitNotes, Boostcamp) leads with "previous set" data shown inline during logging — it's the single most-cited reason users pick a tracker over a notes app.
- The app already stores `reps` and `weight` per set keyed to `userId` + `wgerExerciseId`, so the data needed for "last time," PRs, and 1RM **already exists** — the gap is surfacing it, not capturing it.
- Repeating a routine is the ~70% case for regular lifters (same program week to week); today every workout is built from zero via search.
- kg-only excludes the entire US/UK free-weight market, which logs in lb.
- Assumption to validate: that surfacing this data measurably increases return logging. Needs validation through dogfooding + early-user retention (see Success Metrics).

## Proposed Solution

Ship four data-surfacing features that reuse the existing `workouts → workout_exercises → sets` schema, layered so weight display is correct everywhere first:

1. **Unit preference (kg/lb)** — a per-user display unit; weights stored canonically in kg, converted at render and on input.
2. **"Last time" inline** — when an exercise is added to a draft, show the most recent performance for it (`Last: 80kg × 5, 5, 4`).
3. **Repeat last workout** — one tap to seed a new draft from a previous workout's exercises and sets.
4. **Personal records + estimated 1RM** — best set and an Epley/Brzycki 1RM estimate per exercise, with a PR badge when a set beats the prior best.

This approach is chosen over building programs/templates or analytics dashboards because it delivers the core "train, don't just log" value with near-zero schema change and minimal surface area.

## Key Hypothesis

We believe surfacing prior performance, PRs, and one-tap repeats will turn passive logging into active training for regular lifters.
We'll know we're right when a meaningful share of new workouts are started via Repeat and week-2 logging retention improves over the current baseline.

## What We're NOT Building

- **Workout programs / templates / periodization** — bigger bet, separate PRD; Repeat covers the common case for now.
- **Progress charts / analytics dashboards** — PRs and 1RM give the high-signal numbers without a charting investment.
- **RPE, supersets, rest timers** — power-user polish, deferred (consistent with prior POC scope).
- **Historical unit migration / mixed-unit storage** — we store canonical kg and convert; we do not re-store data per unit.
- **Per-exercise unit overrides** — one unit preference per user in v1.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Repeat adoption | ≥ 40% of new workouts started via Repeat (among users with ≥2 workouts) | Server-side count of workouts created from Repeat vs scratch |
| "Last time" coverage | ≥ 60% of logged exercises show prior-performance data | % of draft exercises where a previous performance exists and renders |
| Week-2 logging retention | Improves over current baseline | Cohort: % of users who log a workout in week 2 after first workout |
| PR moments | ≥ 1 PR badge shown per active user per week (median) | Count of PR badges surfaced per user/week |

## Open Questions

- [x] Where does the unit preference live — a `user_preferences` table (server-rendered, survives devices) or localStorage (no migration, but client-only)? **Resolved: `user_preferences` table** — weights render in async Server Components, so the unit must be readable server-side to avoid hydration flicker (Phase 1, complete).
- [ ] "Last time" definition: most recent workout containing the exercise, or most recent *completed* one? (Drafts with `completedAt = null` may pollute.)
- [ ] PR definition: max weight at any reps, max single-set weight, or max estimated 1RM? 1RM is the most meaningful but least intuitive.
- [ ] Which 1RM formula — Epley (`w × (1 + r/30)`) or Brzycki — and do we hide it for very high-rep sets where estimates degrade?
- [ ] lb→kg input rounding: store exact converted kg, or snap to nearest 0.5 kg / 1.25 lb plate increments?

---

## Users & Context

**Primary User**
- **Who**: A regular lifter following a repeating routine (e.g., upper/lower or PPL split), logging on their phone mid-workout between sets.
- **Current behavior**: Logs sets in Hevy/Strong specifically to see last session's numbers; rebuilds the same workout each time; chases PRs.
- **Trigger**: Standing at the rack about to do a working set, deciding how much weight to load.
- **Success state**: Glances at the app, sees last time's numbers, loads the bar with confidence, and logs the set in seconds.

**Job to Be Done**
When I'm about to do a working set, I want to see what I lifted last time for this exercise, so I can decide whether to add weight or reps today.

**Non-Users**
Casual exercisers tracking cardio/classes, and people who want guided programs written for them — this is for self-directed lifters who already know their routine.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Unit preference kg/lb (store kg, convert on display + input) | Every weight in the app must render correctly before other features build on it |
| Must | "Last time" inline performance per exercise in the logger | The core "train, don't just log" value; highest-gain single feature |
| Must | Repeat last workout → seeded draft | Covers the ~70% repeat-routine case; removes per-session rebuild friction |
| Should | Personal records + estimated 1RM with PR badge | High-signal progression feedback; computed from existing data |
| Could | "Last time" diff hint (e.g., +2.5kg vs last) | Sharper overload nudge once base display exists |
| Could | Per-exercise best-set history view | Deeper progression context |
| Won't | Programs / templates / periodization | Separate, larger bet |
| Won't | Charts / analytics dashboards | PRs + 1RM cover high-signal numbers without charting cost |
| Won't | RPE, supersets, rest timers | Power-user polish, deferred |

### MVP Scope

Units + "Last time" + Repeat. Those three validate the core hypothesis (does surfacing prior performance and removing rebuild friction drive return logging). PRs + 1RM is a fast follow once the data-surfacing plumbing exists.

### User Flow

Critical path (returning lifter, day 2 of a routine):
1. Home → tap **Repeat** on last workout → new draft pre-seeded with same exercises and sets.
2. For each exercise, the logger shows **`Last: 80kg × 5, 5, 4`** inline (in the user's chosen unit).
3. Lifter adjusts weight/reps, logs sets.
4. On save, any set beating the prior best surfaces a **PR badge**.

---

## Technical Approach

**Feasibility**: HIGH — three of four features are pure read/compute over existing tables; only the unit preference needs persistence.

**Architecture Notes**
- **Data already present**: `sets` (`reps`, `weight` numeric) → `workout_exercises` (`wgerExerciseId`, `name`) → `workouts` (`userId`, `completedAt`). No schema change for last-time, repeat, or PRs.
- **Last time**: a `getLastPerformance(userId, wgerExerciseId)` query — most recent qualifying workout's sets for that exercise; wire into `WorkoutLogger` / `ExercisePicker`.
- **Repeat**: reuse the existing edit-mode draft pre-population; create a *new* workout id from a past workout's exercises + sets (reset `completed`, fresh timestamps).
- **PRs / 1RM**: pure computation (`weight`, `reps`) — Epley/Brzycki helper in `src/lib`; no migration needed, optional caching deferred.
- **Units**: store canonical kg (unchanged); add a `user_preferences` row per user; convert at render and parse on input. This is the only migration.
- **Conversion is a boundary concern**: centralize kg↔lb in one `src/lib` util to avoid drift across logger, detail, and history views.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Unit conversion rounding drift across views | M | Single conversion util; store exact kg; round only for display |
| "Last time" picks up abandoned draft workouts | M | Define query to require `completedAt` (or a "has sets" guard) |
| 1RM estimates mislead at high reps | L | Cap/flag estimates above ~12 reps; label as "est." |
| Repeat copying stale weights feels wrong | L | Seed prior values as editable targets, clearly pre-filled not logged |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Unit preference (kg/lb) | `user_preferences` storage + central kg↔lb util; all weight display/input respects unit | complete | - | - | [plan](../plans/completed/unit-preference-kg-lb.plan.md) · [report](../reports/unit-preference-kg-lb-report.md) |
| 2 | "Last time" inline | `getLastPerformance` query + render prior performance in the logger | in-progress | with 3, 4 | 1 | [plan](../plans/last-time-inline.plan.md) |
| 3 | Repeat last workout | Seed a new draft from a past workout's exercises + sets | complete | with 2, 4 | 1 | [plan](../plans/completed/repeat-last-workout.plan.md) · [report](../reports/repeat-last-workout-report.md) |
| 4 | PRs + estimated 1RM | 1RM helper, best-set/PR detection, PR badge on save/detail | complete | with 2, 3 | 1 | [plan](../plans/completed/prs-and-estimated-1rm.plan.md) · [report](../reports/prs-and-estimated-1rm-report.md) |

### Phase Details

**Phase 1: Unit preference (kg/lb)**
- **Goal**: Every weight in the app renders and accepts input in the user's chosen unit, with kg stored canonically.
- **Scope**: `user_preferences` table (`userId`, `unit` default `kg`); central conversion util in `src/lib`; apply to logger inputs, detail, history; a toggle in settings/UI.
- **Success signal**: Switching the toggle re-renders all existing weights correctly; new input in lb persists as correct kg.

**Phase 2: "Last time" inline**
- **Goal**: When an exercise is in the draft, show its most recent prior performance.
- **Scope**: `getLastPerformance(userId, wgerExerciseId)` query; render `Last: {sets}` in `WorkoutLogger`/`ExercisePicker` in the active unit.
- **Success signal**: Adding a previously-logged exercise shows accurate prior reps/weight; exercises with no history show nothing (no error).

**Phase 3: Repeat last workout**
- **Goal**: Start a new workout pre-seeded from a previous one in one tap.
- **Scope**: Repeat action on history items/detail; create new workout id from source exercises + sets (reset `completed`, fresh `startedAt`); route into the logger.
- **Success signal**: Repeating produces an editable draft identical in structure to the source, saving as a distinct new workout.

**Phase 4: PRs + estimated 1RM**
- **Goal**: Surface best set and estimated 1RM, and celebrate new PRs.
- **Scope**: Epley/Brzycki helper; best-set/PR detection per `wgerExerciseId`; PR badge on save and/or detail; show est. 1RM on exercise.
- **Success signal**: A set beating the prior best shows a PR badge; 1RM estimate displays and updates as data grows.

### Parallelism Notes

Phase 1 is foundational — every other phase displays weights, so doing units first avoids rework. Phases 2, 3, and 4 are mutually independent (different surfaces: logger read, draft creation, computation/badge) and can be built concurrently once Phase 1 lands.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| PRD shape | One combined PRD, four phases | Four separate PRDs | Shared schema and user; phased rollout is cleaner as one doc |
| Target framing | Real lifters (adoption) | POC/dogfood only | Forces honest adoption metrics, not just "it builds" |
| Weight storage under units | Canonical kg, convert on display | Store per-user unit / dual columns | Avoids migration and mixed-unit data integrity issues |
| Units sequencing | Build units first | Build last-time first | All weight views depend on correct unit rendering |

---

## Research Summary

**Market Context**
- "Previous set" inline data is table stakes across Hevy, Strong, FitNotes — strongest differentiator vs a notes app.
- One-tap repeat/duplicate of a prior session is standard in the same apps and matches the repeating-routine behavior of regular lifters.
- kg/lb toggle is universally expected; US/UK free-weight users log in lb.

**Technical Context**
- Existing schema (`workouts → workout_exercises → sets`) already captures `reps`, `weight`, `wgerExerciseId`, `userId` — last-time, repeat, and PRs need no migration.
- Edit-mode draft pre-population already exists and can be reused for Repeat.
- Only unit preference needs new persistence (`user_preferences`); conversion should be centralized to prevent drift.

---

*Generated: 2026-06-14*
*Status: DRAFT - needs validation*
