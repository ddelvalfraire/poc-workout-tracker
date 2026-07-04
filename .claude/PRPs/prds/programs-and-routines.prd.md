# Programs & Routines (MCP-Authorable Training Programs)

## Problem Statement

The tracker has exactly one entity — a dated `workout` — so there is no concept of a *plan*. A lifter (or their agent) can't author a reusable, structured, multi-week program, can't start "today's Push" pre-seeded with what to beat, and ends up with templates blended into real history (template targets pollute `get_last_performance`). The cost: the app stays a *logger* when intermediate→advanced lifters need a *program-follower*, and the agent — our differentiator — has nothing rich to author against.

## Evidence

- Direct, in-session: the user loaded a 5-day Upper/Lower/Push/Pull/Legs split and immediately hit the wall — "so no clear difference between a plan and just a workout… we treat them all the same now right?" (correct: there is no plan concept).
- The workaround (creating 5 workouts with blank-weight "template" sets) demonstrably blends plans into history and would make `get_last_performance` return template targets until real sessions are logged.
- Spike (3 lenses) confirms every serious app (Hevy Trainer, RP, Juggernaut, Boostcamp, Liftosaur) models a first-class `program → … → set` hierarchy with progression; flat loggers (Strong, FitNotes) are explicitly the tier this user is trying to leave behind ("I'm used to spreadsheets").
- Assumption needing validation: that *agent-conversational authoring* (vs. a UI builder) is the preferred entry point — validated only by this user so far; treat as the core hypothesis.

## Proposed Solution

Add a first-class Programs model — `programs → program_days → program_exercises → program_sets` — that mirrors the existing `workouts → workout_exercises → sets` shape so instantiation is a near 1:1 row copy. Common, queryable, instantiation-critical fields are **typed columns** (set type, rep range, RIR/RPE, suggested load, metric mode, duration/distance); only the genuinely polymorphic long tail (intensity-technique `stages[]`, progression-scheme params) lives in a **narrow JSONB** validated by Zod. The MCP server is a **first-class authoring surface**: a coarse `upsert_program` to create, granular patch tools to edit, and `instantiate_program_day` to spawn a dated workout that the existing `update_set` logs into. Targets stay on the program; reality stays on the workout — resolving the plan-vs-workout blend by **provenance, not duplication**.

## Key Hypothesis

We believe a first-class, MCP-authorable Programs model will let an intermediate→advanced lifter (or their agent) build and run a structured mesocycle conversationally.
We'll know we're right when a user can author their full split via the agent in one conversation, **start today's session pre-seeded with the weights to beat**, log it, and never see template targets contaminate their real history.

## What We're NOT Building

- **Intra-session cardio-block scheduling** (e.g., "10 min bike between lifting blocks") — out of scope. NOTE: *timed/duration exercises themselves* (planks, ab holds, cardio, loaded carries, measured by time ± distance) ARE in scope and first-class.
- **A free-text DSL** (Liftosaur-style scripting) — we borrow its concepts (named progression rules, state, deterministic preview) but express them as **typed JSON + Zod**, which has far less hallucination surface for an agent and is trivially validatable.
- **Auto-generated programs from a questionnaire / coach AI** — a layer that sits *on top* of this model later; not v1.
- **Program marketplace / social sharing** — later.
- **Multi-user / team programming** — single-user POC, unchanged.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Agent authors a complete multi-day program | 5-day split in ≤1 `upsert_program` + ≤6 patch calls, Zod-valid first try | MCP call trace / manual dogfood |
| Instantiate → loggable session | "start today's Push" yields a dated workout with suggested loads + visible targets, logged via existing `update_set` | Dogfood + integration test |
| Timed exercise round-trips | a plank/cardio entry is authored with a duration target and logged with an actual duration | Unit + dogfood |
| Plan/workout no longer blends | `get_last_performance` ignores program templates; only real sessions count | Unit test (provenance excludes templates) |
| No regression | existing workout create/read/edit/patch + e1RM unchanged | full `vitest run src` green |

## Open Questions

- [x] Muscle-group taxonomy source: **RESOLVED (Phase 5 planning)** — derive from wger's `muscles`/`muscles_secondary` arrays at author time, denormalized onto a `program_exercise_muscles` relation.
- [x] Multi-week storage: **RESOLVED (Phase 5 planning)** — derived weeks PLUS a `program_set_overrides` (set × week) escape hatch; an override wins over the engine.
- [x] e1RM with RIR/RPE: **RESOLVED (Phase 5 planning)** — adopt an RTS-style RPE→%1RM table as a pure function; Epley stays for logged-history e1RM.
- [x] Week tracking: **RESOLVED (Phase 5 planning)** — `instantiate_program_day` auto-derives the week from the program's workout history; explicit `week` arg overrides. No stored counter.

---

## Users & Context

**Primary User**
- **Who**: an intermediate→advanced hypertrophy lifter who *programs* (rep ranges, RIR, progression, deloads), is leaving spreadsheets, and drives the app **through a conversational agent** as much as the UI.
- **Current behavior**: maintains a split in their head / a spreadsheet; logs sessions ad hoc; has no structured week-to-week progression in-app.
- **Trigger**: "set up my program" / "build me a 5-day hypertrophy split" / "start today's Push."
- **Success state**: program authored once (conversationally), each session starts pre-loaded with targets and last numbers to beat, progression advances automatically, history stays clean.

**Secondary "user": the agent.** The MCP tool surface is a primary consumer, not an afterthought — tool ergonomics (coarse-create + granular-patch, named scalar args, deterministic Zod feedback) are a first-class design constraint.

**Job to Be Done**
When I'm setting up or running a training block, I want to author and progress a structured program by talking to my agent, so I can follow a real mesocycle and always know what to beat — without rewriting anything.

**Non-Users**
Beginners who want a single guided linear program out of the box; casual loggers happy with flat routines (Strong/FitNotes tier); team/coach multi-athlete management.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | `programs → program_days → program_exercises → program_sets` typed hierarchy mirroring the workout tree | Foundation; enables 1:1 instantiation and SQL integrity/queries |
| Must | Metric model: `reps_weight \| duration \| duration_distance` on BOTH `program_sets` and live `sets` (+ duration_sec/distance_m) | Timed exercises (planks, abs, cardio, carries) first-class per user decision |
| Must | Per-set planned targets as typed columns: set_type (warmup/working/backoff/amrap), rep-range, RIR/RPE, suggested load (kg), tempo | The planned-vs-actual core every scheme builds on |
| Must | `instantiate_program_day` → dated workout via provenance (`workouts.program_day_id`, `program_week`), seeding `sets` from `program_sets` | Closes author→log loop; resolves plan-vs-workout blend |
| Must | MCP coarse authoring + read: `upsert_program`, `get_program`, `list_programs`, `delete_program`, `set_program_status`; `program://{id}` resource | MCP-first authoring; mirrors `create_workout`/resources |
| Must | Zod validation boundary for program/prescription input | The documented `workout-input.ts` upgrade path; the agent's contract = the DB contract |
| Should | Granular patch tools: add/update/remove/reorder day, exercise, set; `update_program_exercise`/`update_program_set` with **named scalar args** | Whole-doc regen makes LLMs drop detail — the exact lesson behind `patch-tools.ts` |
| Should | Progression engine: linear, double-progression, %1RM, RPE-target, weekly volume (MEV→MRV) + deload; multi-week derivation | The rich, in-scope-per-user power-user tier |
| Should | Intensity techniques (narrow JSONB `stages[]`): drop-set, rest-pause, myo-reps, cluster; superset grouping (column) | Unified one-shape modifier; in scope per user (no deferral) |
| Should | Muscle-group tagging on `program_exercises` | Volume landmarks (MEV→MRV) + like-for-like substitutions |
| Should | Web UI: program builder + browse + "start today's day" | Non-agent users; visual editing |
| Could | Exercise alternates tied to the *slot* (swap preserves volume accounting) | Power-user convenience; can follow taxonomy work |
| Could | Deterministic program *preview/dry-run* (show week-N targets + state transitions before running) | Strong agent guardrail (Liftosaur Playground idea) |
| Won't | Intra-session cardio-block scheduling; free-text DSL; auto-generated programs; marketplace; multi-user | See "What We're NOT Building" |

### MVP Scope

Phase 1 + 2 + 3: the schema (incl. timed metric + provenance), Zod, the coarse MCP authoring/read tools, and `instantiate_program_day`. That alone lets the agent author a program and turn a day into a real, loggable, target-bearing workout — the minimum that validates the hypothesis. Progression engine and granular editing follow.

### User Flow (critical path)

1. User: "build me a 5-day hypertrophy split." → agent calls `upsert_program` (one nested doc), Zod-validated, stored.
2. User: "tweak Push — swap incline DB for cable fly, 4 sets." → agent calls `update_program_exercise` (named args), not a whole-doc rewrite.
3. Monday: "start today's Upper." → `instantiate_program_day` spawns a dated workout, `sets` seeded with suggested loads (reps blank), targets + last-time numbers visible.
4. User logs via existing `update_set`/`add_set`; finishing advances the program week.

---

## Technical Approach

**Feasibility**: HIGH — the program tree is a structural twin of the existing workout tree; the authz boundary, ownership-via-join, 0-based `position`, deferrable unique constraint, MCP tool conventions, and kg↔display conversion are all reusable verbatim.

**Architecture Notes**
- **Data model (decided):** typed `program_sets` rows mirror `sets`; a **narrow JSONB** (`technique` stages + `progression` params) carries only the polymorphic tail. Rejected: (a) one fat `prescription` JSONB per exercise (loses integrity/queryability + instantiation symmetry), (b) fully-normalized per-technique tables (migration-per-technique, sparse EAV), (c) whole-program JSON/DSL (discards the `user_id`/ownership-join security model).
- **Boundary rule:** a field is a **column** if we filter/sort/aggregate/constrain on it or copy it into a `sets` row at instantiation; **JSONB** only if it's a polymorphic value read whole when rendering one exercise. Muscle-group is a relation/column, never JSON.
- **Metric model touches the live `sets` table:** add `metric_mode`, `duration_sec`, `distance_m` so timed exercises can be *logged*, not just planned. `estimated1RM` applies only when `metric_mode = reps_weight`.
- **Instantiation = provenance, not duplication:** nullable `workouts.program_day_id` (`onDelete: set null` so editing/deleting a plan never destroys logged history) + `program_week`. Targets read back via a join overlay on `get_workout`; never written into a `sets` row (a seeded suggested load is a mutable suggestion, not a stored target).
- **Weeks derived, not stored:** `programs.mesocycle_weeks` + `deload_week` + per-exercise progression → week-N targets computed at instantiation (pending the per-week-override open question).
- **MCP surface = hybrid:** coarse `upsert_program` for create/large-rewrite (matches how an agent generates a whole structure and mirrors `create_workout`); granular patches for edits with **named scalar args** (the `patch-tools.ts` lesson). New `src/db/programs.ts` mirrors `src/db/workouts.ts`; `registerProgramTools` wired into `registerTools`; reuse `resolveUserId`, `ToolError`/`errorResult`, `assertProgramIdShape` (sibling of `assertWorkoutIdShape`).
- **Zod introduced here** as the validation boundary (the upgrade path `workout-input.ts` already documents); the same schema validates MCP input and types the JSONB.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Progression engine complexity (multi-week, %1RM/RPE tables, deload, MEV→MRV) | H | Pure functions, heavy unit tests, isolated as the last build phase; ship author→log loop first |
| Narrow-JSONB shape migrations over time | M | Keep JSON to technique/progression only; add a `version` discriminator; tolerant parse |
| Metric-mode change ripples into live logging + e1RM | M | `metric_mode` gates e1RM/volume math; additive nullable columns; cover existing-workout regression in tests |
| Muscle-group taxonomy not yet present (needed for volume/subs) | M | Derive from wger at author time, denormalize; resolve open question before Phase 5 |
| Agent tool-call accuracy on rich edits | M | Hybrid surface + named scalar args + deterministic Zod error feedback (and optional dry-run preview) |
| Instantiation/seed interacting with deferrable unique + partial-edit tools | L | Reuse the exact `saveWorkout` transaction + seeding shape already proven by the patch work |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Schema + Zod + metric model | program tables, `program_sets` typed rows + narrow JSONB tail, Zod schemas, timed metric on `sets`, provenance columns, `db/programs.ts` ops, migration | complete | - | - | [plan](../plans/completed/programs-and-routines-phase-1-schema.plan.md) · [report](../reports/programs-and-routines-phase-1-schema-report.md) |
| 2 | MCP coarse authoring + read | `upsert_program`, `get_program`, `list_programs`, `delete_program`, `set_program_status`, `program://{id}` | complete | with 6 | 1 | [plan](../plans/completed/programs-and-routines-phase-2-mcp-authoring.plan.md) · [report](../reports/programs-and-routines-phase-2-mcp-authoring-report.md) |
| 3 | Instantiation | `instantiate_program_day` → dated workout (seed sets, week derivation), `get_workout` plan overlay | complete | - | 2 | [plan](../plans/completed/programs-and-routines-phase-3-instantiation.plan.md) · [report](../reports/programs-and-routines-phase-3-instantiation-report.md) |
| 4 | Granular patch tools | add/update/remove/reorder day·exercise·set; `update_program_exercise`/`_set` (named scalar args) | complete | with 6 | 2 | [plan](../plans/completed/programs-and-routines-phase-4-patch-tools.plan.md) · [report](../reports/programs-and-routines-phase-4-patch-tools-report.md) |
| 5 | Progression engine + techniques | linear/double/%1RM/RPE/volume schemes, deload, multi-week derivation, technique `stages[]`, supersets, muscle-group tagging | complete | - | 3 | [plan](../plans/completed/programs-and-routines-phase-5-progression-engine.plan.md) · [report](../reports/programs-and-routines-phase-5-progression-engine-report.md) |
| 6 | Web UI | program builder, browse, "start today's day" | complete | with 2,4 | 1 | [plan](../plans/completed/programs-and-routines-phase-6-web-ui.plan.md) · [report](../reports/programs-and-routines-phase-6-web-ui-report.md) |

### Phase Details

**Phase 1: Schema + Zod + metric model**
- **Goal**: the data foundation, with timed exercises and provenance baked in.
- **Scope**: `programs`/`program_days`/`program_exercises`/`program_sets` (Drizzle, mirroring schema.ts conventions); narrow JSONB (`technique`, `progression`) with Zod; `metric_mode`/`duration_sec`/`distance_m` on `program_sets` AND live `sets`; nullable `program_day_id`/`program_week` on `workouts`; `db/programs.ts` user-scoped ops; one migration.
- **Success signal**: migration applies; new tables + columns exist; Zod schemas validate sample programs; existing workout tests stay green.

**Phase 2: MCP coarse authoring + read**
- **Goal**: an agent can create and read a whole program.
- **Scope**: `upsert_program` (create + full replace, Zod, kg conversion, one transaction like `saveWorkout`); `get_program`/`list_programs`/`delete_program`/`set_program_status`; `program://{id}` resource; `assertProgramIdShape`.
- **Success signal**: agent authors the 5-day split via one `upsert_program`; `get_program` returns it in display units; ownership enforced.

**Phase 3: Instantiation**
- **Goal**: turn a program day into a real, loggable session.
- **Scope**: `instantiate_program_day` (ownership-join load, week index, seed `sets` from `program_sets` with suggested loads, `saveWorkout`-shaped insert returning workoutId); `get_workout` optional `plan` overlay; provenance so `get_last_performance` ignores templates.
- **Success signal**: "start today's Push" → dated workout with suggested loads + visible targets; logging via `update_set` works; history clean.

**Phase 4: Granular patch tools**
- **Goal**: iterative editing without whole-doc rewrites.
- **Scope**: add/update/remove/reorder for day·exercise·set; `update_program_exercise`/`update_program_set` with named scalar args (undefined=unchanged, null=clear, like `update_set`); re-validate JSONB on partial edits.
- **Success signal**: "swap day 2's incline for flat, 4 sets" changes only that, leaves siblings intact.

**Phase 5: Progression engine + techniques**
- **Goal**: the rich power-user tier (in scope, not deferred).
- **Scope**: progression schemes (linear, double, %1RM, rpe-target, weekly volume/MEV→MRV), deload modifier, multi-week derivation at instantiation; technique `stages[]` (drop/rest-pause/myo/cluster), tempo, superset grouping; muscle-group tagging; optional dry-run preview.
- **Success signal**: instantiating week 3 yields progressed targets; a drop-set / timed plank authored + logged; volume-per-muscle computable in SQL.

**Phase 6: Web UI**
- **Goal**: non-agent authoring + the at-the-gym start flow.
- **Scope**: program builder (multi-day, ordered exercises, set/target editing), program list, "start today's [day]" button surfacing targets + last numbers.
- **Success signal**: a program built and a session started entirely in the UI.

### Parallelism Notes

Phase 6 (UI) can run alongside the MCP tool phases (2 & 4) once the schema (1) lands — both consume the same `db/programs.ts`. Phases 2 and 4 are sequential (patch tools build on the coarse surface). Phase 5 depends on instantiation (3) because progression only matters once a day can be instantiated across weeks.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Program data model | Typed `program_sets` rows (mirror `sets`) + **narrow JSONB** for technique/progression tail | Fat JSONB prescription per exercise; fully-normalized per-technique tables; whole-program JSON/DSL | Integrity + SQL queryability on the core, 1:1 instantiation symmetry; JSON only for the polymorphic tail; preserves the user_id/ownership-join authz boundary |
| Timed exercises | `metric_mode` (`reps_weight\|duration\|duration_distance`) + duration/distance columns on program_sets AND live sets | reps-only model; JSON metric blob | First-class planks/abs/cardio per user; columns because instantiation-critical + queryable; e1RM gated to reps_weight |
| Plan vs workout | Provenance (`program_day_id`/`program_week` on workouts), targets read via overlay | Duplicate targets into sets; an `is_template` flag on workouts | Targets stay on program, reality on workout; keeps `get_last_performance` clean |
| Weeks | Derived from `mesocycle_weeks` + progression | Store every week's rows | Avoids N× duplication; matches how hypertrophy blocks overload from a week-1 template |
| MCP surface | Hybrid: coarse `upsert_program` + granular patches; named scalar args on updates | Many granular tools only; one whole-doc tool only | LLMs drop unrelated detail on whole-doc regen (the `patch-tools.ts` lesson); coarse matches generation, granular matches editing |
| Validation | Zod at the tool boundary, typing the JSONB | hand-rolled parse like `parseWorkoutInput` | The documented upgrade path; one schema = DB shape + MCP contract + agent contract |
| Deferred tier | NOT deferred — %1RM, clusters, block/DUP all in scope (Phase 5) | Punt to a later PRD | User decision; cheap because they're progression/technique variants in JSONB |

---

## Research Summary

**Market Context**
Three archetypes: flat loggers (Strong, FitNotes, Hevy routines — last-session prefill, no progression), structured periodized libraries (Boostcamp, Liftosaur — first-class program→week→day→set with computed loads), adaptive engines (RP, Juggernaut, Hevy Trainer — program generated each session from volume landmarks / training max / RPE autoregulation fed by *enumerated* feedback). Liftosaur is the key agent-authoring precedent (whole program incl. progression is one text artifact, expression-valued fields, named rules + `custom` escape hatch, deterministic preview) — we keep its concepts but use typed JSON over a DSL. The domain collapses to 3 orthogonal axes: the set (4 load modes × rep-range × RIR), modifiers (set_type, tempo, superset, unified technique `stages[]`), and the hierarchy (program→meso→day→prescription with progression on the meso). The 4 load modes (absolute / %1RM / RPE / RIR) are the load-bearing abstraction every app reduces to.

**Technical Context**
Prior art reused verbatim: `db/workouts.ts` authz boundary (user_id filter + ownership-via-join), `errors.ts`/`result.ts` leak-safe `ToolError` split, `resolveUserId(extra, arg)`, kg-canonical with `displayToKg`/`kgToDisplay`, 0-based `position` / 1-based `setNumber`, the deferrable unique constraint on `sets`, and the coarse-create + granular-patch tool pattern (`create_workout` + `patch-tools.ts`). `workout-input.ts` explicitly documents the Zod upgrade path this PRD takes. Feasibility HIGH; the program tree is a structural twin of the workout tree.

---

*Generated: 2026-06-29*
*Status: DRAFT — needs validation (see Open Questions)*
