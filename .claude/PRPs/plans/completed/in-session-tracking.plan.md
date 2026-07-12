# Plan: In-Session Tracking (set check-off, draft persistence, live duration)

## Summary
Make the logger feel like a live training session: per-set completion check-off (wired to the existing-but-unused `sets.completed` column), automatic draft persistence to `localStorage` so a refresh/tab-close/PWA suspend doesn't lose an in-progress workout, and a live elapsed-time display. Three independent vertical slices — commit each separately.

## User Story
As a lifter mid-workout on my phone, I want to check off sets as I finish them, see how long I've been training, and never lose my in-progress log to a refresh or app suspend, so that the logger works as a live session companion rather than an after-the-fact form.

## Problem → Solution
- `sets.completed` exists in the schema (default `false`) but nothing ever sets it — no in-session check-off. → Draft tracks `completed`, UI toggles it, save path persists it.
- The draft lives only in `useReducer` memory — any reload loses the whole session. → Versioned draft snapshot in `localStorage`, restored on mount, cleared on save.
- No sense of session time while logging (`startedAt` is captured in `openedAtRef` but never shown). → Ticking elapsed clock; edit mode uses the workout's real `startedAt`.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (standalone; rest timers explicitly remain deferred per prior PRDs)
- **PRD Phase**: N/A
- **Estimated Files**: 14 (3 new, 11 updated, incl. tests)

---

## UX Design

### Before
```
┌ New Workout ───────────── Cancel ┐
│ [Workout name (optional)      ]  │
│ [Search exercises…            ]  │
│ ┌ Squat ──────────────────── 🗑 ┐ │
│ │      REPS        KG          │ │
│ │ (1)  [   5  ]  [ 100  ]   ✕  │ │   (1) = static number badge
│ │ (2)  [      ]  [      ]   ✕  │ │
│ │ [ + Add set ]                │ │
│ └──────────────────────────────┘ │
│ [ SAVE WORKOUT ]                 │  ← refresh here = everything gone
└──────────────────────────────────┘
```

### After
```
┌ New Workout ───────────── Cancel ┐
│ [Workout name (optional)      ]  │
│ ⏱ 12:34            ← live clock  │
│ [Search exercises…            ]  │
│ ┌ Squat ──────────────────── 🗑 ┐ │
│ │      REPS        KG          │ │
│ │ (✓)  [   5  ]  [ 100  ]   ✕  │ │   badge is now a toggle button;
│ │ (2)  [      ]  [      ]   ✕  │ │   ✓ = completed (accent style)
│ │ [ + Add set ]                │ │
│ └──────────────────────────────┘ │
│ [ SAVE WORKOUT ]                 │  ← refresh restores draft + clock
└──────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Set number badge | Static `<span>` circle | `<button>` toggling completed; shows ✓ + accent bg when done | `aria-pressed`, label "Mark set N complete" |
| Page reload mid-session | Draft lost | Draft + name + session start restored silently | 12 h TTL; unit/key mismatch → discarded |
| Session time | Invisible (only stored at save) | `⏱ M:SS` / `H:MM:SS` chip ticking every second | Hidden when elapsed > 6 h (backdated edits) |
| Save | — | Also clears the stored draft snapshot | Both create and edit modes |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/workout-draft.ts` | all | The module being extended: DraftSet shape, reducer, `draftToInput`, `detailToDraft`; header comment explains the pure-logic-out-of-React convention every new module here must follow |
| P0 | `src/app/workout/new/workout-logger.tsx` | all | Component being wired: `useReducer` + `openedAtRef` (lines 52–56), save handler (87–109), set row markup (197–250) |
| P0 | `src/lib/workout-input.ts` | 17–28, 94–117 | `SetInput` and `parseSet` — the trust boundary the new `completed` field must pass through |
| P0 | `src/db/workouts.ts` | 150–177 | `insertWorkoutChildren` — the single insert path both save and update funnel sets through |
| P1 | `src/app/workout/new/workout-draft.test.ts` | all | AAA test style for reducer/mapper; copy for new cases |
| P1 | `src/db/save-workout.test.ts` | 1–80 | Mocked-tx harness recording `.values(v)` — set-insert assertions change shape |
| P1 | `src/lib/format.ts` | 82–98 | `formatWorkoutDuration` + plausibility constants — mirror for the live `formatElapsed`, reuse the 6 h ceiling |
| P1 | `src/app/workout/[id]/edit/page.tsx` | 44–85 | Edit mode entry (program-day live logging happens HERE) — gains `startedAt` prop pass-through |
| P2 | `src/lib/workout-input.test.ts` | all | Validation-error test idiom for `parseSet` additions |
| P2 | `src/app/workout/new/page.tsx` | all | New-workout entry; shows the `?from=` repeat seed interacting with restore |
| P2 | `vitest.config.ts` | all | `environment: 'node'` — no `localStorage` in unit tests; storage module must be testable without it |

## External Documentation

None needed — feature uses established internal patterns (pure reducer modules, hand-rolled validation, Drizzle insert path). `localStorage` and `setInterval` are platform basics.

---

## Patterns to Mirror

### PURE_LOGIC_OUT_OF_REACT
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:5-13
/**
 * Pure client-state logic for the in-progress workout, kept free of React/JSX so
 * the reducer and mapper unit-test as plain functions ...
 */
```
`draft-storage.ts` must be pure serialize/parse functions (no `window`, no `localStorage` inside) so it unit-tests under vitest's `node` environment. The component owns the actual `localStorage` calls.

### REDUCER_IMMUTABILITY
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:95-103
case 'UPDATE_SET':
  return {
    exercises: mapExerciseAt(state.exercises, action.exerciseIndex, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set, i) =>
        i === action.setIndex ? { ...set, [action.field]: action.value } : set,
      ),
    })),
  }
```
`TOGGLE_SET_COMPLETED` follows this exact shape (reuse `mapExerciseAt`).

### VALIDATION_BOUNDARY
```ts
// SOURCE: src/lib/workout-input.ts:95-117
function parseSet(raw: unknown): SetInput {
  const obj = asRecord(raw, 'each set must be an object')
  const { reps } = obj
  if (reps !== null && (!Number.isInteger(reps) || ...)) {
    throw new Error(`set reps must be an integer between 0 and ${MAX_REPS}, or null`)
  }
  ...
}
```
`completed` validation: absent/`undefined`/`null` → omitted; anything else must be a boolean or throw `'set completed must be a boolean'`. Never coerce silently.

### DB_INSERT_PATH
```ts
// SOURCE: src/db/workouts.ts:167-174
await tx.insert(sets).values(
  exercise.sets.map((s, i) => ({
    workoutExerciseId: we.id,
    setNumber: i + 1,
    reps: s.reps,
    weight: s.weight,
  })),
)
```
Add `completed: s.completed ?? false`. This one function covers BOTH `saveWorkout` and `updateWorkout` (update deletes + re-inserts children).

### MOCKED_TX_TEST_HARNESS
```ts
// SOURCE: src/db/save-workout.test.ts:73-76
expect(records[2].values).toEqual([
  { workoutExerciseId: 'e1', setNumber: 1, reps: 5, weight: 100 },
  { workoutExerciseId: 'e1', setNumber: 2, reps: 5, weight: 100 },
])
```
These `toEqual` assertions are exact — every set-values assertion in `save-workout.test.ts` and `update-workout.test.ts` gains `completed: false` (or `true` where the input says so).

### DURATION_FORMAT
```ts
// SOURCE: src/lib/format.ts:81-98
const MIN_PLAUSIBLE_DURATION_MS = 60_000
const MAX_PLAUSIBLE_DURATION_MS = 6 * 60 * 60_000
export function formatWorkoutDuration(startedAt: Date, completedAt: Date | null): string | null {
  ...
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}
```
`formatElapsed(ms)` lives next to this: `null` when negative or > `MAX_PLAUSIBLE_DURATION_MS`, else `M:SS` / `H:MM:SS` with zero-padded seconds.

### AAA_TEST_STYLE
```ts
// SOURCE: src/app/workout/new/workout-draft.test.ts:30-39
it('ADD_EXERCISE appends the provided exercise verbatim', () => {
  // Arrange — the component builds the full exercise (with ids) before dispatch
  const exercise = { id: 'ex1', ...SQUAT, sets: [{ id: 's1', reps: '', weight: '' }] }
  // Act
  const next = workoutDraftReducer(emptyDraft, { type: 'ADD_EXERCISE', exercise })
  // Assert
  expect(next.exercises).toEqual([exercise])
})
```

### ARIA_ON_ICON_CONTROLS
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:239-247
<Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground"
  onClick={() => dispatch({ type: 'REMOVE_SET', exerciseIndex, setIndex })}
  aria-label={`Remove set ${setIndex + 1}`}>
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/workout-input.ts` | UPDATE | `SetInput.completed?: boolean` + `parseSet` validation |
| `src/lib/workout-input.test.ts` | UPDATE | Cover completed passthrough + rejection of non-boolean |
| `src/db/workouts.ts` | UPDATE | `insertWorkoutChildren` writes `completed` |
| `src/db/save-workout.test.ts` | UPDATE | Set-values assertions gain `completed` |
| `src/db/update-workout.test.ts` | UPDATE | Same, for the re-insert path |
| `src/app/workout/new/workout-draft.ts` | UPDATE | `DraftSet.completed`, `TOGGLE_SET_COMPLETED` + `RESTORE_DRAFT` actions, mapper passthrough both directions |
| `src/app/workout/new/workout-draft.test.ts` | UPDATE | New reducer cases + mapper round-trip |
| `src/app/workout/new/draft-storage.ts` | CREATE | Pure versioned serialize/parse for the localStorage snapshot |
| `src/app/workout/new/draft-storage.test.ts` | CREATE | Round-trip, TTL, version/unit/shape rejection |
| `src/lib/format.ts` | UPDATE | `formatElapsed(ms)` |
| `src/lib/format.test.ts` | UPDATE | Cover formats + implausible spans |
| `src/app/workout/new/session-clock.tsx` | CREATE | Ticking elapsed chip (client component) |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Toggle UI, persistence wiring, clock, `startedAt` prop |
| `src/app/workout/[id]/edit/page.tsx` | UPDATE | Pass `workout.startedAt` to the logger |

## NOT Building

- **Rest timers** — explicitly excluded by the user; still deferred as in prior PRDs.
- **Completion display in history/detail views** (`/workout/[id]`, home cards) — read-side polish, separate small PR.
- **MCP exposure of `completed`** (`update_set` patch tool, `get_workout` output) — separate PR; schema column already exists so nothing breaks.
- **Cross-device draft sync / server-side drafts** — localStorage only; single-phone POC.
- **"Restore draft?" confirmation banner** — restore is silent; TTL + key/unit checks bound the risk.
- **Auto-save to the server mid-session** — save semantics unchanged.
- **Completion-aware progression/stats** — the progression engine and program stats keep reading reps/weight only.

---

## Step-by-Step Tasks

Slices: Tasks 1–4 = set completion; 5–6 = draft persistence; 7–9 = duration; 10 = final sweep. Each slice ends green (types, lint, tests) and is a natural commit boundary.

### Task 1: `completed` through the save contract
- **ACTION**: Extend `SetInput` and `parseWorkoutInput`.
- **IMPLEMENT**: In `src/lib/workout-input.ts`: add `completed?: boolean` to `SetInput` (doc comment: "true when the lifter checked the set off in-session; absent = false"). In `parseSet`: `const { completed } = obj`; if `completed !== undefined && completed !== null && typeof completed !== 'boolean'` throw `new Error('set completed must be a boolean')`; include `...(typeof completed === 'boolean' && { completed })` in the return.
- **MIRROR**: VALIDATION_BOUNDARY.
- **IMPORTS**: none new.
- **GOTCHA**: Return a fresh object as today — omit the key when absent, matching the house style `...(name !== undefined && { name })`.
- **VALIDATE**: `npx tsc --noEmit && npm test -- src/lib/workout-input.test.ts`

### Task 2: Persist `completed` in the DB layer
- **ACTION**: Write the flag in `insertWorkoutChildren`.
- **IMPLEMENT**: In `src/db/workouts.ts:168-173` add `completed: s.completed ?? false` to the mapped set values.
- **MIRROR**: DB_INSERT_PATH.
- **GOTCHA**: `updateWorkout` re-inserts children through this same function, so edits round-trip completion for free — but that also means EVERY existing exact `toEqual` assertion on set values must now expect `completed: false`. Run `grep -rn "setNumber: 1" src --include="*.test.ts"` and update all hits (at minimum `save-workout.test.ts`, `update-workout.test.ts`).
- **VALIDATE**: `npm test -- src/db/save-workout.test.ts src/db/update-workout.test.ts` (add one case with `completed: true` in the input asserting it lands in values).

### Task 3: Draft state + mappers
- **ACTION**: Extend `workout-draft.ts`.
- **IMPLEMENT**:
  - `DraftSet` gains `completed: boolean` (required — draft is fully controlled state, unlike the wire format).
  - `newDraftSet()` returns `completed: false`.
  - New action `{ type: 'TOGGLE_SET_COMPLETED'; exerciseIndex: number; setIndex: number }` — reducer case flips `completed` via `mapExerciseAt`, same shape as `UPDATE_SET`.
  - New action `{ type: 'RESTORE_DRAFT'; draft: WorkoutDraft }` — returns `action.draft` verbatim (mount-time restore; keeps the reducer the single owner of state transitions).
  - `draftToInput`: set mapping gains `...(set.completed && { completed: true })` (omit when false — keeps the wire payload minimal and MCP/save behavior unchanged for unchecked sets).
  - `detailToDraft`: map `completed: set.completed` from the persisted row; add an options param `{ resetCompleted?: boolean }` (default false) that forces all sets unchecked.
- **MIRROR**: REDUCER_IMMUTABILITY; PURE_LOGIC_OUT_OF_REACT.
- **GOTCHA**: `detailToDraft` also feeds the repeat flow (`/workout/new?from=`) — repeating a workout must start UNCHECKED. `new/page.tsx` passes `resetCompleted: true`; `edit/page.tsx` keeps the default (checks persist across edits). Keep the function pure.
- **VALIDATE**: `npm test -- src/app/workout/new/workout-draft.test.ts` — new cases: toggle on/off, toggle doesn't mutate prev, `draftToInput` includes `completed: true` only for checked sets, `detailToDraft` round-trips and `resetCompleted` clears.

### Task 4: Check-off UI in the logger
- **ACTION**: Turn the set-number badge into a completion toggle.
- **IMPLEMENT**: In `workout-logger.tsx:199-201`, replace the `<span>` badge with a `<button type="button">`:
  ```tsx
  <button
    type="button"
    onClick={() => dispatch({ type: 'TOGGLE_SET_COMPLETED', exerciseIndex, setIndex })}
    aria-pressed={set.completed}
    aria-label={`Mark set ${setIndex + 1} complete`}
    className={cn(
      'relative grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tnum transition-colors',
      'before:absolute before:-inset-1.5', // expands the tap target toward 44px without moving layout
      set.completed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
    )}
  >
    {set.completed ? '✓' : setIndex + 1}
  </button>
  ```
  Import `cn` from `@/lib/utils`. Also update `newDraftExercise`-built seeds anywhere tests construct `DraftSet` literals (they now need `completed`).
- **MIRROR**: ARIA_ON_ICON_CONTROLS; existing tailwind vocabulary (`size-8`, `rounded-full`, `bg-muted`, `tnum`).
- **GOTCHA**: 32 px (`size-8`) is below the 44 px HIG target the repo cares about (see commit `ed0dd21` "HIG touch targets") — hence the `before:` inset hit-area expansion; keep the visual circle at `size-8` to preserve row layout. `transition-colors` only — never animate layout.
- **VALIDATE**: `npx tsc --noEmit && npm run lint`; manual: toggle a set, save, reopen edit — check persists; repeat flow starts unchecked.

### Task 5: Draft snapshot codec
- **ACTION**: CREATE `src/app/workout/new/draft-storage.ts` — pure, no browser APIs.
- **IMPLEMENT**:
  ```ts
  export const DRAFT_STORAGE_VERSION = 1
  export const DRAFT_TTL_MS = 12 * 60 * 60_000 // longest plausible gap within one session
  export function draftStorageKey(workoutId?: string): string // `workout-draft:new` | `workout-draft:${id}`
  export interface StoredDraft { v: number; unit: WeightUnit; name: string; openedAt: string /* ISO */; savedAt: string /* ISO */; draft: WorkoutDraft }
  export function serializeDraft(input: { draft: WorkoutDraft; name: string; unit: WeightUnit; openedAt: Date; now: Date }): string
  export function deserializeDraft(raw: string | null, opts: { unit: WeightUnit; now: Date }):
    { draft: WorkoutDraft; name: string; openedAt: Date } | null
  ```
  `deserializeDraft` returns `null` (never throws) on: null/unparseable JSON, wrong `v`, unit mismatch (draft weight strings are display-unit — converting strings is lossy, discard instead), `savedAt` older than TTL or in the future, invalid `openedAt`, a shape failing a defensive field-walk (every exercise/set field type-checked like `wger.ts` does — never trust storage), or empty `exercises` (nothing worth restoring).
- **MIRROR**: PURE_LOGIC_OUT_OF_REACT (header comment explaining why `localStorage` stays out); VALIDATION_BOUNDARY for the field-walk.
- **IMPORTS**: `type WorkoutDraft` from `./workout-draft`, `type WeightUnit` from `@/lib/units`.
- **GOTCHA**: `now` is a parameter, never `Date.now()` inside — deterministic tests under `environment: 'node'`.
- **VALIDATE**: `npm test -- src/app/workout/new/draft-storage.test.ts` — round-trip, TTL expiry, future savedAt, version bump, unit mismatch, malformed-set, empty-draft.

### Task 6: Wire persistence into the logger
- **ACTION**: Restore on mount, persist on change, clear on save.
- **IMPLEMENT** in `workout-logger.tsx`:
  - `const storageKey = draftStorageKey(workoutId)`.
  - `const restoredRef = useRef(false)`.
  - Mount effect (`[]` deps; localStorage is browser-only — never during render or SSR/hydration breaks): `const restored = deserializeDraft(localStorage.getItem(storageKey), { unit, now: new Date() })`; if non-null → `dispatch({ type: 'RESTORE_DRAFT', draft: restored.draft })`, `setName(restored.name)`, restore the session start (see Task 9). Set `restoredRef.current = true` at the END either way.
  - Persist effect on `[draft, name]`: skip until `restoredRef.current` is true (otherwise the first render's server-seeded draft overwrites the snapshot before restore reads it). Then: empty draft + blank name → `localStorage.removeItem(storageKey)`; else `localStorage.setItem(storageKey, serializeDraft({...}))`. Wrap in try/catch and swallow (Safari private mode quota) — a failed persist must never break logging; same non-critical stance as the ghost-fetch catch at lines 77–80.
  - In `handleSave`, after the awaited action succeeds and BEFORE `router.push`: `localStorage.removeItem(storageKey)` (not on failure — a failed save must keep the snapshot).
- **MIRROR**: the existing mount-fetch effect (lines 62–85) for structure and comment style.
- **GOTCHA 1**: React runs same-phase effects in declaration order, but use the explicit `restoredRef` guard anyway — explicit beats ordering subtleties.
- **GOTCHA 2**: Edit mode restores over server-seeded data by design (an interrupted live session IS newer than the row it was seeded from); a draft from a DIFFERENT device would be stale — accepted POC risk, note in a code comment.
- **GOTCHA 3**: Two tabs on `/workout/new` share the `:new` key — last writer wins; accepted, single-phone POC.
- **VALIDATE**: `npx tsc --noEmit && npm run lint && npm run build`; manual: type sets → reload → restored; save → key gone; switch unit pref → old draft discarded.

### Task 7: Elapsed formatter
- **ACTION**: Add `formatElapsed` to `src/lib/format.ts`.
- **IMPLEMENT**: `export function formatElapsed(ms: number): string | null` — `null` when `ms < 0` or `ms > MAX_PLAUSIBLE_DURATION_MS` (reuse the existing module-level constant); else `H:MM:SS` when ≥ 1 h, `M:SS` otherwise (`12:05`, `1:02:07` — pad seconds always, minutes only under an hour prefix).
- **MIRROR**: DURATION_FORMAT (same constants block, same doc-comment voice).
- **VALIDATE**: `npm test -- src/lib/format.test.ts` — 0 → `0:00`, 65 s → `1:05`, 3661 s → `1:01:01`, negative → null, 7 h → null.

### Task 8: Session clock component
- **ACTION**: CREATE `src/app/workout/new/session-clock.tsx`.
- **IMPLEMENT**:
  ```tsx
  'use client'
  // Ticks once a second from `startedAt`. Renders nothing until mounted (the
  // first client render must match SSR, which can't know the elapsed time) and
  // nothing for implausible spans (formatElapsed → null, e.g. backdated edits).
  export function SessionClock({ startedAt }: { startedAt: Date }) {
    const [now, setNow] = useState<Date | null>(null)
    useEffect(() => {
      setNow(new Date())
      const id = setInterval(() => setNow(new Date()), 1_000)
      return () => clearInterval(id)
    }, [])
    if (!now) return null
    const label = formatElapsed(now.getTime() - startedAt.getTime())
    if (!label) return null
    return (
      <p className="px-1 text-sm font-semibold tnum text-muted-foreground">
        <span aria-hidden="true">⏱ </span>
        <span aria-label="Session time">{label}</span>
      </p>
    )
  }
  ```
- **MIRROR**: `'use client'` + effect-interval; SSR-safe null-first render (same reason localStorage lives in effects).
- **IMPORTS**: `useEffect, useState` from `react`; `formatElapsed` from `@/lib/format`.
- **GOTCHA**: Do NOT compute elapsed on first paint — server HTML and hydration would differ. The `now === null → null` gate is the fix.
- **VALIDATE**: `npx tsc --noEmit`; manual: ticks; backdated edit shows no clock.

### Task 9: Mount the clock + `startedAt` prop
- **ACTION**: Show the clock in both modes; make the session start restorable state.
- **IMPLEMENT**:
  - `WorkoutLoggerProps` gains `startedAt?: Date` (doc: "the persisted session start, for edit mode; new sessions clock from open time").
  - Replace `openedAtRef` with state: `const [openedAt, setOpenedAt] = useState<Date>(() => startedAt ?? new Date())`. The Task 6 restore calls `setOpenedAt(restored.openedAt)`; the persist effect includes `openedAt` in payload and deps; `handleSave`'s create branch uses `startedAt: openedAt`. Keep the existing comment block (lines 52–56, 97–101) — it explains WHY startedAt is the open time.
  - Render `<SessionClock startedAt={openedAt} />` directly under the name input.
  - `edit/page.tsx`: pass `startedAt={workout.startedAt}`.
- **MIRROR**: existing prop-docs style in `WorkoutLoggerProps`.
- **GOTCHA 1**: A ref wouldn't re-render the clock after restore — that's why `openedAt` becomes state.
- **GOTCHA 2**: Edit mode's `startedAt` may be days old (backdated logs, yesterday's program day) — `formatElapsed`'s 6 h ceiling hides the clock instead of showing "26:14:09".
- **GOTCHA 3**: Do NOT start sending `startedAt` on edit saves — `updateWorkout` must keep preserving the existing value; only the create branch passes it (unchanged behavior).
- **VALIDATE**: `npx tsc --noEmit && npm run lint && npm test && npm run build`.

### Task 10: Full-suite validation + e2e touch-up
- **ACTION**: Confirm nothing regressed; extend e2e coverage.
- **IMPLEMENT**: Run the full suite. In `e2e/workout.spec.ts` (or a new spec mirroring its harness) add: check off set 1 → save → assert in Postgres `completed = true` for setNumber 1, `false` for setNumber 2 (specs already assert rows via the `postgres` client).
- **GOTCHA**: e2e runs against live Clerk/Supabase — extend an existing user-provisioning harness rather than adding a new disposable user if practical.
- **VALIDATE**: `npm test && npm run build`; `npm run test:e2e` if env configured (else note skipped in the report).

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| reducer TOGGLE on | unchecked set | `completed: true`, prev not mutated | |
| reducer TOGGLE off | checked set | `completed: false` | |
| reducer RESTORE_DRAFT | any state + draft | returns draft verbatim | |
| draftToInput completed | checked + unchecked sets | `completed: true` only on checked; unchecked omit the key | |
| detailToDraft completed | row with `completed: true` | draft set checked | |
| detailToDraft resetCompleted | same, `{ resetCompleted: true }` | all unchecked | yes |
| parseSet completed | `true` / `false` | passes through | |
| parseSet completed invalid | `'yes'`, `1` | throws 'set completed must be a boolean' | yes |
| insertWorkoutChildren | input with/without completed | values include `completed: true/false` | |
| serialize→deserialize | fresh draft | identical draft/name/openedAt | |
| deserialize TTL | savedAt 13 h ago | null | yes |
| deserialize future savedAt | savedAt tomorrow | null | yes |
| deserialize version | `v: 0` | null | yes |
| deserialize unit mismatch | stored kg, active lb | null | yes |
| deserialize malformed | truncated JSON / wrong field types / empty exercises | null | yes |
| formatElapsed | 0 / 65 s / 3661 s / −1 / 7 h | `0:00` / `1:05` / `1:01:01` / null / null | yes |

### Edge Cases Checklist
- [ ] Empty draft (no exercises) — nothing persisted; empty-state UI unchanged
- [ ] Repeat flow (`?from=`) — seeds unchecked; a stored `/workout/new` draft takes precedence over the seed (restoredRef ordering)
- [ ] Unit preference changed between sessions — stored draft discarded, no lb/kg corruption
- [ ] Safari private mode / quota exceeded — persist fails silently, logging still works
- [ ] Backdated edit (startedAt > 6 h ago) — no clock rendered
- [ ] Save failure — snapshot NOT cleared (clear only after the action resolves)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npm run lint
```
EXPECT: Zero errors

### Unit Tests
```bash
npm test -- src/app/workout/new src/lib/workout-input.test.ts src/lib/format.test.ts src/db/save-workout.test.ts src/db/update-workout.test.ts
```
EXPECT: All pass

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions

### Database Validation
None — `sets.completed` already exists (no migration).

### Browser Validation
```bash
npm run dev
```
- [ ] Check off sets; ✓ badge styling; toggle back off
- [ ] Save → reopen `/workout/{id}/edit` → checks persisted
- [ ] Repeat a workout → all sets unchecked
- [ ] Mid-session reload on `/workout/new` → draft, name, and clock restored
- [ ] Save → localStorage key removed
- [ ] Clock ticks in new + fresh-edit modes; absent on an old backdated edit

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Set completion round-trips: logger → DB → edit page → logger
- [ ] Refresh mid-session restores draft, name, and session start in both new and edit modes
- [ ] Live elapsed time shows in-session, hidden for implausible spans
- [ ] No migration needed; MCP tools unaffected

## Completion Checklist
- [ ] Reducer stays pure; storage codec has no browser APIs
- [ ] Validation boundary rejects non-boolean `completed` and malformed stored drafts
- [ ] Set-values test assertions updated everywhere the harness records inserts
- [ ] No hydration mismatches (storage + clock only render post-mount)
- [ ] Three commit-sized slices (completion / persistence / clock), each green

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Exact `toEqual` set assertions scattered beyond the two named test files | Medium | Test failures | `grep -rn "setNumber: 1" src --include="*.test.ts"` before Task 2; update all hits |
| Stale cross-device draft restored over fresh server data in edit mode | Low (single-phone POC) | Confusing restore | 12 h TTL + code comment; banner deferred |
| Persist effect overwrites snapshot before restore runs | Medium if unguarded | Restore silently no-ops | `restoredRef` guard (Task 6) |
| Touch target of the 32 px toggle | Medium | Missed taps mid-set | `before:` inset hit-area expansion (Task 4) |
| Service worker serving a stale shell confusing restore testing | Low | Dev confusion only | Already fixed in `439d7b3`; test with normal reloads |

## Notes
- `sets.completed` has existed since the original schema with nothing writing it — this feature is the column's intended consumer; no migration required.
- Program-day live logging flows through EDIT mode (instantiated workout → `/workout/{id}/edit`), which is why persistence and the clock must work there, not just on `/workout/new`.
- Rest timers stay deferred (user decision at plan time, consistent with two prior PRDs).
- Follow-ups intentionally left out: completion in history/detail views; MCP `update_set` gaining a `completed` arg — both small standalone PRs.
