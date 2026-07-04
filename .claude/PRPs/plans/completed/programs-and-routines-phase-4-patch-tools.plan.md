# Plan: Programs & Routines — Phase 4 (Granular Patch Tools)

## Summary
Iterative program editing without whole-doc rewrites: add/update/remove/move for **day**, **exercise**, and **set** (12 MCP tools), addressed by `programId` + 0-based positions + 1-based `setNumber` — the program twin of `patch-tools.ts`. Updates take **named scalar args** (omitted = unchanged, `null` = clear, exactly like `update_set`), `suggestedLoad` converts display↔kg, and the `technique`/`progression` JSONB is re-validated through the Phase-1 Zod schemas on every partial edit. New `src/db/program-patches.ts` keeps the ops out of the already-sizeable `programs.ts`.

## User Story
As a lifter's agent, I want to "swap day 2's incline press for flat bench, 4 sets" or "bump set 3's target to 8–10 @ 140" as one targeted call, so that unrelated days/exercises/sets are never regenerated (and never silently dropped by an LLM whole-doc rewrite — the exact lesson behind `patch-tools.ts`).

## Problem → Solution
Today the only edit is `upsert_program` full-replace: a one-set tweak forces the agent to resend the entire program, risking dropped detail. → Granular, position-addressed patch ops with ownership enforced through the `programs.user_id` join chain, contiguous renumbering on remove/move (the Phase-1 DEFERRABLE unique on `program_sets` was built for this), and merge-then-revalidate semantics on set updates.

## Metadata
- **Complexity**: XL (12 tools; highly repetitive — each mirrors an existing pattern)
- **Source PRD**: `.claude/PRPs/prds/programs-and-routines.prd.md`
- **PRD Phase**: Phase 4 — Granular patch tools
- **Estimated Files**: 4 new (`db/program-patches.ts` + test, `mcp/program-patch-tools.ts` + test) + 2 edited (`tools.ts`, `tools.test.ts`)
- **Branch**: create `feat/programs-phase-4-patch-tools` from `main` (phases 1–3 merged in PR #7)

---

## UX Design

Agent-facing. Editing granularity goes from "resend everything" to "name the one thing".

### Before
```
"make bench 4 sets" → agent must upsert_program with the ENTIRE program
  (regenerating 2 days × N exercises it isn't touching)
```
### After
```
add_program_set(programId, dayPosition:0, exercisePosition:0, ...targets)
update_program_exercise(programId, 1, 0, wgerExerciseId:X, name:"Flat Bench")
update_program_set(..., setNumber:3, repMin:8, repMax:10, suggestedLoad:140)
move_program_day(programId, from:2, to:0)   · remove_program_exercise(...)
→ only the addressed node changes; siblings untouched
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Program edits | `upsert_program` full replace only | + 12 granular tools (4 per level) | Full replace remains for wholesale rewrites |
| Addressing | n/a | `programId` + `dayPosition`(0-based) + `exercisePosition`(0-based) + `setNumber`(1-based) | Mirrors `update_set`'s workoutId+position+setNumber; `get_program` already returns positions |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/mcp/patch-tools.ts` | 1-215 | THE pattern: named scalar args (`undefined`=unchanged, `null`=clear), `toKgWeight` bounded in the agent's unit, empty-patch guard, not-found messages, plain-Error→ToolError re-throw |
| P0 | `src/db/workouts.ts` | 235-380 | `findOwnedExerciseId` (ownership-via-join finder), `updateSet`/`addSet`/`removeSet` (empty-patch null, max+1 append, delete + decrement-renumber) |
| P0 | `src/db/programs.ts` | all | The tree these ops edit; `insertProgramChildren` (set-row field mapping to reuse in add ops); `updatedAt` bumping convention |
| P0 | `src/lib/program-input.ts` | all | `programSetSchema` building blocks for merge-revalidation; `techniqueSchema`/`progressionSchema` for JSONB re-parse; `setTypeSchema`/`metricModeSchema` |
| P1 | `src/db/patch-sets.test.ts` | 1-120 | The chain-recording mock (selectQueue + table-named updateChain + toggle rows) to mirror for `program-patches.test.ts` |
| P1 | `src/lib/mcp/program-tools.ts` | all | `unitArg`, ToolError conventions, `assertProgramIdShape`, tool description style |
| P1 | `src/lib/mcp/program-tools.test.ts` / `patch-tools.test.ts` | all | Fake-server tool test pattern (impersonation, no-user gate, malformed id, db-leak) |
| P2 | `drizzle/0003_absurd_wasp.sql` | 18-40 | `program_sets` unique is DEFERRABLE INITIALLY DEFERRED — the remove/move renumber relies on it; `program_days`/`program_exercises` have NO position unique (renumber is unconstrained) |
| P2 | `src/lib/mcp/tools.ts` / `tools.test.ts` | all | Wiring + the exact tool list (21 → 33) |

## External Documentation
No external research needed — established internal patterns.

---

## Patterns to Mirror

### NAMED-SCALAR PATCH ARGS
```ts
// SOURCE: src/lib/mcp/patch-tools.ts:13-17, 70-81
const repsArg = z.number().int().min(0).max(10_000).nullable().optional()
const weightArg = z.number().nullable().optional()
// handler: if every patch field === undefined → ToolError('...needs at least one of ...')
// build patch: if (reps !== undefined) patch.reps = reps   // null passes through = clear
```

### DISPLAY→KG SINGLE VALUE
```ts
// SOURCE: src/lib/mcp/patch-tools.ts:24-35
function toKgWeight(weight: number | null | undefined, unit: WeightUnit) {
  if (weight === undefined || weight === null) return weight
  const kg = displayToKg(weight, unit)
  if (kg < 0 || kg > MAX_WEIGHT_KG) throw new ToolError(`... between 0 and ${kgToDisplay(MAX_WEIGHT_KG, unit)} ${unit}, or null`)
  return kg
}
// unit resolved LAZILY: only when a weight is actually being converted
```

### OWNERSHIP FINDER (join chain to the user root)
```ts
// SOURCE: src/db/workouts.ts:242-261
async function findOwnedExerciseId(tx, userId, workoutId, position) {
  const [we] = await tx.select({ id: workoutExercises.id }).from(workoutExercises)
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(and(eq(...workoutId), eq(...position), eq(workouts.userId, userId))).limit(1)
  return we?.id ?? null
}
// Program version chains one level deeper: program_exercises → program_days → programs.user_id
```

### APPEND / REMOVE+RENUMBER
```ts
// SOURCE: src/db/workouts.ts:304-351
// addSet: max(setNumber)+1 append. removeSet: delete returning → gone? null : decrement
await tx.update(sets).set({ setNumber: sql`${sets.setNumber} - 1` })
  .where(and(eq(sets.workoutExerciseId, exerciseId), gt(sets.setNumber, setNumber)))
// program_sets renumber is safe mid-transaction: unique is DEFERRABLE (checked at COMMIT)
```

### PLAIN-ERROR → TOOLERROR RE-THROW
```ts
// SOURCE: src/lib/mcp/patch-tools.ts:193-200
try { parsed = parseStartedAt(startedAt) }
catch (error: unknown) { throw new ToolError(error instanceof Error ? error.message : '...') }
// Phase-4 twin: db ops throw ProgramPatchError for merge-validation failures; tools convert
```

### CHAIN-RECORDING DB TEST
```ts
// SOURCE: src/db/patch-sets.test.ts:10-95
// selectQueue feeds finder reads in call order; updateChain records `update:<table>`
// via getTableName; toggle vars (ownedRows/updatedRows/deletedRows) drive the gates.
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/program-patches.ts` | CREATE | 12 user-scoped patch ops + ownership finders + `ProgramPatchError`. Separate file: `programs.ts` is ~450 lines; these ops add ~350 more (the 800 cap) and mirror how `patch-tools.ts` sits apart from `write-tools.ts` |
| `src/db/program-patches.test.ts` | CREATE | Chain-recording tests for the ops |
| `src/lib/mcp/program-patch-tools.ts` | CREATE | `registerProgramPatchTools` — the 12 tools |
| `src/lib/mcp/program-patch-tools.test.ts` | CREATE | Fake-server tool tests |
| `src/lib/mcp/tools.ts` | UPDATE | Wire `registerProgramPatchTools` |
| `src/lib/mcp/tools.test.ts` | UPDATE | Tool list 21 → 33 |

## NOT Building
- **Progression math / technique execution** — Phase 5. `progression`/`technique` are stored-and-revalidated JSONB here, nothing computes them.
- **Cross-day exercise moves** (`move_program_exercise` moves within its day) — a swap is remove+add; cross-day splice is speculative.
- **Bulk ops** ("update all working sets") — the agent loops the granular tool.
- **Web UI** — Phase 6.

---

## Design

### Addressing & ownership
All ops root at `programId` (owned via `programs.user_id`), then walk positions:
- `findOwnedDayId(tx, userId, programId, dayPosition)` → `program_days.id` (join `programs`, filter `user_id`)
- `findOwnedExerciseId(tx, userId, programId, dayPosition, exercisePosition)` → `program_exercises.id` (join `program_days` → `programs`)
Every op runs in one `db.transaction`, returns `null` for any not-owned/absent link (tool → not-found), and **bumps `programs.updatedAt`** (the list sort key) on success.

### The 12 ops (`program-patches.ts`)
| Level | add | update | remove | move |
|---|---|---|---|---|
| day | `addProgramDay(userId, programId, {name, notes?})` → append at `max(position)+1` | `updateProgramDay(..., dayPosition, {name?, notes?})` | `removeProgramDay(..., dayPosition)` → delete (cascade) + decrement higher positions | `moveProgramDay(..., from, to)` → splice-renumber |
| exercise | `addProgramExercise(..., dayPosition, {wgerExerciseId, name, progression?})` → append; seeds ONE default set (schema invariant: an exercise has ≥1 set) | `updateProgramExercise(..., exercisePosition, {wgerExerciseId?, name?, progression?})` — `progression: null` clears; re-parsed via `progressionSchema` when object | `removeProgramExercise(...)` + renumber | `moveProgramExercise(..., dayPosition, from, to)` |
| set | `addProgramSet(..., exercisePosition, patch)` → `max(setNumber)+1`, defaults `working`/`reps_weight` | `updateProgramSet(..., setNumber, patch)` — **merge-revalidate** (below) | `removeProgramSet(..., setNumber)` + decrement renumber (DEFERRABLE unique) — throws `ProgramPatchError` if it's the exercise's last set (≥1-set invariant) | `moveProgramSet(..., from, to)` → splice-renumber |

### Merge-revalidate (`updateProgramSet`)
```ts
export class ProgramPatchError extends Error {}  // tool layer converts to ToolError verbatim
// inside the transaction: read the current program_sets row →
const merged = { ...current, ...definedFields(patch) }   // null = clear (column null)
// cross-field integrity, same rules as programSetSchema's refines:
if (merged.metricMode !== 'reps_weight' && merged.durationSec == null)
  throw new ProgramPatchError('durationSec is required when metricMode is duration or duration_distance')
if (merged.repMin != null && merged.repMax != null && merged.repMin > merged.repMax)
  throw new ProgramPatchError('repMin must be less than or equal to repMax')
// technique (when a non-null object arrives): techniqueSchema.parse → ZodError → ProgramPatchError(first issue)
```
Set-field args mirror `programSetSchema` bounds (`repMin/repMax` 0..10000, `rir` 0..20, `rpe` 0..10, `tempo` ≤20, `distanceM` ≥0); `suggestedLoad` arrives in the display unit and converts via the `toKgWeight` twin (`suggestedLoadKg`).

### Move semantics (splice, contiguous)
`move(from, to)`: load the id at `from`; if `from === to` no-op success; shift the block between them by ±1 (`position > from AND position <= to` → −1, or the mirror), then set the moved row to `to`. Out-of-range `to` → null (not-found). Day/exercise positions have no unique constraint (plain updates fine); `program_sets.set_number` renumbering commits under the DEFERRABLE unique.

### Tool surface (`program-patch-tools.ts`)
12 tools, names exactly: `add_program_day`, `update_program_day`, `remove_program_day`, `move_program_day`, `add_program_exercise`, `update_program_exercise`, `remove_program_exercise`, `move_program_exercise`, `add_program_set`, `update_program_set`, `remove_program_set`, `move_program_set`.
Every handler: `resolveUserId` → `assertProgramIdShape(programId)` → empty-patch guard (update tools) → lazy unit resolve (only when `suggestedLoad` is a number) → op → `null` ⇒ `ToolError('<Thing> ... not found for user ...')` → echo `{ userId, programId, ...address, ...(basis && {unit: basis}) }`. `ProgramPatchError` re-thrown as `ToolError` (message verbatim). Shared zod args: `setType: setTypeSchema.optional()`, `metricMode: metricModeSchema.optional()`, `technique: techniqueSchema.nullable().optional()`, `progression: progressionSchema.nullable().optional()`, scalar `nullable().optional()` args for the rest.

---

## Step-by-Step Tasks

### Task 0: Branch
- **ACTION**: `git checkout -b feat/programs-phase-4-patch-tools main` (main already has phases 1–3).
- **VALIDATE**: `git branch --show-current`.

### Task 1: `src/db/program-patches.ts`
- **ACTION**: Create `ProgramPatchError`, the two ownership finders, and the 12 ops per the Design table.
- **MIRROR**: OWNERSHIP FINDER + APPEND/REMOVE+RENUMBER + `updateWorkoutMeta`'s empty-patch-null + `programs.ts`'s `updatedAt: new Date()` bump.
- **IMPORTS**: `and, asc, eq, gt, gte, lte, max, sql` from `drizzle-orm`; `db` from `./index`; `programs, programDays, programExercises, programSets` from `./schema`; `techniqueSchema, progressionSchema, type Technique, type Progression` from `@/lib/program-input`; `z` for ZodError narrowing.
- **GOTCHA**: (1) Ops return `null` for not-found but THROW `ProgramPatchError` for validation — two distinct channels. (2) `removeProgramSet` on the last set throws `ProgramPatchError('an exercise needs at least one set — remove the exercise instead')`. (3) `addProgramExercise` seeds one default set so the ≥1-set invariant holds. (4) Bump `updatedAt` inside the same transaction, gated on the op succeeding. (5) The set-row insert mapping must match `insertProgramChildren`'s field list exactly.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 2: `src/db/program-patches.test.ts`
- **ACTION**: Chain-recording tests (mirror `patch-sets.test.ts`): selectQueue feeds finder + current-row + max reads; `update:<table>` records assert renumbers hit the right table.
- **IMPLEMENT** (representative, not exhaustive — the ops are symmetric): per level, one happy-path (records the right write + updatedAt bump), one not-owned (empty selectQueue ⇒ null, zero writes). Plus the special cases: `updateProgramSet` merge-revalidation (metricMode→duration without durationSec throws `ProgramPatchError`; repMin>repMax throws; technique re-parse rejects bad kind), `removeProgramSet` last-set guard, `removeProgramSet` renumber decrement targets `program_sets`, `moveProgramDay` splice writes, `addProgramSet` appends at max+1, `addProgramExercise` seeds a default set.
- **MIRROR**: CHAIN-RECORDING DB TEST.
- **GOTCHA**: selectQueue order must match each op's internal read order — document the expected order in a comment per test.
- **VALIDATE**: `npx vitest run src/db/program-patches.test.ts`.

### Task 3: `src/lib/mcp/program-patch-tools.ts`
- **ACTION**: `registerProgramPatchTools(server)` with the 12 tools per the Design.
- **MIRROR**: NAMED-SCALAR PATCH ARGS + DISPLAY→KG SINGLE VALUE + PLAIN-ERROR→TOOLERROR (for `ProgramPatchError`).
- **IMPORTS**: the op set from `@/db/program-patches`; `ProgramPatchError`; `resolveUserId`/`jsonResult`/`errorResult`/`ToolError`/`assertProgramIdShape`; `getWeightUnit`; `displayToKg, kgToDisplay, WeightUnit`; `MAX_WEIGHT as MAX_WEIGHT_KG`; `setTypeSchema, metricModeSchema, techniqueSchema, progressionSchema` from `@/lib/program-input`.
- **GOTCHA**: (1) Update tools: reject an all-undefined patch BEFORE resolving the unit (`update_program_set needs at least one field`). (2) Unit resolved lazily — only when `suggestedLoad` is a real number. (3) Echo `unit` only when resolved (mirror `update_set`'s `...(basis ? { unit: basis } : {})`). (4) Tool descriptions state the omitted/null semantics and the display-unit basis. (5) `technique`/`progression` documented as kg (Phase-2 policy).
- **VALIDATE**: `npx tsc --noEmit`.

### Task 4: wire `tools.ts`
- **ACTION**: `registerProgramPatchTools(server)` after `registerProgramTools(server)`; extend the doc comment.
- **VALIDATE**: `npx tsc --noEmit`.

### Task 5: `tools.test.ts` — 21 → 33
- **ACTION**: Add the 12 names (alphabetical) to the exact-list assertion.
- **VALIDATE**: `npx vitest run src/lib/mcp/tools.test.ts`.

### Task 6: `src/lib/mcp/program-patch-tools.test.ts`
- **ACTION**: Fake-server tests (mirror `patch-tools.test.ts`/`program-tools.test.ts`), mocking `@/db/program-patches` + `@/db/preferences`.
- **IMPLEMENT**: registers exactly the 12 (sorted); per level one happy-path (op called with converted kg where applicable; echo shape); `update_program_set` empty-patch → ToolError without unit fetch; `suggestedLoad` over-max → lb-bound message, op untouched; explicit `unit:'kg'` skips `getWeightUnit`; `ProgramPatchError` from the op surfaces verbatim (mock rejects with it); malformed `programId` → not-found, op untouched; `it.each` no-user gate across all 12; one db-leak genericization case.
- **VALIDATE**: `npx vitest run src/lib/mcp/program-patch-tools.test.ts`.

### Task 7: full validation + dogfood
- **ACTION**: Run the Validation Commands; optionally dogfood locally (dev server + curl, as in Phase 3): author a program, `update_program_exercise` to swap an exercise, `update_program_set` to change a target, `move_program_day`, verify with `get_program` that siblings are untouched.

---

## Testing Strategy

### Unit Tests (key rows; symmetric ops share shapes)
| Test | Input | Expected | Edge? |
|---|---|---|---|
| updateProgramSet merges + revalidates | patch `{repMin:8}` on row `{repMax:12}` | update issued | no |
| metricMode→duration w/o durationSec | patch `{metricMode:'duration'}` on reps row | `ProgramPatchError` /durationSec/, no write | yes |
| repMin>repMax after merge | `{repMin:15}` on `{repMax:12}` | `ProgramPatchError`, no write | yes |
| technique re-parse on partial edit | bad `kind` | throws, no write | yes |
| remove last set | exercise w/ 1 set | `ProgramPatchError` /at least one set/ | yes |
| removeProgramSet renumber | set 2 of 4 | delete + `update:program_sets` decrement | no |
| move day splice | from 2 → 0 | shift block +1, moved row → 0, updatedAt bump | no |
| not-owned (each level) | finder returns [] | null, zero writes | yes |
| add exercise seeds default set | — | exercise insert + one set insert | no |
| tool: empty patch | all undefined | ToolError, no unit fetch, no op | yes |
| tool: over-max suggestedLoad | > ceiling lb | lb-bound message, no op | yes |
| tool: no-user gate ×12 | no env/arg | /userId/, op untouched | yes |
| tools list | — | 33 exact | no |

### Edge Cases Checklist
- [x] Empty input (empty patches rejected; blank name rejected via zod `min(1)` on add/update day/exercise)
- [x] Maximum size input (load ceiling in agent unit; rep/rir/rpe bounds)
- [x] Invalid types (bad enums via zod; bad technique kind via re-parse)
- [x] Concurrent access (set renumber under the DEFERRABLE unique — the constraint Phase 1 shipped for exactly this)
- [x] Network failure (db-leak genericization case)
- [x] Permission denied (not-owned null at every level + no-user gate ×12)

---

## Validation Commands

```bash
npx tsc --noEmit                                        # EXPECT: clean
npx vitest run src/db src/lib/mcp                       # EXPECT: all pass
npx vitest run --exclude '**/.claude/worktrees/**'      # EXPECT: no regressions (stray worktree excluded)
npx eslint src                                          # EXPECT: clean
npm run build                                           # EXPECT: succeeds
```
No migration — Phase 4 touches no schema (the DEFERRABLE unique already exists).

### Manual Validation (dogfood, optional)
- [ ] Author a 2-day program → `update_program_exercise` day 1 exercise 0 (swap id+name) → `get_program` shows ONLY that slot changed → `update_program_set` a target → `move_program_day` → `remove_program_set` (renumber verified) → cleanup `delete_program`.

---

## Acceptance Criteria
- [ ] 12 tools registered (list = 33); all validation commands pass.
- [ ] "Swap day 2's incline for flat, 4 sets" = 2 calls (`update_program_exercise` + `add_program_set`), siblings byte-identical.
- [ ] Omitted-vs-null semantics honored on every update tool; merged rows always satisfy the Phase-1 cross-field rules; JSONB re-validated on partial edits.
- [ ] Ownership enforced at every level (join chain to `programs.user_id`); positions stay 0-based contiguous, setNumbers 1-based contiguous.
- [ ] `programs.updatedAt` bumps on every successful patch.

## Completion Checklist
- [ ] Ops mirror `updateSet`/`addSet`/`removeSet` shapes; tools mirror `patch-tools.ts` handler shape.
- [ ] `ProgramPatchError` (validation) vs `null` (not-found) — two channels, both surfaced as clean ToolErrors.
- [ ] Lazy unit resolution; conversion only on `suggestedLoad`.
- [ ] No schema changes; no drive-by edits to phases 1–3 code beyond the two wiring lines.
- [ ] Self-contained — no codebase searching needed.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 12-tool surface bloats context for connecting agents | M | M | Terse, convention-consistent descriptions; names are self-describing |
| Move splice off-by-one | M | M | Dedicated splice tests (from<to and from>to both) |
| selectQueue test brittleness (read-order coupling) | M | L | Comment the expected read order per op; keep finders' read order stable |
| Merge-revalidate drifts from `programSetSchema` refines | L | M | Same two rules, stated verbatim; a comment in both files cross-references them |
| PR size (~1.4k lines) | H | L | Commit in two: (1) db ops + tests, (2) tools + wiring + tests |

## Notes
- Position-based addressing (not raw child ids) is deliberate: it matches `update_set`, survives agents that only read `get_program` summaries, and keeps ids out of the tool contract.
- `upsert_program` stays the right tool for create/wholesale-rewrite; these are for the edit loop.
- Phase 6 (UI) remains parallel-safe: it consumes `db/programs.ts` + `db/program-patches.ts`, not the MCP layer.
