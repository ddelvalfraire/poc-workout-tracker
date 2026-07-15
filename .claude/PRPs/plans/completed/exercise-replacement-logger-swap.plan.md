# Plan: Exercise Replacement — Logger Swap (Phase 1)

## Summary
The machine-is-taken moment, solved plainly: a Replace control on each exercise card in the live logger opens the existing exercise search sheet in replace mode; picking a substitute swaps the exercise's identity in the draft while keeping the set count (scheme), clearing values that belonged to the old movement. Partially/fully completed exercises warn first and offer **Add instead**. The swap is undoable via the existing undo stack; history ghosts for the substitute appear automatically (they key on `wgerExerciseId`); draft autosave picks the swap up for free.

## User Story
As a lifter mid-session whose planned exercise's equipment is unavailable, I want to replace it with another movement in two taps, so I can keep training without skipping or hand-adding an orphan exercise.

## Problem → Solution
Equipment conflict → wait, skip, or hand-add with no connection to the slot → Replace button per exercise: search sheet → identity swap in place (set scheme kept, one-off, undoable), with a warn+Add-instead guard when sets are already logged.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-replacement.prd.md`
- **PRD Phase**: Phase 1 — Logger swap (search-based, one-off)
- **Estimated Files**: 5

---

## Design Decisions (locked at PRD time + refined here)

1. **Replace semantics**: keep set COUNT (the scheme — 3 sets stay 3 sets), reset every set's `reps`/`weight`/`completed` and the exercise's `loggingType` (to `'weight_reps'`). Rationale: typed values and the BW/assist reading belong to the OLD movement — same reasoning as `SET_LOGGING_TYPE` clearing weights ("the column's MEANING changes"). Ghosts immediately re-fill from the substitute's history.
2. **Warn, don't block** (PRD decision): any `completed` set on the target → after picking the substitute, a guard dialog: "**{old} is partially/fully completed** — replacing discards its logged sets." Buttons: **Add instead** (outline, safe default focus — appends the substitute as a NEW exercise, keeps the old one intact) and **Replace** (destructive). Esc/backdrop cancels entirely. The guard fires AFTER the pick so "Add instead" knows what to add.
3. **Undo**: a replace pushes `{ kind: 'replace', previous, replacementId }` onto the existing `removed` stack; undo swaps the ORIGINAL back (full restore incl. logged values), resolving the current index by the replacement's stable id (same stale-index defense the set-undo uses).
4. **Guard dialog is a new small component**, mechanics copied from `ConfirmDialog` (native `<dialog>`, geometric backdrop test) — NOT a `ConfirmDialog` variant: its safe button ACTS (Add instead) rather than merely closing, which `ConfirmDialog`'s hardcoded "Keep it" cannot express.
5. **One-off only**: the program plan is untouched; `planTargets` stays keyed to the original id so the substitute shows history ghosts only (plan-ghost re-key is Phase 3; persistence is Phase 4).

---

## UX Design

### Before
```
Exercise card header: [Name/category]  [logging-type ▾] [plates] | [🗑]
Machine taken → remove the exercise or hand-add another; no swap.
```

### After
```
[Name/category]  [logging-type ▾] [plates] [⇄ replace] | [🗑]
   ⇄ → bottom sheet "Replace Bench Press" (same search picker)
      → pick "Machine Chest Press"
        no logged sets → swapped in place: same card position, same set
          count, empty inputs, ghosts now show Machine Chest Press history
        has logged sets → dialog:
          "Bench Press is partially completed"
          "Replacing discards its logged sets. Add the new exercise
           separately to keep them."
          [Add instead]  [Replace]     (Esc/backdrop = cancel)
   Undo toast (existing bar): "Replaced Bench Press  [Undo]"
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Exercise header | select · plates · ∣ · trash | + ⇄ Replace button before the divider | Utilities cluster; trash stays isolated past the hairline |
| Exercise sheet | "Add exercise" only | `heading` prop: "Replace {name}" in replace mode | Picker itself unchanged |
| Undo bar | exercise/set removals | + "Replaced {name}" entries | Same 5s window, same stack |
| Completed exercise | — | warn dialog w/ Add instead | Cancel = no change at all |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/workout-draft.ts` | all (280) | Reducer + action union + factories the swap extends; immutability doctrine; `SET_LOGGING_TYPE`'s clear-weights rationale (42-74, 88-94, 105-200) |
| P0 | `src/app/workout/new/workout-logger.tsx` | 51-67 (undo types), 220-260 (pushRemoved/handleRemove/handleUndoRemove), 500-580 (header controls), 796-817 (undo toast), 861-868 (ExerciseSheet render) | Every seam the swap touches |
| P0 | `src/app/workout/new/workout-draft.test.ts` | 1-90 | Reducer test conventions (AAA, NESTED fixture, immutability-by-reference asserts) |
| P1 | `src/app/workout/new/exercise-sheet.tsx` | all (112) | Sheet gaining the `heading` prop; dialog mechanics the guard dialog copies |
| P1 | `src/components/confirm-dialog.tsx` | 54-127 | The native-dialog mechanics (StrictMode guard, scroll lock, focus restore, geometric backdrop test, onCancel) to copy into the guard dialog |
| P2 | `src/app/workout/new/exercise-picker.tsx` | 1-50, 85-95 | `onAdd({ wgerExerciseId, name, category })` contract — unchanged |
| P2 | `src/app/workout/new/workout-logger.tsx` | 592-614 | Ghost keying by `wgerExerciseId` — why history ghosts follow the swap automatically |

## External Documentation
None — established internal patterns only.

---

## Patterns to Mirror

### REDUCER_ACTION (component builds, reducer places)
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:42-49, 107-122
| { type: 'ADD_EXERCISE'; exercise: DraftExercise }
| { type: 'INSERT_EXERCISE'; index: number; exercise: DraftExercise }
...
case 'ADD_EXERCISE':
  return { exercises: [...state.exercises, action.exercise] }
```

### IMPURE_FACTORY (ids minted outside the reducer)
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:83-94
export function newDraftSet(): DraftSet {
  return { id: crypto.randomUUID(), reps: '', weight: '', completed: false }
}
export function newDraftExercise(picked: { wgerExerciseId: number; name: string; category: string }): DraftExercise {
  return { id: crypto.randomUUID(), ...picked, loggingType: 'weight_reps', sets: [newDraftSet()] }
}
```

### CLEAR_ON_MEANING_CHANGE (why replace resets values)
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:142-153 (SET_LOGGING_TYPE)
// Clear typed weights: the column's MEANING changes with the type ... a value
// entered under the old type would be silently re-read as something else
sets: exercise.sets.map((set) => ({ ...set, weight: '' })),
```

### UNDO_STACK (stable-id capture + index-resolved restore)
```ts
// SOURCE: src/app/workout/new/workout-logger.tsx:62-67, 220-260
type RemovedEntry =
  | { kind: 'exercise'; exercise: DraftExercise; index: number }
  | { kind: 'set'; exerciseId: string; exerciseName: string; setIndex: number; set: DraftSet }
...
function handleUndoRemove() {
  const last = removed[removed.length - 1]
  ...
  const exerciseIndex = draft.exercises.findIndex((e) => e.id === last.exerciseId)
  if (exerciseIndex !== -1) { dispatch({ ... }) }
  setRemoved((prev) => prev.slice(0, -1))
```

### HEADER_ICON_BUTTON (utility cluster before the hairline)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:557-579
{exercise.loggingType === 'weight_reps' && (
  <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground"
    onClick={() => setPlateSheetFor(exerciseIndex)} aria-label={`Plates for ${exercise.name}`}>
    <Dumbbell aria-hidden="true" className="size-4" />
  </Button>
)}
{/* Hairline gap between the everyday utilities and the destructive remove */}
<span aria-hidden="true" className="h-5 w-px shrink-0 self-center bg-border" />
```

### SHEET_RENDER (conditional mount + callback pair)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:861-868
{isPickerOpen && (
  <ExerciseSheet
    onAdd={(exercise) => dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(exercise) })}
    onClose={() => setIsPickerOpen(false)}
  />
)}
```

### DIALOG_MECHANICS (copy verbatim into the guard dialog)
```tsx
// SOURCE: src/components/confirm-dialog.tsx:75-98 (mount effect) and 104-126 (onCancel + geometric backdrop test)
if (dialog && !dialog.open) dialog.showModal()
...
onCancel={(e) => { e.preventDefault(); if (!isPending) onClose() }}
onClick={(e) => { /* geometric inside-rect test, not target === dialog */ }}
```

### REDUCER_TEST (AAA + immutability-by-reference)
```ts
// SOURCE: src/app/workout/new/workout-draft.test.ts:13-27, 53-70
const SQUAT = { wgerExerciseId: 73, name: 'Squat', category: 'Legs', loggingType: 'weight_reps' as const }
const NESTED: WorkoutDraft = { exercises: [{ id: 'ex1', ...SQUAT, sets: [...] }] }
...
expect(next).not.toBe(NESTED)
expect(NESTED.exercises[0].sets[1].reps).toBe('5')
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/workout/new/workout-draft.ts` | UPDATE | `REPLACE_EXERCISE` action + reducer case; `replacementDraftExercise` factory |
| `src/app/workout/new/workout-draft.test.ts` | UPDATE | TDD: reducer case + factory tests |
| `src/app/workout/new/exercise-sheet.tsx` | UPDATE | Optional `heading` prop (default 'Add exercise') |
| `src/app/workout/new/replace-confirm-dialog.tsx` | CREATE | Warn dialog: Add instead / Replace / dismiss-cancel |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | ⇄ header button, replace-mode state + handlers, undo kind, toast text |

## NOT Building

- Muscle-matched suggestions (Phase 2) — the sheet shows plain search
- Substitute plan targets / `planTargets` re-key (Phase 3) — history ghosts only; the swapped exercise loses its plan ghost by design until then
- Ask-to-remember prompt (Phase 4)
- Custom-exercise substitutes (PRD NOT-building — the picker is wger-only today anyway)
- Mode gating for the Replace button — it renders in ALL logger modes (live and edit): a swap is equally valid when correcting a finished session, and zero conditional complexity is the point
- Draft payload/schema changes — `DraftExercise` shape is unchanged; autosave serializes the swap as-is

---

## Step-by-Step Tasks

### Task 1: Failing reducer + factory tests (RED)
- **ACTION**: Extend `src/app/workout/new/workout-draft.test.ts`.
- **IMPLEMENT**: In the `workoutDraftReducer` describe:
  1. `REPLACE_EXERCISE replaces the exercise at index verbatim, keeping siblings` — two-exercise draft; replace index 0 with a prebuilt exercise object; assert `next.exercises[0]` is the new object, `[1]` untouched, `next !== prev`, prev unmutated.
  2. `REPLACE_EXERCISE past the end is a no-op` — index 5 on NESTED → same state reference back (mirror `INSERT_SET`'s guard).
  New `describe('replacementDraftExercise')`:
  3. keeps the set COUNT: factory with `setCount: 3` → 3 sets, every set `{ reps: '', weight: '', completed: false }` with unique fresh ids.
  4. floors at one set: `setCount: 0` → 1 set (same "seeded with at least one empty set" invariant as `newDraftExercise`).
  5. resets identity + loggingType: result carries the picked `{ wgerExerciseId, name, category }`, `loggingType: 'weight_reps'`, new `id`.
- **MIRROR**: REDUCER_TEST (AAA, immutability-by-reference asserts).
- **GOTCHA**: The factory is impure (crypto.randomUUID) — assert shapes/counts, never exact ids; ids must be UNIQUE across sets (`new Set(ids).size === sets.length`).
- **VALIDATE**: `npm test -- src/app/workout/new/workout-draft.test.ts` → RED.

### Task 2: Reducer case + factory (GREEN)
- **ACTION**: Update `src/app/workout/new/workout-draft.ts`.
- **IMPLEMENT**:
  - Action union, after `INSERT_EXERCISE`:
    ```ts
    /** Swaps the exercise at `index` for a replacement built by the caller
     *  (replacementDraftExercise) — the machine-is-taken swap. Verbatim
     *  placement like ADD_EXERCISE; a stale index past the end is a no-op. */
    | { type: 'REPLACE_EXERCISE'; index: number; exercise: DraftExercise }
    ```
  - Reducer case (after `INSERT_EXERCISE`):
    ```ts
    case 'REPLACE_EXERCISE': {
      if (action.index >= state.exercises.length) return state
      return { exercises: mapExerciseAt(state.exercises, action.index, () => action.exercise) }
    }
    ```
  - Factory (below `newDraftExercise`):
    ```ts
    /** Builds the swap replacement: the picked identity with the OLD slot's
     *  set COUNT (the scheme survives) but fresh empty sets and the default
     *  loggingType — typed values and a BW/assist reading belong to the old
     *  movement (same meaning-change rule as SET_LOGGING_TYPE's weight clear).
     *  Ghosts re-fill from the substitute's own history. */
    export function replacementDraftExercise(
      picked: { wgerExerciseId: number; name: string; category: string },
      setCount: number,
    ): DraftExercise {
      return {
        id: crypto.randomUUID(),
        ...picked,
        loggingType: 'weight_reps',
        sets: Array.from({ length: Math.max(1, setCount) }, () => newDraftSet()),
      }
    }
    ```
- **MIRROR**: REDUCER_ACTION, IMPURE_FACTORY, CLEAR_ON_MEANING_CHANGE (doc-comment voice).
- **VALIDATE**: Task 1 green; `npx tsc --noEmit`.

### Task 3: `ExerciseSheet` heading prop
- **ACTION**: Update `src/app/workout/new/exercise-sheet.tsx`.
- **IMPLEMENT**: `heading?: string` prop, default `'Add exercise'` via destructure; use it for BOTH the `aria-label` on the `<dialog>` (line 63) and the caps label text (lines 84-85). One-line JSDoc addition: replace mode retitles the same sheet ("Replace Bench Press") — chrome only, the picker is untouched.
- **GOTCHA**: Default via destructure so the two existing call sites (logger add, program builder) stay byte-identical in behavior.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 4: `ReplaceConfirmDialog` (the warn + Add-instead guard)
- **ACTION**: Create `src/app/workout/new/replace-confirm-dialog.tsx`.
- **IMPLEMENT**: `'use client'`. Props:
  ```ts
  { oldName: string; newName: string; hasAllCompleted: boolean;
    onReplace: () => void; onAddInstead: () => void; onClose: () => void }
  ```
  Centered modal copied from `ConfirmDialog`'s mechanics (mount effect with StrictMode-guarded `showModal()`, body scroll lock, focus restore, `onCancel` preventDefault → `onClose`, geometric backdrop test → `onClose`; `m-auto` centering, same className). Content:
  - Title: `` `${oldName} is ${hasAllCompleted ? 'fully' : 'partially'} completed` ``
  - Body: `` `Replacing discards its logged sets. Add ${newName} as a separate exercise to keep them.` ``
  - Buttons (both size-default, flex-1): **Add instead** (`variant="outline"`, ref'd + focused on mount — the safe default, mirroring "Keep it") and **Replace** (`variant="destructive"`).
  - No `isPending`/error plumbing: both actions are synchronous dispatches — omit rather than carry dead props.
- **MIRROR**: DIALOG_MECHANICS verbatim; comment crediting confirm-dialog.tsx as the source of the lifecycle mechanics (the repo's one dialog vocabulary).
- **IMPORTS**: `useEffect, useRef` (react), `Button` (`@/components/ui/button`).
- **GOTCHA**: Enter on open must trigger **Add instead**, never Replace — focus the Add-instead button on mount (the "safe default focus" rule from confirm-dialog.tsx:85-87).
- **VALIDATE**: `npx tsc --noEmit`; `npx eslint src/app/workout/new/replace-confirm-dialog.tsx`.

### Task 5: Wire the logger
- **ACTION**: Update `src/app/workout/new/workout-logger.tsx`.
- **IMPLEMENT**:
  1. Imports: `ArrowLeftRight` joins the lucide import; `replacementDraftExercise` joins the workout-draft import; `ReplaceConfirmDialog` from `'./replace-confirm-dialog'`.
  2. `RemovedEntry` union gains:
     ```ts
     /** Undo for REPLACE_EXERCISE: restores the ORIGINAL exercise (logged
      *  values included) over the replacement, resolved by the replacement's
      *  stable id — the list can shift before Undo. */
     | { kind: 'replace'; previous: DraftExercise; replacementId: string }
     ```
  3. State (near the sheet/undo state): `const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null)` (which exercise the sheet is replacing; null = add mode) and `const [pendingReplace, setPendingReplace] = useState<{ index: number; picked: { wgerExerciseId: number; name: string; category: string } } | null>(null)` (a pick awaiting the completed-sets guard).
  4. Handlers (next to handleRemoveExercise):
     ```ts
     function performReplace(index: number, picked: { wgerExerciseId: number; name: string; category: string }) {
       const previous = draft.exercises[index]
       if (!previous) return // list shifted while the sheet was up — nothing to replace
       const replacement = replacementDraftExercise(picked, previous.sets.length)
       dispatch({ type: 'REPLACE_EXERCISE', index, exercise: replacement })
       pushRemoved({ kind: 'replace', previous, replacementId: replacement.id })
     }
     function handleReplacePick(picked: { wgerExerciseId: number; name: string; category: string }) {
       const index = replaceTargetIndex
       setReplaceTargetIndex(null) // the sheet closes itself; clear replace mode
       if (index === null) return
       const target = draft.exercises[index]
       if (!target) return
       // Logged work deserves a pause: warn + offer Add-instead (PRD rule).
       if (target.sets.some((set) => set.completed)) {
         setPendingReplace({ index, picked })
         return
       }
       performReplace(index, picked)
     }
     ```
  5. `handleUndoRemove` gains a branch (refactor the current if/else into if / else-if / else):
     ```ts
     } else if (last.kind === 'replace') {
       const index = draft.exercises.findIndex((e) => e.id === last.replacementId)
       if (index !== -1) {
         dispatch({ type: 'REPLACE_EXERCISE', index, exercise: last.previous })
       }
     }
     ```
  6. Header button — in the utility cluster AFTER the plates button, BEFORE the hairline divider (rendered for EVERY loggingType):
     ```tsx
     <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground"
       onClick={() => setReplaceTargetIndex(exerciseIndex)}
       aria-label={`Replace ${exercise.name}`}>
       <ArrowLeftRight aria-hidden="true" className="size-4" />
     </Button>
     ```
  7. Undo toast text (lines 796-817): restructure the `<p>` so each kind produces its full sentence — `Removed {name}`, `Removed set {n} · {name}`, `Replaced {previous.name}` — keeping the name in the existing `font-medium` span; both existing strings stay verbatim.
  8. Sheet render — replace mode reuses the same mount:
     ```tsx
     {(isPickerOpen || replaceTargetIndex !== null) && (
       <ExerciseSheet
         heading={replaceTargetIndex !== null
           ? `Replace ${draft.exercises[replaceTargetIndex]?.name ?? 'exercise'}`
           : undefined}
         onAdd={(exercise) =>
           replaceTargetIndex !== null
             ? handleReplacePick(exercise)
             : dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(exercise) })}
         onClose={() => { setIsPickerOpen(false); setReplaceTargetIndex(null) }}
       />
     )}
     ```
  9. Guard dialog render (next to the other dialogs):
     ```tsx
     {pendingReplace && draft.exercises[pendingReplace.index] && (
       <ReplaceConfirmDialog
         oldName={draft.exercises[pendingReplace.index].name}
         newName={pendingReplace.picked.name}
         hasAllCompleted={draft.exercises[pendingReplace.index].sets.every((s) => s.completed)}
         onReplace={() => { performReplace(pendingReplace.index, pendingReplace.picked); setPendingReplace(null) }}
         onAddInstead={() => {
           dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(pendingReplace.picked) })
           setPendingReplace(null)
         }}
         onClose={() => setPendingReplace(null)}
       />
     )}
     ```
- **MIRROR**: UNDO_STACK, HEADER_ICON_BUTTON, SHEET_RENDER.
- **GOTCHA 1**: The replace button renders for EVERY loggingType (unlike plates) — equipment conflicts aren't barbell-specific.
- **GOTCHA 2**: `handleReplacePick` clears `replaceTargetIndex` FIRST — the sheet's own `onClose` also clears it; double-clear is harmless, a stale index is not.
- **GOTCHA 3**: History ghosts need NO wiring — `lastByExercise` queries and ghost lookups key on `exercise.wgerExerciseId` from the draft (lines 592-614), so the swap re-points them automatically. The plan ghost (`planTargets[newId]`) goes undefined for the substitute — correct until Phase 3.
- **VALIDATE**: `npx tsc --noEmit`; `npm run build`.

### Task 6: Full validation
- **VALIDATE**: commands below; diff touches only listed files; manual dev pass.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| REPLACE_EXERCISE swaps verbatim at index | 2-exercise draft, replace [0] | new at [0], [1] untouched, prev unmutated | |
| REPLACE_EXERCISE stale index | index past end | same state reference | ✓ |
| factory keeps set count | setCount 3 | 3 fresh empty sets, unique ids | |
| factory floors at 1 | setCount 0 | 1 set | ✓ |
| factory resets identity | picked + old BW type | picked fields, weight_reps, new id | |

UI (button, sheet mode, guard dialog, undo): no component tests — repo convention (build + manual).

### Edge Cases Checklist
- [x] Replace target removed while sheet open (`!previous` guard → no-op)
- [x] Replace with zero completed sets → immediate swap, no dialog
- [x] All sets completed → "fully completed" title variant
- [x] Cancel the guard (Esc/backdrop) → draft untouched
- [x] Undo after list shifted (id-resolved index; vanished replacement → undo no-ops like the set case)
- [x] RESTORE_DRAFT clears the undo stack (existing behavior, replace entries included)
- [ ] Two same-id exercises in a day share ghosts — pre-existing constraint, unchanged

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/app/workout/new
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/app/workout/new/workout-draft.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 960 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Start a program day → tap ⇄ on an untouched exercise → sheet titled "Replace {name}" → pick → card swaps in place, set count kept, inputs empty, ghosts show the substitute's last performance
- [ ] Undo restores the original (values intact) in its slot
- [ ] Check off a set, then replace → guard dialog; "Add instead" appends and keeps the original; "Replace" swaps; Esc cancels clean
- [ ] Swap survives a reload (draft autosave/restore round-trip)
- [ ] Freestyle session: replace works identically (no program required)
- [ ] 320px width: header controls don't overflow (name truncates)

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] Swap keeps set count, clears values/completion/loggingType (meaning-change rule)
- [ ] Completed-sets guard: warn + Add instead + cancel; Enter = Add instead
- [ ] Undo restores the original exercise exactly
- [ ] No changes to draft payload shape, picker internals, or program data

## Completion Checklist
- [ ] Reducer stays pure (factory owns crypto)
- [ ] Dialog follows the one-dialog-vocabulary mechanics (StrictMode guard, geometric backdrop, focus-safe default)
- [ ] a11y: aria-labels on the new button and dialog; Add-instead holds initial focus
- [ ] No volt on any new control (Finish keeps the screen's volt)
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Header row crowds on small screens (4 controls + divider) | M | Cosmetic wrap | icon-sm buttons match existing density; name column is min-w-0 truncating — verify at 320px in the manual pass |
| Undo-toast copy refactor regresses existing kinds | L | Cosmetic | Sentence-per-kind restructure keeps both old strings verbatim |
| Guard-dialog focus lands on Replace (destructive) | L | Data loss on Enter | Explicit ref+focus on Add instead; manual keyboard check |

## Notes
- Phase 2 (suggestions) slots into the same sheet: `ExerciseSheet` will gain an optional suggestions rail above the picker in replace mode — the `heading` prop added here is deliberately the smallest hook that direction needs.
- Phase 3 re-keys `planTargets` after a swap; Phase 4's remember-prompt hangs off `performReplace` — both land in code this plan creates, no rework expected.
