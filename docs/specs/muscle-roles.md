# Muscle Roles

Per-muscle roles — **specialize / grow / maintain** — on a program, driving weekly set targets, week-over-week ramp expectations, and a recovery-budget warning. Set-target bands grounded in public dose-response research, scoped to what this codebase already does well.

- Status: draft / feasibility-verified / no implementation
- Date: 2026-08-20

## 01 · Product framing

Today an author decides sets per exercise, and the app aggregates sets per muscle after the fact (`/stats`, program stats verdicts). What's missing is the step before: *declaring intent per muscle* — pick the muscles this block is for, hold the rest at maintenance, and let the app budget volume around that intent. See the provenance note in §02 for the research this builds on.

A role is a per-muscle declaration on the program:

- **Specialize** — this block exists for this muscle. High starting volume, ramping toward the top of the recoverable range.
- **Grow** — normal hypertrophy work. Moderate volume, gentle ramp.
- **Maintain** — hold what's there at minimum cost. Low, flat volume.

Roles do three things: (1) show the author, at authoring time, whether the plan matches the intent; (2) give the existing volume-proposal engine per-muscle targets instead of generic ones; (3) warn when the sum of ambitions exceeds a recovery budget. Roles are deliberately **not** a fourth prescription-derivation layer — see §05.

> **Design position.** Roles are advisory targets consumed by validation, stats verdicts, and the proposal generator. They never silently rewrite a prescription. This honors the two standing laws: prescriptions are snapshotted facts, and week derivation for pre-feature programs must stay byte-identical.

## 02 · Roles & volume bands

Bands are weekly *credited* working sets per muscle group (primary 1.0 / secondary 0.5, per `creditSetMuscles`), over the ten display buckets in `src/lib/exercises/muscle-groups.ts`. The `Other` bucket is not role-assignable.

| Role | Start band (wk 1) | End band (final acc. week) | Ramp | Evidence anchor |
|---|---|---|---|---|
| Specialize | 12–16 | 16–20 | linear across accumulation weeks | upper end of the 12–20-set optimum (Baz-Valle) |
| Grow | 8–12 | 10–14 | linear, shallower | ~10-set threshold → mid-range (Schoenfeld 2017) |
| Maintain | 4–8 | 4–8 | flat | low-volume maintenance literature |

Expected sets for week `w` of `W` accumulation weeks (deload week excluded — the week axis already handles deload shaping): `lerp(startMid, endMid, (w−1)/(W−1))`, band width carried alongside. All numbers live in one constants table, `src/lib/muscle-roles.ts`, and are **placeholders pending calibration** — the mechanism is the spec; the integers are a tuning pass.

Recovery budget, v1 heuristic (both warning-only):

- **Specialize cap** — warn when more than 2 muscles are Specialize: specializing everything specializes nothing.
- **Systemic budget** — warn when total credited sets across all muscles at the *peak* accumulation week exceeds `RECOVERY_BUDGET_PER_SESSION × trainingDaysPerWeek` (placeholder: 24/session). Training days = count of program days.

> **Provenance.** The bands are calibrated exclusively from peer-reviewed, public research: the Schoenfeld et al. 2017 dose-response meta-analysis (~10 weekly sets threshold, roughly linear gains per added set), the Baz-Valle systematic reviews (12–20 weekly sets optimal in trained lifters), and generic periodization (ramp volume across a mesocycle, reset with a deload — decades old). We use our own vocabulary throughout: internal names are `startBand`/`endBand`, user-facing words are Maintain / Grow / Specialize. Commercial coaching terminology and any third-party per-muscle target tables stay out of both the code and the product surface.

## 03 · Data model

A relation, not JSONB — roles are aggregated over, and the schema's stated rule is that anything aggregated over gets a column or relation. Program-level (a program *is* the mesocycle here — `mesocycle_weeks` lives on `programs`), so it sits beside the tree, not inside it:

```ts
// src/db/schema.ts — sibling of programExerciseMuscles
export const programMuscleRoles = pgTable('program_muscle_roles', {
  id: serial('id').primaryKey(),
  programId: integer('program_id').notNull()
    .references(() => programs.id, { onDelete: 'cascade' }),
  muscleGroup: text('muscle_group').$type<MuscleGroup>().notNull(),
  role: text('role').$type<MuscleRole>().notNull(),
}, (t) => [unique().on(t.programId, t.muscleGroup)])

export type MuscleRole = 'specialize' | 'grow' | 'maintain'
```

Following the house pattern (text + app-level union, no `pgEnum`; nullable-with-no-backfill semantics): **no row = unassigned**, and unassigned means *no role-driven behavior at all*. A program with zero rows validates, derives, and displays exactly as today. There is no default role — defaulting legacy programs to Grow would spray warnings across every existing program on day one.

### Input boundary

```ts
// src/lib/programs/program-input.ts
muscleRoles: z.record(
    z.enum(MUSCLE_GROUPS),          // 'Other' excluded from the enum
    z.enum(['specialize', 'grow', 'maintain'])
  ).optional()                       // absent ⇒ no rows (full-replace semantics)
```

### Lifecycle

- **Save/replace** — `replaceProgram` deletes + reinserts role rows alongside the child wipe. No snapshot/reattach dance needed: roles are keyed by muscle group, not by position, so they are immune to the `setAddress` reordering hazard that overrides carry.
- **Clone** — `copyProgramTree` copies role rows verbatim.
- **Templates** — templates may carry roles; "Use template" copies them. Templates are a sketch, so template roles are a starting point, not a contract.
- **Migration** — one migration creating the table. No backfill, no data change.

## 04 · Authoring UI

**Placement:** a new `<fieldset>` block in `ProgramBuilder` (`src/app/programs/new/program-builder.tsx`), in the existing program-settings stack — after the diet-phase radio group, before autoregulation. Same builder serves create and edit, so both flows get it for free via `programDraftReducer` (`SET_MUSCLE_ROLE` action) and `detailToProgramDraft` round-tripping.

### Control

A `DividerList` of the ten muscle groups; each row is the group name (ICU argument, never embedded in messages) plus a three-chip segmented group — Maintain / Grow / Specialize — using the builder's weekday-chip idiom (`aria-pressed`, tap the active chip to clear back to unassigned). No selection is the default state. **DESIGN.md tension to resolve in review:** the weekday chips use volt for selected, but "one volt moment per screen" is already spent in the builder — selected role chips should take the quiet treatment (primary text + hairline underline or filled-neutral), not volt.

### Live volume readout

Under the fieldset, one plain sentence per *assigned* muscle (EmptyWords voice, `role="status"`): planned week-1 credited sets vs. the role's start band, e.g. *"Chest: 10 planned sets — Specialize starts at 12–16."* Computed client-side from the draft; requires extracting the crediting logic into a pure shared function (§06). Warnings (§07) render in the same block as plain sentences, never as blocking errors — Save stays enabled.

### Elsewhere

- **Detail page** (`/programs/[id]`) — a read-only meta line listing assigned roles; editing goes through `/edit`. If later we want in-place editing, the precedent is the small control-island pattern (`diet-phase-card`, `overshoot-policy-control`) with a `setMuscleRolesAction`.
- **Program stats** (`/programs/[id]/stats`) — per-muscle verdict rows annotate with the role chip, and verdicts judge against role bands instead of generic thresholds when a role exists.
- Any new component in `src/components/**` ships with a co-located `.stories.tsx`; all copy through `next-intl`; nothing added to the card-shell ratchet.

## 05 · Interaction with progression & overrides

The derivation chain does not change:

```
override > deload > autoreg > scheme > template     (roles: not in this chain)
```

Roles influence prescriptions through exactly one channel that already exists: the **volume-proposal generator**. `ensureVolumeProposals` / `muscleVerdicts` (`src/db/volume-progression.ts`, `src/lib/programs/volume-progression.ts`) emit `set_program_set_override` patch proposals for the next untrained week — never auto-applied. One correction from the feasibility audit: today's verdict engine is *purely performance-relative* (beat-two-weeks-running / stall counters) and deliberately "knows nothing about volume tables" — there are no default per-muscle targets to swap out. Roles therefore *add* an absolute dimension rather than replace one: an optional `bands` parameter on `muscleVerdicts` / `proposalsToCreate` (both pure functions that already iterate `MUSCLE_GROUPS`), gating and contextualizing proposals. Cards can then say *why*: "Chest is Specialize — week 3 target is 14–18 sets, you're at 11."

### Per-week overrides

- Role-driven set additions arrive *as* overrides (via accepted proposals), so they already occupy the top of the precedence chain and survive replace by `setAddress`. No new machinery.
- Changing a role never edits existing overrides. An owner's explicit week-3 numbers stand even if they now contradict the band — validation may *mention* it (§07), nothing more.
- Week-aware planned volume (§06) must count overrides, otherwise accepted volume proposals would keep re-firing: the plan would still look under-target after the fix was applied.

### Conflict with the `weekly-volume` scheme

An exercise on the `weekly-volume` scheme already carries explicit `mevSets`/`mrvSets`. Rule: **explicit beats derived** — exercise-level scheme config wins for that exercise's set-count resizing; the role band still governs the *muscle-level* verdict and warnings. Deload weeks are excluded from all role math (the week axis and deload policy own that shape).

## 06 · Volume math required

Three pieces, one of which is the real work:

1. **Week-aware planned volume (the real work, now verified cheap).** `aggregatePlannedVolume` (`src/db/planned-volume.ts`) credits base prescriptions only and takes no week. Role validation needs planned credited sets per muscle *per week*: run `deriveWeekSets` per accumulation week, merge `program_set_overrides` by `sourceIndex` + week, credit through `creditSetMuscles`. The audit confirmed every set-*count*-changing path (`volumeSetCount`, deload `setFactor` resize, amrap deload rows, 1:1 overrides) is history-independent, so history inputs can be null: load structure once, loop weeks in memory — **zero extra DB round trips**, O(weeks × sets). Do *not* use `deriveDayPrescription` for this — it awaits per-exercise history/unit/performance queries that are week-invariant here.
2. **A pure, client-usable crediting core.** `creditSetMuscles` is itself pure, but its module (`src/db/muscle-volume.ts`) imports the live postgres client — extract it (plus `VolumeGroup`) to `src/lib/muscle-credit.ts` and re-export; its only dependency (`muscle-groups.ts`) is already client-safe. Three existing call sites keep working via the re-export.
3. **Draft muscles for the live readout.** The draft carries no muscle data today, but the fix is small and display-only: `/api/exercises?all=1` already returns `muscles`/`musclesSecondary` and the picker's result type already declares them — `PickedExercise` just drops them. Widen `PickedExercise` and `DraftProgramExercise` by two optional fields and copy `exercise.muscles` in `detailToProgramDraft`. Persistence is unaffected: tags are re-derived server-side from the catalog on save, so client-carried muscles can't corrupt anything.

Band evaluation on top is trivial: `expectedBand(role, week, accumulationWeeks)` and `evaluateMuscleWeek(planned, band) → 'under' | 'in' | 'over'` — shared by builder warnings, stats verdicts, and the proposal engine.

Approximation note: autoregulation adjusts loads/reps, not set counts, so ignoring autoreg here is exact, not a shortcut. Reactive deloads proposed mid-block arrive as overrides and are therefore counted by (1) automatically.

### Feasibility audit (verified against the engine)

| Integration point | Verdict | What the audit found |
|---|---|---|
| Band injection into proposal engine | Additive | No per-muscle targets exist to reuse — `mevSets`/`mrvSets` are per-exercise set ramps, and the verdict engine is performance-relative (constants `BEAT_WEEKS_REQUIRED`, `HOLD_STALLED_MOVEMENTS`). Pure functions accept an optional bands param cleanly; new storage is exactly the §03 table. |
| Week-aware planned volume | Cheap | Set-count derivation is history-free; weeks 1..N in one request, no per-week DB round trips. |
| Client draft muscles | Small | Data already reaches the browser; two type widenings + one mapper line. |
| `creditSetMuscles` reuse | Small | Pure logic in a server-poisoned module; ~15-line extraction to `src/lib/`. |
| Stats configurability | Mixed | `lowVolumeGroups` floor is already an injectable parameter; `OVER_PLAN_RATIO` is hardcoded, and `PlanComparisonEntry`/`verdictForStats`/`bulletWidthPct` assume a scalar target — widening scalar→band is a typed, compiler-guided change. |
| Maintain suppression | Clean seam | Per-muscle dedup already exists end-to-end (unique index on `programId, source, muscleGroup`); `proposalsToCreate` is the single choke point — one added predicate. |

**No blockers.** The one thing the audit surfaced that the spec must own: there is no per-muscle configuration storage anywhere today — the §03 table is not optional plumbing, it is the enabling change.

## 07 · Validation rules

All warning-only. Save never blocks on volume — the author owns the program. Surfaced in the builder readout (§04) at authoring time; the same evaluations back stats verdicts on the live program.

| # | Rule | Fires when | Voice (plain sentence) |
|---|---|---|---|
| V1 | Under band | planned week-1 sets < role start band | "Back: 6 planned sets — Grow starts at 8–12." |
| V2 | Over band | planned sets > band top for that week | "Quads: 22 sets in week 4 is past the Specialize band." |
| V3 | No ramp | Specialize/Grow muscle flat across weeks while `mesocycleWeeks > 1` and no `weekly-volume` exercise covers it | "Chest is Specialize but volume never ramps — proposals can add sets week to week." |
| V4 | Recovery budget | Σ credited sets at peak week > sessions × budget | "Peak week totals 96 sets across 4 days — that's past the recovery budget." |
| V5 | Specialize cap | > 2 muscles set to Specialize | "Three muscles are Specialize — specializing everything specializes nothing." |
| V6 | Role, no work | Specialize/Grow muscle with 0 planned sets | "Hamstrings is Grow but no exercise trains it." |

Cross-field logic that doesn't fit Zod's tree follows the `programSetIntegrityViolation` precedent: a pure function over the parsed input, callable by both the builder (client, on the draft) and anywhere server-side that wants it. It is *not* enforced at parse time — same compatibility reasoning as metric-mode × scheme.

## 08 · Out of scope & open questions

### Out of scope (v1)

- **Generative ramping** — "set roles, generate the week-by-week set plan for me." The clean v2: roles seed `weekly-volume` scheme configs at authoring time. Deliberately deferred; v1 proves the advisory loop first.
- Per-week role changes mid-block; role history/audit.
- Sub-bucket granularity (front/side/rear delts) — bands operate on the ten display buckets.
- Roles affecting autoregulation or deload policy in any way.

### Open questions

- **Band and budget constants** — all integers in §02 are placeholders. Calibrate from the public dose-response literature (Schoenfeld 2017, Baz-Valle reviews, the 2026 volume/frequency meta-regression) — per-muscle differentiation, if we ever want it, comes from muscle-specific studies in that same literature. Per-muscle band tables would be a constants change, not a schema change, so shipping uniform v1 bands is safe.
- **Should Maintain suppress volume proposals?** A Maintain muscle drifting below the generic growth threshold currently draws "add sets" proposals. Proposed answer: yes, suppress increase-proposals for Maintain muscles inside its band — that's the point of the role.
- **Selected-chip treatment** — volt vs. quiet, per the one-volt rule — needs the DESIGN.md review pass, not a spec decision.
- **Coach/MCP surface** — program tools should read/write roles (an `upsert_muscle_roles` patch op) so the coach can reason about intent. Straightforward, but decide whether it lands in v1 or immediately after.

---

Grounded in: `src/db/schema.ts` · `src/lib/programs/progression.ts` · `src/lib/exercises/muscle-groups.ts` · `src/db/planned-volume.ts` · `src/lib/programs/volume-progression.ts` · `src/app/programs/new/program-builder.tsx` · `DESIGN.md`
