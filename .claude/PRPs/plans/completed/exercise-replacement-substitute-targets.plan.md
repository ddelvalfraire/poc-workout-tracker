# Plan: Exercise Replacement — Substitute Targets (Phase 3)

## Summary
A swapped exercise gets honest plan targets, not just history ghosts: a new server action re-derives the ORIGINAL slot's week-N prescription for the SUBSTITUTE — same set scheme, rest, and technique, but with the original movement's absolute loads stripped (template `suggestedLoadKg`, TM-based progressions) so nothing squat-scale ever ghosts onto a leg press. The engine is reused untouched: `deriveDayPrescription` already accepts a synthetic one-exercise day, and its history reads then target the substitute's id. The logger overlays the result on `planTargets` via a small client-side map, feeding both ghost placeholders and the rest countdown.

## User Story
As a lifter who swapped a taken machine, I want the substitute to carry my plan's set/rep/rest scheme with loads that make sense for THAT movement, so the swap doesn't cost me the program's guidance.

## Problem → Solution
After a swap the plan ghosts vanish (`planTargets` is keyed to the original id) → derive the slot's prescription for the substitute (loads from ITS history where the scheme supports it; null loads otherwise — never the original's) and merge it into the logger's ghost/rest lookups.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-replacement.prd.md`
- **PRD Phase**: Phase 3 — Substitute targets
- **Estimated Files**: 5

---

## CRITICAL DESIGN — what transfers and what must be stripped

Verified against `src/lib/progression.ts` (`schemeLoad`, 175-214; `amrapCycleTargets`, 221-241):

| Progression scheme | Load anchor | Substitute treatment |
|---|---|---|
| `rpe-target` | `history.e1rmKg` × percent | **KEEP** — history reads target the substitute's id, so loads are leg-press-scale by construction (the PRD's success case) |
| `rep-progression` | template base (targets-only scheme) | KEEP — bumps reps/duration; loads null once base is stripped |
| `weekly-volume` | template base (count-only scheme) | KEEP — set-count wave survives; loads null once base is stripped |
| `linear` / `double-progression` | template `suggestedLoadKg` + increment | KEEP the scheme, STRIP the base → loads null (rep scheme + advance logic intact, no squat-scale loads) |
| `percent-1rm` / `amrap-cycle` | `progression.trainingMaxKg` | **DROP the progression** (→ null) — the TM is an original-movement absolute; loads would be wrong regardless of base. Falls back to template targets (amrap wave reps are lost — accepted) |

Also stripped: `suggestedLoadKg` on every template set AND on every per-week override (both carry original-movement loads; rep/rest/technique overrides survive). Result: the substitute's plan ghost shows the full scheme — sets × reps, RIR/RPE, rest, technique — with loads only where they're honestly derivable. Real loads otherwise come from the substitute's HISTORY ghost, which already wins over the plan ghost in the logger.

**Reuse over new engine code**: no new derivation function. The action builds a one-exercise `DayForDerivation` (`{ exercises: [sanitizedSlot], program }`) with the substitute's `wgerExerciseId` and calls the existing `deriveDayPrescription` — its `getExerciseHistoryBefore`/`getLastPerformance` reads then key on the substitute automatically (verified: `src/db/programs.ts:648-704` keys everything on `exercise.wgerExerciseId`).

---

## UX Design

### Before
```
Swap Squat → Leg Press:
  Leg Press sets show HISTORY ghosts only (last leg-press session).
  First-ever leg press: no ghosts at all; rest countdown loses the plan's restSec.
```

### After
```
Swap Squat → Leg Press:
  Ghosts show the PLAN scheme re-derived for leg press:
    reps 8–12 (the slot's scheme), rest 120s, technique chips —
    loads from leg-press history under rpe-target; blank loads otherwise
    (history ghost still wins when it exists).
  Rest countdown keeps the slot's prescribed restSec.
No visible change for unswapped exercises or ad-hoc workouts.
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Swapped exercise ghosts | history-only | plan scheme merged back in | best-effort async; ghosts fill in when the action returns |
| Rest countdown after swap | falls to session default | keeps the slot's restSec | same merged lookup |
| Unswapped exercises / ad-hoc | — | zero change | overlay map empty |
| Page reload after swap | — | plan ghost gone again (overlay is client state) | accepted POC edge; history ghosts carry |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/programs.ts` | 636-704 | `DayForDerivation` + `deriveDayPrescription` — the exact shape the action synthesizes; history keyed by `wgerExerciseId` |
| P0 | `src/lib/progression.ts` | 55-140 (`ProgramSetRowLike`, `SetOverrideLike`), 175-241 (`schemeLoad`, `amrapCycleTargets`) | The load-anchor table above — what the sanitizer strips and why |
| P0 | `src/app/workout/[id]/edit/page.tsx` | 21-46 | `loadPlanTargets` — the `PlanSetTarget` mapping the action mirrors (repMin/repMax/loadKg/restSec) and the provenance guards (`programDayId`/`programWeek` null → undefined) |
| P0 | `src/app/workout/new/workout-logger.tsx` | ghost derivation (~592-614), rest resolve (~718), `performReplace` | The two `planTargets?.[id]` read sites to route through the merged lookup; where the fetch fires |
| P1 | `src/app/workout/actions.ts` | 75-85 (`getLastPerformanceAction`) | Server-action conventions in THIS file: requireUserId, `Number.isInteger` guard, positive-id check |
| P1 | `src/db/workouts.ts` | getWorkoutDetail | Ownership-gated read carrying `programDayId`/`programWeek` |
| P2 | `src/lib/format.ts` | 181-210 | `PlanSetTarget` + `planPlaceholderForSet` (consumes the array; no changes needed) |
| P2 | `src/lib/block-name.ts` | all | Pure-helper module convention for the sanitizer |

## External Documentation
None — established internal patterns only.

---

## Patterns to Mirror

### ACTION_GUARDS (this file's own conventions)
```ts
// SOURCE: src/app/workout/actions.ts:75-85
export async function getLastPerformanceAction(
  wgerExerciseId: unknown,
  excludeWorkoutId?: unknown,
): Promise<LastPerformance | null> {
  const userId = await requireUserId()
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  ...
}
```

### PLAN_TARGET_MAPPING (mirror exactly — ghosts must match instantiation)
```ts
// SOURCE: src/app/workout/[id]/edit/page.tsx:29-41
const derived = await deriveDayPrescription(userId, day, workout.programWeek)
...
targets[exercise.wgerExerciseId] = derived[i].map((s) => ({
  repMin: s.repMin,
  repMax: s.repMax,
  loadKg: s.loadKg,
  restSec: s.restSec,
}))
```

### PROVENANCE_GUARDS (null out, don't throw — ad-hoc workouts are normal)
```ts
// SOURCE: src/app/workout/[id]/edit/page.tsx:25-27
if (!workout.programDayId || !workout.programWeek) return undefined
const day = await getProgramDayDetail(userId, workout.programDayId)
if (!day) return undefined
```

### PURE_HELPER_MODULE
```ts
// SOURCE: src/lib/block-name.ts (shape) — JSDoc states the policy, co-located test
```

### BEST_EFFORT_CLIENT_FETCH (non-critical enhancement, silent failure)
```ts
// SOURCE: src/app/workout/new/workout-logger.tsx:277-299 (draft restore effect)
getWorkoutDraftAction(key)
  .then((payload) => { ... })
  .catch(() => {
    // Non-critical: restore is best-effort; the logger works without it.
  })
```

### GHOST_LOOKUP_SITES (the two reads to merge)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:601-605 and :718
const plan = planPlaceholderForSet(planTargets?.[exercise.wgerExerciseId], setIndex, unit)
...
resolveRestTarget(planTargets?.[exercise.wgerExerciseId], setIndex, null),
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/substitute-slot.ts` | CREATE | Pure sanitizer: strip original-movement loads/TMs from a slot |
| `src/lib/substitute-slot.test.ts` | CREATE | TDD for the strip/keep table |
| `src/app/workout/actions.ts` | UPDATE | `substitutePlanTargetsAction` — synthesize the one-exercise day, derive, map |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | `planOverrides` state, merged lookup at both read sites, fetch in `performReplace` |
| `.claude/PRPs/prds/exercise-replacement.prd.md` | UPDATE | Phase 3 status at report time |

## NOT Building

- Engine changes — `deriveWeekSets`/`deriveDayPrescription` untouched
- Persisting the derived targets (draft payload/schema unchanged) — overlay is in-memory; a reload falls back to history ghosts (documented edge)
- Re-keying after "Add instead" — an added exercise is a new slot with no plan; history ghosts only (existing behavior)
- Cross-scheme load translation (e.g. scaling the original's TM by e1RM ratios) — clever and wrong-prone; null loads are honest
- Server-side batch derivation for multiple swaps — one call per swap is plenty

---

## Step-by-Step Tasks

### Task 1: Failing sanitizer tests (RED)
- **ACTION**: Create `src/lib/substitute-slot.test.ts`.
- **IMPLEMENT**: Fixture helpers building full `ProgramSetRowLike` rows + overrides. Cases for `substituteSlot(slot, 42)`:
  1. **re-ids the slot**: result `wgerExerciseId` is 42.
  2. **strips template loads**: every set's `suggestedLoadKg` → null; ALL other set fields (repMin/repMax/rir/rpe/tempo/durationSec/distanceM/restSec/technique/setNumber/setType/metricMode) preserved verbatim.
  3. **strips override loads, keeps override targets**: override `suggestedLoadKg` → null, its `restSec: 150` and `week: 3` survive.
  4. **drops TM-based progressions**: `percent-1rm` → null; `amrap-cycle` → null.
  5. **keeps history/structure schemes**: `rpe-target`, `rep-progression`, `weekly-volume`, `linear`, `double-progression` pass through unchanged; null progression stays null.
  6. **does not mutate the input** (deep: original set still has `suggestedLoadKg: 100`).
- **MIRROR**: PURE_HELPER_MODULE test voice; immutability asserts like workout-draft.test.ts.
- **VALIDATE**: `npm test -- src/lib/substitute-slot.test.ts` → RED.

### Task 2: `substituteSlot` (GREEN)
- **ACTION**: Create `src/lib/substitute-slot.ts`.
- **IMPLEMENT**:
  ```ts
  import type { Progression, ProgramSetRowLike, SetOverrideLike } from './progression'

  /** The slot slice the substitution re-derives — matches DayForDerivation's
   *  exercise element (db/programs.ts). */
  export interface SlotForSubstitution {
    wgerExerciseId: number
    progression: Progression | null
    sets: (ProgramSetRowLike & { overrides: (SetOverrideLike & { week: number })[] })[]
  }

  /** Schemes whose loads come from an ORIGINAL-movement training max — kept,
   *  they'd prescribe squat loads to a leg press. Base-anchored schemes are
   *  fine once the base is stripped (loads go null); rpe-target anchors on
   *  the substitute's own history e1RM and transfers perfectly. */
  const TM_BASED_SCHEMES = new Set(['percent-1rm', 'amrap-cycle'])

  /**
   * The original slot re-pointed at the substitute, with every absolute load
   * that belongs to the ORIGINAL movement stripped: template suggestedLoadKg,
   * override suggestedLoadKg, and TM-based progressions. Set scheme, rep
   * ranges, RIR/RPE, rest, technique, and rep/rest overrides all survive —
   * the plan's structure transfers; its loads don't (same meaning-change rule
   * as the swap's value reset). Feed the result to deriveDayPrescription as a
   * one-exercise day: the engine's history reads then target the substitute.
   */
  export function substituteSlot(slot: SlotForSubstitution, substituteId: number): SlotForSubstitution {
    return {
      wgerExerciseId: substituteId,
      progression:
        slot.progression && TM_BASED_SCHEMES.has(slot.progression.scheme) ? null : slot.progression,
      sets: slot.sets.map((set) => ({
        ...set,
        suggestedLoadKg: null,
        overrides: set.overrides.map((o) => ({ ...o, suggestedLoadKg: null })),
      })),
    }
  }
  ```
- **MIRROR**: PURE_HELPER_MODULE.
- **GOTCHA**: Fresh objects at every level touched (set + override spreads) — no input mutation.
- **VALIDATE**: Task 1 green; `npx tsc --noEmit`.

### Task 3: `substitutePlanTargetsAction`
- **ACTION**: Add to `src/app/workout/actions.ts`.
- **IMPLEMENT**:
  ```ts
  /**
   * Week-N plan targets for a MID-SESSION substitute: the original slot's
   * scheme re-derived for the replacement exercise (loads from the
   * substitute's own history where the scheme supports it; original-movement
   * absolutes stripped — see lib/substitute-slot). Null (not a throw) when
   * the workout is ad-hoc, provenance is gone, or the original isn't in the
   * day — the logger just keeps history-only ghosts.
   */
  export async function substitutePlanTargetsAction(
    workoutId: unknown,
    originalWgerExerciseId: unknown,
    substituteWgerExerciseId: unknown,
  ): Promise<PlanSetTarget[] | null> {
    const userId = await requireUserId()
    if (typeof workoutId !== 'string' || workoutId.length === 0) {
      throw new Error('invalid workout id')
    }
    if (!Number.isInteger(originalWgerExerciseId) || (originalWgerExerciseId as number) <= 0) {
      throw new Error('invalid exercise id')
    }
    if (!Number.isInteger(substituteWgerExerciseId) || (substituteWgerExerciseId as number) <= 0) {
      throw new Error('invalid exercise id')
    }
    const workout = await getWorkoutDetail(userId, workoutId)
    if (!workout?.programDayId || !workout.programWeek) return null
    const day = await getProgramDayDetail(userId, workout.programDayId)
    if (!day) return null
    const slot = day.exercises.find((e) => e.wgerExerciseId === originalWgerExerciseId)
    if (!slot) return null

    // One-exercise synthetic day: the engine's history reads key on the
    // exercise id, so re-pointing the slot derives SUBSTITUTE-scale loads.
    const [derived] = await deriveDayPrescription(
      userId,
      { exercises: [substituteSlot(slot, substituteWgerExerciseId as number)], program: day.program },
      workout.programWeek,
    )
    return derived.map((s) => ({ repMin: s.repMin, repMax: s.repMax, loadKg: s.loadKg, restSec: s.restSec }))
  }
  ```
- **MIRROR**: ACTION_GUARDS, PROVENANCE_GUARDS, PLAN_TARGET_MAPPING (field-for-field).
- **IMPORTS**: `getProgramDayDetail, deriveDayPrescription` from `@/db/programs`; `substituteSlot` from `@/lib/substitute-slot`; `type PlanSetTarget` from `@/lib/format`; `getWorkoutDetail` (verify the file's existing import block — likely present).
- **GOTCHA**: `day.program` from `getProgramDayDetail` carries `mesocycleWeeks`/`deloadWeek` (same object `instantiateProgramDay` derives from) — pass straight through; first-match slot lookup mirrors loadPlanTargets' first-slot-wins.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 4: Logger overlay
- **ACTION**: Update `src/app/workout/new/workout-logger.tsx`.
- **IMPLEMENT**:
  1. Import `substitutePlanTargetsAction` (joins the actions import).
  2. State near the replace state: `const [planOverrides, setPlanOverrides] = useState<Record<number, PlanSetTarget[]>>({})` — comment: substitute targets fetched after a swap; overlays the server-seeded `planTargets` (still keyed to the plan's original exercises). In-memory only: a reload falls back to history ghosts (accepted).
  3. Merged lookup — one helper inside the component:
     ```ts
     // Substitute overlay first, then the server-seeded plan — both ghost
     // placeholders and the rest countdown must see the same answer.
     const planFor = (id: number) => planOverrides[id] ?? planTargets?.[id]
     ```
     Replace BOTH read sites: ghost derivation (`planPlaceholderForSet(planFor(exercise.wgerExerciseId), ...)`) and rest resolve (`resolveRestTarget(planFor(exercise.wgerExerciseId), setIndex, null)`).
  4. Fire in `performReplace`, after `pushRemoved` — best-effort, only when this session can have a plan:
     ```ts
     // Re-derive the slot's plan targets for the substitute (loads from ITS
     // history) — best-effort enhancement: ghosts stay history-only if this
     // fails or the workout is ad-hoc.
     if (workoutId) {
       substitutePlanTargetsAction(workoutId, previous.wgerExerciseId, picked.wgerExerciseId)
         .then((targets) => {
           if (targets) {
             setPlanOverrides((prev) => ({ ...prev, [picked.wgerExerciseId]: targets }))
           }
         })
         .catch(() => {
           // Non-critical: the swap already stands on history ghosts.
         })
     }
     ```
- **MIRROR**: BEST_EFFORT_CLIENT_FETCH; GHOST_LOOKUP_SITES.
- **GOTCHA 1**: Key the overlay by the SUBSTITUTE's id — undo restores the original, whose ghosts still resolve via `planTargets`; a stale overlay entry for the substitute is unreachable and harmless.
- **GOTCHA 2**: Do NOT gate on `programContext` — `workoutId` is the honest gate; the action itself nulls for ad-hoc workouts.
- **GOTCHA 3**: Weight ghosts stay `weight_reps`-only (existing ghost logic, untouched) — a substitute defaulting to `weight_reps` gets load ghosts; switching to a BW type drops them, correctly.
- **VALIDATE**: `npx tsc --noEmit`; `npm run build`.

### Task 5: Full validation
- **VALIDATE**: commands below; diff touches only listed files; manual dev pass.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| re-ids the slot | slot + substitute id | wgerExerciseId = substitute | |
| strips template loads | set with suggestedLoadKg | null load, all else verbatim | core |
| strips override loads only | override with load + restSec | load null, restSec/week survive | core |
| drops TM schemes | percent-1rm, amrap-cycle | progression null | core |
| keeps other schemes | rpe-target, rep-progression, weekly-volume, linear, double-progression, null | unchanged | |
| no input mutation | any | original untouched (deep) | ✓ |

Action + logger wiring: no test files (repo convention — the composition rides the already-tested engine; UI by build + manual).

### Edge Cases Checklist
- [x] Ad-hoc workout (no provenance) → action nulls; no overlay
- [x] Original not in the day (double-swap: original id is the first substitute) → action nulls; history ghosts only — accepted
- [x] Substitute with no history + rpe-target → e1rmKg null → loadKg null (scheme ghost without loads, the PRD fallback)
- [x] Deload week → derived loads (where present) get the deload factor via the untouched engine path
- [x] Reload mid-session → overlay lost, history ghosts carry (documented)
- [ ] Concurrent double-swap racing two fetches — last write wins per id; harmless

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/lib/substitute-slot.ts src/lib/substitute-slot.test.ts src/app/workout/actions.ts src/app/workout/new/workout-logger.tsx
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/lib/substitute-slot.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 976 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Program session: swap an exercise → within a beat, empty sets show the slot's rep scheme (and rest countdown keeps the plan's restSec)
- [ ] Substitute WITH history: history ghost still wins (loads from last session)
- [ ] Substitute WITHOUT history: plan ghost shows reps (+ loads only under rpe-target)
- [ ] Ad-hoc session: swap works, no plan ghosts appear, no errors
- [ ] Undo: original's plan ghosts intact

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] No original-movement absolute load can reach a substitute (template, override, or TM path)
- [ ] Both ghost and rest-countdown reads use the merged lookup
- [ ] Ad-hoc/missing-provenance paths null quietly; UI never blocks on the fetch
- [ ] Engine untouched

## Completion Checklist
- [ ] Sanitizer pure + immutable, co-located test
- [ ] Action mirrors loadPlanTargets' mapping field-for-field
- [ ] Best-effort fetch with silent catch (draft-restore precedent)
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A scheme leaks original loads through an unconsidered path | L | Wrong targets | The strip/keep table was built from reading schemeLoad line-by-line; tests pin each scheme |
| Overlay/planTargets divergence if a third read site appears later | L | Inconsistent ghosts | Single `planFor` helper is the choke point; comment says so |
| Async overlay lands after the user typed values | L | None — ghosts never overwrite typed input (placeholder semantics) | By construction |

## Notes
- Phase 4 (ask-to-remember) hangs off the same `performReplace` and is the PRD's last phase.
- If chained re-swaps (original → sub A → sub B) ever matter, the fix is passing the PLAN's original id through the replace flow — noted, not built.
