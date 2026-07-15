# Plan: Exercise Replacement — Ask-to-Remember (Phase 4)

## Summary
The PRD's final phase: right after a successful swap of a PLAN exercise, a quiet prompt in the logger's sticky bar asks "Use {substitute} for the rest of the block?" — **Use for block** persists the swap into the program via the override-safe `updateProgramExercise` patch (movement identity only; sets and per-week overrides untouched, muscles re-tagged); **Just today** dismisses and snoozes that exercise for the rest of the workout (in-memory, no store — a fresh swap next session re-prompts once, which doubles as the it-keeps-happening signal). Never shown for freestyle sessions or non-plan exercises.

## User Story
As a lifter whose gym permanently lost a machine, I want one tap after the swap to make the substitute the plan's exercise going forward, so a recurring equipment problem becomes a program edit instead of a weekly ritual.

## Problem → Solution
A persistent swap must be re-done every session; editing the plan means leaving the logger → post-swap prompt with the user's decided anti-nag semantics (Just-today = in-workout snooze per exercise), persisting through the narrow patch that keeps overrides and re-tags muscles.

## Metadata
- **Complexity**: Small–Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-replacement.prd.md`
- **PRD Phase**: Phase 4 — Ask-to-remember (final)
- **Estimated Files**: 3

---

## Design Decisions

1. **Persistence seam** (verified): `updateProgramExercise(userId, programId, dayPosition, exercisePosition, patch)` (`src/db/program-patches.ts:410-437`) — position-addressed; `{ wgerExerciseId, name }` patch swaps the movement, re-derives muscle tags, bumps `updatedAt`, and leaves sets + per-week overrides alone (the exact reason the PRD chose it over full-replace). The client knows none of those addresses, so the server action resolves them: `getWorkoutDetail` → `programDayId` → `getProgramDayDetail` → `day.program.id` + `day.position` + the matching exercise's `position` (all present — the relational reads return full rows).
2. **"Is this a plan exercise?" gate, client-side**: `planTargets?.[previous.wgerExerciseId] !== undefined`. The server-seeded `planTargets` is keyed by exactly the plan's exercise ids — ad-hoc sessions have no map, hand-added exercises aren't in it, and a second swap of a substitute (original id = first substitute) correctly isn't either. `workoutId` must also exist.
3. **Prompt surface**: a second quiet row in the sticky bottom bar, same visual grammar as the undo toast (`role="status"`, rounded-xl bordered card row) — NOT a modal: the user just made the decision that matters (the swap); this is a follow-up question that must not block logging. Both buttons non-volt (one-volt rule: Finish keeps the bar's volt).
4. **Anti-nag semantics** (PRD decision): "Just today" adds the ORIGINAL's id to an in-memory `rememberSnoozed` set — the same original swapped again this session won't re-ask. In-memory only (like `planOverrides`): reload drops it; a later SESSION's swap re-prompts once, by design.
5. **One prompt at a time**: a new swap replaces any unanswered prompt (the newest swap is the live question). The prompt dies with: undo of ITS swap (matched by `replacementId`), accept success, Just-today, save/discard (dialog-reset convention), RESTORE_DRAFT (stale-index convention).
6. **Accept failure**: error text renders inside the prompt row, buttons stay — retry in place (two-surface error rule).

---

## UX Design

### Before
```
Machine gone for good → swap it every single session; the plan never learns.
```

### After
```
Swap Squat → Leg Press (Squat is a plan exercise) → sticky bar gains:
┌────────────────────────────────────────────────┐
│ Use Leg Press for the rest of the block?       │
│ Replaces Squat in the plan — your history stays.│
│                     [Just today] [Use for block]│
└────────────────────────────────────────────────┘
Use for block → patch runs → row disappears; future weeks derive Leg Press.
Just today   → row disappears; Squat won't re-ask THIS workout.
Undo the swap→ row disappears with it.
Freestyle session / hand-added exercise → no prompt, ever.
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Sticky bar after a plan-exercise swap | undo toast only | + remember prompt row | Coexists with the undo toast (undo expires in 5s; prompt persists until answered) |
| Program page after accept | original exercise | substitute (same sets/overrides) | `updateProgramExercise` + revalidate |
| Freestyle / non-plan swap | — | zero change | Gate 2 above |
| Repeat swap of a snoozed exercise, same session | — | no prompt | `rememberSnoozed` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/program-patches.ts` | 320-345, 404-437 | `ProgramExercisePatch` + `updateProgramExercise` — the persistence seam, its null-on-not-owned contract, muscle re-tagging |
| P0 | `src/app/workout/new/workout-logger.tsx` | performReplace + handleUndoRemove (replace branch), save/discard reset blocks, RESTORE_DRAFT effect, undo-toast render (sticky bar), Phase-3 `planOverrides`/`planFor` block | Every wiring point; the toast row is the visual template |
| P0 | `src/app/workout/actions.ts` | `substitutePlanTargetsAction` (Phase 3) | The provenance-resolution pattern the new action reuses (guards → getWorkoutDetail → getProgramDayDetail → slot find) |
| P1 | `src/app/programs/actions.ts` | `setProgramStatusAction` | revalidatePath conventions for program mutations |
| P1 | `src/db/programs.ts` | 275-296 (getProgramDayDetail) | Confirms day rows carry `position` and `program.id` |
| P2 | `src/lib/mcp/program-patch-tools.ts` | 348-388 (`update_program_exercise`) | The MCP twin of the same patch — wording precedent ("swap the movement without touching its sets") |

## External Documentation
None — established internal patterns only.

---

## Patterns to Mirror

### PROVENANCE_RESOLUTION (Phase 3's action, reused shape)
```ts
// SOURCE: src/app/workout/actions.ts (substitutePlanTargetsAction)
const workout = await getWorkoutDetail(userId, workoutId)
if (!workout?.programDayId || !workout.programWeek) return null
const day = await getProgramDayDetail(userId, workout.programDayId)
if (!day) return null
const slot = day.exercises.find((e) => e.wgerExerciseId === originalWgerExerciseId)
if (!slot) return null
```

### PATCH_MUTATION_ACTION (throw-on-null + revalidate, program mutations)
```ts
// SOURCE: src/app/programs/actions.ts (setProgramStatusAction)
const result = await setProgramStatus(userId, id, parsed)
if (!result) throw new Error('program not found')
revalidatePath('/programs')
revalidatePath(`/programs/${id}`)
```

### STICKY_BAR_STATUS_ROW (the undo toast — visual + a11y template)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx (undo toast)
<div role="status"
  className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
  <p className="min-w-0 truncate text-sm">…</p>
  <Button size="sm" variant="outline" className="shrink-0" onClick={…}>Undo</Button>
</div>
```

### DIALOG_RESET_CONVENTION (save/discard + RESTORE_DRAFT clear all transient UI state)
```ts
// SOURCE: src/app/workout/new/workout-logger.tsx (handleSave/handleDiscard + restore effect)
setReplaceTargetIndex(null)
setPendingReplace(null)
// restore effect: setRemoved([]); setReplaceTargetIndex(null); setPendingReplace(null)
```

### IN_DIALOG_ERROR (retry in place)
```ts
// SOURCE: src/app/programs/[id]/restart-program-button.tsx (handleRestart catch)
setIsPending(false)
setError('Could not restart this block. Please try again.')
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/workout/actions.ts` | UPDATE | `rememberSwapAction` — resolve positions, patch the program exercise |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | prompt state + snooze set, wiring in performReplace/undo/save/discard/restore, prompt row UI |
| `.claude/PRPs/prds/exercise-replacement.prd.md` | UPDATE | Phase 4 + PRD completion at report time |

## NOT Building

- Persistent snooze storage (PRD decision — re-prompt next session IS the signal)
- Prompting from "Add instead" (nothing was replaced) or for non-plan exercises
- Editing the substitute's name/sets in the prompt — the builder owns edits
- Progression adjustments on accept (TM-based schemes keep their params on the PROGRAM side — the plan's exercise changed, its scheme didn't; the user tunes TMs in the builder if needed)
- Unit tests for the action/UI — no new pure seam; the action is thin composition over the already-tested `updateProgramExercise` (same convention as `restartProgramAction`); coverage is build + manual

---

## Step-by-Step Tasks

### Task 1: `rememberSwapAction`
- **ACTION**: Add to `src/app/workout/actions.ts` (below `substitutePlanTargetsAction`).
- **IMPLEMENT**:
  ```ts
  /**
   * Persists a mid-session swap into the PROGRAM: the slot that prescribed
   * the original exercise is re-pointed at the substitute via the narrow
   * updateProgramExercise patch — sets and per-week overrides untouched,
   * muscle tags re-derived. Position addresses are resolved server-side from
   * the workout's provenance. Throws (not null) on any broken link: the
   * client offered the prompt because the plan link existed moments ago, so
   * a failure is surfaced for retry rather than swallowed.
   */
  export async function rememberSwapAction(
    workoutId: unknown,
    originalWgerExerciseId: unknown,
    substitute: { wgerExerciseId: unknown; name: unknown },
  ): Promise<void> {
    const userId = await requireUserId()
    if (typeof workoutId !== 'string' || workoutId.length === 0) {
      throw new Error('invalid workout id')
    }
    if (!Number.isInteger(originalWgerExerciseId) || (originalWgerExerciseId as number) <= 0) {
      throw new Error('invalid exercise id')
    }
    if (!Number.isInteger(substitute.wgerExerciseId) || (substitute.wgerExerciseId as number) <= 0) {
      throw new Error('invalid exercise id')
    }
    if (typeof substitute.name !== 'string' || substitute.name.trim().length === 0) {
      throw new Error('invalid exercise name')
    }
    const workout = await getWorkoutDetail(userId, workoutId)
    if (!workout?.programDayId) throw new Error('workout has no program')
    const day = await getProgramDayDetail(userId, workout.programDayId)
    if (!day) throw new Error('program day not found')
    const slot = day.exercises.find((e) => e.wgerExerciseId === originalWgerExerciseId)
    if (!slot) throw new Error('exercise not found in program')

    const updated = await updateProgramExercise(userId, day.program.id, day.position, slot.position, {
      wgerExerciseId: substitute.wgerExerciseId as number,
      name: substitute.name.trim(),
    })
    if (!updated) throw new Error('could not update the program')
    revalidatePath('/programs')
    revalidatePath(`/programs/${day.program.id}`)
  }
  ```
- **MIRROR**: PROVENANCE_RESOLUTION (guards + resolution), PATCH_MUTATION_ACTION (throw + revalidate).
- **IMPORTS**: `updateProgramExercise` from `@/db/program-patches` joins the imports (`getWorkoutDetail`/`getProgramDayDetail` already there from Phase 3).
- **GOTCHA**: THROW on broken links (unlike Phase 3's null) — the prompt only renders when the plan link existed, so failure here is an error the user retries, not a silent degrade. `day.position` and `slot.position` are the STORED position columns (full relational rows), exactly what `findOwnedExercise` addresses.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 2: Prompt state + wiring
- **ACTION**: Update `src/app/workout/new/workout-logger.tsx`.
- **IMPLEMENT**:
  1. Import `rememberSwapAction` (joins the actions import).
  2. State (next to `planOverrides`):
     ```ts
     // Post-swap "use for the block?" prompt — one at a time, newest swap
     // wins. Snooze is per ORIGINAL exercise, in-memory for this workout
     // only (PRD decision: a fresh swap next session re-asks once — that
     // repeat IS the signal the question deserves re-asking).
     const [pendingRemember, setPendingRemember] = useState<{
       originalId: number
       originalName: string
       substituteId: number
       substituteName: string
       replacementId: string
     } | null>(null)
     const [rememberSnoozed, setRememberSnoozed] = useState<Set<number>>(new Set())
     const [rememberError, setRememberError] = useState<string | null>(null)
     const [isRemembering, setIsRemembering] = useState(false)
     ```
  3. In `performReplace`, after the Phase-3 fetch block:
     ```ts
     // Offer to make it permanent — only for PLAN exercises (planTargets is
     // keyed by exactly the plan's ids; ad-hoc sessions and hand-added
     // exercises never qualify) and not while snoozed for this workout.
     if (
       workoutId &&
       planTargets?.[previous.wgerExerciseId] !== undefined &&
       !rememberSnoozed.has(previous.wgerExerciseId)
     ) {
       setRememberError(null)
       setPendingRemember({
         originalId: previous.wgerExerciseId,
         originalName: previous.name,
         substituteId: picked.wgerExerciseId,
         substituteName: picked.name,
         replacementId: replacement.id,
       })
     }
     ```
  4. Handlers (next to handleReplacePick):
     ```ts
     function handleRememberJustToday() {
       if (!pendingRemember) return
       setRememberSnoozed((prev) => new Set(prev).add(pendingRemember.originalId))
       setPendingRemember(null)
     }
     async function handleRememberForBlock() {
       if (!pendingRemember || !workoutId) return
       setIsRemembering(true)
       try {
         setRememberError(null)
         await rememberSwapAction(workoutId, pendingRemember.originalId, {
           wgerExerciseId: pendingRemember.substituteId,
           name: pendingRemember.substituteName,
         })
         setPendingRemember(null)
       } catch {
         // Prompt stays: the error renders inside it, retry in place.
         setRememberError('Could not update the program. Please try again.')
       } finally {
         setIsRemembering(false)
       }
     }
     ```
  5. Undo integration — in `handleUndoRemove`'s replace branch, after the dispatch: `if (pendingRemember?.replacementId === last.replacementId) { setPendingRemember(null) }` (undoing the swap withdraws the question).
  6. Reset convention — add `setPendingRemember(null)` to BOTH save/discard reset blocks and to the RESTORE_DRAFT effect (alongside the existing replace-state clears). The snooze set stays — per-session preference, not index-coupled.
- **MIRROR**: DIALOG_RESET_CONVENTION, IN_DIALOG_ERROR.
- **GOTCHA 1**: The gate reads `planTargets` (the server prop), NOT `planFor`/`planOverrides` — the overlay contains SUBSTITUTE ids, which must not qualify for re-prompting (double-swap rule).
- **GOTCHA 2**: `rememberSnoozed` uses copy-then-add (`new Set(prev).add(...)`) — no Set mutation of state.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 3: Prompt row UI
- **ACTION**: Same file — render in the sticky bar ABOVE the undo toast (the prompt is longer-lived, so it takes the top slot; the undo row keeps its position and 5s expiry).
- **IMPLEMENT**:
  ```tsx
  {pendingRemember && (
    <div
      role="status"
      className="mb-3 rounded-xl border border-border bg-card px-4 py-2.5"
    >
      <p className="min-w-0 text-sm">
        Use <span className="font-medium">{pendingRemember.substituteName}</span> for the rest
        of the block?
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Replaces {pendingRemember.originalName} in the plan — your history stays.
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={isRemembering} onClick={handleRememberJustToday}>
          Just today
        </Button>
        <Button size="sm" variant="outline" disabled={isRemembering} onClick={handleRememberForBlock}>
          {isRemembering ? 'Saving…' : 'Use for block'}
        </Button>
      </div>
      {rememberError && <p className="mt-1.5 text-sm text-destructive">{rememberError}</p>}
    </div>
  )}
  ```
- **MIRROR**: STICKY_BAR_STATUS_ROW (card grammar, role=status); ghost/outline weighting makes "Use for block" the visually primary of the pair without volt.
- **GOTCHA**: No animation — bar rows appear/disappear plainly like the undo toast; consistent and reduced-motion safe by default.
- **VALIDATE**: `npm run build`; manual dev pass.

### Task 4: Full validation
- **VALIDATE**: commands below; diff touches only listed files; manual dev pass.

---

## Testing Strategy

### Unit Tests
None new — no new pure seam. The persistence path (`updateProgramExercise`) is covered by `program-patches.test.ts`; the action mirrors the tested Phase-3 resolution shape; prompt UI follows the repo's build+manual convention. (Documented deviation from the 80% rule, consistent with every prior actions/UI change in this PRD.)

### Edge Cases Checklist
- [x] Freestyle session swap → no prompt (`planTargets` undefined)
- [x] Hand-added exercise swap → no prompt (id not in `planTargets`)
- [x] Double swap (substitute → substitute-2) → no prompt (original id was never a plan key)
- [x] Snoozed original re-swapped same session → no prompt
- [x] Undo the swap while the prompt is up → prompt withdrawn
- [x] Accept fails (network) → error in the row, retry in place
- [x] Save/discard/restore with a live prompt → cleared (reset conventions)
- [x] Accept succeeds mid-session → in-session ghosts unchanged (overlay already keyed to the substitute); program page shows the substitute on next visit (revalidated)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/app/workout/actions.ts src/app/workout/new/workout-logger.tsx
```
EXPECT: zero errors

### Full Test Suite
```bash
npm test
```
EXPECT: 982 passing, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Program session: swap a plan exercise → prompt appears; "Use for block" → program page shows the substitute with the ORIGINAL's sets and per-week overrides intact
- [ ] "Just today" → prompt gone; swap the same exercise again this session → no prompt
- [ ] Undo immediately after swapping → prompt disappears with the swap
- [ ] Freestyle session swap → no prompt
- [ ] Accept with network off → error in the row; retry after reconnect succeeds
- [ ] 320px: prompt row + undo toast stack without overflow

---

## Acceptance Criteria
- [ ] All tasks complete
- [ ] Prompt only for plan exercises in program sessions; snooze honored; undo withdraws it
- [ ] Accept persists via the override-safe patch (sets/overrides intact, muscles re-tagged) and revalidates program surfaces
- [ ] All transient state respects the save/discard/restore reset conventions
- [ ] One-volt rule intact (both prompt buttons non-volt)

## Completion Checklist
- [ ] Action throws (not nulls) on broken links — the prompt implies the link existed
- [ ] Gate reads `planTargets`, never the overlay
- [ ] No Set mutation of state
- [ ] PRD marked complete (all 4 phases) at report time
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Position drift: program edited elsewhere between prompt and accept | L | Patch lands on the wrong slot | Positions resolved AT ACCEPT time (the action re-reads the day); a vanished original throws and surfaces |
| Sticky bar gets busy (prompt + undo + buttons) | M | Cosmetic crowding for 5s | Undo expires in 5s; prompt is compact two-line; verify at 320px in the manual pass |
| TM-based schemes keep original-scale params in the PLAN after accept | L | Future targets odd for the substitute | Documented NOT-building; the builder owns scheme tuning; suggestions already penalize same-equipment picks |

## Notes
- This closes the exercise-replacement PRD — at report time mark Phase 4 complete.
- The MCP `update_program_exercise` tool already exposes this same patch, so Claude-side "remember my swap" needs no new tool.
