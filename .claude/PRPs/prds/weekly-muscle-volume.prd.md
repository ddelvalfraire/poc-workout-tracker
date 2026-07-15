# Weekly Muscle-Group Volume

## Problem Statement

The app reports the past (records, trends, PRs) but doesn't guide the next session: the one planning number a hypertrophy lifter runs on — sets per muscle per week — is unanswerable without a spreadsheet. Swapping OHP out mid-block can silently drop shoulder volume to near zero and nothing surfaces it.

## Evidence

- Every stats surface built to date is per-exercise or per-program; no muscle-level aggregation exists anywhere in the UI.
- The schema comment on `program_exercise_muscles` (schema.ts:311) says it was built as "the aggregation surface" for exactly this — the write side landed, the read side never did.
- Standard hypertrophy practice tracks 10–20 weekly sets per muscle (primary full, secondary half) — the convention every serious tracker (Hevy Pro, Alpha Progression) exposes as muscle-volume charts.

## Proposed Solution

A `/stats` page answering "what did I train this week": sets per muscle GROUP (chest/back/shoulders/biceps/triceps/quads/hamstrings/glutes/calves/core), this week vs last, with under-floor flags — plus a small home teaser card linking to it. Muscle mapping resolves each logged exercise through the cached wger catalog (`lib/wger.ts`, memory→Redis→API) and `custom_exercises.muscles`, so ad-hoc workouts count, not just program-provenance ones. Week window is user-switchable: rolling 7 days (default) or calendar weeks, as URL state.

## Key Hypothesis

We believe a per-muscle weekly volume view will replace guesswork about training balance for the app's lifter. We'll know we're right when under-trained muscles are visible at a glance (and the numbers match a hand count of the same week's sets).

## What We're NOT Building

- **Configurable volume targets/floors** — v1 ships fixed, commented thresholds; personal MEV/MRV tuning can come later.
- **Muscle-volume PLANNING preview** ("what would next week look like") — this is a measurement surface; program preview tools already exist.
- **Per-muscle trend charts over months** — v1 is this-week-vs-last; longer horizons ride the same aggregation later.
- **Effective-load weighting** — volume = set counts (the literature's unit), not tonnage per muscle.
- **Backfilling `program_exercise_muscles` reads** — the catalog-based mapping supersedes provenance-scoped tags for this feature (they stay for program authoring).

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Correct counting | Per-muscle numbers match a hand count (primary 1.0 / secondary 0.5, completed sets in completed workouts only) | Unit tests on pure aggregation |
| Coverage | Ad-hoc workouts count identically to program sessions | Unit test with null-provenance rows |
| Glanceability | Under-floor muscles visibly flagged; week toggle switches cleanly (URL state) | Manual |

## Open Questions

- [x] Week boundary timezone: the calendar toggle carries the client's `getTimezoneOffset()` in URL state (hydration-safe via useSyncExternalStore); rolling mode is tz-free with an open upper edge for clock skew.
- [x] Unmapped exercises/names: explicit 'Other' bucket, never dropped (Phase 1).
- [x] Duration-mode sets: excluded — reps_weight completed sets only, consistent with records (Phase 1).

---

## Users & Context

**Primary User**
- **Who**: The app's owner-lifter, mid-block, deciding what to emphasize this week.
- **Current behavior**: Guesses balance from memory; discovers a lagging muscle weeks late.
- **Trigger**: Planning the next session ("have I done enough back this week?") and post-swap sanity checks after replacing an exercise.
- **Success state**: One glance at /stats answers it.

**Job to Be Done**
When I'm deciding what to train next, I want to see this week's sets per muscle against last week and a sane floor, so I can plug gaps before the week ends.

**Non-Users**
Multi-user/coach scenarios; powerlifting-style tonnage-per-lift analytics (program stats covers that lens).

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Exercise→muscle-group resolver (wger catalog + custom exercises, name→bucket mapping) | The whole feature; must cover ad-hoc workouts |
| Must | Pure weekly aggregation: primary 1.0 / secondary 0.5, completed-only, reps_weight sets | Correctness is the product |
| Must | `/stats` page: per-group bars (this week, last week reference), under-floor flags | The deliverable |
| Must | Week-window toggle: rolling 7d (default) ⇄ calendar weeks, as URL state | User decision: both modes |
| Should | Home teaser card (top-line: total sets + lowest group) linking to /stats | Reach without crowding home |
| Should | StatTiles: total sets, sessions, most/least-trained group | Reuses the tile contract |
| Could | Tap a bar → the exercises that contributed | Drill-down, not blocking |
| Won't | Custom floors, monthly trends, tonnage weighting | See NOT building |

### MVP Scope

Phases 1–2. Hypothesis testable the moment /stats renders real numbers.

### User Flow

Home → "This week" teaser → `/stats`: bar per muscle group (this week vs last), flagged lows, toggle rolling/calendar → back to planning.

---

## Technical Approach

**Feasibility**: HIGH — verified in-session: `lib/wger.ts` serves the full catalog with `muscles`/`musclesSecondary` from a 3-layer cache (wger.ts:219-259); `custom_exercises` stores muscle arrays; completed-only set queries are the house pattern; chart + tile primitives just shipped (PRs #60–61).

**Architecture Notes**
- **Mapping layer** (`lib/muscle-groups.ts`): wger English muscle names → the 10 display buckets (pure, tested). Resolver: composite exercise id → buckets via catalog/customs — built once per request from `getAllExercises()` + a customs query, then pure.
- **Aggregation** (`db/muscle-volume.ts`): flat completed-sets query over the last 2 windows, then pure `aggregateMuscleVolume(rows, resolver, window)` — program-stats module style, exported for tests.
- **Surface**: server component `/stats` + `?window=` URL state; bar chart via the shadcn chart primitive (the spike's remaining bar-chart adoption lands here); `StatTile` row on top; home teaser server-rendered.
- **Set credit rule**: completed `reps_weight`-mode sets in completed workouts; primary 1.0, secondary 0.5 per set (a muscle listed as both counts once at 1.0).

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| wger name → bucket mapping misses names (catalog drift) | M | Unmapped names roll into an explicit "Other/Unmapped" row + a test pinning the known name list |
| Week-boundary timezone drift | M | Follow the local-day convention already in the codebase; document the choice |
| Catalog fetch latency on cold cache | L | 3-layer cache exists; page is read-only and tolerant |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Muscle mapping + aggregation | `lib/muscle-groups.ts`, `db/muscle-volume.ts`, week-window math, tests | complete | - | - | [plan](../plans/completed/muscle-volume-data-layer.plan.md) · [review](../reviews/muscle-volume-data-layer-review.md) |
| 2 | /stats surface + home teaser | Page (bars, tiles, flags, window toggle), teaser card, nav | complete | - | 1 | [plan](../plans/completed/muscle-volume-surface.plan.md) · [review](../reviews/muscle-volume-surface-review.md) |

### Phase Details

**Phase 1: Muscle mapping + aggregation**
- **Goal**: Correct numbers, fully tested, no UI.
- **Scope**: name→bucket map; composite-id resolver (catalog + customs); flat query (userId, completed-only, last 2 windows); pure aggregation (credits, dedup, window split rolling/calendar); totals for tiles.
- **Success signal**: Matrix tests green (credit rule, dedup, ad-hoc coverage, unmapped handling, window edges).

**Phase 2: /stats surface + home teaser**
- **Goal**: The glanceable answer.
- **Scope**: `/stats` server page (`?window=` state), per-group bar chart (this vs last week), StatTiles, under-floor flags (fixed thresholds), home teaser card, back-nav.
- **Success signal**: Real data renders; toggle switches windows; flagged groups obvious.

### Parallelism Notes

Sequential — 2 consumes 1.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Muscle source | Catalog-based (wger cache + customs) | `program_exercise_muscles` provenance join | Covers ad-hoc workouts; provenance misses them by construction |
| Week window | BOTH, toggle, rolling default | one mode only | User decision |
| Secondary credit | 0.5 | primary-only / full | Literature convention |
| Granularity | 10 grouped buckets | raw wger names | Actionable over anatomical |
| Surface | /stats + home teaser | home-only / program stats | Cross-program by nature; room to grow |
| Set unit | Count of completed reps_weight sets | tonnage per muscle | Volume literature counts sets |

---

## Research Summary

**Market Context**
Muscle-volume weekly charts are the signature "pro" feature of Hevy (Pro) and Alpha Progression; the 10–20 set/week band with fractional secondary credit is the community convention.

**Technical Context**
Verified: wger catalog cache exposes per-exercise muscles server-side (wger.ts); customs carry arrays; chart/tile primitives shipped this session (PRs #60–61); completed-only aggregation pattern established across program-stats and exercise-stats.

---

*Generated: 2026-07-15*
*Status: DRAFT - needs validation*
