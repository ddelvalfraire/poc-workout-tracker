# Plan: PRs + Estimated 1RM

## Summary
Add an estimated one-rep-max (1RM) calculation and personal-record (PR) detection to the workout detail page. Each exercise shows its best set's estimated 1RM (in the user's unit), and exercises whose best estimate beats every earlier workout earn a "PR" badge. All math lives in one pure, unit-tested helper; detection uses a single user-scoped history query.

## User Story
As a lifter reviewing a finished workout, I want to see each exercise's estimated 1RM and a badge when I hit a new best, so that I get immediate, motivating feedback on progressive overload without doing math in my head.

## Problem → Solution
Today the detail page lists sets verbatim (`5 × 100 kg`) with no notion of "best" or "progress." → The detail page surfaces a per-exercise **Est. 1RM** line and a **PR** badge when this workout beats the user's prior best for that exercise.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/progressive-overload-essentials.prd.md`
- **PRD Phase**: Phase 4 — PRs + estimated 1RM
- **Estimated Files**: 7 (2 created, 4 updated, 1 e2e)

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  Bench Press                │
│  Set 1   5 × 100 kg         │
│  Set 2   8 × 60 kg          │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  Bench Press         [ PR ] │
│  Set 1   5 × 100 kg         │
│  Set 2   8 × 60 kg          │
│  Est. 1RM ~117 kg           │   ← from best set (5 × 100)
└─────────────────────────────┘
```
The `[ PR ]` pill appears only when this workout's best estimated 1RM for the
exercise exceeds the best estimate from all of the user's *earlier* workouts.
`Est. 1RM` shows whenever at least one set has both reps and weight.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Workout detail exercise card | Sets only | Sets + `Est. 1RM ~X {unit}` line | Display-only, server-rendered |
| Workout detail exercise header | Name only | Name + optional `PR` badge | Honest vs. earlier workouts by `startedAt` |
| Weight unit | — | Est. 1RM rendered in user's unit | Reuses `kgToDisplay` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/format.ts` | 1-45 | Mirror the pure-formatter + unit-conversion pattern; add `formatE1RM` here |
| P0 | `src/db/workouts.ts` | 51-103 | Mirror user-scoped query style; add the history query next to `getLastPerformance`/`getWorkoutDetail` |
| P0 | `src/app/workout/[id]/page.tsx` | 1-87 | The render surface; where Est. 1RM + PR badge go |
| P1 | `src/lib/units.ts` | 15-33 | `kgToDisplay`/rounding semantics the helper and formatter must respect (kg canonical) |
| P1 | `src/lib/format.test.ts` | 1-45 | Test file/style to mirror for `format.test.ts` additions |
| P1 | `src/lib/units.test.ts` | 1-40 | Vitest `describe/it/expect` convention for the new `one-rep-max.test.ts` |
| P2 | `src/db/schema.ts` | 26-46 | Column names/types for the history join (`sets.reps`, `sets.weight`, `workoutExercises.wgerExerciseId`, `workouts.startedAt`) |
| P2 | `src/lib/workout-input.ts` | 1-45 | Defensive-validation house style (hand-rolled, no Zod) if guarding inputs |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| Epley 1RM formula | Established strength-training formula | `1RM ≈ w × (1 + reps/30)`; exact at `reps = 1` only by special-casing (Epley gives `1.033×w` at 1 rep, so return `w` directly). Most widely used estimator. |
| High-rep validity | PRD risk row | Estimates drift above ~12 reps; mitigate by always labelling output `Est.` (never a hard number presented as truth). |

*No external library research needed — pure arithmetic + established internal patterns.*

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/lib/units.ts:25-33  — pure lib fn, explicit param/return types, camelCase, JSDoc with examples
export function kgToDisplay(weightKg: number, unit: WeightUnit): number {
  return unit === 'lb' ? roundForDisplay(weightKg / KG_PER_LB) : weightKg
}
```

### PURE_FORMATTER
```ts
// SOURCE: src/lib/format.ts:15-25 — unit defaults to 'kg', converts via kgToDisplay, returns a string
export function formatSet(reps: number | null, weightKg: number | null, unit: WeightUnit = 'kg'): string {
  const weight = weightKg !== null ? `${kgToDisplay(weightKg, unit)} ${unit}` : null
  if (reps !== null && weight !== null) return `${reps} × ${weight}`
  ...
}
```

### REPOSITORY_PATTERN (user-scoped query)
```ts
// SOURCE: src/db/workouts.ts:62-90 — every query filters by userId; multi-table join; returns typed rows
const [recent] = await db
  .select({ exerciseId: workoutExercises.id, performedAt: workouts.startedAt })
  .from(workoutExercises)
  .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
  .where(and(eq(workouts.userId, userId), eq(workoutExercises.wgerExerciseId, wgerExerciseId), ...))
  .orderBy(desc(workouts.startedAt))
  .limit(1)
```

### TYPE_DEFINITION
```ts
// SOURCE: src/db/workouts.ts:51-55 — exported interface co-located with its query
export interface LastPerformance {
  performedAt: Date
  sets: { reps: number | null; weight: number | null }[]
}
```

### SERVER_COMPONENT_RENDER
```ts
// SOURCE: src/app/workout/[id]/page.tsx:56-80 — exercises.map → card; formatSet(set.reps, set.weight, unit)
{workout.exercises.map((exercise) => (
  <section key={exercise.id} className="rounded-2xl border border-border bg-card p-4">
    <h2 className="text-base">{exercise.name}</h2>
    ...
    {formatSet(set.reps, set.weight, unit)}
  </section>
))}
```

### TEST_STRUCTURE
```ts
// SOURCE: src/lib/format.test.ts:1-25 — vitest, describe per fn, it() behavioral names, expect().toBe()
import { describe, it, expect } from 'vitest'
import { formatSet } from './format'

describe('formatSet', () => {
  it('converts stored kg to lb when unit is lb', () => {
    expect(formatSet(5, 100, 'lb')).toBe('5 × 220.5 lb')
  })
})
```

### E2E_HARNESS
```ts
// SOURCE: e2e/repeat.spec.ts:24-55 — disposable +clerk_test user pinned to kg, direct SQL teardown, Clerk delete
test.beforeAll(async () => { /* create Clerk user, insert user_preferences unit 'kg' */ })
test.afterAll(async () => { /* delete workouts (cascade), prefs, Clerk user */ })
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/one-rep-max.ts` | CREATE | Pure `estimate1RM` + `bestSet` helper — single source of 1RM math |
| `src/lib/one-rep-max.test.ts` | CREATE | Unit tests for the formula, null handling, best-set selection |
| `src/lib/format.ts` | UPDATE | Add `formatE1RM(e1rmKg, unit)` formatter (kg→display) |
| `src/lib/format.test.ts` | UPDATE | Cover `formatE1RM` (kg, lb, rounding) |
| `src/db/workouts.ts` | UPDATE | Add `getExerciseHistoryBefore` user-scoped query for prior-best comparison |
| `src/app/workout/[id]/page.tsx` | UPDATE | Compute per-exercise best + PR flag; render Est. 1RM line and PR badge |
| `e2e/pr.spec.ts` | CREATE | E2E: heavier second session shows a PR badge on detail |

## NOT Building
- **PR celebration at save time** (client toast/animation on the logger). Detail-page surface only — server-rendered, no client plumbing. Easy follow-up.
- **Live "as you type" 1RM in the logger.** Out of scope; detail reflection is enough for the success signal.
- **PR indicators on the home history list.** Avoids extra per-row queries.
- **Multiple formula choice / Brzycki toggle.** Single estimator (Epley) keeps it simple; the helper is structured so a second formula is a later, additive change.
- **First-ever-exercise = PR.** A PR requires a prior best to beat; the first time an exercise is logged shows Est. 1RM but no badge (decision below).
- **Schema/migration changes.** Reps/weight/wgerExerciseId already persist; nothing new to store.

---

## Step-by-Step Tasks

### Task 1: Create the 1RM helper
- **ACTION**: Create `src/lib/one-rep-max.ts`.
- **IMPLEMENT**:
  ```ts
  /** Reps above this make the estimate unreliable; callers always label output "Est." */
  export const MAX_RELIABLE_REPS = 12

  /**
   * Estimated one-rep max (Epley) from a single set, in the same unit as `weightKg`.
   * Returns null for blank/invalid input. A single (reps === 1) IS its own 1RM, so
   * it's returned verbatim rather than Epley-inflated (Epley would give 1.033×w).
   */
  export function estimate1RM(reps: number | null, weightKg: number | null): number | null {
    if (reps === null || weightKg === null) return null
    if (!Number.isFinite(reps) || !Number.isFinite(weightKg)) return null
    if (reps < 1 || weightKg <= 0) return null
    if (reps === 1) return weightKg
    return weightKg * (1 + reps / 30)
  }

  export interface BestSet {
    reps: number
    weightKg: number
    /** Estimated 1RM in kg (full precision; round only at display). */
    e1rm: number
  }

  /**
   * The set with the highest estimated 1RM from a list, or null when none have
   * both reps and weight. Ties resolve to the first (earliest) qualifying set.
   */
  export function bestSet(sets: readonly { reps: number | null; weight: number | null }[]): BestSet | null {
    let best: BestSet | null = null
    for (const s of sets) {
      const e1rm = estimate1RM(s.reps, s.weight)
      if (e1rm === null) continue
      if (best === null || e1rm > best.e1rm) {
        best = { reps: s.reps as number, weightKg: s.weight as number, e1rm }
      }
    }
    return best
  }
  ```
- **MIRROR**: NAMING_CONVENTION (`src/lib/units.ts:25-33`) — explicit types, JSDoc with rationale.
- **IMPORTS**: none (no `WeightUnit` needed — math is unit-agnostic; conversion happens in the formatter).
- **GOTCHA**: Keep `e1rm` at FULL precision (no rounding) — rounding here would corrupt PR comparisons where two estimates are close. Round only in `formatE1RM`. `weight` is `numeric(6,2) mode:'number'`, so it arrives as a JS number already.
- **VALIDATE**: `npx tsc --noEmit` clean.

### Task 2: Unit-test the helper
- **ACTION**: Create `src/lib/one-rep-max.test.ts`.
- **IMPLEMENT**: `describe('estimate1RM')` — `(1, 100) → 100` (single is its own max), `(5, 100) → 100*(1+5/30)` (≈116.67, assert `toBeCloseTo`), `(null, 100) → null`, `(5, null) → null`, `(0, 100) → null`, `(5, 0) → null`. `describe('bestSet')` — picks the higher-e1rm set (e.g. `[{reps:5,weight:100},{reps:3,weight:110}]` → the one with larger estimate), returns `null` for all-blank, ignores blank sets, ties → first.
- **MIRROR**: TEST_STRUCTURE (`src/lib/format.test.ts:1-25`).
- **IMPORTS**: `import { describe, it, expect } from 'vitest'`; `import { estimate1RM, bestSet } from './one-rep-max'`.
- **GOTCHA**: Use `toBeCloseTo` for the irrational Epley results, `toBe` for exact (reps=1, nulls).
- **VALIDATE**: `npm test` — new tests pass.

### Task 3: Add the `formatE1RM` formatter
- **ACTION**: Update `src/lib/format.ts`.
- **IMPLEMENT**:
  ```ts
  /**
   * Formats an estimated 1RM (stored-kg) for display in the active unit, e.g.
   *   117 (kg) → "117 kg"      117 (lb) → "258 lb"
   * Rounds via kgToDisplay (kg identity, lb to 1dp), matching formatSet.
   */
  export function formatE1RM(e1rmKg: number, unit: WeightUnit = 'kg'): string {
    return `${kgToDisplay(e1rmKg, unit)} ${unit}`
  }
  ```
- **MIRROR**: PURE_FORMATTER (`src/lib/format.ts:15-25`).
- **IMPORTS**: `kgToDisplay`, `WeightUnit` already imported at `src/lib/format.ts:6`.
- **GOTCHA**: Do NOT pre-round before `kgToDisplay` — let it own rounding so kg keeps full precision and lb rounds to 1dp, consistent with `formatSet`. Note the kg path is the identity (no display rounding), so Est. 1RM in kg can render a long decimal — Task 6 feeds it `current.e1rm`; if a cleaner kg display is wanted, round in the formatter ONLY for kg display (not in the helper).
- **VALIDATE**: `npx tsc --noEmit` clean.

### Task 4: Test `formatE1RM`
- **ACTION**: Update `src/lib/format.test.ts`.
- **IMPLEMENT**: `describe('formatE1RM')` — `formatE1RM(117) → '117 kg'`, `formatE1RM(100, 'lb') → '220.5 lb'`, default unit kg.
- **MIRROR**: `src/lib/format.test.ts:1-25`.
- **IMPORTS**: extend the existing `import { ..., formatE1RM } from './format'`.
- **GOTCHA**: kg path is the identity (no display rounding) — pick kg test inputs that are already clean (e.g. 117) to avoid asserting long decimals; use lb to exercise rounding.
- **VALIDATE**: `npm test` passes.

### Task 5: Add the prior-history query
- **ACTION**: Update `src/db/workouts.ts`.
- **IMPLEMENT**:
  ```ts
  /** Flat set rows (reps/weight in kg) for the given exercises across the user's
   *  workouts STARTED BEFORE `before` — the corpus for prior-best/PR comparison.
   *  Excludes the current workout naturally via the time bound. */
  export async function getExerciseHistoryBefore(
    userId: string,
    wgerExerciseIds: number[],
    before: Date,
  ): Promise<{ wgerExerciseId: number; reps: number | null; weight: number | null }[]> {
    if (wgerExerciseIds.length === 0) return []
    return db
      .select({
        wgerExerciseId: workoutExercises.wgerExerciseId,
        reps: sets.reps,
        weight: sets.weight,
      })
      .from(sets)
      .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
      .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
      .where(
        and(
          eq(workouts.userId, userId),
          inArray(workoutExercises.wgerExerciseId, wgerExerciseIds),
          lt(workouts.startedAt, before),
        ),
      )
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN (`src/db/workouts.ts:62-90`).
- **IMPORTS**: extend line 1 to `import { and, asc, count, countDistinct, desc, eq, inArray, lt, ne } from 'drizzle-orm'`.
- **GOTCHA**: Empty-id guard is required — `inArray(col, [])` generates invalid SQL in Drizzle. The time bound (`startedAt < before`) is what excludes the viewed workout from its own comparison, so no `excludeWorkoutId` needed; two workouts can't share an exact `startedAt` in practice (per-row `defaultNow`).
- **VALIDATE**: `npx tsc --noEmit` clean; `npm run build` compiles the query.

### Task 6: Render Est. 1RM + PR badge on the detail page
- **ACTION**: Update `src/app/workout/[id]/page.tsx`.
- **IMPLEMENT**:
  1. After the existing `Promise.all([...])` and `if (!workout) notFound()`, gather distinct ids and load history:
     ```ts
     const exerciseIds = [...new Set(workout.exercises.map((e) => e.wgerExerciseId))]
     const history = await getExerciseHistoryBefore(userId, exerciseIds, workout.startedAt)
     const priorByExercise = new Map<number, { reps: number | null; weight: number | null }[]>()
     for (const row of history) {
       const list = priorByExercise.get(row.wgerExerciseId) ?? []
       list.push({ reps: row.reps, weight: row.weight })
       priorByExercise.set(row.wgerExerciseId, list)
     }
     ```
  2. Inside the `exercises.map`, before render:
     ```ts
     const current = bestSet(exercise.sets)
     const prior = bestSet(priorByExercise.get(exercise.wgerExerciseId) ?? [])
     const isPR = current !== null && prior !== null && current.e1rm > prior.e1rm
     ```
  3. In the `<h2>` row, render the badge when `isPR`:
     ```tsx
     <div className="flex items-center justify-between gap-2">
       <h2 className="min-w-0 text-base">{exercise.name}</h2>
       {isPR && (
         <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground">
           PR
         </span>
       )}
     </div>
     ```
  4. After the sets list, render Est. 1RM when `current`:
     ```tsx
     {current && (
       <p className="mt-2 text-sm text-muted-foreground">
         Est. 1RM <span className="tnum font-medium text-foreground">~{formatE1RM(current.e1rm, unit)}</span>
       </p>
     )}
     ```
- **MIRROR**: SERVER_COMPONENT_RENDER (`src/app/workout/[id]/page.tsx:56-80`); badge styling mirrors the muted-pill look used for set numbers in the logger (`src/app/workout/new/workout-logger.tsx:172`).
- **IMPORTS**: `import { getWorkoutDetail, getExerciseHistoryBefore } from "@/db/workouts";` and `import { formatWorkoutDate, formatSet, formatE1RM } from "@/lib/format";` and `import { bestSet } from "@/lib/one-rep-max";`.
- **GOTCHA**: This is a Server Component — keep the math synchronous and inline (no hooks). `bg-primary`/`text-primary-foreground` are existing theme tokens (see `buttonVariants` default). Don't animate/over-style — one tasteful pill (design rules: intentional, not template-y). The second query is sequential after `workout` loads because it needs `workout.startedAt` + ids; that's one extra round-trip, acceptable.
- **VALIDATE**: `npm run build`; manual: view a workout where a later session went heavier → PR badge shows on the heavier one, Est. 1RM shows on both.

### Task 7: E2E for the PR flow
- **ACTION**: Create `e2e/pr.spec.ts`.
- **IMPLEMENT**: Mirror `e2e/repeat.spec.ts` setup (disposable `+clerk_test` user pinned to `kg`). Test body: log Bench `5 × 100`; save. Log Bench again `5 × 110` (heavier → higher e1rm); save. Open the second workout's detail; assert a `PR` badge is visible and an `Est. 1RM` line is present. Open the first workout's detail; assert NO `PR` badge (it was the first, nothing prior to beat). Teardown removes workouts (cascade), prefs, and the Clerk user.
- **MIRROR**: E2E_HARNESS (`e2e/repeat.spec.ts:24-105`).
- **IMPORTS**: `import { test, expect } from '@playwright/test'`; `import { clerk } from '@clerk/testing/playwright'`; `import postgres from 'postgres'`.
- **GOTCHA**: Pin the user to `kg` so seeded values are deterministic (lb would round). Use role/text locators consistent with the repo (`getByRole('link'/'button')`, `getByText('Workout', { exact: true })`). Assert the badge via `getByText('PR', { exact: true })` scoped to the exercise card if needed. This spec needs live Clerk + Supabase env (`CLERK_SECRET_KEY`, `DATABASE_URL_DIRECT`) — it is not part of `npm test`.
- **VALIDATE**: `npm run test:e2e` (requires env); otherwise verify it typechecks/lints.

### Task 8: Mark PRD phase in-progress
- **ACTION**: Update `.claude/PRPs/prds/progressive-overload-essentials.prd.md`.
- **IMPLEMENT**: In the phases table, change Phase 4 `Status` from `pending` to `in-progress` and set its `PRP Plan` cell to `[plan](../plans/prs-and-estimated-1rm.plan.md)`.
- **MIRROR**: The Phase 3 row's format after planning.
- **VALIDATE**: Visual diff; table still renders.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| estimate1RM single | `(1, 100)` | `100` (exact) | Yes — single is its own 1RM |
| estimate1RM Epley | `(5, 100)` | `≈116.67` (`toBeCloseTo`) | No |
| estimate1RM blank reps | `(null, 100)` | `null` | Yes |
| estimate1RM blank weight | `(5, null)` | `null` | Yes |
| estimate1RM zero/neg | `(0, 100)` / `(5, 0)` | `null` | Yes |
| bestSet picks max | `[{5,100},{3,110}]` | set with higher e1rm | No |
| bestSet all blank | `[{null,null}]` | `null` | Yes |
| bestSet ignores blanks | `[{null,null},{5,100}]` | `{5,100,…}` | Yes |
| formatE1RM kg | `(117)` | `'117 kg'` | No |
| formatE1RM lb | `(100,'lb')` | `'220.5 lb'` | Yes — rounding |

### Edge Cases Checklist
- [x] Empty input — `bestSet([])` → null; `getExerciseHistoryBefore(_, [], _)` → `[]`
- [x] Invalid types — `estimate1RM` guards non-finite / null
- [x] No prior history — first time logging an exercise → Est. 1RM shown, no PR badge
- [x] High reps — estimate still computed but always labelled `Est.` (PRD risk mitigation)
- [x] Unit conversion — Est. 1RM rendered in lb for lb users
- [ ] Concurrent access — N/A (read-only render)
- [x] Permission — history query filters by `userId`; cannot leak another user's bests

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
npm test
```
EXPECT: All tests pass (existing 108 + new one-rep-max/formatE1RM cases)

### Lint
```bash
npm run lint
```
EXPECT: Zero warnings

### Build
```bash
npm run build
```
EXPECT: Compiles; `/workout/[id]` route builds

### E2E (requires live Clerk + Supabase env)
```bash
npm run test:e2e
```
EXPECT: PR spec passes — heavier second session shows PR badge, first does not

### Manual Validation
- [ ] Log an exercise once; view detail → `Est. 1RM ~X` shows, no `PR` badge
- [ ] Log the same exercise heavier in a new workout; view it → `PR` badge + higher Est. 1RM
- [ ] View the older workout again → still no `PR` badge (honest vs. earlier only)
- [ ] Switch unit to lb in settings → Est. 1RM re-renders in lb
- [ ] Exercise with only blank weights → no Est. 1RM line, no crash

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (one-rep-max + formatE1RM)
- [ ] No type errors
- [ ] No lint errors
- [ ] Matches UX design (Est. 1RM line + PR pill)

## Completion Checklist
- [ ] Code follows discovered patterns (pure lib helper, user-scoped query, server render)
- [ ] Error handling matches codebase style (null-returning helpers, no throws for blank data)
- [ ] Tests follow vitest `describe/it` convention
- [ ] No hardcoded values (constants: `MAX_RELIABLE_REPS`, formula inline-documented)
- [ ] No mutation of inputs (helpers build fresh objects; map/loop only reads)
- [ ] PRD phase updated
- [ ] No unnecessary scope additions (save-time toast, live 1RM, home badges all deferred)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 1RM misleading at high reps | M | L | Always label `Est.`; `MAX_RELIABLE_REPS` exported for future flagging |
| PR feels noisy / wrong definition | L | M | PR = strictly beats best of *earlier* workouts (by `startedAt`); first-ever = no badge (documented decision) |
| Rounding drift makes a near-tie show/hide PR | L | L | Compare e1RM at full precision; round only at display |
| Extra detail-page query adds latency | L | L | One join over the user's rows; POC scale is tiny; sequential after workout load |
| `inArray([])` invalid SQL | L | M | Explicit empty-id guard returns `[]` |

## Notes
- **Why estimated 1RM as the "best" metric**: it collapses reps×weight into one comparable number, so a `3 × 110` can out-rank a `5 × 100` — matching how lifters judge progress. Raw max-weight or max-reps alone would miss this.
- **Formula choice**: Epley (`w × (1 + reps/30)`) is the most widely used; structured as a single function so adding Brzycki later is additive (new fn + caller choice), not a refactor.
- **First-time = no PR**: a "record" implies a prior to beat. Showing PR on the very first log of every exercise would make the badge meaningless. Flip is one line (`prior === null` → treat as PR) if product disagrees.
- **No save-time celebration yet**: the detail page is the honest reflection surface and needs zero client plumbing. A save-time toast can reuse `bestSet` + a post-save action later.
