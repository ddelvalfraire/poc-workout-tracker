# Plan: Program Lifecycle — Restart-as-Clone (Phase 3)

## Summary
One tap from block N to block N+1: `cloneProgram` copies a program's full tree ROW-FOR-ROW in the db layer (days → exercises incl. `supersetGroup`/`source`/`progression` → sets incl. `technique`/`restSec` → per-week overrides → muscle tags), names it "Name — Block k", and `restartProgramAction` activates the clone — the existing single-active sweep archives the source. Entry points: the Phase-2 completion card's action row, ProgramActions on active/archived programs.

## User Story
As a lifter who finished (or abandoned) a block, I want "Restart block" to hand me a fresh week-1 copy of the same program with my history intact on the old one, so rolling into the next mesocycle doesn't mean rebuilding the plan.

## Problem → Solution
A finished block dead-ends: re-running the final week forever, or hand-rebuilding the program → clone the program faithfully at the ROW level (the `ProgramInput` path provably drops `supersetGroup`, `source: 'custom'`, and per-week overrides — see CRITICAL DESIGN DECISION), activate the clone via the tested single-active invariant, and surface the action where completion already lives.

## Metadata
- **Complexity**: Medium (large end)
- **Source PRD**: `.claude/PRPs/prds/program-lifecycle.prd.md`
- **PRD Phase**: Phase 3 — Restart-as-clone
- **Estimated Files**: 10

---

## CRITICAL DESIGN DECISION — row-copy clone, NOT ProgramInput round-trip

The PRD sketches `cloneProgramInput(detail)` → `saveProgram`. **That path cannot be faithful.** Verified against the code:

1. `programExerciseSchema` (`src/lib/program-input.ts:232-237`) has NO `supersetGroup` and NO `source` field — a clone through `ProgramInput` silently strips supersets and turns custom exercises into wger ones. This is the exact `upsert_program`-wipes-supersets infidelity precedent.
2. `insertProgramChildren` (`src/db/programs.ts:119-170`) never inserts `program_set_overrides` — `updateProgramAction`'s JSDoc (`src/app/programs/actions.ts:38-39`) documents overrides as a known loss of the full-replace path ("they remain MCP-only").
3. Muscle tags are re-derived from the wger catalog (network read); copying rows is both faithful and offline-safe.

**Therefore**: `cloneProgram(userId, sourceId)` is a db-layer function that reads `getProgramDetail` (which returns ALL columns — relations use full row selects) and re-inserts every row inside one transaction. No Zod, no catalog fetch, no `ProgramInput`. The PRD's fidelity list (supersets/techniques/overrides/progression/deload) becomes assertions on the recorded inserts.

---

## UX Design

### Before
```
Block complete card: label + PR rows + Stats link (no action)
Active program actions:   [Edit] [Leave program] [Delete]
Archived program actions: [Edit] [Activate]      [Delete]
```

### After
```
Completion card gains its designed action row:
┌──────────────────────────────────┐
│ BLOCK COMPLETE · 7 WEEKS         │
│ Bench Press    ~113 → ~130 kg    │
│ Stats →           [Restart block]│  outline button, right-aligned row
└──────────────────────────────────┘

Program actions (active OR archived) gain Restart:
[Edit] [Leave program|Activate] [Restart block] [Delete]

Tapping Restart → centered ConfirmDialog:
  "Start the next block?"
  "Creates a fresh copy of this program starting at week 1 and makes
   it active. This one is archived — its history and stats stay."
  [Keep it]  [Restart block]   ← confirm is volt (affirmative, not destructive)
→ on success: navigate to /programs/{newId}
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Completion card | Label + PRs + Stats | + Restart button row | The row Phase 2 reserved |
| Active program actions | Edit/Leave/Delete | + Restart block | Restart ≠ Leave: it archives AND replaces |
| Archived program page | Edit/Activate/Delete | + Restart block | Revive an old plan as a fresh block |
| Draft programs | — | NO restart | Nothing to roll over |
| ConfirmDialog | destructive-only confirm | optional `confirmVariant` | Backward-compatible prop, default 'destructive' |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/programs.ts` | 49-70, 112-197, 240-266 | `getProgramDetail` (clone source shape), `insertProgramChildren`/`saveProgram` (write-order + tx conventions to mirror), `setProgramStatus` (the sweep Restart relies on) |
| P0 | `src/db/save-program.test.ts` | 1-50 | The recording-tx harness `clone-program.test.ts` mirrors (ID_SEQUENCE, records, makeTx) |
| P0 | `src/db/schema.ts` | 230-363 | EVERY column the clone must copy: `programDays`, `programExercises` (supersetGroup, source, progression), `programSets` (technique, restSec…), `programExerciseMuscles`, `programSetOverrides` |
| P0 | `src/app/programs/[id]/program-actions.tsx` | all | The client-island pattern the restart button copies EXACTLY: pending/error state, closeRef-before-navigate (#25 backdrop race), two-surface errors |
| P1 | `src/components/confirm-dialog.tsx` | 28-53, 143-150 | Props contract + the confirm Button to parameterize (`confirmVariant`) |
| P1 | `src/app/programs/actions.ts` | all | Server-action conventions: requireUserId → validate → db → throw-on-null → revalidatePath |
| P1 | `src/app/programs/[id]/page.tsx` | 105-160 (completion card section) | Where the Restart row lands; `blockComplete`/card markup from Phase 2 |
| P2 | `src/db/program-status.test.ts` | 1-56 | update-chain mock w/ PgDialect param introspection (if asserting the activate step) |
| P2 | `src/lib/next-program-day.ts` | all | Pure-helper module convention (`block-name.ts` mirrors: JSDoc, single export, co-located test) |

## External Documentation
None — established internal patterns only.

---

## Patterns to Mirror

### RECORDING_TX_HARNESS (clone tests copy this shape)
```ts
// SOURCE: src/db/save-program.test.ts:13-41
const records: { values: unknown }[] = []
let idCounter = 0
const ID_SEQUENCE = ['p1', 'd1', 'e1', 'e2', 'd2', 'e3']
function makeTx() {
  return { insert: () => ({ values: (v: unknown) => {
    records.push({ values: v })
    return { returning: () => Promise.resolve([{ id: ID_SEQUENCE[idCounter++] }]) }
  } }) }
}
vi.mock('./index', () => ({ db: { transaction: (cb) => cb(makeTx()) } }))
```
Clone difference: `db.query.programs.findFirst` must ALSO be mocked (detail read), and the SETS insert needs `.returning()` (override remapping) — batch-returning ids, one per set, in insertion order.

### TX_WRITE_FUNCTION (db-layer shape for cloneProgram)
```ts
// SOURCE: src/db/programs.ts:178-197 (saveProgram)
export async function saveProgram(userId: string, input: ProgramInput): Promise<{ id: string }> {
  const catalog = await loadExerciseCatalog() // network read stays outside the tx
  return db.transaction(async (tx) => {
    const [program] = await tx.insert(programs).values({ userId, ... }).returning({ id: programs.id })
    ...
```
Clone difference: NO catalog load (muscle rows are copied), detail read happens before the tx, ownership via `getProgramDetail`'s own gate (null → return null, insert nothing).

### SERVER_ACTION (restartProgramAction shape)
```ts
// SOURCE: src/app/programs/actions.ts:72-80
export async function setProgramStatusAction(id: string, status: unknown): Promise<{ id: string }> {
  const userId = await requireUserId()
  const parsed = statusSchema.parse(status)
  const result = await setProgramStatus(userId, id, parsed)
  if (!result) throw new Error('program not found')
  revalidatePath('/programs')
  revalidatePath(`/programs/${id}`)
  return result
}
```

### CLIENT_CONFIRM_ISLAND (restart button copies the delete path)
```tsx
// SOURCE: src/app/programs/[id]/program-actions.tsx:88-104
async function handleDelete() {
  setIsPending(true)
  try {
    setDeleteError(null)
    await deleteProgramAction(id)
    closeDialogRef.current?.()   // release top layer BEFORE router.push (#25)
    setIsModalOpen(false)
    router.push('/programs')
    // isPending stays true on success: navigation unmounts this screen.
  } catch {
    setIsPending(false)
    setDeleteError('Could not delete program. Please try again.')
  }
}
```
Also mirror: `setXError(null)` before opening the dialog (stale-failure rule, lines 122-123, 137), NOT-startTransition comment (lines 53-55).

### SINGLE_ACTIVE_SWEEP (why the action never archives explicitly)
```ts
// SOURCE: src/db/programs.ts:259-264 (setProgramStatus)
if (status === 'active' && owned) {
  await db.update(programs).set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active'), ne(programs.id, id)))
}
```
Activating the clone archives an ACTIVE source automatically (tested invariant); an already-archived source needs nothing. PRD's "archive source → activate clone" collapses to one `setProgramStatus` call.

### PURE_HELPER_MODULE (block-name.ts convention)
```ts
// SOURCE: src/lib/next-program-day.ts:18-22
export function pickNextProgramDay<T extends ProgramDayRef>(
  days: readonly T[],
  loggedDayIds: ReadonlySet<string>,
): T | null {
```
Doc-comment states the policy; co-located `*.test.ts` with AAA vitest cases.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/block-name.ts` | CREATE | `nextBlockName(name)` — pure "Name — Block k" derivation |
| `src/lib/block-name.test.ts` | CREATE | TDD for the derivation incl. increment + length clamp |
| `src/db/clone-program.test.ts` | CREATE | TDD: maximal-fixture row-fidelity tests for `cloneProgram` |
| `src/db/programs.ts` | UPDATE | `cloneProgram(userId, sourceId)` — transactional row copy |
| `src/app/programs/actions.ts` | UPDATE | `restartProgramAction(id)` — clone → activate → revalidate |
| `src/components/confirm-dialog.tsx` | UPDATE | Optional `confirmVariant` prop (default 'destructive') |
| `src/app/programs/[id]/restart-program-button.tsx` | CREATE | Shared client island: button + confirm + navigate |
| `src/app/programs/[id]/program-actions.tsx` | UPDATE | Render restart button for active/archived |
| `src/app/programs/[id]/page.tsx` | UPDATE | Restart row in the completion card |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATE | Phase 3 status at report time |

## NOT Building

- MCP `restart_program` tool — Phase 4 (but `cloneProgram`'s signature is the seam it will wrap)
- Any change to `saveProgram`/`updateProgram`/`ProgramInput` — the builder's documented override loss stays as-is
- Restart for `draft` programs — no entry point renders for drafts
- Carrying training history/e1RM baselines onto the clone — the engine re-derives from all-time workout history at instantiation, which already spans programs (`getExerciseHistoryBefore` is not program-scoped); nothing to copy
- Un-archiving the source on clone failure — clone commits atomically BEFORE any status change; a failed activate leaves a harmless draft clone
- Editing the derived name in the confirm — POC keeps it automatic; rename via Edit after

---

## Step-by-Step Tasks

### Task 1: `nextBlockName` (RED → GREEN)
- **ACTION**: Create `src/lib/block-name.test.ts` then `src/lib/block-name.ts`.
- **IMPLEMENT**:
  ```ts
  const BLOCK_SUFFIX = /\s—\sBlock\s(\d+)$/
  export const MAX_PROGRAM_NAME = 200 // mirrors MAX_NAME in program-input.ts (not exported there)
  export function nextBlockName(name: string): string {
    const match = name.match(BLOCK_SUFFIX)
    const base = match ? name.slice(0, match.index) : name
    const k = match ? Number(match[1]) + 1 : 2
    const suffix = ` — Block ${k}`
    // Clamp the BASE so the stamped name stays a valid program name.
    return base.slice(0, Math.max(1, MAX_PROGRAM_NAME - suffix.length)).trimEnd() + suffix
  }
  ```
  Tests: `"Upper/Lower"` → `"Upper/Lower — Block 2"`; `"X — Block 2"` → `"X — Block 3"`; `"X — Block 99"` → 100; an em-dash INSIDE the base (`"Push — Pull"`) is untouched (suffix regex is end-anchored); a 200-char name still yields ≤200 chars ending in the suffix.
- **MIRROR**: PURE_HELPER_MODULE.
- **GOTCHA**: The suffix uses an em dash with spaces (`" — Block k"`), matching the PRD copy. Anchor with `$` and require the exact ` — Block ` spelling so user names containing "Block" elsewhere never increment.
- **VALIDATE**: `npm test -- src/lib/block-name.test.ts` green.

### Task 2: Failing `cloneProgram` fidelity tests (RED)
- **ACTION**: Create `src/db/clone-program.test.ts`.
- **IMPLEMENT**: RECORDING_TX_HARNESS, plus `db.query.programs.findFirst` mock (vi.hoisted, like instantiate-program.test.ts's findFirst) returning a MAXIMAL detail fixture:
  - program: `{ id: 'src1', userId: USER, name: 'PPL', status: 'archived', mesocycleWeeks: 6, deloadWeek: 4, notes: 'block notes' }`
  - day 0 `Push` (notes null) with TWO exercises to prove superset copy: e0 `{ wgerExerciseId: 73, source: 'wger', name: 'Bench', position: 0, supersetGroup: 1, progression: { scheme: 'linear', incrementKg: 2.5 } }`, e1 `{ wgerExerciseId: 5, source: 'custom', name: 'Cable Fly Custom', position: 1, supersetGroup: 1, progression: null }`
  - e0 sets: set 1 full-column `{ setNumber: 1, setType: 'working', metricMode: 'reps_weight', repMin: 8, repMax: 12, rir: 2, rpe: null, suggestedLoadKg: 100, tempo: '3-1-1', durationSec: null, distanceM: null, restSec: 120, technique: { version: 1, kind: 'drop-set', stages: [{ loadKg: 80, reps: 8 }] }, overrides: [{ week: 4, suggestedLoadKg: 60, ... }, { week: 6, rir: 0, ... }] }`; set 2 minimal with `overrides: []`
  - day 1 `Legs` with one exercise/one set (day-position proof)
  - ID_SEQUENCE: `['p2', 'd1', 'e1', …]` — the SETS insert RETURNS ids (`[{ id: 'ps1' }, { id: 'ps2' }]` style); overrides + muscles inserts have no returning (thenable resolve).
  Tests:
  1. **program row**: `{ userId: USER, name: 'PPL — Block 2', status: 'draft', mesocycleWeeks: 6, deloadWeek: 4, notes: 'block notes' }` — createdAt/updatedAt NOT set (column defaults).
  2. **fidelity sweep**: exercise inserts carry `supersetGroup: 1` on BOTH, `source: 'custom'` on e1, `progression` on e0; set insert carries every column (technique, restSec, tempo…); override rows remapped to the NEW set id (`programSetId: 'ps1'`, week 4 and 6) with all target columns; muscle rows copied verbatim (`{ programExerciseId: 'e1', muscle: 'Chest', role: 'primary' }`) — fixture puts `muscles` on e0.
  3. **write order**: program → (per day: day → (per exercise: exercise → sets → overrides → muscles)) — assert via `records.map` shape, mirroring save-program.test.ts's positional asserts.
  4. **ownership**: findFirst → undefined ⇒ returns null, `records` empty.
  5. **no catalog**: `getAllExercises` mock is never called (clone must not touch wger).
- **MIRROR**: RECORDING_TX_HARNESS; AAA + behavior-naming from save-program.test.ts.
- **GOTCHA**: `getProgramDetail`'s relation rows include DB-only fields (`id`, `programId`, `programDayId`, `programExerciseId`, `programSetId`) — the fixture should include them so tests prove they are STRIPPED/REMAPPED, not copied.
- **VALIDATE**: `npm test -- src/db/clone-program.test.ts` → RED (no export).

### Task 3: `cloneProgram` (GREEN)
- **ACTION**: Add to `src/db/programs.ts` (below `setProgramStatus`).
- **IMPLEMENT**:
  ```ts
  /**
   * Clones a program's ENTIRE tree row-for-row — days, exercises (superset
   * groups, custom-exercise source, progression), sets (technique, per-set
   * rest), per-week set overrides, and muscle tags — as a fresh DRAFT named
   * by nextBlockName. Row copy, NOT a ProgramInput round-trip: the input
   * schema cannot express supersetGroup/source/overrides (the documented
   * update-path loss), and copying muscle rows skips the catalog fetch.
   * Returns null when the source isn't owned. The caller decides activation.
   */
  export async function cloneProgram(userId: string, sourceId: string): Promise<{ id: string } | null> {
    const source = await getProgramDetail(userId, sourceId)   // ownership gate
    if (!source) return null
    return db.transaction(async (tx) => {
      const [program] = await tx.insert(programs).values({
        userId, name: nextBlockName(source.name), status: 'draft',
        mesocycleWeeks: source.mesocycleWeeks, deloadWeek: source.deloadWeek, notes: source.notes,
      }).returning({ id: programs.id })
      for (const day of source.days) {
        const [pd] = await tx.insert(programDays).values({ programId: program.id, name: day.name, position: day.position, notes: day.notes }).returning({ id: programDays.id })
        for (const exercise of day.exercises) {
          const [pe] = await tx.insert(programExercises).values({
            programDayId: pd.id, wgerExerciseId: exercise.wgerExerciseId, source: exercise.source,
            name: exercise.name, position: exercise.position, supersetGroup: exercise.supersetGroup,
            progression: exercise.progression,
          }).returning({ id: programExercises.id })
          if (exercise.sets.length > 0) {
            // Postgres returns batch-insert RETURNING rows in VALUES order —
            // the index zip below relies on it for override remapping.
            const newSets = await tx.insert(programSets).values(exercise.sets.map((s) => ({
              programExerciseId: pe.id, setNumber: s.setNumber, setType: s.setType, metricMode: s.metricMode,
              repMin: s.repMin, repMax: s.repMax, rir: s.rir, rpe: s.rpe, suggestedLoadKg: s.suggestedLoadKg,
              tempo: s.tempo, durationSec: s.durationSec, distanceM: s.distanceM, restSec: s.restSec,
              technique: s.technique,
            }))).returning({ id: programSets.id })
            const overrideRows = exercise.sets.flatMap((s, i) => s.overrides.map((o) => ({
              programSetId: newSets[i].id, week: o.week, repMin: o.repMin, repMax: o.repMax, rir: o.rir,
              rpe: o.rpe, suggestedLoadKg: o.suggestedLoadKg, tempo: o.tempo, durationSec: o.durationSec,
              distanceM: o.distanceM, restSec: o.restSec, technique: o.technique,
            })))
            if (overrideRows.length > 0) await tx.insert(programSetOverrides).values(overrideRows)
          }
          if (exercise.muscles.length > 0) {
            await tx.insert(programExerciseMuscles).values(exercise.muscles.map((m) => ({ programExerciseId: pe.id, muscle: m.muscle, role: m.role })))
          }
        }
      }
      return { id: program.id }
    })
  }
  ```
- **MIRROR**: TX_WRITE_FUNCTION (detail read outside tx, insert cascade inside).
- **IMPORTS**: `nextBlockName` from `@/lib/block-name`; ensure `programSetOverrides`, `programExerciseMuscles` are in the `./schema` import list (`programs`, `programDays`, `programExercises`, `programSets` already are).
- **GOTCHA 1**: `.returning()` on the batch sets insert returns rows in VALUES order on Postgres — the `newSets[i]` zip depends on it; keep the comment.
- **GOTCHA 2**: Copy `position`/`setNumber` from the SOURCE rows (already contiguous, relation-ordered), don't re-derive from `entries()` — copying the stored value is the fidelity-honest move.
- **GOTCHA 3**: Do NOT touch `loadExerciseCatalog` — no network in the clone path.
- **VALIDATE**: Task 2 green; `npx tsc --noEmit`.

### Task 4: `restartProgramAction`
- **ACTION**: Add to `src/app/programs/actions.ts`.
- **IMPLEMENT**:
  ```ts
  /**
   * Rolls a block over: clone the program (full fidelity, week-1 fresh) and
   * activate the clone — setProgramStatus's single-active sweep archives an
   * active source automatically; an already-archived source stays archived.
   * Clone commits BEFORE activation, so a failed activate leaves only a
   * harmless draft copy (retry-safe). Returns the NEW program id — the client
   * navigates; no redirect() (try/catch would mistake NEXT_REDIRECT for failure).
   */
  export async function restartProgramAction(id: unknown): Promise<{ id: string }> {
    const userId = await requireUserId()
    if (typeof id !== 'string' || id.length === 0) throw new Error('invalid program id')
    const clone = await cloneProgram(userId, id)
    if (!clone) throw new Error('program not found')
    const activated = await setProgramStatus(userId, clone.id, 'active')
    if (!activated) throw new Error('could not activate the new block')
    revalidatePath('/')            // home hero now points at the clone
    revalidatePath('/programs')
    revalidatePath(`/programs/${id}`)
    return { id: clone.id }
  }
  ```
- **MIRROR**: SERVER_ACTION (`startProgramDayAction`'s typeof-guard for the raw param).
- **IMPORTS**: add `cloneProgram` to the existing `@/db/programs` import.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 5: `ConfirmDialog` `confirmVariant` prop
- **ACTION**: Update `src/components/confirm-dialog.tsx`.
- **IMPLEMENT**: `confirmVariant?: 'destructive' | 'default'` in the props interface (JSDoc: affirmative confirms like Restart use 'default'; destructive stays the default), destructure with `confirmVariant = 'destructive'`, `variant={confirmVariant}` on the confirm Button. Adjust the "never wears volt" comment: the DESTRUCTIVE confirm never wears volt — an affirmative confirm may.
- **GOTCHA**: Default MUST stay `'destructive'` — existing call sites (program delete, program leave) rely on it unchanged.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 6: `RestartProgramButton` client island
- **ACTION**: Create `src/app/programs/[id]/restart-program-button.tsx`.
- **IMPLEMENT**: `'use client'`. Props: `{ id: string; size?: 'sm' | 'default'; className?: string }`. State: `isOpen`, `isPending`, `error`, `closeDialogRef`. Outline Button labeled `Restart block`; opens dialog after `setError(null)` (stale-failure rule). Handler mirrors CLIENT_CONFIRM_ISLAND verbatim:
  ```ts
  const { id: newId } = await restartProgramAction(id)
  closeDialogRef.current?.()
  setIsOpen(false)
  router.push(`/programs/${newId}`)
  // isPending stays true on success: navigation unmounts this screen.
  ```
  catch → `setIsPending(false)`; `setError('Could not restart this block. Please try again.')` (renders inside the dialog). Dialog: title `Start the next block?`, body `Creates a fresh copy of this program starting at week 1 and makes it active. This one is archived — its history and stats stay.`, confirmLabel `Restart block`, pendingLabel `Restarting…`, `confirmVariant="default"`.
- **MIRROR**: CLIENT_CONFIRM_ISLAND incl. the not-startTransition rationale comment.
- **IMPORTS**: `useRef`/`useState` (react), `useRouter` (next/navigation), `Button` (`@/components/ui/button`), `ConfirmDialog` (`@/components/confirm-dialog`), `restartProgramAction` (`@/app/programs/actions`), `cn` (`@/lib/utils`).
- **GOTCHA**: `router.push` (not refresh) — the destination is a DIFFERENT program's page. The island stays dumb about status; parents decide when to render it.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 7: Entry points
- **ACTION**: Update `program-actions.tsx` and `programs/[id]/page.tsx`.
- **IMPLEMENT**:
  - `ProgramActions`: render `<RestartProgramButton id={id} className="flex-1" />` in the action row when `status !== 'draft'`, between the status button and Delete. Comment: restart replaces the block (clone + archive), Leave merely archives — different questions, both stay.
  - Completion card (page.tsx): turn the card's Stats-link line into a `flex items-center justify-between gap-3` action row — Stats link left, `<RestartProgramButton id={program.id} size="sm" />` right. Comment: the action row Phase 2's layout reserved.
- **GOTCHA**: One-volt rule holds — the restart BUTTON is outline everywhere (volt stays with Start on the page; the dialog's affirmative confirm is the only volt inside the modal). The card is server-rendered; the button is the client boundary (fine as a child).
- **VALIDATE**: `npm run build`; manual dev-server pass.

### Task 8: Full validation
- **VALIDATE**: commands below; diff touches only listed files.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| nextBlockName plain | "Upper/Lower" | "Upper/Lower — Block 2" | |
| nextBlockName increments | "X — Block 2" | "X — Block 3" | |
| nextBlockName big k | "X — Block 99" | "X — Block 100" | ✓ |
| nextBlockName inner dash safe | "Push — Pull" | "Push — Pull — Block 2" | ✓ |
| nextBlockName clamps | 200-char name | ≤200 chars, ends with suffix | ✓ |
| clone program row | maximal fixture | draft, derived name, meso/deload/notes copied | |
| clone fidelity | superset+custom+technique+overrides+muscles fixture | every column on new rows, ids remapped | core |
| clone write order | fixture | program→day→exercise→sets→overrides→muscles | |
| clone ownership | findFirst → undefined | null, zero inserts | ✓ |
| clone offline | — | no catalog call | ✓ |

Server action + UI: no test files (repo convention — actions are exercised through the db layer; cards by build + manual).

### Edge Cases Checklist
- [x] Source archived (restart from archived page): sweep no-ops, clone activates, source stays archived
- [x] Source active: sweep archives it (existing tested invariant)
- [x] Activate fails after clone commits: draft clone remains, error surfaces in dialog (documented in action JSDoc)
- [x] Custom exercises (`source: 'custom'`) survive the clone
- [x] Exercise with zero override/muscle rows: no empty-array inserts
- [ ] Concurrent restarts: two clones possible (POC-accepted; last activate wins the sweep)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/lib/block-name.ts src/lib/block-name.test.ts src/db/programs.ts src/db/clone-program.test.ts src/app/programs/actions.ts src/components/confirm-dialog.tsx "src/app/programs/[id]"
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/lib/block-name.test.ts src/db/clone-program.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 945 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Restart an ACTIVE program: lands on "Name — Block 2", week 1, active; source archived with intact history/stats
- [ ] Restart from an ARCHIVED program page: same, source stays archived
- [ ] Clone's builder view structurally identical to the source (spot-check supersets, techniques, a week override via MCP `get_program`)
- [ ] Completion card shows the Restart button; draft programs show none
- [ ] Cancel path ("Keep it") leaves everything untouched

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] Clone is row-faithful: supersets, custom sources, progression, technique, per-week overrides, muscle tags
- [ ] Restart = clone + activate; the single-active invariant does the archiving
- [ ] Entry points: completion card, active actions, archived actions — never drafts
- [ ] `ConfirmDialog` default behavior unchanged for existing callers

## Completion Checklist
- [ ] No catalog/network read in the clone path
- [ ] closeRef-before-navigate on the success path (#25 discipline)
- [ ] One-volt rule intact on both surfaces
- [ ] Action JSDoc documents the clone-then-activate failure seam
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Clone infidelity (the upsert_program precedent) | M | Product trust | Row copy, not input round-trip; maximal-fixture tests assert every column incl. overrides/supersets |
| Batch `.returning()` order assumption for override remap | L | Wrong-week overrides | Postgres returns VALUES order; comment + two-sets-with-distinct-overrides fixture catches a swap |
| `updatedAt`-recency assumptions elsewhere pick the wrong program | L | Cosmetic | Clone is freshest AND only active — recency and invariant agree |
| Draft clone orphaned by a failed activate | L | Clutter | Documented; visible in Programs list, deletable; retry-safe |

## Notes
- Phase 4 (`MCP restart_program`) wraps `cloneProgram` + `setProgramStatus` behind a tool — keep both exported with stable signatures.
- The PRD's `cloneProgramInput(detail)` naming is superseded by the row-copy decision (see CRITICAL DESIGN DECISION); the fidelity goal is unchanged, the mechanism is stronger.
