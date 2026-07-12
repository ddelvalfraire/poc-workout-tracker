# Plan: Program Stats — UI (Phase 2)

## Summary
Add a `/programs/[id]/stats` server-component page — the one-screen block check-in: adherence header ("Week 2 of 7 · 3/5 days last week"), per-week volume strip (inline div bars, no chart dependency), and a per-exercise progression list (weekly best set + Est. 1RM). Linked from the program detail page. Consumes Phase 1's `getProgramStats` verbatim; converts kg → display unit only at render.

## User Story
As a lifter mid-block, I want one screen showing week position, adherence, volume, and per-lift trends scoped to this program, so I can tell whether the block is working without opening individual workouts.

## Problem → Solution
Phase 1's aggregate exists but nothing renders it → a stats sub-page on the program surface renders all four v1 categories (PRs are Phase 3) with explicit sparse-data states.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/program-stats.prd.md`
- **PRD Phase**: Phase 2 — Stats UI
- **Estimated Files**: 4 (2 new UI/helper files, 1 new test file, 1 page edit)

---

## UX Design

### Before
```
Programs → [program] → week pills + day cards. Progress requires opening
individual workout summaries; no adherence, volume, or trend anywhere.
```

### After
```
Programs → [program] ── "Stats" link (quiet, next to week meta) ──▶
┌──────────────────────────────────┐
│ ◀ Program Stats          [badge] │  AppHeader, back → /programs/[id]
│ WEEK 2 OF 7                      │  hero meta (font-display numeral row)
│ 3/5 days · wk 1  (muted line)    │  last full week adherence
│                                  │
│ ADHERENCE                        │  section label (11px caps widest)
│ wk1 3/5   wk2 2/5 +1 unfinished… │  per-week row: n/planned + started flag
│                                  │
│ VOLUME                           │
│ wk1 ████████ 12,400 kg · 18 sets │  div bar scaled to block max tonnage
│ wk2 █████    8,210 kg · 12 sets  │
│                                  │
│ PROGRESSION                      │
│ Bench Press                      │
│  wk1  8 × 100 kg   ~113 kg       │  formatSet + ~formatE1RM (tnum)
│  wk2  8 × 102.5 kg ~130 kg       │
│ Leg Press                        │
│  wk1  8 reps       —             │  null best → sets/reps-only line
└──────────────────────────────────┘
Empty block: teach line — "No sessions from this program yet — start a
day and stats build themselves." (no bare dashes / empty tables)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Program detail meta row | "Week 2 of 7 · deload wk 6" | same + "Stats" link on the right | Quiet link, not a volt CTA (one volt per screen stays with Start) |
| New route `/programs/[id]/stats` | 404 | Stats page | Server component; `notFound()` when `getProgramStats` returns null |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/program-stats.ts` | all | THE data contract: `ProgramStats`, `ProgramWeekStats`, `ExerciseWeekPoint`, `BestSet`; kg-domain, weeks index 0 = week 1, sparse exercise weeks |
| P0 | `src/app/programs/[id]/page.tsx` | 25–50, 105–145 | Page skeleton to mirror: `requireUserId` → `Promise.all` → `notFound()`; AppHeader with back link + status pill; "Week X of Y" meta line (the Stats link lands beside it, ~line 140) |
| P0 | `src/app/bodyweight/page.tsx` | all | The closest existing stats surface: hero numeral pattern, section `aria-label`s, empty-state teach line, list styling |
| P1 | `src/lib/format.ts` | 24–42, 94–101, 136–144 | `formatSet` (best-set line), `formatVolume` (tonnage, whole-unit grouping), `formatE1RM` |
| P1 | `src/app/workout/[id]/page.tsx` | 218–238 | Est. 1RM display convention: "Est. 1RM" caps label + muted `~` prefix + `formatE1RM` |
| P1 | `src/lib/units.ts` | all | `kgToDisplay` — ALL conversion happens in format helpers at render; view helpers stay kg |
| P2 | `src/lib/sparkline.test.ts` | all | Pure-helper test style for the view helpers (no mocks, AAA) |
| P2 | `src/app/programs/[id]/week-view.ts` | all | Route-local pure-helper module precedent (helpers colocated with the route, tested) |

## External Documentation

None needed — feature uses established internal patterns.

---

## Patterns to Mirror

### PAGE_SKELETON (server component, ownership → notFound)
```tsx
// SOURCE: src/app/programs/[id]/page.tsx:32-35
const userId = await requireUserId()
const [{ id }, sp] = await Promise.all([params, searchParams])
const [program, unit] = await Promise.all([getProgramDetail(userId, id), getWeightUnit(userId)])
if (!program) notFound()
```

### APP_HEADER_BACK (leading chevron link)
```tsx
// SOURCE: src/app/bodyweight/page.tsx:44-55
<AppHeader
  title="Bodyweight"
  leading={
    <Link href="/settings" aria-label="Back"
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}>
      <ChevronLeft aria-hidden="true" className="size-5" />
    </Link>
  }
/>
```

### SECTION_LABEL + TEACH_EMPTY_STATE
```tsx
// SOURCE: src/app/bodyweight/page.tsx:59-78
<section aria-label="Current bodyweight" className="mt-6">
  ...
  // Teach line, not a bare dash: the value exists to power est. 1RM.
  <p className="text-sm text-muted-foreground">
    Log your first weigh-in — bodyweight exercises use it for est. 1RM.
  </p>
```

### EST_1RM_DISPLAY
```tsx
// SOURCE: src/app/workout/[id]/page.tsx:220-229
<span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
  {current.kind === "e1rm" ? "Est. 1RM" : "Top set"}
</span>
<span className="font-display text-3xl leading-none tnum">
  <span aria-hidden="true" className="text-muted-foreground">~</span>
  {formatE1RM(current.e1rm, unit)}
</span>
```

### BIG_NUMERAL_META (hero week position)
```tsx
// SOURCE: src/app/programs/[id]/page.tsx:213-216 (display face + caps tracking)
<h2 className="font-display text-xl uppercase leading-none tracking-wide">
  Week {selectedWeek}
</h2>
```

### PURE_HELPER_TESTS (no mocks, AAA, edge-first)
```ts
// SOURCE: src/lib/sparkline.test.ts:5-8
it('returns empty for fewer than 2 points (no line to draw)', () => {
  expect(sparklinePoints([], 100, 64)).toBe('')
```

### QUIET_INLINE_LINK (non-volt secondary navigation)
```tsx
// SOURCE: src/app/settings/page.tsx:75-93 (link row: label + chevron, muted)
<Link href="/bodyweight" className="flex items-center justify-between gap-4 ...">
  ... <ChevronRight aria-hidden="true" className="size-4" />
```

### STATUS_PILL (header trailing)
```tsx
// SOURCE: src/app/programs/[id]/page.tsx:123-134
<span className={cn(
  'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
  status === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
)}>
  {status}
</span>
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/programs/[id]/stats/stats-view.ts` | CREATE | Pure view helpers (testable, kg-domain): visible-week trimming, bar scaling, empty detection |
| `src/app/programs/[id]/stats/stats-view.test.ts` | CREATE | TDD coverage for the helpers |
| `src/app/programs/[id]/stats/page.tsx` | CREATE | The stats page (server component, no client islands — read-only surface) |
| `src/app/programs/[id]/page.tsx` | UPDATE | "Stats" link beside the "Week X of Y" meta line |
| `.claude/PRPs/prds/program-stats.prd.md` | UPDATE | Phase 2 status (done by this planning pass) |

## NOT Building

- Program PRs (Phase 3) and MCP tool (Phase 4)
- Charting/sparkline for stats (PRD: tables + simple inline div bars only; the bodyweight SVG sparkline is NOT the pattern here)
- Client interactivity — no tab state, no week selector on the stats page (it shows the whole block; the program page owns week browsing)
- Fixing the BW-type e1RM caveat in the data layer (see Risks — flagged for Phase 3)
- Any data-layer changes at all: the page consumes `getProgramStats` as-is

---

## Step-by-Step Tasks

### Task 1: Failing tests for the view helpers (RED)
- **ACTION**: Create `src/app/programs/[id]/stats/stats-view.test.ts` before the helper module.
- **IMPLEMENT**: One describe per helper (pure, no mocks — MIRROR PURE_HELPER_TESTS):
  - `visibleWeeks(weeks, currentWeek)` — trims trailing all-zero future weeks but never below `currentWeek`: full 7-week zeroed array + currentWeek 2 → 2 entries; data in week 5 + currentWeek 2 → 5; empty array → empty.
  - `volumeBarWidthPct(tonnageKg, maxTonnageKg)` — 0 when max is 0 (never NaN/Infinity); 100 at max; proportional rounded to whole pct.
  - `hasAnyTraining(weeks)` — false for all-zero weeks (drives the whole-page empty state), true when any `daysStarted > 0`.
- **IMPORTS**: `import type { ProgramWeekStats } from '@/db/program-stats'`; a local `week(over?)` fixture factory like program-stats.test.ts's `row()`.
- **VALIDATE**: `npm test -- "src/app/programs/[id]/stats/stats-view.test.ts"` → module-not-found (RED). Note: quote the path — the brackets glob in zsh.

### Task 2: Implement `stats-view.ts` (GREEN)
- **ACTION**: Write the three helpers with JSDoc per the density of `week-view.ts`.
- **IMPLEMENT**: All pure; `visibleWeeks` returns a NEW array (`slice`), never mutates. "All-zero" week = `daysStarted === 0 && completedSets === 0` (a week with only an empty started workout still shows).
- **GOTCHA**: `weeks` from the data layer is always materialized 1..N (no holes) — helpers may rely on `weeks[i].week === i + 1`.
- **VALIDATE**: helper tests green.

### Task 3: The stats page
- **ACTION**: Create `src/app/programs/[id]/stats/page.tsx`, server component.
- **IMPLEMENT**:
  - Skeleton per PAGE_SKELETON: `requireUserId` → await `params` → `Promise.all([getProgramStats(userId, id), getWeightUnit(userId)])` → `if (!stats) notFound()`.
  - AppHeader: title "Program Stats", leading back-chevron to `/programs/${id}` (APP_HEADER_BACK), trailing STATUS_PILL from `stats.program.status`.
  - Hero: program name muted small; "Week {currentWeek} of {mesocycleWeeks}" in the display face (BIG_NUMERAL_META scale); muted second line = last FULL week's adherence when `currentWeek >= 2`: "{daysCompleted}/{plannedDays} days · wk {currentWeek - 1}".
  - Whole-page empty state: `!hasAnyTraining(stats.weeks)` → teach line (TEACH_EMPTY_STATE voice): "No sessions from this program yet — start a day and stats build themselves." Render nothing else.
  - Adherence section (`aria-label="Adherence"`): one row per `visibleWeeks(stats.weeks, stats.currentWeek)`: `Wk {n}` caps label (current week's label `text-primary` — the "you are here" accent), `{daysCompleted}/{plannedDays}` tnum, muted "+{daysStarted − daysCompleted} unfinished" suffix when started > completed (PRD: started counts, flagged visually).
  - Volume section (`aria-label="Weekly volume"`): per visible week, a div bar — outer `h-2 rounded-full bg-muted`, inner `h-full rounded-full bg-primary` with `style={{ width: \`${volumeBarWidthPct(w.tonnageKg, maxTonnage)}%\` }}` — labeled `{formatVolume(w.tonnageKg, unit)} · {w.completedSets} sets`. Zero-tonnage week with sets still shows "{n} sets" (machine-only weeks are real training).
  - Progression section (`aria-label="Progression"`): per `stats.exercises` (already first-appearance ordered): name (`text-sm font-medium`), then one line per week point: `Wk {point.week}` caps + `formatSet(best.reps, best.weightKg, unit)` + `~{formatE1RM(best.e1rm, unit)}` (EST_1RM_DISPLAY: muted `~`, tnum). `best === null` → muted `{completedSets} sets` (null-weight machine weeks still show effort). Single-point exercises render their one line.
- **MIRROR**: PAGE_SKELETON, APP_HEADER_BACK, SECTION_LABEL, EST_1RM_DISPLAY, STATUS_PILL; `mx-auto w-full max-w-md flex-1 px-5 pb-safe` main; `min-h-[100dvh]` wrapper.
- **IMPORTS**: `getProgramStats` from `@/db/program-stats`; `getWeightUnit` from `@/db/preferences`; `formatSet, formatVolume, formatE1RM` from `@/lib/format`; `visibleWeeks, volumeBarWidthPct, hasAnyTraining` from `./stats-view`; `requireUserId` from `@/lib/auth`.
- **GOTCHA**: weeks are 1-based in a 0-based array — last full week is index `currentWeek - 2`, guard `currentWeek >= 2`. Do NOT convert units anywhere except through the format helpers. No client component needed anywhere — zero `'use client'`.
- **VALIDATE**: `npx tsc --noEmit` clean; `npm run build` lists `/programs/[id]/stats`.

### Task 4: Stats link on the program page
- **ACTION**: Edit `src/app/programs/[id]/page.tsx` — wrap the meta line (~line 140) in `div className="mt-4 flex items-baseline justify-between gap-3"`: existing `<p>` (drop its `mt-4`, add `min-w-0 truncate`) left; `<Link href={\`/programs/${program.id}/stats\`} className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground">Stats<ChevronRight aria-hidden="true" className="size-4" /></Link>` right.
- **MIRROR**: QUIET_INLINE_LINK — muted text + chevron, NOT a button/volt (Start keeps the page's one volt CTA). `ChevronRight` import already exists? — it does NOT on this page; add it to the existing `lucide-react` import.
- **GOTCHA**: No drive-by changes — only the meta row block. Keep the comment above it.
- **VALIDATE**: `npm run build`; page renders unchanged otherwise.

### Task 5: Full validation
- **ACTION**: Full suite, lint, build. (PRD Phase 2 → complete happens at implementation-report time, per workflow.)
- **VALIDATE**: commands below; `git diff --stat` shows only the 4 files.

---

## Testing Strategy

### Unit Tests — stats-view helpers (pure)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| trims empty future weeks | 7 zeroed weeks, currentWeek 2 | length 2 | ✓ |
| keeps trailing data weeks | data at week 5, currentWeek 2 | length 5 | ✓ |
| never trims below current week | data only week 1, currentWeek 3 | length 3 | |
| empty weeks array | `[]`, currentWeek 1 | `[]` | ✓ |
| does not mutate input | any | input array unchanged | ✓ |
| bar pct at zero max | (0, 0) | 0 (not NaN) | ✓ |
| bar pct proportional | (500, 1000) | 50 | |
| bar pct full | (1000, 1000) | 100 | |
| hasAnyTraining false on zeroed block | 7 zeroed weeks | false | ✓ |
| hasAnyTraining true on one started day | week with daysStarted 1 | true | |

Page itself: no component test (repo convention — server pages are validated by build + manual pass; pure logic lives in the tested helpers).

### Edge Cases Checklist
- [x] Empty block (whole-page teach state)
- [x] Zero-tonnage weeks (machine-only) — bar 0%, sets still shown
- [x] Single-week block / single-point progression
- [x] Week overshoot (weeks array longer than mesocycleWeeks — visibleWeeks keeps data weeks)
- [ ] Concurrent access — N/A read-only

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint "src/app/programs/[id]/stats" "src/app/programs/[id]/page.tsx"
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- "src/app/programs/[id]/stats/stats-view.test.ts"
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 881 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: `/programs/[id]/stats` appears in the route list

### Manual Validation
- [ ] Open the live 7-week block → Stats: week position, adherence rows, volume bars, ≥1 lift trend render with real data (PRD success signal)
- [ ] A program with zero sessions shows the teach line only
- [ ] lb display: volumes and e1RMs convert; kg values match workout summaries

---

## Acceptance Criteria
- [ ] All tasks complete, helper TDD order respected
- [ ] All validation commands pass
- [ ] Empty/sparse states render designed copy, never bare dashes or empty tables
- [ ] Unit conversion only via format helpers at render
- [ ] Program page unchanged except the meta-row link

## Completion Checklist
- [ ] One-volt-CTA rule intact on both pages (stats page has ZERO volt CTAs — read-only)
- [ ] tnum on every numeral; caps-tracking section labels; muted secondary lines
- [ ] `aria-label` on each section; back link labeled
- [ ] No chart dependency added
- [ ] Self-contained — no codebase searching needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BW-type exercises show misleading e1RM (data layer scores raw `weight`, but for bodyweight logging types `weight` isn't total load — see `bestSet` caveat in `src/lib/one-rep-max.ts:30-34`) | M | Wrong trend numbers for BW lifts in programs | Known Phase-1 scope cut; flag for Phase 3 (add loggingType to the stats row + score via `bestScoredSet`); the live validating block is barbell/machine (weight_reps) so v1 numbers are honest for it |
| Program page meta-row edit wraps badly on narrow screens | L | Layout | flex + `shrink-0` on the link, `min-w-0 truncate` on meta text |
| Sparse data reads as broken | M | Trust | Explicit teach line; single-point progression renders as-is (trend accrues) |

## Notes
- The stats page deliberately has no `?week=` param — it's the whole-block lens; the program page owns week browsing. `currentWeek` comes from the data layer so both surfaces always agree.
- Phase 3 (PRs) adds a section to THIS page (first-week baseline → best per exercise); the progression section's per-exercise grouping is already the right container.
- `MAX_RELIABLE_REPS` "Est." labeling: the `~` + "Est. 1RM"-style convention (workout summary) carries as-is; finer >12-reps flagging belongs to Phase 3 alongside PRs.
