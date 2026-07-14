# Program Lifecycle — Leave, Restart, Start New

## Problem Statement

A lifter who finishes (or abandons) a training block has no path forward in the app: a completed program silently re-runs its final week forever, restarting a block corrupts the week math (`nextProgramWeek` reads `max(programWeek)` over all history), and activating a second program leaves two "active" programs with the home hero silently following `updatedAt` recency. The cost: the app dead-ends exactly at its payoff moment — the end of a block.

## Evidence

- `src/db/programs.ts:329-330` — `nextProgramWeek` clamps at `mesocycleWeeks`; a finished block re-offers its final week indefinitely (`pickNextProgramDay` wraps to day 1). There is no completion state anywhere in the app.
- The provenance model `(programDayId, programWeek)` has no run dimension — a second pass through the same program merges into the first on every axis (week derivation, stats, week-view day cards).
- Live user (the developer) is in week 2 of 7 of a real block; this dead-end is ~5 weeks away.
- Competitor survey (spike, 2026-07-12): every block-instance app (RP Hypertrophy, Boostcamp, Hevy) treats restart as **new-instance creation** — RP's "recreate meso in two clicks", Boostcamp's "restart program". None rewind counters in place.

## Proposed Solution

Treat a block as one program row — the model the app already has — and make the lifecycle explicit around it: **leave** = archive with honest copy and a confirm; **restart** = clone-as-new-block ("PPL — Block 2": faithful copy of days/exercises/sets/overrides/supersets as a fresh program, archive the old, activate the clone); **start new** = existing creation plus a single-active guarantee (activating a program archives the previously active one). A new **block-completion state** (derivable from existing week math) surfaces the moment all weeks are done: a completion card on the program page and home hero showing the block's PR summary with Restart/Archive actions — the payoff screen. Chosen over a `program_runs` entity (right long-term model, wrong POC cost — full provenance-path rewrite + migration) and a `cycleNumber` column (all of the touch-points, none of the clarity); the clone approach matches both the app's provenance-is-a-fact philosophy and the dominant competitor pattern, and migrates cleanly to `program_runs` later since each block already has its own id.

## Key Hypothesis

We believe explicit block completion + one-tap restart-as-clone will carry lifters from block N into block N+1 without leaving the app.
We'll know we're right when the live block, on finishing week 7, shows the completion card and a restart produces a correct fresh block (week 1, empty stats, faithful structure) with zero manual re-creation.

## What We're NOT Building

- `program_runs` entity / multi-run analytics — deferred until cross-block analytics matter; clone-per-block migrates cleanly into it
- Carry-over-of-session-edits on restart (Boostcamp-style "with my adjustments") — v1 clones the program **as currently written**; deriving template changes from logged sessions is real scope
- Auto-rolling periodization (JuggernautAI-style next-block generation) — different product
- Delete-as-leave — archive only; delete stays a separate destructive action
- Cross-block PR comparison ("Block 2 vs Block 1") — the per-block PR section already gives Boostcamp's "fresh baseline" for free; comparison UI can come later

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Block N → N+1 continuation | Restart used on the live block at week 7 without manual program re-creation | Live validation (the block finishes ~5 weeks out) |
| Clone fidelity | 100% structural round-trip (days, exercises, sets, supersets, techniques, overrides, progression, deload) | Unit tests on the clone mapping |
| Single-active invariant | Never >1 active program after any activate | Unit test + db check |
| No stuck-at-final-week states | Completion card replaces the silent final-week loop | Manual + week-view assertion |

## Open Questions

- [ ] Clone naming: auto "— Block 2" suffix with collision-aware increment — editable at restart time or only via the builder afterward? (v1 lean: auto-suffix, edit later in builder)
- [x] Home hero at completion: full completion card vs compact "Block complete — see results" banner? → Decided in Phase 2: compact banner on home (program name + weeks + "See results" link), full card with PR deltas on the program page.

---

## Users & Context

**Primary User**
- **Who**: The app's single lifter-developer, mid-mesocycle on a 7-week block, logging via web PWA and Claude/MCP
- **Current behavior**: No block has ever completed; the failure modes are latent but arrive with certainty at week 7
- **Trigger**: Finishing the last day of the last week (or deciding mid-block that the block is dead)
- **Success state**: One tap from "block done" to "block N+1, week 1, day 1", with block N browsable as history

**Job to Be Done**
When my training block ends (or I abandon it), I want to close it out and roll into the next one, so I can keep training without re-building my program or corrupting my history.

**Non-Users**
Lifters who don't use programs (ad-hoc quick-log flow is untouched); multi-user/coaching scenarios.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Single-active enforcement (activate archives the previous active) | Kills the silent recency tiebreak; small change in `setProgramStatus` |
| Must | Block-completion state exposed from week math | The moment everything else hangs off; `nextProgramWeek` already computes `cycleComplete` internally |
| Must | Completion card (program page + home hero) with PR summary + Restart/Archive | The payoff screen; PR data already exists (`getProgramStats`) |
| Must | Restart-as-clone server action with faithful structural copy | The core feature; the clone-fidelity bug class (superset wipe) is the known risk to TDD |
| Must | Restart entry points: completion card AND active program actions (mid-block) AND archived program page | User decision: mid-block do-overs allowed; archives the partial block |
| Should | "Leave program" confirm + copy on the archive action ("history is kept; you're mid-week N") | Lifter vocabulary; tiny |
| Should | MCP `restart_program` tool | MCP-first app; wraps the same server logic |
| Could | Completion push/banner the day the last week completes | Notifications are deferred product-wide |
| Won't | Carry-over session edits, program_runs, cross-block comparisons | See NOT Building |

### MVP Scope

Phases 1–3 below: the invariant, the moment, and the clone. MCP parity rides along as phase 4.

### User Flow

Finish last day of week 7 → program page (and home hero) show "Block complete · 7 weeks" + top PR deltas + [Restart block] [Archive] → Restart → confirm sheet ("creates 'PPL — Block 2' and archives this block") → land on the new program page, week 1, next-up day ready to start.

---

## Technical Approach

**Feasibility**: HIGH — no schema changes, no migration; everything composes from existing primitives.

**Architecture Notes**
- Completion is **derived, not stored**: expose it from the same aggregate `nextProgramWeek` uses (all weeks ≤ mesocycleWeeks have every day completed). Stored status stays `draft|active|archived` — a completed block the user keeps training in is still just "active + complete".
- Clone goes through a **program-detail → ProgramInput mapping** reused by web action and MCP tool — the same shape `saveProgram` consumes. Fidelity is the risk: supersets, techniques, per-week overrides, progression schemes, deload week must round-trip (the documented `upsert_program` superset-wipe bug class).
- Restart = clone (new program id) → archive source → activate clone. Provenance untouched: old workouts keep pointing at the old block's day ids.
- Single-active: `setProgramStatus(userId, id, 'active')` also archives other actives.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Clone drops nested structure (superset/override/technique wipe) | M | TDD the detail→input mapping with a maximal-program fixture; round-trip assertion |
| Completion check adds queries to hot pages (home hero) | L | Derive from data `getNextProgramDay`/program page already fetch; no new round-trips |
| Name collisions ("— Block 2" already exists) | L | Suffix increments ("— Block 3"); unit test |
| Archived-but-live-session edge (leave/restart with an unfinished workout) | M | Restart/archive don't touch workouts; the home banner keeps owning the live session; confirm copy states it |

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
| 1 | Single-active + Leave UX | Activate archives previous active; archive button becomes "Leave program" with confirm + honest copy | complete | - | - | [plan](../plans/completed/program-lifecycle-single-active.plan.md) · [report](../reports/program-lifecycle-single-active-report.md) |
| 2 | Block completion state | Derive+expose completion; completion card on program page + home hero with PR summary and Restart/Archive slots | complete | - | 1 | [plan](../plans/completed/program-lifecycle-block-completion.plan.md) · [report](../reports/program-lifecycle-block-completion-report.md) |
| 3 | Restart-as-clone | Faithful clone mapping (TDD), `restartProgramAction` (clone → archive → activate), entry points: completion card, program actions, archived page | complete | - | 2 | [plan](../plans/completed/program-lifecycle-restart-clone.plan.md) · [report](../reports/program-lifecycle-restart-clone-report.md) |
| 4 | MCP `restart_program` | Tool wrapping the same clone logic; parity tests | complete | - | 3 | [plan](../plans/completed/program-lifecycle-mcp-restart.plan.md) · [report](../reports/program-lifecycle-mcp-restart-report.md) |

### Phase Details

**Phase 1: Single-active + Leave UX**
- **Goal**: The invariant and the vocabulary.
- **Scope**: `setProgramStatus` archives sibling actives on activate (+tests); `ProgramActions` archive path gains ConfirmDialog with "Leave program — your history stays" copy incl. mid-week context.
- **Success signal**: Activating B while A is active leaves exactly one active; leave confirm renders mid-block week context.

**Phase 2: Block completion state**
- **Goal**: The app knows and says a block is done.
- **Scope**: Completion derivation (pure helper over existing week/adherence data, tested); completion card on program page above the day list; home hero variant ("Block complete — [name]" + top PR deltas via `getProgramStats`); Start buttons stay (final-week re-run remains possible).
- **Success signal**: A block with all weeks complete renders the card in both surfaces; incomplete blocks render nothing new.

**Phase 3: Restart-as-clone**
- **Goal**: One tap from block N to block N+1.
- **Scope**: `cloneProgramInput(detail)` mapping with maximal-fixture round-trip tests (supersets/techniques/overrides/progression/deload); `restartProgramAction` = save clone ("Name — Block k") → archive source → activate clone → return new id; confirm sheet; entry points on completion card, active program actions ("Restart block"), archived program page.
- **Success signal**: Restarting the live block yields a week-1 fresh program whose builder view is structurally identical to the source; source archived with intact stats.

**Phase 4: MCP `restart_program`**
- **Goal**: Claude can roll a block over.
- **Scope**: Tool wrapping the same clone+archive+activate path, registered/tested per program-tools conventions; registry count tests updated.
- **Success signal**: Tool returns the new programId; same fidelity guarantees hold through the MCP path.

### Parallelism Notes

Sequential by dependency (invariant → moment → action → parity), but each phase is small; 2 and 3 could overlap if the completion card ships with a placeholder Restart slot.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Restart model | B: clone-as-new-block | A: `program_runs` entity; C: `cycleNumber` column | Zero model change, matches provenance philosophy + RP/Boostcamp pattern; migrates cleanly to A later (user-approved 2026-07-12) |
| Restart entry points | Completion card + mid-block + archived page | Completion-only | Mid-block do-overs are real; archiving the partial block keeps history honest (user-approved) |
| Clone edits | Clean as-written clone in v1 | Boostcamp-style carry-over option | Carry-over needs template-diff derivation from sessions — real scope, deferred (user-approved) |
| Completion card content | Includes PR summary | Minimal state-only card | It's the payoff moment; data already computed by `getProgramStats` (user-approved) |
| Leave semantics | Archive only, never delete | Delete option in leave flow | Destructive action stays separate |

---

## Research Summary

**Market Context** (spike: `.claude/PRPs/spikes/program-lifecycle.spike.md`)
Template-repeat apps (Strong, Stronglifts) have no block identity — nothing to leave or restart. Block-instance apps (RP Hypertrophy, Boostcamp, Hevy) all restart by creating a **new instance**: RP's two-click meso recreate, Boostcamp's restart-with-options, Hevy's restartable programs. Boostcamp's "reset PRs to a new baseline" falls out of clone-as-new-block for free. No surveyed app rewinds week counters in place.

**Technical Context**
`programs.status` toggle, `deleteProgram` cascade, `nextProgramWeek`'s internal `cycleComplete`, `getProgramDetail`/`saveProgram` (the clone's read/write pair), `getProgramStats` (completion-card PRs) all exist. The one bug class to defend against is clone infidelity (`upsert_program` superset wipe precedent).

---

*Generated: 2026-07-12*
*Status: DRAFT — core decisions user-approved in-session; open questions are cosmetic*
