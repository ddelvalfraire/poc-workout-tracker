# Plan: Exercise Stats — Phase 2: Library + Detail Page

## Summary
Build the standalone surface: `/exercises` (history-first, filterable library) and `/exercises/[source]/[id]` (all-time records, e1RM sparkline trend, paginated session history). Read-only server components over the Phase-1 `db/exercise-stats.ts` module, plus one new list query in that module. Ordered BEFORE Phase 3 so the sheet's "View full stats →" link never dangles.

## User Story
As the app's lifter, I want to browse any exercise I've trained and see its all-time records, trend, and session history, so that I can answer "how has this lift moved" outside the gym.

## Problem → Solution
Phase-1 data layer exists but nothing renders it → two routes render it, and the home screen links to the library.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-stats.prd.md`
- **PRD Phase**: 2 — Library + detail page
- **Estimated Files**: 8

---

## UX Design

### Before
Home → Programs / Start workout / Settings. No way to see an exercise's story anywhere.

### After
```
Home ──> [Exercises] ──> /exercises (search box + rows: name · N sessions · last done)
                              │ tap row
                              ▼
              /exercises/wger/73 ─ Records grid (Best e1RM / Heaviest / Most reps / Best volume)
                                 ─ Trend sparkline (per-session best e1RM)
                                 ─ History: session cards (date, sets) → /workout/[id]
                                 ─ Older / Newer pagination (?page=N)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home quick links | Programs, Settings | + Exercises | Same link vocabulary as the Programs link (page.tsx:124) |
| Exercise story | Only block-scoped program stats | All-time detail page | Records reps_weight-only; duration rows show in history |
| History row | — | Links to `/workout/[id]` | Edits stay on workout surfaces (PRD "NOT building") |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db/exercise-stats.ts` | all | The data source; new list query lands here and must match its style |
| P0 | `src/app/bodyweight/page.tsx` | 1–110 | THE page template: server component, `requireUserId` + `Promise.all`, AppHeader + back link, sparkline constants/render, hero numerals |
| P0 | `src/app/programs/[id]/stats/page.tsx` | 1–50 | notFound() on null, `getWeightUnit` pairing, format helpers, stats-view pure-helper split |
| P1 | `src/lib/format.ts` | exports | `formatE1RM`, `formatVolume`, `formatSet`, `formatWorkoutDate` — display converts, never the data layer |
| P1 | `src/lib/sparkline.ts` | all | `sparklinePoints(values, w, h)` |
| P1 | `src/db/exercise-stats.test.ts` | 1–60 | Harness to extend for the new list query |
| P2 | `src/app/page.tsx` | 100–150 | Where the Exercises link slots in, link styling |
| P2 | `src/app/programs/page.tsx` | all | List-row card vocabulary for the library rows |

## External Documentation
None needed — established internal patterns only.

---

## Patterns to Mirror

### SERVER_PAGE
```tsx
// SOURCE: src/app/bodyweight/page.tsx:33-36
export default async function BodyweightPage() {
  const userId = await requireUserId()
  const [unit, logs] = await Promise.all([getWeightUnit(userId), listBodyweightLogs(userId)])
```

### NOT_FOUND_ON_NULL + PARAMS
```tsx
// SOURCE: src/app/programs/[id]/stats/page.tsx:26-34
export default async function ProgramStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId()
  const { id } = await params
  const [stats, unit] = await Promise.all([getProgramStats(userId, id), getWeightUnit(userId)])
  if (!stats) notFound()
```

### SPARKLINE
```tsx
// SOURCE: src/app/bodyweight/page.tsx:19-23, 85-97
const SPARK_W = 320; const SPARK_H = 64; const SPARK_INSET = 2
// values chronological oldest → newest
<polyline points={sparklinePoints(values, SPARK_W, SPARK_H - SPARK_INSET * 2)} ... />
```

### HEADER_WITH_BACK
```tsx
// SOURCE: src/app/bodyweight/page.tsx:45-56
<AppHeader title="Bodyweight" leading={
  <Link href="/settings" aria-label="Back" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}>
    <ChevronLeft aria-hidden="true" className="size-5" />
  </Link>} />
```

### PURE_VIEW_HELPERS (tested, page stays render-only)
```ts
// SOURCE: src/app/programs/[id]/stats/stats-view.ts:29-49 (+ .test.ts)
export function visibleWeeks(...)  // pure, exported, unit-tested
```

### DB_LIST_AGGREGATION (module style from Phase 1)
```ts
// SOURCE: src/db/exercise-stats.ts:96-104
/** Pure aggregation over the flat rows — exported for tests. Builds fresh
 *  structures throughout; never mutates its inputs. */
export function aggregateExerciseStats(rows: readonly ExerciseStatsRow[], ...)
```

### TEST_STRUCTURE
Same mocked-db harness as `src/db/exercise-stats.test.ts:13-46` (queued thenable builders, PgDialect where-introspection).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db/exercise-stats.ts` | UPDATE | Add `LoggedExercise` type, pure `aggregateLoggedExercises`, and `listLoggedExercises(userId)` |
| `src/db/exercise-stats.test.ts` | UPDATE | Cover the new aggregation + query scoping |
| `src/app/exercises/exercise-ref.ts` | CREATE | `parseExerciseRef(source, id)` — URL-param validation shared by page + (Phase 3) sheet link building |
| `src/app/exercises/exercise-ref.test.ts` | CREATE | Param matrix |
| `src/app/exercises/page.tsx` | CREATE | Library server page |
| `src/app/exercises/library-filter.tsx` | CREATE | Small client island: name-substring filter over the server-rendered list |
| `src/app/exercises/[source]/[id]/page.tsx` | CREATE | Detail server page (records, sparkline, paginated history) |
| `src/app/page.tsx` | UPDATE | Add Exercises quick link beside Programs |

## NOT Building
- Full-catalog (wger API) search on the library — v1 lists exercises WITH history and filters client-side; the picker already covers catalog discovery in the logger. (Resolves the PRD open question minimally; catalog search can layer on later.)
- Logger sheet / PR detection — Phases 3–4
- Duration/distance records or pace math — cardio feature
- MCP exposure, editing from stats surfaces, per-program filters

---

## Step-by-Step Tasks

### Task 1: `listLoggedExercises` in `src/db/exercise-stats.ts`
- **ACTION**: New exported types + pure aggregation + query, appended to the module.
- **IMPLEMENT**:
  ```ts
  export interface LoggedExerciseRow {
    wgerExerciseId: number; source: ExerciseSource; name: string
    workoutId: string; startedAt: Date
  }
  export interface LoggedExercise {
    wgerExerciseId: number; source: ExerciseSource; name: string
    sessionCount: number; lastPerformedAt: Date
  }
  export function aggregateLoggedExercises(rows: readonly LoggedExerciseRow[]): LoggedExercise[]
  export async function listLoggedExercises(userId: string): Promise<LoggedExercise[]>
  ```
  Query: `db.select({...}).from(workoutExercises).innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId)).where(and(eq(workouts.userId, userId), isNotNull(workouts.completedAt))).orderBy(asc(workouts.startedAt))` — one row per exercise OCCURRENCE (no sets join; "appeared in a completed workout" is the list's bar, cheaper than the per-set scan and documented as such). Aggregate: group by `${source}:${id}` (composite-key rule, program-stats.ts:203), latest name wins, `sessionCount` = distinct workoutIds, `lastPerformedAt` = max startedAt; sort result by `lastPerformedAt` desc.
- **MIRROR**: DB_LIST_AGGREGATION; composite grouping from `program-stats.ts:203-210`.
- **IMPORTS**: already in module (`and`, `asc`, `eq`, `isNotNull`, tables).
- **GOTCHA**: sessionCount here counts completed workouts CONTAINING the exercise (occurrence-level), which can differ from `totalSessions` (≥1 completed set) — document the distinction in the doc comment; the list is navigation, not scoring.
- **VALIDATE**: New unit tests (Task 2) green.

### Task 2: Tests for Task 1
- **ACTION**: Extend `src/db/exercise-stats.test.ts`.
- **IMPLEMENT**: `aggregateLoggedExercises`: composite-identity separation (custom 42 ≠ wger 42); latest-name-wins; distinct sessionCount when an exercise appears twice in one workout; newest-first ordering. `listLoggedExercises`: where params contain userId; sql contains `"completed_at" is not null`.
- **MIRROR**: TEST_STRUCTURE.
- **VALIDATE**: `npm test`.

### Task 3: `parseExerciseRef` (`src/app/exercises/exercise-ref.ts` + test)
- **ACTION**: Pure URL-param validator + href builder.
- **IMPLEMENT**:
  ```ts
  import type { ExerciseSource } from '@/lib/custom-exercise-input'
  export interface ExerciseRef { source: ExerciseSource; wgerExerciseId: number }
  /** null for anything not ('wger'|'custom', positive-integer string). */
  export function parseExerciseRef(source: string, id: string): ExerciseRef | null
  export function exerciseHref(ref: ExerciseRef): string  // `/exercises/${source}/${id}`
  ```
  Reject: non-integer, ≤ 0, `1e3`/`1.5`/`NaN` forms via `/^\d+$/` then `parseInt`, plus `Number.isSafeInteger`.
- **MIRROR**: `parseCustomRest` (rest-sheet.tsx:28-33) — regex-then-parse validation style.
- **GOTCHA**: Guard `Number.MAX_SAFE_INTEGER` (`Number.isSafeInteger`).
- **VALIDATE**: Test matrix: valid wger/custom; 'foo', '-1', '0', '1.5', '1e3', '' → null.

### Task 4: Library page (`src/app/exercises/page.tsx` + `library-filter.tsx`)
- **ACTION**: Server page + client filter island.
- **IMPLEMENT**: Page: `requireUserId`, `listLoggedExercises`, AppHeader "Exercises" with back-to-home ChevronLeft (HEADER_WITH_BACK), render `<LibraryFilter entries={...} />`. Island (`'use client'`): `useState` query, case-insensitive substring filter, rows as `<Link href={exerciseHref(ref)}>` cards — name, `{sessionCount} sessions · last {date}` — mirroring the programs-page card vocabulary; empty states for "no history yet" and "no match".
- **MIRROR**: SERVER_PAGE, HEADER_WITH_BACK; input styling from rest-sheet's `<Input>` usage.
- **IMPORTS**: `formatWorkoutDate` from `@/lib/format`; `Input` from `@/components/ui/input`.
- **GOTCHA**: Pre-format the date string on the SERVER and pass display-ready entries to the island — avoids Date-serialization/locale drift questions entirely.
- **VALIDATE**: `npm run build`; manual: page renders, filter narrows.

### Task 5: Detail page (`src/app/exercises/[source]/[id]/page.tsx`)
- **ACTION**: The full stats surface.
- **IMPLEMENT**: `params: Promise<{ source: string; id: string }>`; `parseExerciseRef` → invalid ⇒ `notFound()`. `searchParams: Promise<{ page?: string }>` → `page` = positive int, default 1. `Promise.all`: `getExerciseStats`, `getExerciseSessions(userId, source, id, { limit: HISTORY_PAGE (10), offset: (page-1)*10 })`, `getWeightUnit`. `stats === null` ⇒ `notFound()`. Render:
  1. AppHeader: exercise name, back link to `/exercises`.
  2. Records grid (2×2 cards): Best e1RM (`formatE1RM`, flag `> MAX_RELIABLE_REPS` reps as "Est." per stats-page convention), Heaviest load, Most reps, Best session volume (`formatVolume`) — each with its date. Null record ⇒ "—". All-null records (rep-fallback-only history) ⇒ single "No load records yet" card.
  3. Trend sparkline when `trend.length >= 2` (bodyweight page's "needs two points" rule), values = `trend.map(p => p.e1rm)` chronological (already ascending).
  4. History: one card per `ExerciseSession` — `formatWorkoutDate(performedAt)`, workoutName, sets as reps × weight lines in display unit (duration rows: check `lib/format.ts` for a duration formatter first; else a tiny local helper + test), card links to `/workout/${workoutId}`.
  5. Pagination: "Older" link `?page=${page+1}` when `sessions.length === HISTORY_PAGE`; "Newer" when `page > 1`. URL is the state.
- **MIRROR**: NOT_FOUND_ON_NULL + PARAMS, SPARKLINE, SERVER_PAGE.
- **GOTCHA**: (1) kg → display only via format helpers/`kgToDisplay`. (2) `sessions.length === limit` has-more heuristic can show one empty "Older" page at exact multiples — accepted POC trade-off, comment it. (3) `notFound()` for unparseable refs, NOT a throw.
- **VALIDATE**: Build; manual on dev server with real data.

### Task 6: Home quick link (`src/app/page.tsx`)
- **ACTION**: Add an "Exercises" link using the same component/classes as the adjacent Programs link (~line 124), in BOTH layouts if Programs appears twice (lines 124 & 147).
- **GOTCHA**: No drive-by restyling of the home page.
- **VALIDATE**: Build + visual.

### Task 7: PRD table
- **ACTION**: Phase 2 → in-progress at plan time; complete + report link when done.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| composite separation | wger:42 + custom:42 rows | two list entries | ✓ |
| latest name wins | renamed across workouts | newest name | |
| distinct sessions | exercise twice in one workout | sessionCount 1 | ✓ |
| ordering | mixed dates | lastPerformedAt desc | |
| list scoping | any | userId + completed_at not null in WHERE | ✓ |
| parseExerciseRef | 'wger'/'custom' + '42' | ref | |
| parseExerciseRef junk | 'foo','-1','0','1.5','1e3','','9007199254740993' | null | ✓ |

### Edge Cases Checklist
- [x] Empty library (no completed history) → empty state
- [x] Invalid URL params → 404
- [x] Rep-fallback-only history → "no load records" state, no sparkline
- [x] Page past the end → empty history list, "Newer" link back
- [ ] Concurrent access — N/A read-only

## Validation Commands
```bash
npm run lint      # changed files clean
npm test          # all suites green
npm run build     # type check + build
```
Manual: `npm run dev` → `/exercises` renders logged exercises; filter works; detail page records/trend/history match a known exercise; pagination walks; workout links resolve; invalid `/exercises/foo/bar` 404s.

## Acceptance Criteria
- [ ] Library lists logged exercises newest-first with working filter
- [ ] Detail renders records (reps_weight-gated), sparkline (≥2 points), paginated history, workout links
- [ ] Invalid refs 404; kg only converts in format helpers
- [ ] All validation commands pass; PRD updated

## Completion Checklist
- [ ] Server components; only the filter is a client island
- [ ] Pure helpers exported + tested; pages render-only
- [ ] No scope creep (no catalog search, no sheet)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `lib/format.ts` lacks a duration formatter for history rows | M | L | Check first; fall back to a tiny local `formatDuration` helper + test |
| Home layout has two Programs links (empty vs regular state) | M | L | Task 6 checks both call sites |

## Notes
- Phase order deliberately swapped vs. the earlier message: pages (2) before sheet (3) so the sheet's link-out lands on a real route.
- Library search scope decision (history-first + client filter, no catalog search) resolves the PRD's open question minimally — noted for the PRD.
