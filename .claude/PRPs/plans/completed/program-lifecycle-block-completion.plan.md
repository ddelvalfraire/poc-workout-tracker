# Plan: Program Lifecycle — Block Completion State (Phase 2)

## Summary
Make the app know and say a block is done instead of silently re-offering the final week forever. Completion is derived from the week math the app already trusts (`nextProgramWeek`'s advancement rule firing at the last week), surfaced as a full completion card with top PR deltas on the program page and a compact "Block complete — see results" hero variant on home. Start buttons stay — a finished block can still re-run its final week.

## User Story
As a lifter finishing week 7, I want the app to declare the block complete and show what I gained, so the end of a mesocycle is a payoff moment instead of a silent loop.

## Problem → Solution
`nextProgramWeek` clamps at `mesocycleWeeks` — finishing the last week just re-offers it; the hero says "Start Upper · Week 7" forever → expose `blockComplete` from the same reads, render the completion card (program page, with PR deltas from `getProgramStats`) and the compact hero banner (home).

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/program-lifecycle.prd.md`
- **PRD Phase**: Phase 2 — Block completion state
- **Estimated Files**: 7 (all existing files + their tests)

---

## UX Design

### Before
```
Week 7, all days done →
Home hero: "Up next · Week 7 — Upper [Start Upper]"   (forever)
Program page: week pills + day cards, nothing changes
```

### After
```
Home hero (compact banner variant, replaces Start CTA):
┌──────────────────────────────────┐
│ BLOCK COMPLETE                   │  caps label, volt
│ Upper/Lower + PPL Hybrid         │  poster type (existing h2 style)
│ 7 weeks · See results →          │  links to /programs/[id]/stats
└──────────────────────────────────┘

Program page (full card above the day list):
┌──────────────────────────────────┐
│ BLOCK COMPLETE · 7 WEEKS         │
│ Bench Press    ~113 → ~130 kg    │  top PR deltas (max 3, gains only)
│ Squat          ~140 → ~152 kg    │
│ Stats →                          │  full breakdown link
└──────────────────────────────────┘
Day cards below unchanged (final-week re-run stays possible).
Restart button lands in this card in Phase 3.
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home hero at completion | "Start [day]" forever | Compact completion banner → stats | Resolves the PRD's open question: compact on home, full on program page |
| Program page at completion | Nothing | Completion card above day list | PR data fetched ONLY when complete |
| `nextProgramWeek` callers | number | unchanged (thin wrapper) | New `programWeekState` carries the flag |
| Incomplete blocks | — | Zero visual change | Both cards render nothing |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/programs.ts` | 294–331 | `nextProgramWeek` — the function to refactor into `programWeekState`; its reads/order must not change (mocked-select tests depend on it) |
| P0 | `src/db/instantiate-program.test.ts` | 434–500 | The `nextProgramWeek` describe + selectQueue harness — new blockComplete tests live here; select order is load-bearing |
| P0 | `src/app/programs/[id]/page.tsx` | 25–50, 105–145, 210–230 | Page skeleton, existing reads, where the card slots (above the day list heading) |
| P1 | `src/db/programs.ts` | 380–461 | `getNextProgramDay` — swaps to `programWeekState`, `NextProgramDay` gains the flag |
| P1 | `src/app/next-workout-card.tsx` | all | The hero card gaining the completion variant |
| P1 | `src/app/programs/[id]/stats/stats-view.ts` | all | Tested pure-helper module — `topPRs` joins `prDeltaKg`/`isHighRepEstimate` |
| P1 | `src/db/program-stats.ts` | 46–81 | `ProgramExerciseProgression.pr` shape the card consumes |
| P2 | `src/app/programs/[id]/stats/page.tsx` | 86–150 | PR display conventions: `~` prefix, `formatE1RM`, section-label caps style |
| P2 | `src/app/page.tsx` | 25–55, 100–110 | `showNextDay` gating — the completion banner must respect the same activeSession suppression |

## External Documentation
None needed — established internal patterns only.

---

## Patterns to Mirror

### WEEK_MATH (the reads to preserve, refactored not rewritten)
```ts
// SOURCE: src/db/programs.ts:299-331
const [agg] = await db.select({ current: max(workouts.programWeek) })...
if (current === null) return 1
const [[dayTotal], [daysDone]] = await Promise.all([...])   // planned days, COMPLETED days at `current`
const cycleComplete = daysDone.value >= dayTotal.value
return cycleComplete ? Math.min(current + 1, Math.max(1, mesocycleWeeks)) : current
```

### SELECT_QUEUE_TESTS (harness whose select ORDER is the contract)
```ts
// SOURCE: src/db/instantiate-program.test.ts:440-445, 462
it('stays on the current week while the cycle is incomplete', async () => {
  // current=2, 3 days total, only 1 COMPLETED at week 2
  selectQueue = [[{ current: 2 }], [{ value: 3 }], [{ value: 1 }]]
  expect(await nextProgramWeek(USER, 'p1', 4)).toBe(2)
```

### HERO_CARD (the component gaining a variant)
```tsx
// SOURCE: src/app/next-workout-card.tsx:12-23
<section className="mt-6 rounded-2xl border border-border bg-card p-5">
  <div className="flex items-baseline justify-between gap-3">
    <p className="shrink-0 text-xs font-semibold uppercase tracking-widest text-primary">
      Up next · Week {next.week}
    </p>
    <Link href={`/programs/${next.programId}`} className="min-w-0 truncate text-xs ...">
```

### PR_DISPLAY (baseline → best with ~ and unit)
```tsx
// SOURCE: src/app/programs/[id]/stats/page.tsx (PRs section)
<span aria-hidden="true" className="text-muted-foreground">~</span>
{formatE1RM(pr.baseline.e1rm, unit)}
<span aria-hidden="true" className="text-muted-foreground">{' → '}</span>
<span className="sr-only"> to </span>
...
```

### PURE_HELPER_TESTS (stats-view convention)
```ts
// SOURCE: src/app/programs/[id]/stats/stats-view.test.ts:70-98
describe('prDeltaKg', () => {
  const point = (over = {}) => ({ week: 1, reps: 8, e1rm: 113, ...over })
  it('is the best-minus-baseline e1rm gain', () => { ... })
```

### QUIET_INLINE_LINK (Stats link precedent)
```tsx
// SOURCE: src/app/programs/[id]/page.tsx (meta row)
<Link href={`/programs/${program.id}/stats`}
  className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
  Stats<ChevronRight aria-hidden="true" className="size-4" />
</Link>
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/programs.ts` | UPDATE | `programWeekState` (currentWeek + blockComplete) extracted from `nextProgramWeek`; `nextProgramWeek` becomes a wrapper; `getNextProgramDay` consumes state and `NextProgramDay` gains `blockComplete` + `mesocycleWeeks` |
| `src/db/instantiate-program.test.ts` | UPDATE | TDD: blockComplete true/false cases in the existing nextProgramWeek describe (same selectQueue harness) |
| `src/app/programs/[id]/stats/stats-view.ts` | UPDATE | `topPRs(exercises, count)` — gains only, sorted desc by delta |
| `src/app/programs/[id]/stats/stats-view.test.ts` | UPDATE | TDD for `topPRs` |
| `src/app/programs/[id]/page.tsx` | UPDATE | Use `programWeekState`; conditional `getProgramStats` fetch + completion card above the day list |
| `src/app/next-workout-card.tsx` | UPDATE | Completion banner variant when `next.blockComplete` |
| `.claude/PRPs/prds/program-lifecycle.prd.md` | UPDATE | Phase 2 status |

## NOT Building

- Restart action/button — Phase 3 (the card is its future home; no placeholder button)
- Any `nextProgramWeek` semantic change: same reads, same return, same clamp — completion is a NEW output, not a behavior change
- Completion for past-overshoot blocks (observed week > mesocycleWeeks with the final week untouched) — `blockComplete` stays false there; documented edge
- Home-page PR deltas — compact banner only (decided: full card on program page, banner on home)
- Persisted completion state — derived every read, never stored

---

## Step-by-Step Tasks

### Task 1: Failing week-state tests (RED)
- **ACTION**: Extend the `nextProgramWeek` describe in `src/db/instantiate-program.test.ts` with a `programWeekState` sub-describe (import it alongside `nextProgramWeek`).
- **IMPLEMENT**: Same selectQueue idiom (order: current → dayTotal → daysDone):
  1. Final week complete → `{ currentWeek: 4, blockComplete: true }`: `selectQueue = [[{ current: 4 }], [{ value: 3 }], [{ value: 3 }]]`, meso 4.
  2. Final week incomplete → `{ currentWeek: 4, blockComplete: false }`: daysDone 1 of 3 at current 4.
  3. Mid-block complete week → advances, not blockComplete: current 2 done of meso 4 → `{ currentWeek: 3, blockComplete: false }`.
  4. Empty program history → `{ currentWeek: 1, blockComplete: false }` (`selectQueue = [[]]` — current null short-circuits).
  5. `nextProgramWeek` regression: still returns the same numbers for cases 1–4 (wrapper contract).
- **MIRROR**: SELECT_QUEUE_TESTS.
- **GOTCHA**: Do NOT reorder or add selects in the implementation — `getNextProgramDay` tests queue five+ selects positionally and `instantiateProgramDay`'s derived-week tests count them too.
- **VALIDATE**: `npm test -- src/db/instantiate-program.test.ts` → RED (no export).

### Task 2: `programWeekState` (GREEN)
- **ACTION**: Refactor in `src/db/programs.ts`.
- **IMPLEMENT**:
  ```ts
  export interface ProgramWeekState {
    /** Same value nextProgramWeek has always returned (clamped). */
    currentWeek: number
    /** The advancement rule fired AT the final week: every day of week
     *  mesocycleWeeks has a completed session. Earlier skipped weeks don't
     *  block completion — same policy that lets the week advance past them. */
    blockComplete: boolean
  }
  export async function programWeekState(userId, programId, mesocycleWeeks): Promise<ProgramWeekState> {
    // body = nextProgramWeek's exact reads, then:
    // blockComplete = cycleComplete && current >= mesocycleWeeks
    // currentWeek   = cycleComplete ? Math.min(current + 1, Math.max(1, mesocycleWeeks)) : current
  }
  export async function nextProgramWeek(...): Promise<number> {
    return (await programWeekState(userId, programId, mesocycleWeeks)).currentWeek
  }
  ```
  `getNextProgramDay`: swap its `nextProgramWeek` call for `programWeekState` (same Promise.all slot, zero extra queries); `NextProgramDay` interface gains `blockComplete: boolean` and `mesocycleWeeks: number` (already selected on the program row); return them.
- **MIRROR**: WEEK_MATH — reads byte-for-byte, only the return shape grows.
- **GOTCHA**: Overshoot rows (`current > mesocycleWeeks` with the final week partial) → `cycleComplete` computes against the OVERSHOT week, so `blockComplete` may read false even if week N was finished earlier. Document in the JSDoc as the accepted edge (manual overshoot is already a documented anomaly path).
- **VALIDATE**: Task 1 green; `npx tsc --noEmit`.

### Task 3: Failing `topPRs` tests (RED) then GREEN
- **ACTION**: Extend `stats-view.test.ts` then `stats-view.ts`.
- **IMPLEMENT**: `topPRs(exercises: ProgramExerciseProgression[], count: number)` → exercises with `pr !== null` AND `prDeltaKg(pr) > 0`, sorted by delta desc, first `count`. Cases: sorts desc; filters null-pr and zero-delta (single-week baselines are not gains); respects count; empty input → [].
- **MIRROR**: PURE_HELPER_TESTS; reuse `prDeltaKg` internally.
- **GOTCHA**: Return the exercises (typed with non-null `pr` via the type-predicate idiom already used in stats/page.tsx), not bare numbers — the card needs name + both endpoints.
- **VALIDATE**: helper tests green.

### Task 4: Program page completion card
- **ACTION**: Update `src/app/programs/[id]/page.tsx`.
- **IMPLEMENT**:
  - Replace the `nextProgramWeek(...)` call in the page's Promise.all with `programWeekState(...)`; destructure `{ currentWeek, blockComplete }`.
  - When `blockComplete`: `const stats = await getProgramStats(userId, program.id)` (conditional, sequential — only complete blocks pay it) and `const prs = stats ? topPRs(stats.exercises, 3) : []`.
  - Card above the week-heading block (`mt-8` section, volt-tinted border like the done-day cards: `rounded-2xl border border-primary/50 bg-card p-4`):
    - `<p>` caps-widest volt label: `Block complete · {program.mesocycleWeeks} weeks` (tnum).
    - One row per `prs` entry: name (truncate) left; `~baseline → ~best` right (PR_DISPLAY, `formatE1RM`, tnum, sr-only "to").
    - QUIET_INLINE_LINK to `/programs/${program.id}/stats` labeled "Stats".
    - Zero `prs` → card still renders with just the label + Stats link (the state is the message; no empty table).
  - `aria-label="Block complete"` on the section. Day cards below unchanged.
- **MIRROR**: PR_DISPLAY, QUIET_INLINE_LINK, section-label conventions.
- **IMPORTS**: `programWeekState` (replaces `nextProgramWeek` import), `getProgramStats` from `@/db/program-stats`, `topPRs` from `./stats/stats-view`, `formatE1RM` from `@/lib/format`.
- **GOTCHA**: One-volt rule: the card's label may be volt TEXT, but no volt button — Start on the current week's next-up day keeps the page's CTA. Don't fetch `getProgramStats` for incomplete blocks.
- **VALIDATE**: `npx tsc --noEmit`; `npm run build`.

### Task 5: Home hero completion banner
- **ACTION**: Update `src/app/next-workout-card.tsx`.
- **IMPLEMENT**: Early branch on `next.blockComplete`: same `section` shell; caps volt label `Block complete`; the existing poster `h2` shows the PROGRAM name (not a day); footer line `{next.mesocycleWeeks} weeks` + Link "See results" (with ChevronRight) → `/programs/${next.programId}/stats`. No StartDayButton in this variant — a finished block's re-run lives on the program page, not the hero.
- **MIRROR**: HERO_CARD shell; comment explaining the variant split.
- **GOTCHA**: `showNextDay` gating on home stays untouched — a live session still suppresses the banner (correct: it's a "what next" surface).
- **VALIDATE**: `npm run build`; manual on dev server.

### Task 6: Full validation
- **VALIDATE**: commands below; diff touches only listed files.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| blockComplete at final week | current=meso, all days done | true, week clamped | |
| final week partial | daysDone < dayTotal | false | |
| mid-block week done | current < meso, done | false, week advances | ✓ |
| empty history | no workouts | week 1, false | ✓ |
| wrapper regression | cases above | nextProgramWeek returns same numbers | regression |
| topPRs sorts desc | deltas 5, 17, 9 | [17, 9, 5] order | |
| topPRs filters non-gains | pr null / delta 0 | excluded | ✓ |
| topPRs respects count | 5 gains, count 3 | length 3 | |
| topPRs empty | [] | [] | ✓ |

Cards: no component tests (repo convention — build + manual).

### Edge Cases Checklist
- [x] Skipped earlier week doesn't block completion (matches week-advance policy — the user's real week-1 Legs)
- [x] Overshoot rows → blockComplete false (documented accepted edge)
- [x] Complete block with zero positive PR deltas → card renders label + link only
- [x] Incomplete block → zero new UI anywhere
- [ ] Concurrent access — N/A read-only

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/db/programs.ts src/db/instantiate-program.test.ts "src/app/programs/[id]" src/app/next-workout-card.tsx
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/db/instantiate-program.test.ts "src/app/programs/[id]/stats/stats-view.test.ts"
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 935 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Live block (week 2 of 7): NOTHING changes anywhere (most important check — completion must be invisible until real)
- [ ] Seed/complete a 1-week test program → hero shows the banner, program page shows the card with its PR rows, stats link works
- [ ] Day cards + Start still render below the card on the complete block

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] `nextProgramWeek` byte-compatible for all callers (wrapper)
- [ ] Completion card + hero banner render only for complete blocks
- [ ] PR data fetched only when complete
- [ ] Incomplete blocks: zero visual or query-cost change

## Completion Checklist
- [ ] Select order in the db layer unchanged (harness contract)
- [ ] tnum/caps-label/volt-discipline consistent with neighbors
- [ ] `aria-label` on the new section; sr-only "to" in PR rows
- [ ] No stored completion state
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor perturbs select order → positional test harness breaks | M | Test failures (loud) | Extract-then-wrap, reads byte-for-byte; run instantiate tests first |
| Completion definition surprises (strict all-weeks vs final-week rule) | L | Product | Final-week rule matches the app's own advancement policy; user's skipped Legs week must not block — explicitly reasoned |
| Conditional getProgramStats slows the complete-block page | L | Perf | Only paid at completion; single extra read on a page already doing several |

## Notes
- Resolves the PRD's open "hero card vs banner" question: compact banner on home, full card on program page (decision logged here; check off the PRD open question at report time).
- Phase 3's Restart button drops into this card — its layout (label row / PR rows / action row) is designed to take one more row without rework.
- `mesocycleWeeks` joins `NextProgramDay` — the hero variant needs the week count and `getNextProgramDay` already selects it.
