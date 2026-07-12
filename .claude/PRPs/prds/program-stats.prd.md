# Program Stats

## Problem Statement

A lifter who trains at more than one gym (home gym + commercial gym) runs discrete program blocks, each completed at a single gym. Global exercise history mixes data across gyms — machine-lift numbers (stack machine vs. plate-loaded leg press) are incomparable — and nothing in the app answers "is *this program* working?" Progression, adherence, and volume are invisible at the block level.

## Evidence

- User (2026-07-04): "this gym is not the same of my home gym… we dont need per gym but idk maybe per program? this program i will finish at this gym you know?"
- User accepted the global-stats trade-off explicitly: "we can accept the trade off for exercise stats but we should be able to see stats per program too."
- Live trigger: an active 7-week Upper/Lower + PPL block just started at the commercial gym; leg press there is a maxed stack machine whose numbers mean nothing next to home-gym history.

## Proposed Solution

A read-only **Stats view scoped to one program**, built entirely on existing provenance: workouts instantiated from a program day already carry `programDayId` and `programWeek`. Aggregating by program gives self-consistent numbers by construction (one program = one gym = one set of machines), with zero schema changes and no gym/equipment entity. Global per-exercise history stays exactly as-is.

Four stat categories (user: "all 4"):

1. **Per-exercise progression** — load/reps and best-set e1RM per week within the program
2. **Adherence** — days completed vs. planned per week; current week vs. `mesocycleWeeks`
3. **Weekly volume** — completed sets and tonnage per week across the block
4. **Program PRs** — e1RM improvements attributable to the block (first-week baseline → best)

## Key Hypothesis

We believe program-scoped stats will make block progress legible (and neutralize cross-gym number pollution) for lifters running one program per gym.
We'll know we're right when the user can answer "am I on track this week / is the program working?" from the program page alone, without opening individual workouts or global history.

## What We're NOT Building

- **Gym/equipment profiles** — scope-heavy for a POC; the program *is* the equipment context. Revisit only if multi-gym training within one program becomes real.
- **Changes to `getLastPerformance` / global exercise stats** — trade-off explicitly accepted; cross-gym noise on machine lifts is tolerated there.
- **Ad-hoc workout attribution** — workouts not started via `instantiate_program_day` don't count toward program stats. UX nudge, not retro-linking.
- **Charts library / heavy viz** — v1 is tables + simple inline bars consistent with the existing UI; no charting dependency.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Block questions answerable from one screen | Week #, adherence %, per-lift trend all visible on program Stats tab | Manual walkthrough on the live 7-week block |
| Zero schema migrations | 0 new tables/columns | PR diff |
| No pollution of global stats | `getLastPerformance` behavior unchanged | Existing tests still green |

## Open Questions

- [ ] MCP exposure: also ship a `get_program_stats` read tool so Claude can answer "how's my program going?" — defaulted to **yes, as a later phase** (this app is MCP-first in practice); confirm before building phase 4.
- [ ] Tonnage for machine lifts with null weights (stack maxed, weight unlogged): count sets only, or prompt to log the stack number? v1: sets always count; tonnage skips null-weight sets.
- [ ] Does adherence count a day "done" when the workout is started but not completed (`completedAt` null)? v1 proposal: started counts, flagged visually if incomplete.

---

## Users & Context

**Primary User**
- **Who**: The app's owner — a lifter mid-block on a 7-week Upper/Lower + PPL program at a commercial gym, with separate home-gym history in the same account.
- **Current behavior**: Scrolls the workout list and opens individual sessions to guess at progress; ignores machine-lift history because numbers cross gyms.
- **Trigger**: Mid-block check-in ("week 3 — am I actually progressing / hitting my days?") and end-of-block review before planning the next mesocycle.
- **Success state**: Opens the program, sees week position, adherence, and per-lift trends at a glance; trusts machine numbers because they're scoped to this block.

**Job to Be Done**
When I'm partway through a program block, I want to see progression, adherence, and volume scoped to that program, so I can tell whether the block is working without cross-gym noise.

**Non-Users**
Multi-user scenarios, coaches reviewing clients, and lifters who train ad-hoc without programs — out of scope for this POC.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Per-exercise progression within program (week × load/reps/e1RM) | The capability that actually fixes the gym problem |
| Must | Adherence (days done vs. planned per week, current week indicator) | Cheapest high-signal stat; mesocycle gives a free x-axis |
| Must | Weekly volume (sets + tonnage per week) | "Am I ramping into the deload correctly" |
| Should | Program PRs (baseline → best e1RM per exercise) | End-of-block payoff; needs ≥2 weeks of data to be meaningful |
| Should | MCP `get_program_stats` tool | Claude-facing parity; pending open question |
| Won't | Gym/equipment profiles, global-stats changes, retro-linking ad-hoc workouts | See "Not Building" |

### MVP Scope

Program detail page gains a **Stats tab** (or section) rendering all data from one aggregate query over program-linked workouts: per-week adherence row, per-week volume row, and a per-exercise progression table. PRs and MCP tool follow once ≥1 week of real data exists to validate against.

### User Flow

Programs → open active program → Stats tab → see: "Week 2 of 7 · 4/5 days done last week" → per-lift table (Bench 185×8 → 190×8) → weekly sets/tonnage strip.

---

## Technical Approach

**Feasibility**: HIGH — pure read-side feature over existing provenance columns.

**Architecture Notes**
- Provenance already exists: `workouts.programDayId` (SET NULL FK) + `workouts.programWeek` (1-based) — `src/db/schema.ts:27-31`. Program days → program via `programDays`.
- e1RM math exists: `estimate1RM` (Epley, single-rep passthrough) and `bestSet` in `src/lib/one-rep-max.ts`; `MAX_RELIABLE_REPS = 12` labeling convention must carry into stats display.
- Week context exists: `nextProgramWeek` + `deriveDayPrescription` in `src/db/programs.ts`, already used by `src/app/programs/[id]/page.tsx`.
- Weights stored in kg (`numeric(6,2)`); convert at display via existing `src/lib/units.ts` + `getWeightUnit` preference, same as program detail page.
- New aggregate lives in `src/db/` (e.g. `program-stats.ts`) following the existing Drizzle query style in `workouts.ts`/`programs.ts`; server component consumes it like `page.tsx` does today.
- MCP tool (if confirmed) follows the `read-tools.ts` registration pattern with its existing test conventions.
- Caveat: workouts keep `programDayId` but **not** a direct `programId`; day deletion sets provenance NULL. Stats join through `programDays`, so sessions from deleted days silently drop out of stats — acceptable for POC, worth a code comment.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Provenance loss on program edit (full-replace `upsert_program` regenerates day IDs → old workouts orphaned) | H | Document; prefer granular patch tools for edits once a block is underway; consider denormalizing `programId` onto workouts later |
| Null weights (machine lifts) skew tonnage | M | Sets always count; tonnage computed over non-null-weight sets only, labeled |
| Sparse early-block data makes stats look broken | M | Empty/1-week states designed explicitly ("not enough data yet") |

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
| 1 | Stats data layer | `src/db/program-stats.ts`: aggregate program-linked workouts into per-week adherence, volume, and per-exercise progression (TDD, kg-domain) | complete | - | - | [plan](../plans/completed/program-stats-data-layer.plan.md) · [report](../reports/program-stats-data-layer-report.md) |
| 2 | Stats UI | Stats tab/section on program detail page: adherence header, weekly volume strip, progression table; empty states | complete | - | 1 | [plan](../plans/completed/program-stats-ui.plan.md) · [report](../reports/program-stats-ui-report.md) |
| 3 | Program PRs | Baseline vs. best e1RM per exercise within block, added to data layer + UI | complete | with 4 | 1, 2 | [plan](../plans/completed/program-stats-prs-and-mcp.plan.md) · [report](../reports/program-stats-prs-and-mcp-report.md) |
| 4 | MCP `get_program_stats` | Read tool exposing the phase-1 aggregate; open question resolved YES (2026-07-11) | complete | with 3 | 1 | [plan](../plans/completed/program-stats-prs-and-mcp.plan.md) · [report](../reports/program-stats-prs-and-mcp-report.md) |

### Phase Details

**Phase 1: Stats data layer**
- **Goal**: One tested module answering all four stat questions in kg-domain data structures.
- **Scope**: Drizzle aggregate(s) joining workouts → programDays → program, keyed by `programWeek`; planned-days baseline from program days count; unit tests per existing `src/db/*.test.ts` conventions.
- **Success signal**: Tests cover multi-week, sparse, null-weight, and ad-hoc-workout-excluded cases.

**Phase 2: Stats UI**
- **Goal**: The one-screen block check-in.
- **Scope**: Server-component section on `programs/[id]` (tab or anchor), unit conversion at display, no chart dependency; "not enough data yet" state.
- **Success signal**: Live block renders week position, adherence, volume, and at least one lift's progression with real data.

**Phase 3: Program PRs**
- **Goal**: "Did the block work" summary.
- **Scope**: Per-exercise first-available vs. best e1RM within program, `Est.` labeling per `MAX_RELIABLE_REPS`.
- **Success signal**: PR list matches manual calculation on real block data.

**Phase 4: MCP get_program_stats**
- **Goal**: Claude can answer "how's my program going?"
- **Scope**: Read tool wrapping phase-1 aggregate, unit-aware output, registered + tested per `read-tools.ts` patterns.
- **Success signal**: Tool returns the same numbers the UI shows.

### Parallelism Notes

Phases 3 and 4 both consume the phase-1 data layer and touch disjoint surfaces (UI vs. MCP), so they can run concurrently once phase 1 (and for 3, phase 2's UI slot) is in.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Scoping model | Per-program | Per-gym entity; per-exercise loadBasis field | Program = one gym in practice; zero schema cost; user's own framing |
| Global exercise stats | Unchanged | Program-scope `getLastPerformance` with fallback | User explicitly accepted the trade-off; keeps barbell history whole |
| All 4 stat categories in scope | Yes, phased | v1 = progression + adherence only | User: "all 4"; PRs/MCP deferred to later phases, not cut |
| Viz approach | Tables + simple bars, no chart lib | Recharts/etc. | POC bundle discipline; existing UI is table-based |

---

## Research Summary

**Market Context**
Mainstream trackers (Strong, Hevy, Boostcamp) keep exercise history global and *do not* solve cross-gym machine incomparability; their program/routine stats are limited to adherence streaks and per-routine volume. Program-scoped progression as the primary lens is the differentiated (and simpler) cut here. (From prior product knowledge; not re-verified — low risk, informs framing only.)

**Technical Context**
All required provenance and math already exist: `workouts.programDayId`/`programWeek` (`src/db/schema.ts`), `estimate1RM`/`bestSet` (`src/lib/one-rep-max.ts`), week derivation (`src/db/programs.ts`), unit handling (`src/lib/units.ts`), MCP read-tool pattern (`src/lib/mcp/read-tools.ts`). Main structural caveat: no direct `workouts.programId`; stats join through `programDays`, and full-replace program edits orphan provenance — flagged as the top risk.

---

*Generated: 2026-07-04*
*Status: DRAFT - needs validation*
