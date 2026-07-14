# Spike: Program Lifecycle — Leave / Restart / Start New

**Date**: 2026-07-12 · **Status**: exploration, no code changes

## What exists today

| Primitive | Where | Behavior |
|---|---|---|
| `programs.status` | `schema.ts:220` | `draft \| active \| archived`; toggled on the program page (`ProgramActions`: Activate/Archive) and MCP `set_program_status` |
| "Active program" | `getNextProgramDay` | Most recently **updated** program with status `active` — nothing enforces a single active; recency is a silent tiebreak |
| A "run" of a program | implicit | Weeks derive from `max(workouts.programWeek)` joined through the program's days. One program row = one run, forever |
| End of block | `nextProgramWeek` (`programs.ts:329-330`) | Clamps at `mesocycleWeeks`: a finished program **re-runs its final week indefinitely** (`pickNextProgramDay` wraps to day 1). No completion moment |
| Delete | `deleteProgramAction` | Program cascade; workouts survive with `programDayId` SET NULL — they orphan out of program stats/week view (documented blind spot) |

## The three stories vs. reality

### 1. "Leave a program" — 90% exists
Archive **is** leave: history stays intact, stats/week view still work (read-only), the hero stops suggesting it. Gaps are UX, not model:
- The button says "Archive" — gym users think "leave/stop this program".
- No confirmation, and no acknowledgment of an in-flight week ("you're mid-week 3 — history is kept").
- An unfinished session from the program stays live (home banner) — correct, but worth a line in the confirm copy.

### 2. "Restart a program" — the real gap
Provenance is `(programDayId, programWeek)` with **no run dimension**. If a user re-runs a block, week numbers restart at 1, but:
- `nextProgramWeek` reads `max(programWeek)` over all history → permanently stuck at the final week; the hero and Start buttons never return to week 1.
- Stats would merge runs: tonnage/adherence/progression from run 1 and run 2 collapse into one axis.
- Resume-on-start only resumes *unfinished* rows, so a completed week-1 day from run 1 blocks nothing — but the week view's `resolveDayState` would show run 1's result as run 2's week-1 card (completed beats in-progress).

**Options considered**

| Option | Shape | Cost | Verdict |
|---|---|---|---|
| A. `program_runs` table | New entity; workouts stamp `runId`; every consumer (nextProgramWeek, stats, week view, hero, resume) scopes to the current run; migration backfills run 1 | Large — touches the whole provenance read path + migration | Right long-term model, wrong POC cost |
| B. **Clone-as-new-block** | "Restart block" duplicates the program (days/exercises/sets/overrides/supersets) as a fresh program row ("PPL — Block 2"), archives the old one, activates the clone | Medium-small — one server action + faithful clone mapping; zero provenance-model change, no migration | **Recommended.** A block = one program row = one self-consistent context, exactly the existing provenance philosophy. Stats stay per-block honest by construction; old blocks read as history in the archived list |
| C. `cycleNumber` column | `programs.currentCycle` + stamp on workouts; restart increments | Medium — still touches every consumer's filters, halfway to A without its clarity | Dominated by A and B |

Option B gotchas (from `upsert_program` history): the clone must go through a **faithful** program-detail → input mapping — the known "full-replace wipes supersets" bug class. Clone must carry supersets, techniques, per-week overrides, progression schemes, deload week. Long-term exercise history is unaffected (progression engine and ghosts read all-time by `wgerExerciseId`, not per program).

### 3. "Start a new program" — exists, missing one guardrail
Creation (builder + MCP) and activation work. The gap: activating program B while A is active leaves **two** actives, and the hero silently follows `updatedAt` recency. Fix: on activate, auto-archive (or confirm-archive) any other active program — single-active-by-intent, one small change in `setProgramStatus` or its action.

## The connective tissue: a block-completion moment
All three stories converge on the same missing moment. When every week ≤ `mesocycleWeeks` is complete, the app should *say so* instead of silently re-running the final week:
- Program page + home hero: "Block complete — 7 weeks · [restart block] [archive]".
- This is the natural home for Restart (option B) and Leave, and it's detectable today (`nextProgramWeek` already computes `cycleComplete` internally — it just clamps instead of surfacing).

## Competitor survey (web research, 2026-07-12)

The market splits cleanly into two models:

**Template-repeat apps (no block identity):**
- **Strong** — no program/week concept at all: folders of reusable templates; "switching programs" just changes which templates show on the home screen; history persists independently. Leave/restart are non-problems because there's nothing to leave.
- **Stronglifts** — cycles are implicit: weights auto-increment workout-to-workout; a program "reset" restores defaults and weights resume where you left off. No block boundary.

**Block-instance apps (a finished block spawns a new one) — our category:**
- **RP Hypertrophy** — the mesocycle is a first-class *instance*: finishing one lands you on a "plan a new mesocycle" page, and a finished meso can be **recreated in two clicks** as a fresh instance. Exactly the clone-as-new-block shape.
- **Boostcamp** — explicit **restart program** flow with two notable options: **carry over the edits** you made to workouts during the previous cycle into the new one, and **reset PRs to a new baseline** so targets stay reachable while full PR history is preserved.
- **Hevy** — programs restartable/cyclable; after each workout it asks whether to **fold your session edits back into the routine template** (keep original vs update).
- **JuggernautAI** — fully adaptive: blocks auto-roll into the next phase (hypertrophy → strength) with deloads inserted; no manual restart moment at all. (Out of our scope, but shows where "restart" disappears entirely at the high end.)

**Takeaways for this spike:**
1. Option B (clone-as-new-block) is the *established* pattern in our category — RP's "recreate meso" and Boostcamp's "restart program" are both new-instance creations, not in-place week resets. No surveyed app rewinds week counters on the same entity (option A/C's shape).
2. Boostcamp's **carry-over-edits** prompt is worth copying: restart should offer "clone as originally written" vs "clone with the tweaks I made along the way" (we track per-week overrides — the second option maps to folding session reality back into the template).
3. RP's completion → "plan new meso" page validates the block-completion moment as the restart entry point.
4. Boostcamp's baseline-reset is a Phase-3-adjacent idea: a new block's PR section starts a fresh baseline automatically under clone-as-new-block — we get their headline feature for free.

Sources: [Hevy routines](https://www.hevyapp.com/features/gym-routines/), [Hevy programming options](https://www.hevyapp.com/features/exercise-programming-options/), [Boostcamp](https://www.boostcamp.app/), [RP Hypertrophy help — Where to start](https://hypertrophy.zendesk.com/hc/en-us/articles/32430129362327-Where-to-start), [RP app updates](https://rpstrength.com/blogs/podcasts/major-updates-to-the-rp-diet-hypertrophy-apps-rp-strength), [Strong help center](https://help.strongapp.io/), [Stronglifts progression](https://support.stronglifts.com/article/71-progression), [JuggernautAI](https://www.juggernautai.app/blog/juggernautai-25)

## Suggested phasing (if this becomes a PRD)
1. **Single-active enforcement + "Leave program" copy/confirm** — small, pure UX + one action tweak.
2. **Block-completion state** — expose "complete" from the week math; render the completion card on program page + hero.
3. **Restart via clone** — `restartProgramAction` (clone + archive + activate), entry points on the completion card and archived programs. TDD the clone fidelity (supersets/overrides/techniques round-trip).
4. *(Later, if multi-run analytics matter)* — promote to `program_runs` with a backfill; the clone approach migrates cleanly since each block is already a separate program id.

## Open questions for the PRD
- Restart mid-block allowed (abandon week 3, start over), or only from completion? (Lean: allow both; mid-block restart archives the partial block.)
- Clone naming: auto "— Block 2" suffix vs. user-editable at restart time?
- Should the completion card also show the block's PR summary (stats page Phase 3 data is right there)? Strong yes — it's the payoff moment.
- Does "leave" ever mean delete? (Lean: no — archive only; delete stays a separate destructive action.)
