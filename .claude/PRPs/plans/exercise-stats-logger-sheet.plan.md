# Plan: Exercise Stats — Phase 3: Logger Sheet

## Summary
Tap an exercise's name in the active logger → bottom sheet with all-time records + the last few sessions + "View full stats →" to the Phase-2 detail page. Zero new chrome: the name becomes the hit target, the sheet reuses the rest-sheet dialog recipe, data arrives through one new read-only server action.

## User Story
As the lifter mid-session, I want the exercise's records and recent history one tap away, so that I can pick loads and spot PRs without leaving the workout.

## Problem → Solution
Mid-workout the only lookback is the single-session ghost values → the name opens the exercise's all-time story in a sheet; the session, draft, and rest timer are untouched.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-stats.prd.md`
- **PRD Phase**: 3 — Logger sheet
- **Estimated Files**: 4

---

## UX Design

### Before
Exercise header: `[Name/category] [logging-type select] [plates] [replace] | [remove]` — name is static text.

### After
Name is tappable (same visual, button semantics):
```
tap "Bench Press" ─▶ ┌──────────────────────────────┐
                     │ BENCH PRESS            ✕     │
                     │ Best 1RM 117 kg · ×5 · Jun 3 │
                     │ Heaviest 105 kg · Most reps 8│
                     │ RECENT                       │
                     │ Jun 10 — 5×100, 5×100, 4×102 │
                     │ Jun 3  — 5×97.5, 5×97.5      │
                     │ [View full stats →]          │
                     └──────────────────────────────┘
```
Sheet dismisses like every other sheet; "View full stats" navigates to `/exercises/wger/[id]` (draft persistence already survives navigation).

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Exercise name | Static `<h3>` text | Button opening stats sheet | Category line stays static; replace/plates/remove untouched |
| Navigation mid-session | n/a | Link out to detail page | Draft autosave already survives navigation |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/rest-sheet.tsx` | all (204) | The dialog recipe to copy VERBATIM (showModal, StrictMode guard, geometric backdrop dismiss, scroll lock, close() in cleanup, focus restore) |
| P0 | `src/app/workout/new/workout-logger.tsx` | 190–230, 480–550, 640–760, 1110–1130 | Sheet state wiring (`plateSheetFor`), navigation-time sheet clearing, the exercise header markup, sheet render block |
| P0 | `src/app/workout/actions.ts` | 76–95 | `getLastPerformanceAction` — the read-only action pattern to mirror (requireUserId, integer-id validation, no revalidate) |
| P1 | `src/db/exercise-stats.ts` | exports | `getExerciseStats`, `getExerciseSessions`, types |
| P1 | `src/app/workout/actions.test.ts` | 1–60 | Action test harness (vi.mock auth + db modules) |
| P1 | `src/app/exercises/exercise-ref.ts` | all | `exerciseHref` for the link-out |
| P2 | `src/lib/format.ts` | `formatLoggedSet`, `formatE1RM`, `formatWorkoutDate` | Row formatting |

## External Documentation
None — internal patterns only (TanStack Query already in the logger: `useQueries` at line 148).

---

## Patterns to Mirror

### READ_ACTION
```ts
// SOURCE: src/app/workout/actions.ts:80-91
export async function getLastPerformanceAction(wgerExerciseId: unknown, ...): Promise<LastPerformance | null> {
  const userId = await requireUserId()
  if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
    throw new Error('invalid exercise id')
  }
  ...
}
```

### SHEET_DIALOG (copy verbatim per rest-sheet's own note: "two sheets, one behavior")
```tsx
// SOURCE: src/app/workout/new/rest-sheet.tsx:58-81 (effect), 116-136 (dialog element + geometric dismiss + className)
```

### SHEET_WIRING
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:196, 490, 1118-1119
const [plateSheetFor, setPlateSheetFor] = useState<number | null>(null)
...
setPlateSheetFor(null) // a live showModal() dialog must not cross navigation
...
{plateSheetFor !== null && draft.exercises[plateSheetFor] && (<PlateSheet .../>)}
```

### QUERY_FETCH
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:148-152
useQueries({ ... queryKey: ['last-performance', id, workoutId ?? null], queryFn: () => getLastPerformanceAction(id, workoutId) })
// Sheet uses a single useQuery(['exercise-sheet', id], () => getExerciseSheetAction(id)) — cached per exercise for the session.
```

### ACTION_TESTS
```ts
// SOURCE: src/app/workout/actions.test.ts:25-44
vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/workouts', () => ({ ... }))
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/workout/actions.ts` | UPDATE | Add `getExerciseSheetAction` (stats + 3 recent sessions in one round trip) |
| `src/app/workout/actions.test.ts` | UPDATE | Validation + delegation tests for the new action |
| `src/app/workout/new/stats-sheet.tsx` | CREATE | The sheet component (dialog recipe + query + render) |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Name→button, `statsSheetFor` state, navigation clearing, render block |

## NOT Building
- PR detection (Phase 4)
- Source-aware sheet: the draft doesn't carry `source` (DraftExercise, workout-draft.ts:26), same limitation as `getLastPerformanceAction` — the action hardcodes `'wger'` and documents it; customs get first-class logger identity when drafts do
- Charts in the sheet (detail page owns the trend — PRD decision)
- Any change to replace/plates/remove controls or the drafts

---

## Step-by-Step Tasks

### Task 1: `getExerciseSheetAction` (`src/app/workout/actions.ts`)
- **ACTION**: One read-only action returning everything the sheet renders.
- **IMPLEMENT**:
  ```ts
  export interface ExerciseSheetData {
    stats: ExerciseAllTimeStats
    recent: ExerciseSession[]
  }
  /** All-time records + the last RECENT_SESSIONS sessions for the sheet.
   *  Null = no completed history. Draft exercises carry no source (see
   *  DraftExercise) so this reads 'wger' — same limitation as
   *  getLastPerformanceAction; customs join when drafts learn source. */
  export async function getExerciseSheetAction(
    wgerExerciseId: unknown,
  ): Promise<ExerciseSheetData | null> {
    const userId = await requireUserId()
    if (!Number.isInteger(wgerExerciseId) || (wgerExerciseId as number) <= 0) {
      throw new Error('invalid exercise id')
    }
    const id = wgerExerciseId as number
    const [stats, recent] = await Promise.all([
      getExerciseStats(userId, 'wger', id),
      getExerciseSessions(userId, 'wger', id, { limit: RECENT_SESSIONS, offset: 0 }),
    ])
    if (!stats) return null
    return { stats, recent }
  }
  ```
  `const RECENT_SESSIONS = 3` near the function.
- **MIRROR**: READ_ACTION.
- **IMPORTS**: `getExerciseStats, getExerciseSessions, type ExerciseAllTimeStats, type ExerciseSession` from `@/db/exercise-stats`.
- **GOTCHA**: No `revalidatePath` — read-only. Types re-exported from the action module so the client sheet never imports the db module.
- **VALIDATE**: Task 2 tests.

### Task 2: Action tests (`src/app/workout/actions.test.ts`)
- **ACTION**: Extend the existing harness — add `vi.mock('@/db/exercise-stats', ...)`.
- **IMPLEMENT**: (a) rejects non-integer/≤0/string ids; (b) passes userId + 'wger' + id to both db fns, limit 3; (c) returns null when stats null; (d) returns combined payload.
- **MIRROR**: ACTION_TESTS.
- **VALIDATE**: `npx vitest run src/app/workout/actions.test.ts`.

### Task 3: `StatsSheet` (`src/app/workout/new/stats-sheet.tsx`)
- **ACTION**: New client sheet component.
- **IMPLEMENT**: Props `{ wgerExerciseId: number; name: string; unit: WeightUnit; onClose: () => void }`. Dialog mechanics copied verbatim from rest-sheet (aria-label = `Stats for ${name}`). Data: `useQuery({ queryKey: ['exercise-sheet', wgerExerciseId], queryFn: () => getExerciseSheetAction(wgerExerciseId), staleTime: 60_000 })`. Render states:
  - loading → muted "Loading stats…"
  - error → muted "Couldn't load stats." (close/reopen retries; matches the app's quiet error style)
  - null → "No completed sessions yet — finish a workout with this movement and its records land here."
  - data → compact records rows (Best est. 1RM via `formatE1RM` + ×reps + `formatWorkoutDate`; Heaviest via `kgToDisplay`; Most reps; Best session volume via `formatVolume`), then "Recent": one line per session — date + COMPLETED sets joined with ", " via `formatLoggedSet(set, unit, data.stats.exercise.loggingType)`.
  - Footer: `<Link href={exerciseHref({ source: 'wger', wgerExerciseId })} ...buttonVariants>View full stats</Link>` — full-width.
- **MIRROR**: SHEET_DIALOG; QUERY_FETCH.
- **IMPORTS**: `useQuery` from `@tanstack/react-query`; `getExerciseSheetAction, type ExerciseSheetData` from `../actions`; `exerciseHref` from `@/app/exercises/exercise-ref`; format helpers; `buttonVariants`.
- **GOTCHA**: (1) QueryClientProvider already wraps the app (providers.tsx) — no new provider. (2) Format recent sets with the STORED `stats.exercise.loggingType`, not the draft's current one — a just-switched type would misread old rows. (3) The Link navigates away with the dialog open — the effect cleanup's `close()` (copied recipe) releases the top layer; also cleared by the logger's navigation cleanup.
- **VALIDATE**: lint + build; manual.

### Task 4: Logger wiring (`src/app/workout/new/workout-logger.tsx`)
- **ACTION**: Name→button + sheet state.
- **IMPLEMENT**:
  1. `const [statsSheetFor, setStatsSheetFor] = useState<number | null>(null)` next to `plateSheetFor` (~196).
  2. BOTH navigation-cleanup sites (~490 and ~542): add `setStatsSheetFor(null)` in the same comment style.
  3. Header — button inside the existing `<h3>`, h3 classes untouched:
     ```tsx
     <h3 className="min-w-0 text-base leading-tight">
       <button type="button" onClick={() => setStatsSheetFor(exerciseIndex)}
         aria-label={`Stats for ${exercise.name}`}
         className="text-left underline-offset-4 active:underline">
         {exercise.name}
       </button>
       {exercise.category && (...unchanged category span...)}
     </h3>
     ```
  4. Render block next to PlateSheet (~1118):
     ```tsx
     {statsSheetFor !== null && draft.exercises[statsSheetFor] && (
       <StatsSheet
         wgerExerciseId={draft.exercises[statsSheetFor].wgerExerciseId}
         name={draft.exercises[statsSheetFor].name}
         unit={unit}
         onClose={() => setStatsSheetFor(null)}
       />
     )}
     ```
- **MIRROR**: SHEET_WIRING.
- **GOTCHA**: (1) NOT `disabled={isSaving || isDiscarding}` — read-only, unlike replace. (2) No drive-by changes in the 1163-line file.
- **VALIDATE**: Full suite + build; manual (below).

### Task 5: PRD table
- **ACTION**: Phase 3 in-progress → complete with report link.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected | Edge? |
|---|---|---|---|
| action rejects junk | '5', 0, -1, 1.5, null | throws 'invalid exercise id' | ✓ |
| action delegates | 42 | getExerciseStats(userId,'wger',42) + sessions limit 3 | |
| action null passthrough | stats null | null | ✓ |
| action payload | stats + sessions | { stats, recent } | |

Sheet/logger UI: no component-test convention in this repo — lint/build + manual validation (consistent with plate/rest sheets, whose tests cover only pure helpers; this sheet has none).

### Edge Cases Checklist
- [x] No history → sheet empty state
- [x] Action error → quiet error text, session unaffected
- [x] Sheet open during save/discard navigation → cleared like other sheets
- [x] StrictMode double-effect → handled by copied dialog recipe

## Validation Commands
```bash
npm test && npx eslint src/app/workout/new/stats-sheet.tsx src/app/workout/new/workout-logger.tsx src/app/workout/actions.ts src/app/workout/actions.test.ts && npm run build
```
Manual: dev server → start a workout → tap a name → records/recent render → "View full stats" lands on detail → back → session intact; replace/plates/remove unaffected; save/discard closes the sheet.

## Acceptance Criteria
- [ ] Name tap opens the sheet without pausing/discarding the session
- [ ] Sheet: records, last 3 sessions, link-out to `/exercises/wger/[id]`
- [ ] No-history / loading / error states render quietly
- [ ] Replace flow and other header controls unchanged
- [ ] All validation commands pass; PRD updated

## Completion Checklist
- [ ] Dialog mechanics byte-consistent with rest-sheet (one recipe, no drift)
- [ ] No db imports in client code (types via the action module)
- [ ] Recent rows use stored loggingType, not the draft's current one

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Custom exercises get wger-keyed sheet stats | M (only if customs enter drafts) | L | Documented hardcode, same as last-performance; fixed when drafts learn source |
| Name button changes header layout | L | L | Button inside the existing h3, h3 classes untouched |

## Notes
- Sheet = records + recent only (PRD decision: the chart lives on the detail page).
- `['exercise-sheet', id]` cache makes reopening instant; no invalidation on set completion — mid-session record changes are Phase 4's concern.
