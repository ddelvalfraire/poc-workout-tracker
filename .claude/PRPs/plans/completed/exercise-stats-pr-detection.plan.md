# Plan: Exercise Stats — Phase 4: Live PR Detection

## Summary
Flag the moment a live session beats an exercise's all-time estimated 1RM: a pure comparison helper, a lean per-exercise "current best" server action, and an "All-time PR" line under the winning set row in the logger. Strictly-greater, weight_reps-only, live sessions only.

## User Story
As the lifter mid-session, I want the app to tell me when a set is an all-time PR, so the record moment is recognized when it happens — not discovered later on the stats page.

## Problem → Solution
Records exist on the stats surfaces but nothing watches the live session → the logger preloads each exercise's best e1RM and badges the set that beats it.

## Metadata
- **Complexity**: Small-Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-stats.prd.md`
- **PRD Phase**: 4 — PR detection
- **Estimated Files**: 5

---

## UX Design

### Before
Completed sets look identical whether they're routine or a lifetime best.

### After
```
[✓] [ 5 ] [ 102.5 ]  (🗑)
    ALL-TIME PR            ← volt caption line under the winning set row
```
Appears live as sets are checked off; recomputes if the set is edited/unchecked. Only the session's single best qualifying set carries the flag ("flags exactly once").

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Set row (live session) | check/reps/weight/remove | + PR caption when it beats the all-time best | No layout squeeze — a caption line under the row |
| Edit mode (`isLive` false) | — | unchanged, no queries fired | Correcting an old workout is not "the moment it happens" |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/workout-logger.tsx` | 143–190, 777–890 | The `useQueries` last-performance block to mirror; the set-row render to badge |
| P0 | `src/lib/one-rep-max.ts` | all | `estimate1RM`, `effectiveLoadKg`, strictly-greater policy |
| P0 | `src/app/workout/actions.ts` | getExerciseSheetAction | The read-action pattern (validation, wger identity note) |
| P1 | `src/app/workout/new/workout-draft.ts` | 16–23 | `DraftSet`: reps/weight are STRINGS in the DISPLAY unit |
| P1 | `src/lib/units.ts` | `displayToKg` | Draft weights → kg before scoring |
| P1 | `src/app/workout/actions.test.ts` | new sheet-action tests | Harness to extend |

## External Documentation
None.

---

## Patterns to Mirror

### QUERIES_BLOCK
```tsx
// SOURCE: workout-logger.tsx:148-152 — per-exercise read-only queries
const lastPerformanceQueries = useQueries({ queries: exerciseIds.map((id) => ({
  queryKey: ['last-performance', id, workoutId ?? null],
  queryFn: () => getLastPerformanceAction(id, workoutId), ... })) })
```

### READ_ACTION + WGER_NOTE
As `getExerciseSheetAction` (actions.ts) — integer validation, 'wger' identity with the documented draft limitation.

### STRICTLY_GREATER
`derivePR` / `bestScoredSet`: strictly-greater keeps ties on the earliest.

### PURE_LIB + TESTS
`src/lib/one-rep-max.ts` + its test file — small pure module, exhaustive matrix.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/pr-detection.ts` | CREATE | Pure `allTimePRIndex` — the whole decision in one testable function |
| `src/lib/pr-detection.test.ts` | CREATE | Matrix tests |
| `src/app/workout/actions.ts` | UPDATE | `getExerciseBestAction` — lean number-or-null payload |
| `src/app/workout/actions.test.ts` | UPDATE | Action tests |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Bests queries (live only), per-exercise PR index, caption under the winning row |

## NOT Building
- Bodyweight-type PR detection — the logger has no bodyweight value client-side; `weight_reps` only (PRD gate: "reps_weight, e1rm-scorable only"). BW types simply never flag.
- First-ever-session "PR" — no baseline, no claim (mirrors `derivePR` needing a baseline).
- Celebration animation/toast — the caption is the v1 moment; delight polish can layer later.
- Persisting the PR event — records remain derived, never stored.
- Edit-mode flags — `isLive` only.

---

## Step-by-Step Tasks

### Task 1: `src/lib/pr-detection.ts`
- **ACTION**: Pure helper deciding which set (if any) carries the flag.
- **IMPLEMENT**:
  ```ts
  import { estimate1RM } from './one-rep-max'
  import { displayToKg, type WeightUnit } from './units'
  import type { LoggingType } from './workout-input'

  /** The draft-set fields the detector reads (logger keeps these as display-unit strings). */
  export interface PRCandidateSet { reps: string; weight: string; completed: boolean }

  /**
   * Index of the session's single best completed set IF it strictly beats the
   * all-time best e1RM — null otherwise. weight_reps only (the logger has no
   * bodyweight basis client-side); null bestE1rmKg = no baseline, no claim.
   * Ties inside the session keep the earliest set, matching bestScoredSet.
   */
  export function allTimePRIndex(
    sets: readonly PRCandidateSet[],
    loggingType: LoggingType,
    unit: WeightUnit,
    bestE1rmKg: number | null,
  ): number | null
  ```
  Body: guard loggingType/best; per completed set parse `Number(set.reps)` / `Number(set.weight)` → `displayToKg` → `estimate1RM` (its guards handle NaN/blank/≤0); track strictly-greater max; return winner index only when `winner.e1rm > bestE1rmKg`.
- **MIRROR**: PURE_LIB; STRICTLY_GREATER.
- **GOTCHA**: Parse with `Number`, not `parseFloat` — `parseFloat('12abc')` silently accepts garbage prefixes; `Number` rejects. (`estimate1RM` then rejects NaN.)
- **VALIDATE**: Task 2 tests.

### Task 2: `src/lib/pr-detection.test.ts`
- **IMPLEMENT**: beats best → winner index; equal → null (strictly greater, incl. lb round-trip equality); no baseline → null; non-weight_reps → null; uncompleted best set ignored; two qualifying sets → single (max; tie → earliest) index; blank/garbage inputs never flag; lb unit converts before compare.
- **MIRROR**: one-rep-max.test.ts style (AAA, descriptive names).
- **VALIDATE**: `npx vitest run src/lib/pr-detection.test.ts`.

### Task 3: `getExerciseBestAction` (`src/app/workout/actions.ts`)
- **IMPLEMENT**:
  ```ts
  /** The exercise's all-time best estimated 1RM in kg, or null when no
   *  e1rm-scorable history. Lean payload for the logger's live PR watch —
   *  same wger-identity limitation as the sheet action. */
  export async function getExerciseBestAction(wgerExerciseId: unknown): Promise<number | null> {
    const userId = await requireUserId()
    if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
      throw new Error('invalid exercise id')
    }
    const stats = await getExerciseStats(userId, 'wger', wgerExerciseId as number)
    return stats?.records.bestE1rm?.e1rm ?? null
  }
  ```
- **MIRROR**: READ_ACTION.
- **GOTCHA**: Live sessions can't contaminate their own baseline: the in-progress workout has `completedAt` null, so the completed-only query excludes it by construction. (Edit mode never fires this — Task 5 gates on `isLive`.)
- **VALIDATE**: Task 4 tests.

### Task 4: Action tests
- **IMPLEMENT**: id-validation loop; returns `records.bestE1rm.e1rm` when present; null when stats null or bestE1rm null.
- **VALIDATE**: `npx vitest run src/app/workout/actions.test.ts`.

### Task 5: Logger wiring
- **IMPLEMENT**:
  1. Next to the last-performance `useQueries` block: bests queries, LIVE ONLY —
     ```tsx
     const bestQueries = useQueries({
       queries: (isLive ? exerciseIds : []).map((id) => ({
         queryKey: ['exercise-best', id],
         queryFn: () => getExerciseBestAction(id),
         staleTime: Infinity, // the baseline is fixed at session start by design
         retry: 1,
       })),
     })
     ```
     and a `bestByExercise` map mirroring `lastByExercise` (empty when `!isLive`).
  2. In the exercise map, before the sets render:
     `const prIndex = isLive ? allTimePRIndex(exercise.sets, exercise.loggingType, unit, bestByExercise[exercise.wgerExerciseId] ?? null) : null`
  3. Under the winning set row, caption travels with its row (move `key={set.id}` to a fragment wrapping row+caption):
     ```tsx
     {setIndex === prIndex && (
       <p className="pl-10 text-[0.7rem] font-semibold uppercase tracking-widest text-primary">
         All-time PR
       </p>
     )}
     ```
- **MIRROR**: QUERIES_BLOCK.
- **GOTCHA**: (1) Reuse how the last-performance block derives `exerciseIds` (same dedupe). (2) Do NOT invalidate `['exercise-best']` on set completion — the baseline is session-start by design. (3) Presentation-only: no draft mutation, no dispatch.
- **VALIDATE**: Full suite, lint, build.

### Task 6: PRD table → Phase 4 complete; mark the PRD's tie-breaking open question resolved (strictly-greater).

---

## Testing Strategy

| Test | Input | Expected | Edge? |
|---|---|---|---|
| beats best | best 116, set 5×105 (=122.5) | winner index | |
| equals best | e1rm exactly best | null | ✓ |
| no baseline | best null | null | ✓ |
| bodyweight type | any | null | ✓ |
| uncompleted | heavy set unchecked | ignored | ✓ |
| two qualifying | both beat best | single index (max, tie→earliest) | ✓ |
| garbage input | reps "abc", weight "" | never flags | ✓ |
| lb conversion | unit 'lb' | kg compare correct; lb round-trip of the record → equal → null | ✓ |

## Validation Commands
```bash
npm test && npx eslint src/lib/pr-detection.ts src/lib/pr-detection.test.ts src/app/workout/actions.ts src/app/workout/actions.test.ts src/app/workout/new/workout-logger.tsx && npm run build
```
Manual: live session → beat a known best → caption on that set; edit an older workout → no captions, no best queries.

## Acceptance Criteria
- [ ] Beating the all-time e1RM flags exactly one set, live sessions only
- [ ] Non-scorable (BW types, garbage, no baseline, equal) never flags
- [ ] No layout shift on unaffected rows; no draft mutations
- [ ] All validation green; PRD Phase 4 complete

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| N full-history scans on logger mount | M | L | Same cost class as existing per-exercise queries; react-query caches; Phase-1 index serves it |
| Baseline staleness across a multi-hour session | L | L | Deliberate (`staleTime: Infinity`) — documented in code |

## Notes
- Resolves the PRD open question on tie policy: strictly-greater everywhere; an equal-to-record set is not a PR.
