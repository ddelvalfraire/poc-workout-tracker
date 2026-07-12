# Plan: Program Stats — PRs + MCP Tool (Phases 3 & 4)

## Summary
Finish the program-stats PRD. Phase 3: per-exercise Program PRs (first-week baseline → best e1RM within the block) with loggingType-aware scoring via `bestScoredSet` — fixing the known BW-type e1RM caveat — and high-rep "Est." flagging per `MAX_RELIABLE_REPS`. Phase 4: an MCP `get_program_stats` read tool exposing the same aggregate, unit-converted at the boundary, so Claude answers "how's my program going?" with the numbers the stats page shows.

## User Story
As a lifter finishing a block, I want each lift's baseline vs. best (and honest numbers for bodyweight movements), on the stats page and via Claude, so I can tell whether the block worked without manual comparison.

## Problem → Solution
Progression scores raw `weight` via `bestSet` (wrong for BW types) and nothing summarizes "did the block work" → score via `bestScoredSet` with per-exercise loggingType + stored bodyweight, derive baseline/best PRs in the data layer, render a PRs section, and mirror it all through one MCP read tool.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/program-stats.prd.md`
- **PRD Phase**: Phase 3 — Program PRs, Phase 4 — MCP `get_program_stats` (PRD marks them parallel; one plan, sequential tasks)
- **Estimated Files**: 7 (3 db, 2 UI, 2 MCP — all existing files + their tests)

---

## UX Design

### Before
```
Stats page progression: "Wk 1  8 × 100 kg  ~113 kg" — but a pull-up week
scores its raw added weight (or shows sets-only), silently wrong.
No block verdict anywhere. Claude has no program-stats read.
```

### After
```
┌──────────────────────────────────┐
│ PRS                              │  new section, above Progression
│ Bench Press      ~113 → ~130 kg  │  baseline wk1 → best wk4
│                  +17 kg          │  volt-tinted delta when > 0
│ Pull-up          ~95 kg · wk 2   │  single-scored-week → baseline only
│ Leg Press        —  est. from 15 │  >12-rep winner flagged "est. from N reps"
│                                  │
│ PROGRESSION (per-week, as today) │
│ Pull-up  Wk1  BW × 8   ~95 kg    │  BW types: reps line + e1RM (no fake load)
│          Wk2  12 reps            │  rep-fallback (no bodyweight stored)
└──────────────────────────────────┘
MCP: get_program_stats(programId) → same numbers, user's unit.
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Stats page | Adherence/Volume/Progression | + PRs section; progression lines honest for BW types | No new navigation |
| MCP | No program-stats read | `get_program_stats` tool | Open question resolved YES (user approved 2026-07-11) |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/program-stats.ts` | all | The module being extended: row shape, `aggregateExercises`, kg-domain rules |
| P0 | `src/lib/one-rep-max.ts` | 49–120 | `effectiveLoadKg`, `ScoredBestSet`, `bestScoredSet` — the scoring to adopt; `MAX_RELIABLE_REPS` |
| P0 | `src/lib/mcp/read-tools.ts` | all | Tool registration/error/unit-conversion pattern; `scoreExercise` precedent |
| P1 | `src/db/program-stats.test.ts` | 60–120 | `row()` fixture + aggregate test style to extend |
| P1 | `src/lib/mcp/read-tools.test.ts` | 1–90 | fakeServer/setup/payload harness; "registers exactly the five read tools" count test (→ six) |
| P1 | `src/app/programs/[id]/stats/page.tsx` | all | Progression section to adapt; PRs section's container conventions |
| P2 | `src/app/workout/[id]/page.tsx` | 218–238 | e1rm vs reps-fallback display convention (the two `ScoredBestSet` kinds) |
| P2 | `src/lib/mcp/program-id.ts` | all | `assertProgramIdShape` guard for the tool |

## External Documentation
None needed — established internal patterns only.

---

## Patterns to Mirror

### SCORED_BEST_SET (the scoring to adopt)
```ts
// SOURCE: src/lib/mcp/read-tools.ts:259-270
function scoreExercise(sets, loggingType, bodyweightKg, unit) {
  const best = bestScoredSet(sets, loggingType, bodyweightKg)
  if (best === null) return { estimated1RM: null }
  return best.kind === 'e1rm'
    ? { estimated1RM: kgToDisplay(best.e1rm, unit) }
    : { estimated1RM: null, bestReps: best.reps }
}
```

### LATEST_DENORMALIZED_WINS (loggingType joins name's rule)
```ts
// SOURCE: src/db/program-stats.ts:190-191
// Latest non-null denormalized name wins (renames mid-block converge).
if (row.exerciseName !== null) acc.name = row.exerciseName
```

### MCP_READ_TOOL (registration + error + unit echo)
```ts
// SOURCE: src/lib/mcp/read-tools.ts:119-157 (get_last_performance)
server.registerTool('get_last_performance', { title, description, inputSchema: {
  wgerExerciseId: z.number().int(), userId: z.string().optional(), ... } },
  async ({ ... }, extra) => {
    try {
      const resolved = resolveUserId(extra, userId)
      const [last, unit] = await Promise.all([...])
      return jsonResult({ userId: resolved, unit, ... })
    } catch (error: unknown) { return errorResult(error) }
  })
```

### MCP_NOT_FOUND (null from db → ToolError)
```ts
// SOURCE: src/lib/mcp/read-tools.ts:74-76
if (!workout) {
  return errorResult(new ToolError(`Workout ${id} not found for user ${resolved}`))
}
```

### MCP_ID_GUARD
```ts
// SOURCE: src/lib/mcp/program-tools.ts:511-512
assertProgramDayIdShape(programDayId)   // → use assertProgramIdShape from './program-id'
```

### E1RM_VS_REPS_DISPLAY (the two ScoredBestSet kinds)
```tsx
// SOURCE: src/app/workout/[id]/page.tsx:223-236
{current.kind === "e1rm" ? (
  <span className="font-display ... tnum"><span aria-hidden="true" ...>~</span>{formatE1RM(current.e1rm, unit)}</span>
) : (
  // Rep fallback: no load to estimate from, but the best effort still
  // deserves its readout — not a blank card.
  <span className="...">{current.reps} reps</span>
)}
```

### SECTION_LABEL (stats page)
```tsx
// SOURCE: src/app/programs/[id]/stats/page.tsx:91-93
<h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
```

### TEST_ROW_FIXTURE
```ts
// SOURCE: src/db/program-stats.test.ts:67-82
function row(over: Partial<ProgramStatsRow> = {}): ProgramStatsRow {
  return { workoutId: 'w1', programDayId: 'd1', programWeek: 1, completedAt: null,
    wgerExerciseId: null, source: over.wgerExerciseId != null ? 'wger' : null,
    exerciseName: null, reps: null, weight: null, completed: null, metricMode: null, ...over }
}
```

### MCP_TEST_HARNESS
```ts
// SOURCE: src/lib/mcp/read-tools.test.ts:36-57
function fakeServer() { /* records registerTool(name, _config, handler) */ }
function setup(): Map<string, ToolHandler> { registerReadTools(server); return tools }
function payload(result: ToolResult) { return JSON.parse(result.content[0]!.text) }
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/program-stats.ts` | UPDATE | Row gains `loggingType`; `bestScoredSet` scoring (needs `bodyweightKg` param on aggregate; fetched in `getProgramStats`); per-exercise `pr` derivation; `loggingType` on `ProgramExerciseProgression` |
| `src/db/program-stats.test.ts` | UPDATE | TDD: BW-type scoring, rep-fallback, PR baseline/best/single-week/null cases |
| `src/app/programs/[id]/stats/page.tsx` | UPDATE | PRs section; progression rows adapt to `ScoredBestSet` kinds |
| `src/app/programs/[id]/stats/stats-view.ts` | UPDATE | Pure helpers for testability: PR delta, high-rep flag |
| `src/app/programs/[id]/stats/stats-view.test.ts` | UPDATE | Tests for the new helpers |
| `src/lib/mcp/read-tools.ts` | UPDATE | `get_program_stats` tool (PRD: "per read-tools.ts patterns") |
| `src/lib/mcp/read-tools.test.ts` | UPDATE | Registration count 5→6; happy-path/not-found/malformed-id/unit tests |
| `.claude/PRPs/prds/program-stats.prd.md` | UPDATE | Phases 3–4 statuses (in-progress now; complete at report time) |

## NOT Building

- No schema/migration changes — `workout_exercises.logging_type` already exists (`schema.ts:59`)
- No changes to the workout-summary PR surface or `bestSet` itself (stays for the progression engine, per its own doc comment)
- No per-week bodyweight history — scoring uses the CURRENT stored bodyweight for all weeks (same trade-off as the workout summary; document in code)
- No charting; no new pages; no stats-page week selector
- No `nextProgramWeek`/adherence/volume changes — Phase 3 touches only exercise scoring + PRs

---

## Step-by-Step Tasks

### Task 1: Failing data-layer tests (RED)
- **ACTION**: Extend `src/db/program-stats.test.ts` BEFORE touching the module.
- **IMPLEMENT**: `row()` fixture gains `loggingType: null` default (spreadable override). New cases:
  1. BW exercise (`loggingType: 'bodyweight_reps'`, weight null, reps 8, bodyweightKg 80) → week point `best.kind === 'e1rm'` with `e1rm = 80 * (1 + 8/30)`.
  2. Same rows, `bodyweightKg: null` → `best.kind === 'reps'` (rep fallback, no fake load).
  3. `weighted_bodyweight` with weight 25, bodyweight 80 → effective 105 drives e1rm.
  4. PRs: exercise with e1rm points in weeks 1 (~113) and 3 (~130) → `pr = { baseline: { week: 1, e1rm≈113, reps }, best: { week: 3, e1rm≈130, reps } }`.
  5. Single e1rm week → baseline === best (same week).
  6. Only rep-fallback points → `pr: null`.
  7. Best-tie across weeks → earliest week wins (strictly-greater policy, mirrors `bestSet`).
  8. `aggregateProgramStats(..., bodyweightKg)` new trailing param — existing calls in the file pass `null` (weight_reps cases unaffected: effectiveLoadKg returns raw weight).
- **MIRROR**: TEST_ROW_FIXTURE; AAA style of the existing describe blocks.
- **VALIDATE**: `npm test -- src/db/program-stats.test.ts` → new cases fail (RED), signature errors expected.

### Task 2: Data layer (GREEN)
- **ACTION**: Update `src/db/program-stats.ts`.
- **IMPLEMENT**:
  - `ProgramStatsRow` += `loggingType: string | null`; select `workoutExercises.loggingType` in the flat query.
  - `aggregateProgramStats(program, plannedDays, currentWeek, rows, bodyweightKg: number | null)`; thread to `aggregateExercises(valid, bodyweightKg)`.
  - `ExerciseAcc` += `loggingType: LoggingType` (default `'weight_reps'`, LATEST_DENORMALIZED_WINS rule like `name`).
  - Week points: replace `bestSet(completedRows)` with `bestScoredSet(completedRows, acc.loggingType, bodyweightKg)` → `ExerciseWeekPoint.best: ScoredBestSet | null` (re-export `ScoredBestSet`; drop the `BestSet` re-export if nothing else imports it from here — the stats page will stop).
  - `ProgramExerciseProgression` += `loggingType: LoggingType` and `pr: ProgramExercisePR | null` where `ProgramExercisePR = { baseline: PRPoint; best: PRPoint }`, `PRPoint = { week: number; reps: number; e1rm: number }` (kg). Derivation over the built week points: baseline = first `kind === 'e1rm'` point; best = max e1rm (strictly-greater → earliest week keeps ties); null when no e1rm point.
  - `getProgramStats`: add `getBodyweightKg(userId)` (import from `./preferences`) to the existing `Promise.all`; pass through. JSDoc: current bodyweight scores ALL weeks (accepted drift, same as workout summary).
- **MIRROR**: SCORED_BEST_SET, LATEST_DENORMALIZED_WINS.
- **GOTCHA**: `ScoredBestSet.weightKg` (e1rm kind) is the EFFECTIVE load, not the stored column — never feed it back through `formatSet` for BW types (display rule in Task 4). Fresh structures only — no mutation.
- **VALIDATE**: `npm test -- src/db/program-stats.test.ts` green; `npx tsc --noEmit` will now fail in `stats/page.tsx` — expected until Task 4.

### Task 3: Failing view-helper tests (RED)
- **ACTION**: Extend `src/app/programs/[id]/stats/stats-view.test.ts`.
- **IMPLEMENT**: `prDeltaKg(pr)` → `best.e1rm - baseline.e1rm` (0 when same week); `isHighRepEstimate(point)` → true when winning e1rm reps > `MAX_RELIABLE_REPS` (import the constant, no magic 12). Cases: positive delta, zero (single week), high-rep true/false at the 12/13 boundary.
- **VALIDATE**: helper tests fail (RED).

### Task 4: Stats page — PRs section + honest progression (GREEN for UI)
- **ACTION**: Update `stats-view.ts` (helpers) then `stats/page.tsx`.
- **IMPLEMENT**:
  - PRs section between Volume and Progression, `aria-label="PRs"`, SECTION_LABEL heading "PRs". One row per exercise with `pr !== null`: name left; right block `~{formatE1RM(baseline.e1rm)} → ~{formatE1RM(best.e1rm)}` + `+{formatE1RM(delta)}` on a second muted line when delta > 0 (`text-primary` for the delta — the page's one accent moment); single-week (`baseline.week === best.week`) renders `~{e1rm} · wk {week}` only. High-rep winner (either endpoint `isHighRepEstimate`) appends muted `est. from {reps} reps`. No section at all when every `pr` is null (PRD: no empty tables).
  - Progression rows adapt to kinds: `best.kind === 'e1rm'` → for `loggingType === 'weight_reps'` keep `formatSet(best.reps, best.weightKg, unit)`; for BW types render `{best.reps} reps` (effective load must not masquerade as a barbell line) — both followed by the existing `~e1rm` span. `best.kind === 'reps'` → `{best.reps} reps` (no `~`). `best === null` → `{completedSets} set(s)` as today.
- **MIRROR**: E1RM_VS_REPS_DISPLAY, SECTION_LABEL; tnum everywhere.
- **IMPORTS**: `MAX_RELIABLE_REPS` only inside `stats-view.ts`; page imports the helpers.
- **VALIDATE**: helper tests green; `npx tsc --noEmit` clean; `npm run build`.

### Task 5: Failing MCP tests (RED)
- **ACTION**: Extend `src/lib/mcp/read-tools.test.ts`.
- **IMPLEMENT**: mock module `@/db/program-stats` (`getProgramStats: vi.fn()`); update "registers exactly the five read tools" → six incl. `get_program_stats`. Cases: (1) happy path — fixture `ProgramStats` with tonnage/e1rm/PR values; assert payload echoes `userId` + `unit` and converts tonnage, e1rm, and PR endpoints via `kgToDisplay` (lb user), reps/weeks verbatim; (2) null from db → isError `/not found/`; (3) malformed programId → isError without calling the mock.
- **MIRROR**: MCP_TEST_HARNESS.
- **GOTCHA**: unit basis follows `get_workout`'s contract (stored unit only, no `unit` arg) — keep it consistent with the other read tools.
- **VALIDATE**: RED.

### Task 6: MCP `get_program_stats` (GREEN)
- **ACTION**: Add the tool to `src/lib/mcp/read-tools.ts`.
- **IMPLEMENT**: `inputSchema: { programId: z.string(), userId: z.string().optional() }`. Handler: `resolveUserId` → `assertProgramIdShape(programId)` (import from `./program-id`) → `getProgramStats(resolved, programId)`; null → MCP_NOT_FOUND (`Program ${programId} not found for user ${resolved}`); else `getWeightUnit` and build payload: program meta verbatim; `currentWeek`; weeks with `tonnage: kgToDisplay(tonnageKg, unit)` (rename key — a kg suffix would lie for lb users); exercises with `loggingType`, week points (`e1rm` converted, reps verbatim, kind preserved), `pr` endpoints converted. Echo `userId` + `unit`. Description tells the agent what it is: "Per-week adherence, volume, and per-exercise progression/PRs for one program — the same numbers the app's stats page shows."
- **MIRROR**: MCP_READ_TOOL, MCP_NOT_FOUND, MCP_ID_GUARD.
- **GOTCHA**: registry doc comment says "Phase 2 read tools" and the count — update the wording. Do NOT convert `reps`/`week` values; only weights.
- **VALIDATE**: `npm test -- src/lib/mcp/read-tools.test.ts` green.

### Task 7: Full validation
- **VALIDATE**: commands below; `git diff --stat` touches only the listed files.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| BW scoring uses bodyweight | bodyweight_reps, bw 80, 8 reps | e1rm kind, 80×(1+8/30) | |
| BW without bodyweight | same, bw null | reps kind (fallback) | ✓ |
| weighted BW effective load | +25 on bw 80 | e1rm from 105 | |
| weight_reps unchanged w/ bw present | 8×100, bw 80 | e1rm from 100 | ✓ regression |
| PR baseline vs best | e1rm wks 1,3 | baseline wk1, best wk3 | |
| PR single week | one e1rm point | baseline === best | ✓ |
| PR none | rep-fallback only | pr null | ✓ |
| PR tie | equal e1rm wks 2,4 | best = wk2 | ✓ |
| delta helper | baseline 113 / best 130 | 17 | |
| high-rep flag boundary | reps 12 / 13 | false / true | ✓ |
| MCP registration | — | exactly six tools | |
| MCP conversion | lb user | tonnage/e1rm×2.2046, reps verbatim | |
| MCP not-found / bad id | — | isError, no db hit on bad id | ✓ |

### Edge Cases Checklist
- [x] Bodyweight missing (rep fallback, pr null)
- [x] Mixed loggingTypes across the block (latest wins, like name)
- [x] Exercise with zero e1rm-scorable weeks (PRs section omits; no empty table)
- [x] lb display conversion at both surfaces
- [ ] Concurrent access — N/A read-only

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/db/program-stats.ts "src/app/programs/[id]/stats" src/lib/mcp/read-tools.ts
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/db/program-stats.test.ts src/lib/mcp/read-tools.test.ts "src/app/programs/[id]/stats/stats-view.test.ts"
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 895 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean; `/programs/[id]/stats` still listed

### Manual Validation
- [ ] Live block stats page: PRs section shows Bench et al. baseline→best; progression unchanged for barbell lifts
- [ ] Ask Claude (MCP): "how's my program going?" → `get_program_stats` returns the page's numbers in the preferred unit
- [ ] A BW exercise (if present) shows reps-based lines, not a fake load

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected (RED before each GREEN)
- [ ] All validation commands pass
- [ ] BW-type progression no longer scores raw `weight`
- [ ] PRs render only where scorable; no empty sections/dashes
- [ ] MCP tool returns unit-converted parity with the page
- [ ] PRD Phases 3 & 4 marked complete at report time

## Completion Checklist
- [ ] kg only converts at display/MCP boundary (`kgToDisplay` / format helpers)
- [ ] No mutation in aggregates (fresh structures, like the existing module)
- [ ] `MAX_RELIABLE_REPS` referenced, never a literal 12
- [ ] Doc comments updated (read-tools registry wording, program-stats module doc)
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `ExerciseWeekPoint.best` type change ripples into the stats page | Certain | Compile-time only | Task 4 adapts the page in the same pass; tsc gates it |
| Current-bodyweight-scores-history drift (weight changed mid-block) | M | Slightly off BW e1rms | Accepted, matches workout-summary precedent; documented in JSDoc |
| PR delta misread as a load PR (it's an e1RM-estimate delta) | L | Trust | `~` prefix on every figure + "est. from N reps" flag |
| read-tools registration-count test forgotten | L | CI failure | Task 5 updates it first (RED includes the count) |

## Notes
- PRD open question on MCP exposure resolved YES (user approved 2026-07-11 in-session).
- `bestSet` is NOT deleted — the progression engine legitimately uses it (weight_reps by definition); only program-stats migrates to `bestScoredSet`.
- The MCP payload renames `tonnageKg` → `tonnage` because values are unit-converted; the web page keeps kg-domain names since it converts at format time.
- Branch note: base this work on `fix/start-any-week` (the current stack tip) or on `main` after the stack merges — the stats page files it edits live in PR #42's branch.
