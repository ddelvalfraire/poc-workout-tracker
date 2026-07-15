# Exercise Replacement (Mid-Session Swap)

## Problem Statement

A lifter mid-session hits an unavailable exercise — the machine is taken, the rack is full, the gym doesn't have the equipment. Today the logger offers no swap: they either wait, skip the exercise (losing the stimulus and leaving a hole in the session), or hand-add a different exercise with no targets and no connection to the plan. The program's value proposition ("just do today's session") breaks exactly when the gym is busiest.

## Evidence

- Personal experience (the app's primary user): busy-gym equipment conflicts are a weekly occurrence — assumption grounded in direct use, not analytics.
- Every major competitor treats this as table stakes: Hevy/Strong have "Replace exercise" mid-workout, Fitbod swaps by equipment availability, RP/Juggernaut publish substitution lists per movement pattern. (Informal market scan, not fresh research.)

## Proposed Solution

A "Replace" action on each exercise in the live logger: opens the existing exercise sheet with a new muscle-matched suggestions rail (ranked from the cached wger catalog by shared primary muscles, equipment-aware) plus the existing search as fallback. The swap changes the exercise's identity in the draft (one-off by default), keeps the set scheme, and re-derives load targets from the substitute's own history via the existing progression engine. After a swap, a "use this for the rest of the block?" prompt can persist it into the program through the narrow `updateProgramExercise` patch (which keeps per-week overrides and re-tags muscles).

## Key Hypothesis

We believe an in-logger swap with muscle-matched suggestions and honest targets will keep program sessions intact when equipment is unavailable.
We'll know we're right when equipment conflicts stop producing skipped exercises or orphan hand-added exercises in program sessions.

## What We're NOT Building

- **Custom-exercise substitutes** — `source` is absent from `DraftExercise`, the workout save path, and `ProgramExercisePatch`; threading it end-to-end is its own effort (and custom exercises are already a deferred track — see `custom-exercises.prd.md`). Suggestions and swaps are wger-only in this PRD.
- **Program-builder swap UI** — swapping in the plan already exists (builder edit, MCP `update_program_exercise`); this PRD is the in-the-moment path.
- **Frequency-based "make it permanent" nudges** — the ask-to-remember prompt covers persistence; auto-detection is a later idea.
- **Equipment-availability profiles** (per-gym equipment lists à la Fitbod) — massive scope; equipment matters here only as a ranking signal.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Swap flow works under real gym conditions | Used in anger ≥1×/week without falling back to hand-adding | Personal use (POC — no analytics) |
| Swapped exercises carry usable targets | Ghost targets present for substitutes with history | Manual verification |
| No stats corruption | Swapped exercise appears as its own progression series; adherence unaffected | Program stats page after swapped sessions |

## Open Questions

- [x] Suggestion ranking → **movement-scale parity matters**: compounds and isolations don't correlate, so ranking must prefer like-for-like (compound↔compound, isolation↔isolation — approximated from the catalog's muscle breadth since wger has no explicit flag) alongside primary-muscle overlap. Best-estimate ordering, search always available.
- [x] Swap after sets logged → **warn, don't block**: "This exercise is partially/fully completed — replace anyway?" with **Add instead** as a first-class alternative (keeps the logged work, appends the substitute as a new exercise).
- [x] Ask-to-remember timing → **immediately after a successful swap**, with anti-nag semantics: prompt offers "Use for the block" / "Just today"; "Just today" snoozes the prompt for that exercise for the rest of the current workout. No persistent snooze store — re-swapping the same exercise in a later week re-prompts once, which is exactly when the question is worth re-asking (and doubles as the it-keeps-happening signal).

---

## Users & Context

**Primary User**
- **Who**: The app's owner — an intermediate lifter running multi-week programs in a commercial gym.
- **Current behavior**: When equipment is taken: waits, skips, or quick-adds a replacement exercise manually with no targets.
- **Trigger**: Standing in the gym, mid-session, next planned exercise unavailable.
- **Success state**: Two taps replace the exercise with a sensible alternative carrying real targets; the session and its stats stay coherent.

**Job to Be Done**
When my planned exercise's equipment is unavailable mid-session, I want to swap in an equivalent movement with honest targets, so I can keep training without breaking my program's structure or data.

**Non-Users**
Freestyle (non-program) sessions — the picker already covers ad-hoc adds; swap is only meaningful where a plan exists. Coaches/multi-user scenarios — single-user POC.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Replace action per exercise in the live logger (one-off, draft-level) | The core "machine is taken" moment |
| Must | Reuse exercise sheet for picking; swap keeps set scheme | Cheapest honest v1; search already exists |
| Must | Undoable swap (existing undo-stack pattern) | Mis-taps mid-workout are common |
| Should | Muscle-matched suggestions rail (wger catalog: shared primary muscles, category, equipment signal) | The "don't make me think at the gym" layer |
| Should | Re-derived targets for the substitute (single-exercise engine wrapper + plan-ghost re-key) | Leg press ≠ squat loads; history ghosts alone cover most cases day one |
| Should | Ask-to-remember prompt persisting via `updateProgramExercise` | User-chosen persistence model |
| Could | Suggestions include recent-swap quick picks | Cheap addition once swaps are recorded in drafts |
| Won't | Custom-exercise substitutes / source threading | Separate effort (see NOT Building) |

### MVP Scope

Phase 1 alone is shippable: Replace button → existing search sheet → identity swap in the draft with undo. History ghosts for the substitute come free (they key on `wgerExerciseId`). Suggestions, re-derived plan targets, and persistence layer on in later phases.

### User Flow

Logger → exercise header → Replace → sheet opens (suggestions on top, search below) → pick → exercise identity + name swap in place, set scheme kept, ghosts now reflect the substitute → (Phase 4) quiet "Use for the rest of the block?" prompt → continue logging.

---

## Technical Approach

**Feasibility**: HIGH for wger→wger (verified against the codebase); custom exercises deliberately excluded.

**Architecture Notes** (file references from exploration, 2026-07-14)
- Logger state: `WorkoutDraft` reducer (`src/app/workout/new/workout-draft.ts`) gains a `REPLACE_EXERCISE` action; draft autosave picks it up for free. Undo via the existing `RemovedEntry` stack pattern (`workout-logger.tsx:65-67`).
- Picker: reuse `ExerciseSheet`/`ExercisePicker` (`src/app/workout/new/exercise-sheet.tsx`, `exercise-picker.tsx`) with an `onReplace` callback; the catalog already loads fully client-side from `/api/exercises?all=1`.
- Suggestions: net-new pure ranking over the cached wger catalog (`Exercise` has `muscles`, `musclesSecondary`, `category`, `equipment` — `src/lib/wger.ts:38-47`). No current search filters by muscle/equipment.
- Targets: `deriveDayPrescription` is day-shaped (`src/db/programs.ts:648-704`); Phase 3 needs a single-exercise wrapper over its internals (`getExerciseHistoryBefore`, `getLastPerformance`, `deriveWeekSets`) + re-keying the logger's `planTargets` map for the swapped id.
- Persistence: `updateProgramExercise` patch (`src/db/program-patches.ts:410-436`) already swaps `wgerExerciseId`/`name`, re-derives muscle tags, and leaves sets (and per-week overrides) untouched — exactly the safe path; NOT the full-replace `updateProgram` (drops overrides).
- Stats: `program-stats.ts` groups by `(source, wgerExerciseId)` — a swap correctly starts a new progression series; adherence counts days, unaffected.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Swap after sets already logged creates ambiguous provenance | M | Warn ("partially/fully completed — replace anyway?") with Add-instead as the safe path; replacing discards the old exercise's logged sets via the undoable swap |
| Suggestion quality is poor (wger taxonomy is coarse) | M | Search always one tap away; ranking is a pure, tested, tunable function |
| Plan-ghost re-key misses → swapped exercise shows stale/no targets | L | Phase 3 tests; history ghosts already correct by construction |
| `wgerExerciseId`-keyed maps collide if two identical exercises in one day | L | Pre-existing constraint in the logger's ghost maps; swap follows the same convention |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Logger swap (search-based, one-off) | REPLACE_EXERCISE reducer case, header Replace control, ExerciseSheet reuse, undo; history ghosts follow automatically | complete | - | - | [plan](../plans/completed/exercise-replacement-logger-swap.plan.md) · [report](../reports/exercise-replacement-logger-swap-report.md) |
| 2 | Muscle-matched suggestions | Pure ranking helper over the cached catalog (primary-muscle overlap, category, equipment signal); suggestions rail in the swap sheet | pending | with 3 | 1 | - |
| 3 | Substitute targets | Single-exercise prescription wrapper; re-key planTargets so plan ghosts survive the swap | pending | with 2 | 1 | - |
| 4 | Ask-to-remember | Post-swap prompt persisting the swap for the block via updateProgramExercise (wger-only; keeps overrides, re-tags muscles) | pending | - | 1 | - |

### Phase Details

**Phase 1: Logger swap (search-based, one-off)**
- **Goal**: The machine-is-taken moment is solved, plainly.
- **Scope**: `REPLACE_EXERCISE` draft action (identity + name + category swap, sets kept); Replace control in the exercise header; `ExerciseSheet` opened in replace mode; undo entry; logged-sets rule: WARN, don't block — "partially/fully completed — replace anyway?" dialog with **Add instead** as a first-class option (keeps logged work, appends the substitute as a new exercise).
- **Success signal**: Mid-session swap in two taps; ghosts show the substitute's history; draft autosave/restore round-trips the swap; a partially-done exercise warns and offers Add instead.

**Phase 2: Muscle-matched suggestions**
- **Goal**: Zero-thought alternatives, like-for-like.
- **Scope**: Tested pure `rankAlternatives(current, catalog)`: share ≥1 primary muscle, **movement-scale parity** (compound↔compound / isolation↔isolation, approximated from muscle breadth — compounds recruit secondary muscles, isolations don't), boost same category, penalize same equipment token (the taken machine); suggestions rail above search in replace mode only.
- **Success signal**: Replacing a machine chest press surfaces presses before flyes; replacing a curl never suggests a row.

**Phase 3: Substitute targets**
- **Goal**: The substitute carries honest plan targets, not just history ghosts.
- **Scope**: Narrow server action deriving week-N sets for an arbitrary wger exercise using the ORIGINAL slot's set scheme (engine internals: history reads + `deriveWeekSets`); logger re-keys `planTargets` for the swapped id.
- **Success signal**: Swapping squat→leg press shows leg-press-scale loads (from its history) under the plan's set/rep scheme; no history → scheme ghosts without loads.

**Phase 4: Ask-to-remember**
- **Goal**: A persistent equipment problem becomes a plan edit in one tap — without nagging.
- **Scope**: Immediately after a successful swap, quiet prompt with "Use for the block" / "Just today". Accept → `updateProgramExercise` patch (wgerExerciseId + name). "Just today" → snooze for that exercise for the REST OF THIS WORKOUT (client-side, in the draft — no persistent snooze store); a fresh swap of the same exercise in a later session re-prompts once. Never shown for freestyle sessions.
- **Success signal**: Accepting updates the program (overrides intact, muscles re-tagged); declining never re-asks within the session; future weeks derive the substitute after an accepted swap.

### Parallelism Notes

Phases 2 and 3 are independent slices over Phase 1's swap flow (UI ranking vs target derivation) — parallelizable. Phase 4 only needs Phase 1 but lands best last: its prompt sits at the end of the flow the earlier phases polish.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Swap surface | Mid-session logger | Program-level only; both | The core scenario is in-the-moment; plan edits already exist |
| Persistence | Ask to remember | One-off only; frequency tracking | User choice; the narrow patch makes it safe (overrides preserved) |
| Suggestions | Muscle-tag ranked + search fallback | Search only; recents | Data already on the catalog; search stays one tap away |
| Targets | Re-derive from substitute's history | Copy as-is; blank | Engine exists; copied loads across equipment are nonsense |
| Custom exercises | Excluded | Include | `source` missing from draft/save/patch paths — its own effort |
| Ranking scale rule | Movement-scale parity (compound↔compound) | Muscle overlap alone | Compounds and isolations don't correlate — a curl must never suggest a row |
| Logged-sets rule | Warn + Add-instead option | Hard block; silent allow | Keeps logged work honest while never dead-ending the user mid-session |
| Prompt anti-nag | "Just today" = in-workout snooze, re-ask next session | Persistent snooze store; per-exercise never-ask | Zero new storage; a repeat swap IS the signal the question deserves re-asking |

---

## Research Summary

**Market Context**
Replace-exercise mid-workout is table stakes in Hevy/Strong; Fitbod's differentiator is equipment-aware swaps; RP/Juggernaut curate substitution lists per movement pattern. Muscle-match + equipment signal is the pragmatic middle. (Informal scan from prior knowledge.)

**Technical Context**
Codebase exploration (2026-07-14) verified: logger reducer/sheet/undo infrastructure is ready for a swap action; the wger catalog carries `muscles`/`equipment` but no search uses them (ranking is net-new); `deriveDayPrescription` needs a single-exercise wrapper for substitute targets; `updateProgramExercise` is the override-safe persistence path; stats bucket by `(source, wgerExerciseId)` so swaps re-bucket cleanly; `source` threading is the blocker that keeps custom exercises out of scope.

---

*Generated: 2026-07-14*
*Status: DRAFT - needs validation*
