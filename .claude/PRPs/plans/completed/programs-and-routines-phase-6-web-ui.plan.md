# Plan: Programs & Routines — Phase 6: Web UI

## Summary
Add the non-agent surface for programs: a mobile-first program builder (multi-day, ordered exercises, set/target editing), a program list + detail browse view, and a "Start today's [day]" flow that instantiates a program day into a real workout with engine-derived targets. Everything consumes the already-complete `db/programs.ts` — this phase is pages, server actions, and one client draft reducer; no new DB or engine code.

## User Story
As a lifter using the web app (not the MCP agent), I want to build a program, browse it, and start today's session with one tap, so that I can run my training plan entirely from the UI at the gym.

## Problem → Solution
Programs are fully functional but agent-only (MCP tools). → The web app gets `/programs` (list), `/programs/new` (builder), `/programs/[id]` (browse + start day + edit/delete/status), reusing the workout UI's exact patterns.

## Metadata
- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/programs-and-routines.prd.md`
- **PRD Phase**: Phase 6 — Web UI
- **Estimated Files**: 12 (11 create, 1 update)

---

## UX Design

### Before
```
Home ─ [+ Start Workout] ─ History list
(programs invisible to the UI; only the MCP agent can touch them)
```

### After
```
Home ─ [+ Start Workout] ─ [Programs →] ─ History list

/programs                      /programs/[id]
┌──────────────────────┐      ┌────────────────────────────┐
│ PROGRAMS             │      │ PPL Hypertrophy   [active] │
│ [+ New Program]      │      │ Week 3 of 6 · deload wk 6  │
│ ┌──────────────────┐ │      │ ┌─ Day 1 · Push ─────────┐ │
│ │ PPL Hypertrophy  │ │      │ │ Bench 3×5 @ 105 kg     │ │
│ │ active · 6-wk  > │ │      │ │ (engine targets, wk 3) │ │
│ └──────────────────┘ │      │ │ [Start this day]       │ │
└──────────────────────┘      │ └────────────────────────┘ │
                              │ [Edit] [Archive] [Delete]  │
                              └────────────────────────────┘
/programs/new  (same builder at /programs/[id]/edit)
┌────────────────────────────────────────┐
│ Program name │ weeks │ deload          │
│ ┌ Day 1 [name] [remove] ─────────────┐ │
│ │  <ExercisePicker>                  │ │
│ │  Bench Press                       │ │
│ │  set 1  reps 5-5  load 100  rpe 8  │ │
│ │  [+ set]                           │ │
│ └────────────────────────────────────┘ │
│ [+ Add day]     [Save]                 │
└────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home page | Workouts only | Adds a `Programs` link | one `Link` styled like existing buttons |
| Program authoring | MCP only | `/programs/new` builder | reuses `ExercisePicker` |
| Starting a session | Manual `+ Start Workout` | `Start this day` on `/programs/[id]` → redirects to `/workout/{id}` | week auto-derived; targets pre-seeded |
| Program lifecycle | MCP `set_program_status`/`delete_program` | Buttons on detail page | archive/activate + delete w/ confirm |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/workout-draft.ts` | all | THE pattern to mirror for `program-draft.ts` (string-field draft, pure reducer, `draftToInput`/`detailToDraft` pair, kg conversion at the mapper) |
| P0 | `src/app/workout/actions.ts` | all | Server-action pattern: `requireUserId` → parse → db → `revalidatePath` → throw for client try/catch; NO `redirect()` inside try/catch-wrapped actions |
| P0 | `src/db/programs.ts` | 38–70, 176–260, 292–470 | The complete data layer this phase consumes: `listPrograms`, `getProgramDetail`/`ProgramDetail`, `saveProgram`, `updateProgram`, `deleteProgram`, `setProgramStatus`, `nextProgramWeek`, `deriveDayPrescription`, `instantiateProgramDay` |
| P0 | `src/lib/program-input.ts` | 133–225 | `programSetSchema`/`programInputSchema` field names (`suggestedLoadKg`, `repMin`/`repMax`, `setType`, `metricMode`) + `parseProgramInput` (line 222) — the server-action trust boundary already exists |
| P1 | `src/app/page.tsx` | all | Page shell: `max-w-md` PWA layout, sticky header, `rounded-2xl border bg-card` lists, empty-state card |
| P1 | `src/app/workout/new/workout-logger.tsx` | 1–120 | Client component wiring: `useReducer` + `useTransition` + `router.push` on success, inline error string on catch |
| P1 | `src/app/workout/new/exercise-picker.tsx` | 8–25 | Reused as-is: `onAdd({ wgerExerciseId, name, category })` |
| P1 | `src/app/workout/[id]/workout-actions.tsx` | all | Client delete-with-confirm pattern to mirror for program delete/status |
| P2 | `src/lib/units.ts`, `src/lib/format.ts` | all | `kgToDisplay`/`displayToKg`, `formatSet`, `placeholderForSet` |
| P2 | `src/lib/progression.ts` | 77–96 | `DerivedSet` shape rendered on the detail page (loadKg, repMin/repMax, rpe, derivedFrom) |
| P2 | `e2e/workout.spec.ts`, `e2e/global.setup.ts` | all | Playwright + Clerk setup pattern for the new spec |

## External Documentation
None needed — feature uses established internal patterns only (Next 16 App Router server components + server actions, already in use throughout).

---

## Patterns to Mirror

### SERVER_ACTION
```ts
// SOURCE: src/app/workout/actions.ts:22-28
export async function saveWorkoutAction(input: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = parseWorkoutInput(input)
  const result = await saveWorkout(userId, parsed)
  revalidatePath('/')
  return result
}
```
Ownership miss → `if (!result) throw new Error('program not found')` (actions.ts:39). Never `redirect()` inside an action the client wraps in try/catch (actions.ts:46-49 comment).

### DRAFT_REDUCER (pure, string fields, factories outside)
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:16-21, 57-59, 79-116
export interface DraftSet { id: string; reps: string; weight: string }
export function newDraftSet(): DraftSet {
  return { id: crypto.randomUUID(), reps: '', weight: '' }
}
// reducer: every case returns fresh objects; impure id-minting stays in factories
```

### DRAFT_TO_INPUT (unit conversion at the mapper, server re-validates)
```ts
// SOURCE: src/app/workout/new/workout-draft.ts:140-156
const w = toWeight(set.weight)
return { reps: toReps(set.reps), weight: w === null ? null : displayToKg(w, unit) }
```

### PAGE_SHELL (server component)
```tsx
// SOURCE: src/app/page.tsx:11-28
export default async function HomePage() {
  const userId = await requireUserId() // middleware also guards; defense-in-depth
  ...
  <div className="flex min-h-[100dvh] flex-col">
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-safe pt-safe backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-5 pb-3">
```
List rows: `divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card`; empty state: `rounded-2xl border ... px-5 py-12 text-center` (page.tsx:41-47).

### CLIENT_SAVE (transition + inline error + push)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx:79-94
startTransition(async () => {
  try {
    setError(null)
    await saveWorkoutAction(draftToInput(draft, name, unit))
    router.push('/')
  } catch {
    setError('Could not save workout. Please try again.')
  }
})
```

### TEST_STRUCTURE (pure-module vitest)
```ts
// SOURCE: repo convention — pure modules tested as plain functions (workout-draft, progression)
// AAA structure, descriptive behavior names:
// test('returns empty array when no markets match query', () => {})
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/programs/actions.ts` | CREATE | Server actions: save/update/delete/setStatus/startDay |
| `src/app/programs/page.tsx` | CREATE | Program list (server component) |
| `src/app/programs/new/program-draft.ts` | CREATE | Pure draft reducer + `draftToProgramInput` + `detailToProgramDraft` |
| `src/app/programs/new/program-builder.tsx` | CREATE | Client builder (create + edit modes) |
| `src/app/programs/new/page.tsx` | CREATE | Server wrapper: unit fetch → builder |
| `src/app/programs/[id]/page.tsx` | CREATE | Detail/browse: derived-week targets per day + start/edit/lifecycle |
| `src/app/programs/[id]/start-day-button.tsx` | CREATE | Client: startDay action → `router.push('/workout/'+id)` |
| `src/app/programs/[id]/program-actions.tsx` | CREATE | Client: delete-with-confirm + status toggle |
| `src/app/programs/[id]/edit/page.tsx` | CREATE | Server wrapper: detail → draft → builder in edit mode |
| `src/app/page.tsx` | UPDATE | Add `Programs` link near Start Workout |
| `src/app/programs/new/program-draft.test.ts` | CREATE | Unit tests for reducer + mappers |
| `e2e/programs.spec.ts` | CREATE | Build → browse → start-day e2e |

## NOT Building
- Progression-scheme editing in the builder (agent tier; existing programs keep their JSONB untouched on edit — see Task 3 GOTCHA)
- Technique (`stages[]`), superset grouping, per-week override editing in the UI (render-only where cheap, edit via MCP)
- Timed-metric (`duration`/`distance`) set authoring in the builder (`reps_weight` only; detail page renders whatever exists)
- Muscle-volume dashboard, week picker on start (auto-week only; explicit week stays MCP-only)
- Any new `db/` or engine code

---

## Step-by-Step Tasks

### Task 1: `program-draft.ts` — pure client draft
- **ACTION**: Create draft types/reducer/mappers for programs.
- **IMPLEMENT**: `DraftProgramSet { id, repMin, repMax, load, rpe: string }` (+ opaque pass-through fields, see Task 3 GOTCHA), `DraftProgramExercise { id, wgerExerciseId, name, category, progression (pass-through), sets }`, `DraftProgramDay { id, name, exercises }`, `ProgramDraft { name, mesocycleWeeks, deloadWeek: string, days }`. Actions: ADD_DAY/REMOVE_DAY/RENAME_DAY, ADD_EXERCISE/REMOVE_EXERCISE (day-scoped), ADD_SET/UPDATE_SET/REMOVE_SET, SET_META. Factories `newDraftDay/Exercise/Set` mint `crypto.randomUUID()` outside the reducer. `draftToProgramInput(draft, unit): ProgramInput` — trims name, parses ints (`mesocycleWeeks` ≥1 default 1, blank deload → null), maps sets to `{ setType: 'working', metricMode: 'reps_weight', repMin, repMax, rpe, suggestedLoadKg: displayToKg(load, unit) }` with `'' → null` (pass-through fields re-emitted verbatim). `detailToProgramDraft(detail: ProgramDetail, unit)` — inverse, reuses row UUIDs as client ids, `kgToDisplay` for loads (pure — no `crypto`, callable from the edit Server Component).
- **MIRROR**: DRAFT_REDUCER + DRAFT_TO_INPUT patterns exactly.
- **IMPORTS**: `type ProgramInput` from `@/lib/program-input`; `type ProgramDetail` from `@/db/programs`; `displayToKg, kgToDisplay, type WeightUnit` from `@/lib/units`.
- **GOTCHA**: `programSetSchema` field is `suggestedLoadKg` (not `weight`/`suggestedLoad` — the latter is the MCP display name). repMin > repMax is rejected server-side by `programSetIntegrityViolation`; mirror workout-draft's leniency (send as-is, server rejects, inline error).
- **VALIDATE**: `npx vitest run src/app/programs/new/program-draft.test.ts`

### Task 2: `program-draft.test.ts`
- **ACTION**: Unit-test reducer + both mappers (TDD: write before/alongside Task 1).
- **IMPLEMENT**: AAA tests — add/remove day preserves order; UPDATE_SET returns fresh objects with untouched siblings referentially identical; `draftToProgramInput` converts lb→kg, `'' → null`, drops blank program name, blank deload → null; JSONB pass-through re-emitted verbatim; `detailToProgramDraft` round-trips a minimal `ProgramDetail` fixture (kg→lb strings, row ids reused).
- **MIRROR**: TEST_STRUCTURE; fixture style of `src/lib/progression.test.ts`.
- **VALIDATE**: all green.

### Task 3: `src/app/programs/actions.ts`
- **ACTION**: Create the five server actions.
- **IMPLEMENT**:
  - `saveProgramAction(input: unknown)` → `parseProgramInput` → `saveProgram` → `revalidatePath('/programs')` → `{ id }`
  - `updateProgramAction(id, input)` → `updateProgram`; `if (!result) throw new Error('program not found')`; revalidate `/programs` + `/programs/${id}`
  - `deleteProgramAction(id)` → `deleteProgram`; throw on empty returning; revalidate `/programs`
  - `setProgramStatusAction(id, status: unknown)` → validate via `statusSchema.parse` → `setProgramStatus`; throw on null; revalidate both paths
  - `startProgramDayAction(programDayId: string)` → assert non-empty string → `instantiateProgramDay(userId, programDayId)` (no week arg — auto-derive) → throw on null → `revalidatePath('/')` → return `{ workoutId: r.id, week: r.week }`
- **MIRROR**: SERVER_ACTION pattern verbatim, incl. the no-`redirect()` rule and JSDoc tone of `workout/actions.ts`.
- **IMPORTS**: `requireUserId` from `@/lib/auth`; `parseProgramInput, statusSchema` from `@/lib/program-input`; db fns from `@/db/programs`; `revalidatePath` from `next/cache`.
- **GOTCHA**: `updateProgram` is a FULL REPLACE — the builder's edit mode round-trips the whole tree, so progression/technique JSONB not shown in the UI would be silently LOST on edit. `detailToProgramDraft` must carry `progression`/`technique`/`setType`/`metricMode`/`durationSec`/`distanceM` through as opaque pass-through fields and `draftToProgramInput` must re-emit them. This is the one place the draft is richer than the UI. Overrides live in a separate table and are untouched by `updateProgram`? — VERIFY at implementation time by reading `updateProgram` (programs.ts:203); if the replace drops override rows, surface a confirm or document the loss.
- **VALIDATE**: `npx tsc --noEmit` clean.

### Task 4: `/programs` list page
- **ACTION**: Create the list server component.
- **IMPLEMENT**: `requireUserId` → `listPrograms(userId)`. Header matches home (back link to `/`, title "Programs"). `+ New Program` link → `/programs/new` styled like home's Start Workout (`buttonVariants({ size: 'lg' })`). Rows: name, `status · N-wk cycle`, chevron → `/programs/[id]`. Empty-state card mirroring page.tsx:41-47. Status as a small badge (`text-xs uppercase text-muted-foreground`; `active` → `text-primary`).
- **MIRROR**: PAGE_SHELL. No per-program day counts — `listPrograms` returns program rows only; use `mesocycleWeeks` subtitle instead (avoids N+1).
- **VALIDATE**: `/programs` renders empty state, then a created program.

### Task 5: builder (`/programs/new/page.tsx` + `program-builder.tsx`)
- **ACTION**: Server wrapper + client builder.
- **IMPLEMENT**: `new/page.tsx`: `requireUserId`, `getWeightUnit`, render `<ProgramBuilder unit={unit} />` under the standard header. `program-builder.tsx` (`'use client'`): props `{ programId?, initialDraft?, unit }`; `useReducer`; meta inputs (name, mesocycleWeeks, deloadWeek — `<Input inputMode="numeric">`); per-day card (`rounded-2xl border border-border bg-card p-4`) with rename/remove, an `<ExercisePicker onAdd={...}>` per day; per-set row of four small inputs (repMin, repMax, load w/ unit suffix, rpe) + remove; `+ set`, `+ Add day`; Save via CLIENT_SAVE — create → `saveProgramAction` → `router.push('/programs/'+id)`; edit → `updateProgramAction(programId, ...)` → push detail.
- **MIRROR**: CLIENT_SAVE; section layout of `workout-logger.tsx`.
- **IMPORTS**: `Button`/`Input` from `@/components/ui/*`; `ExercisePicker` from `@/app/workout/new/exercise-picker` (plain client component — cross-route import is fine).
- **GOTCHA**: Zod requires ≥1 day and ≥1 set per exercise (`programDaySchema`/`programExerciseSchema` mins); disable Save when `days.length === 0` or any exercise has 0 sets, mirroring the logger's `isEmpty` gating.
- **VALIDATE**: build a 2-day program in the browser; row appears on `/programs`.

### Task 6: `/programs/[id]` detail page
- **ACTION**: Browse view with engine targets + lifecycle.
- **IMPLEMENT**: `getProgramDetail(userId, id)` → `notFound()` if null. `week = await nextProgramWeek(userId, id, program.mesocycleWeeks)`; per day: `deriveDayPrescription(userId, { exercises: day.exercises, program: { mesocycleWeeks, deloadWeek } }, week)` (run days via `Promise.all`). Render per exercise: `3×5 @ 105 kg · RPE 8` from `DerivedSet[]` (loadKg via `kgToDisplay`, repMin/repMax collapsed when equal, null load → reps-only); tag `derivedFrom === 'deload'` sets with `Deload`. Header: name + status badge + `Week {week} of {mesocycleWeeks}`. Each day card: `<StartDayButton programDayId={day.id} />`. Footer: `Edit` link + `<ProgramActions id status />`.
- **MIRROR**: PAGE_SHELL; formatting conventions from `src/lib/format.ts`.
- **GOTCHA**: `DayForDerivation` needs `program: { mesocycleWeeks, deloadWeek }` attached per day — `getProgramDetail` days have no back-ref; construct the object inline. Sets already include `overrides` (getProgramDetail eager-loads them).
- **VALIDATE**: page targets match `preview_program_week` output for the same program/week.

### Task 7: `start-day-button.tsx` + `program-actions.tsx`
- **ACTION**: The two client islands for the detail page.
- **IMPLEMENT**: `StartDayButton`: `useTransition`; click → `startProgramDayAction(programDayId)` → `router.push('/workout/'+workoutId)`; catch → inline error; pending state "Starting…". `ProgramActions`: mirror `workout-actions.tsx` — two-step confirm delete → `deleteProgramAction` → `router.push('/programs')`; status button toggles `active ⇄ archived` (draft → "Activate") via `setProgramStatusAction` + `router.refresh()`.
- **MIRROR**: `src/app/workout/[id]/workout-actions.tsx` (confirm-state, ghost/destructive variants).
- **GOTCHA**: navigation is client-side AFTER the action resolves — actions must not redirect.
- **VALIDATE**: Start yields a workout named after the day with seeded loads; delete returns to list.

### Task 8: `/programs/[id]/edit/page.tsx`
- **ACTION**: Edit-mode wrapper.
- **IMPLEMENT**: `getProgramDetail` → `notFound()`; `detailToProgramDraft(detail, unit)`; render `<ProgramBuilder programId={id} initialDraft={draft} unit={unit} />`.
- **MIRROR**: `src/app/workout/[id]/edit/page.tsx`.
- **GOTCHA**: JSONB pass-through must survive this round-trip — verify with an MCP-authored program carrying a progression scheme: edit one set in the UI, confirm `progression` still in DB.
- **VALIDATE**: edit changes only what was touched.

### Task 9: Home link
- **ACTION**: UPDATE `src/app/page.tsx` — secondary `Programs` link under Start Workout (`buttonVariants({ variant: 'outline', size: 'lg' })`, same width classes).
- **VALIDATE**: visual check; navigates.

### Task 10: `e2e/programs.spec.ts`
- **ACTION**: One happy-path spec.
- **IMPLEMENT**: Signed-in (existing global setup): builder → 1 day, 1 exercise via picker, 1 set (5-5 @ 100) → detail shows target line → `Start this day` → lands on `/workout/{id}` titled with the day name → cleanup through the UI (delete workout, delete program). Deterministic waits only.
- **MIRROR**: `e2e/workout.spec.ts` structure/selectors; workers already serial.
- **VALIDATE**: `npm run test:e2e -- programs.spec.ts`.

---

## Testing Strategy

### Unit Tests (vitest, pure modules only — repo convention)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| reducer ADD_DAY/REMOVE_DAY | 2 days, remove idx 0 | order preserved, fresh array | |
| reducer UPDATE_SET | one field patch | untouched siblings referentially identical | immutability |
| draftToProgramInput unit conv | load "220.5", unit lb | `suggestedLoadKg` ≈ 100 (via displayToKg) | |
| draftToProgramInput blanks | `''` everywhere | nulls; blank deload → null; blank name dropped | empty input |
| draftToProgramInput pass-through | draft with progression JSONB | re-emitted verbatim | data-loss guard |
| detailToProgramDraft round-trip | ProgramDetail fixture | row ids reused; kg→display strings | |

### Edge Cases Checklist
- [ ] Zero days / zero sets → Save disabled (client) AND Zod rejects (server)
- [ ] repMin > repMax → server rejects, inline error shown
- [ ] Program not owned → detail/edit 404; actions throw
- [ ] rpe-target with no history → null loads render reps-only (no crash)
- [ ] Deload week → scaled targets + tag on detail page

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit && npm run lint
```
EXPECT: zero errors

### Unit Tests
```bash
npx vitest run src/app/programs
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: no regressions

### Build
```bash
npm run build
```
EXPECT: clean production build

### E2E
```bash
npm run test:e2e -- programs.spec.ts
```
EXPECT: happy path passes

### Manual Validation
- [ ] Build 2-day program in UI → detail shows week-1 targets
- [ ] MCP `preview_program_week` numbers match the detail page for the same program
- [ ] Start day → workout pre-seeded; logging via existing workout UI works
- [ ] Edit a set on an MCP-authored program → progression JSONB survives

## Acceptance Criteria
- [ ] All tasks completed; all validation commands pass
- [ ] PRD success signal: a program built AND a session started entirely in the UI
- [ ] Detail-page targets agree with the engine (`preview_program_week` parity)
- [ ] No type/lint errors; tests written and passing

## Completion Checklist
- [ ] New code indistinguishable from workout UI code (naming, layout classes, action shape)
- [ ] No `redirect()` inside try/catch-wrapped actions
- [ ] Weights converted at the draft mapper; canonical kg on the wire
- [ ] JSONB pass-through verified (no silent data loss on edit)
- [ ] No drive-by refactors of workout pages

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Full-replace edit drops agent-authored JSONB (or override rows) | M | H | Pass-through fields + dedicated unit test + manual check; verify `updateProgram`'s override handling at Task 3 |
| Builder UI scope creep (techniques, supersets…) | M | M | Explicit NOT-building list; render-only on detail |
| Detail-page derivation cost (N days × history) | L | L | `Promise.all`; single-user POC scale |
| e2e flakiness w/ Clerk | L | M | Reuse proven global.setup.ts; deterministic waits |

## Notes
- Scope decision (from PRD phase text): the builder edits **targets** (rep range, load, RPE) only — the power tier (progression schemes, techniques, supersets, overrides) stays agent-authored; the UI round-trips it losslessly but never edits it.
- `parseProgramInput` already exists (`program-input.ts:222`) — do NOT hand-roll validation in actions.
- Commit strategy per repo rules: ~3 reviewable commits — (1) draft module + tests, (2) actions + pages, (3) e2e + home link.
