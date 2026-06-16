# Plan: Repeat Last Workout

## Summary
Add a one-tap "Repeat" affordance that seeds a brand-new workout draft from a past workout's exercises and sets. It reuses the existing, already-tested `detailToDraft` mapper (the same one edit mode uses) and threads the source workout through a `?from=<id>` query param on the existing `/workout/new` page. No schema change, no new draft logic — almost pure wiring.

## User Story
As a regular lifter following a repeating routine, I want to repeat a previous workout with one tap, so that I can start today's session pre-filled with last time's exercises and weights instead of rebuilding it from search.

## Problem → Solution
Today every workout is built from zero via exercise search, even though ~70% of sessions repeat a prior routine → tapping "Repeat" on a past workout opens the logger pre-seeded with that workout's exercises and sets, editable before saving as a distinct new workout.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/progressive-overload-essentials.prd.md`
- **PRD Phase**: 3 — Repeat last workout
- **Estimated Files**: 4 (3 UPDATE, 1 CREATE)

---

## UX Design

### Before
```
Home history row            Detail page actions
┌───────────────────────┐   ┌─────────────────────┐
│ Leg Day            ›   │   │ [ Edit ] [ Delete ] │
│ Jun 14 · 3 ex · 9 sets│   └─────────────────────┘
└───────────────────────┘
(tap row → view detail only; no way to reuse it)
```

### After
```
Home history row                 Detail page actions
┌──────────────────────────────┐ ┌──────────────────────┐
│ Leg Day          [↻]     ›    │ │ [   ↻ Repeat   ]     │  ← primary, full width
│ Jun 14 · 3 ex · 9 sets       │ │ [ Edit ] [ Delete ]  │
└──────────────────────────────┘ └──────────────────────┘
 tap [↻] or Repeat → /workout/new?from=<id>
 → logger opens pre-filled with that workout's exercises + sets (editable)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home history row | Whole row links to detail | Row info links to detail; a Repeat icon-link sits beside the chevron | Siblings, not nested interactives |
| Workout detail actions | Edit + Delete | Repeat (primary) + Edit + Delete | Repeat elevated as the high-value CTA (PRD metric) |
| `/workout/new` | Always empty draft | Empty, OR seeded when `?from=<id>` resolves to an owned workout | Stale/foreign `from` → silently falls back to empty |
| Seeded inputs vs "last time" ghosts | N/A | Seeded fields are real values (not placeholders); ghosts only show on empty fields, so they don't double up | Harmless interaction |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/workout-draft.ts` | 158-182 | `detailToDraft` — the exact mapper we reuse to seed the draft (persisted workout → draft + name, unit-converted) |
| P0 | `src/app/workout/new/page.tsx` | 1-29 | The page being extended to accept `?from` |
| P0 | `src/db/workouts.ts` | 92-106 | `getWorkoutDetail(userId, id)` — user-scoped fetch + `WorkoutDetail` type |
| P0 | `src/app/workout/[id]/workout-actions.tsx` | 1-49 | Detail-page action island to add the Repeat link to |
| P1 | `src/app/page.tsx` | 49-80 | Home history `<li>` markup to add the Repeat affordance to |
| P1 | `src/app/workout/[id]/edit/page.tsx` | 19-25, 41 | Reference: how a seeded logger is wired (`detailToDraft` → `WorkoutLogger initialDraft/initialName/unit`) |
| P1 | `src/app/workout/new/workout-logger.tsx` | 25-39 | `WorkoutLoggerProps` defaults (`initialDraft = emptyDraft`, `initialName = ''`) — passing `undefined` uses the defaults |
| P2 | `e2e/last-time.spec.ts` | 1-106 | The exact e2e harness to mirror (Clerk `+clerk_test` user, kg pin, Supabase teardown) |

## External Documentation
No external research needed — feature uses established internal patterns (Next.js App Router Server Component `searchParams`, Drizzle user-scoped query, existing draft mapper). One framework note captured as a gotcha below.

```
KEY_INSIGHT: In Next.js 15 App Router, `searchParams` is a Promise in Server Components and must be awaited.
APPLIES_TO: Task 1 (new page signature)
GOTCHA: Type as `searchParams: Promise<{ from?: string }>` and `await` it — mirrors how `params` is already awaited in `[id]/page.tsx:18`.
```

---

## Patterns to Mirror

### SERVER_COMPONENT_FETCH (await auth, parallel reads, user-scoped)
```tsx
// SOURCE: src/app/workout/[id]/page.tsx:17-23
const userId = await requireUserId();
const { id } = await params;
const [workout, unit] = await Promise.all([
  getWorkoutDetail(userId, id),
  getWeightUnit(userId),
]);
if (!workout) notFound();
```

### SEED_LOGGER_FROM_DETAIL (the reuse target)
```tsx
// SOURCE: src/app/workout/[id]/edit/page.tsx:25, 41
const { draft, name } = detailToDraft(workout, unit)
// ...
<WorkoutLogger workoutId={id} initialDraft={draft} initialName={name} unit={unit} />
```

### DETAIL_TO_DRAFT (already pure + unit-aware + tested)
```tsx
// SOURCE: src/app/workout/new/workout-draft.ts:166-182
export function detailToDraft(
  workout: WorkoutDetail,
  unit: WeightUnit = 'kg',
): { draft: WorkoutDraft; name: string } {
  const exercises = workout.exercises.map((exercise) => ({
    id: exercise.id, wgerExerciseId: exercise.wgerExerciseId, name: exercise.name, category: '',
    sets: exercise.sets.map((set) => ({
      id: set.id,
      reps: set.reps?.toString() ?? '',
      weight: set.weight === null ? '' : kgToDisplay(set.weight, unit).toString(),
    })),
  }))
  return { draft: { exercises }, name: workout.name ?? '' }
}
```

### ACTION_ISLAND_LINK_BUTTON (Link styled as a button)
```tsx
// SOURCE: src/app/workout/[id]/workout-actions.tsx:36-41
<Link
  href={`/workout/${id}/edit`}
  className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
>
  Edit
</Link>
```

### HOME_HISTORY_ROW (current Link-wraps-row markup to refactor)
```tsx
// SOURCE: src/app/page.tsx:51-77
<li key={w.id}>
  <Link href={`/workout/${w.id}`} className="flex items-center justify-between gap-3 px-4 py-4 ...">
    <span className="min-w-0">{/* name + meta */}</span>
    <svg /* chevron */ />
  </Link>
</li>
```

### TEST_STRUCTURE (e2e harness)
```ts
// SOURCE: e2e/last-time.spec.ts:24-55
test.beforeAll(async () => { /* create +clerk_test user via Clerk API; insert user_preferences unit='kg' */ })
test.afterAll(async () => { /* delete workouts (cascade), prefs, then Clerk user */ })
// in test: page.goto('/sign-in'); await clerk.signIn({ page, emailAddress: TEST_EMAIL })
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/app/workout/new/page.tsx` | UPDATE | Accept `?from=<id>`, fetch + seed the draft via `detailToDraft` |
| `src/app/workout/[id]/workout-actions.tsx` | UPDATE | Add primary "Repeat" link; reflow Edit/Delete below it |
| `src/app/page.tsx` | UPDATE | Add per-row Repeat icon-link beside the chevron |
| `e2e/repeat.spec.ts` | CREATE | E2E: log a workout → repeat it → assert seeded values → save as a distinct workout |

## NOT Building
- **Server-side repeat attribution / analytics** — the PRD's "Repeat adoption" metric needs a way to mark a workout as repeat-sourced; that's an analytics concern (PRD explicitly defers dashboards) and would require a schema column. Out of scope; no migration here.
- **A `repeatWorkout` Server Action that pre-creates a workout id** — unnecessary; saving the seeded draft already creates a fresh, distinct workout via the existing `saveWorkoutAction` path. (The PRD's "create new workout id from source" is satisfied at save time, not at repeat time.)
- **Resetting/copying `completed` flags** — the draft model has no per-set "completed" concept in the logger; seeded sets are plain editable values. No-op.
- **Repeat from the "last time" ghost surface** — separate feature (phase 2), already shipped.
- **Carrying over `completedAt`/timestamps** — a new save gets fresh `startedAt`/`createdAt` by schema default.

---

## Step-by-Step Tasks

### Task 1: Seed the new-workout page from `?from=<id>`
- **ACTION**: Make `NewWorkoutPage` read an optional `from` search param and seed the logger when it resolves to an owned workout.
- **IMPLEMENT**:
  ```tsx
  // module scope — guards against malformed ids hitting the uuid column (see GOTCHA)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  export default async function NewWorkoutPage({
    searchParams,
  }: {
    searchParams: Promise<{ from?: string }>
  }) {
    const userId = await requireUserId() // middleware also guards; defense-in-depth
    const { from } = await searchParams
    const [unit, source] = await Promise.all([
      getWeightUnit(userId),
      from && UUID_RE.test(from) ? getWorkoutDetail(userId, from) : Promise.resolve(undefined),
    ])
    const seed = source ? detailToDraft(source, unit) : undefined

    return (
      // ...unchanged header/main...
      <WorkoutLogger unit={unit} initialDraft={seed?.draft} initialName={seed?.name} />
    )
  }
  ```
- **MIRROR**: SERVER_COMPONENT_FETCH (parallel reads), SEED_LOGGER_FROM_DETAIL.
- **IMPORTS**: add to `src/app/workout/new/page.tsx`:
  `import { getWorkoutDetail } from '@/db/workouts'` and
  `import { detailToDraft } from './workout-draft'`. (`getWeightUnit`, `requireUserId`, `WorkoutLogger` already imported.)
- **GOTCHA**:
  - `getWorkoutDetail` compares against a `uuid` column; a malformed `from` (e.g. `?from=abc`) makes Postgres throw `invalid input syntax for type uuid` and 500s the page. The `UUID_RE` guard short-circuits that. A well-formed but non-existent/foreign id returns `undefined` (user-scoped `where`), which falls back to an empty draft — exactly the forgiving behavior we want for stale links.
  - Passing `initialDraft={undefined}` is intentional: the prop default (`emptyDraft`) applies when the value is `undefined` (same for `initialName` → `''`).
  - `searchParams` must be `await`ed (Next 15).
- **VALIDATE**: `npx tsc --noEmit` clean; visiting `/workout/new?from=<own workout id>` pre-fills inputs; `/workout/new?from=garbage` and `/workout/new?from=<other user's id>` render an empty logger (no error).

### Task 2: Add the Repeat action to the detail page
- **ACTION**: In `WorkoutActions`, add a full-width primary "Repeat" link above the Edit/Delete row.
- **IMPLEMENT**:
  ```tsx
  return (
    <div className="mt-6 space-y-2">
      <Link
        href={`/workout/new?from=${id}`}
        className={cn(buttonVariants(), 'w-full')}
      >
        ↻ Repeat workout
      </Link>
      <div className="flex gap-2">
        {/* existing Edit link + Delete button unchanged */}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
  ```
- **MIRROR**: ACTION_ISLAND_LINK_BUTTON (`buttonVariants()` default variant for primary).
- **IMPORTS**: none new — `Link`, `buttonVariants`, `cn` already imported in this file.
- **GOTCHA**: Keep the component a client component as-is (Delete needs it); the Repeat `Link` is plain navigation, no action/transition needed. Use a unicode glyph or an inline `svg` consistent with the file's existing icon style — do NOT add an icon dependency.
- **VALIDATE**: Detail page shows Repeat above Edit/Delete; clicking navigates to `/workout/new?from=<id>`.

### Task 3: Add a Repeat affordance to each home history row
- **ACTION**: Refactor the history `<li>` so the row info links to detail and a separate Repeat icon-link sits beside the chevron (avoid nesting interactives).
- **IMPLEMENT**:
  ```tsx
  <li key={w.id} className="flex items-center">
    <Link
      href={`/workout/${w.id}`}
      className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-4 transition-colors active:bg-muted/60"
    >
      <span className="min-w-0">{/* name + meta — unchanged */}</span>
    </Link>
    <Link
      href={`/workout/new?from=${w.id}`}
      aria-label={`Repeat ${w.name ?? "Workout"}`}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-sm" }),
        "mr-2 shrink-0 text-muted-foreground",
      )}
    >
      {/* ↻ glyph or small inline svg, aria-hidden */}
    </Link>
  </li>
  ```
  Move the existing chevron `svg` inside the detail `Link` (keep it as the affordance that the row opens detail), or drop it in favor of the layout — keep it for visual continuity.
- **MIRROR**: HOME_HISTORY_ROW, ACTION_ISLAND_LINK_BUTTON.
- **IMPORTS**: `buttonVariants` and `cn` are already imported in `src/app/page.tsx`.
- **GOTCHA**: Two sibling `<Link>`s in one `<li>` — do not nest the Repeat link inside the detail link (invalid + breaks tap targets). Give the Repeat link an `aria-label` (icon-only). Preserve the `divide-y`/rounded list styling on the `<ul>`; the dividers are applied between `<li>`s via `divide-border` and are unaffected by the `<li>` becoming a flex container.
- **VALIDATE**: Each row shows a Repeat icon; tapping it goes to `/workout/new?from=<id>`; tapping the row body still opens detail; keyboard focus reaches both links.

### Task 4: E2E — repeat flow
- **ACTION**: Add `e2e/repeat.spec.ts` mirroring the last-time harness (kg-pinned `+clerk_test` user, Supabase teardown).
- **IMPLEMENT** (single test):
  1. Create user (kg pin) in `beforeAll`; sign in.
  2. Start workout, add an exercise (search `bench`), fill `Set 1 reps`=`5`, `Set 1 weight in kg`=`100`, optionally add a Set 2 with `8`/`60`, Save → land on `/`.
  3. Open the workout's detail (click the history row), click **Repeat workout**.
  4. `await expect(page).toHaveURL(/\/workout\/new\?from=/)`.
  5. Assert seeded **values** (not placeholders): `await expect(page.getByLabel('Set 1 reps')).toHaveValue('5')` and `('Set 1 weight in kg')` → `'100'` (kg pin makes this exact).
  6. Edit one field (e.g. weight → `102.5`), Save → land on `/`.
  7. Assert two history rows now exist (count list items / detail links increased to 2).
  - Also assert the Repeat icon-link exists on a home row: `page.getByRole('link', { name: /repeat/i })`.
- **MIRROR**: TEST_STRUCTURE (`e2e/last-time.spec.ts:1-106`) — copy `beforeAll`/`afterAll`, change `TEST_EMAIL` prefix to `e2e+clerk_test_rep_${STAMP}`.
- **IMPORTS**: `import { test, expect } from '@playwright/test'`, `import { clerk } from '@clerk/testing/playwright'`, `import postgres from 'postgres'`.
- **GOTCHA**: Use `toHaveValue` (seeded = real value) not `toHaveAttribute('placeholder', …)`. Pin unit to kg so `100 kg` round-trips exactly. Disambiguate the history-row selector if both "Repeat" links and detail links match a name regex — prefer `getByLabel`/`aria-label` for the Repeat link.
- **VALIDATE**: `npm run test:e2e -- repeat` passes (requires the live Clerk dev + Supabase env, same as existing e2e).

---

## Testing Strategy

### Unit Tests
No new pure function is introduced — the seeding logic is `detailToDraft`, already covered:

| Existing test | Input | Expected | Edge case? |
|---|---|---|---|
| `workout-draft.test.ts` "maps a saved workout to an editable draft" | persisted workout (fractional + blank set) | strings, `null→''`, ids reused | yes (blank set) |
| `workout-draft.test.ts` "converts stored kg weights to the display unit (lb)" | 100 kg, unit `lb` | `'220.5'` | yes (unit conversion) |
| `workout-draft.test.ts` "falls back to an empty name" | name `null` | `''` | yes |

The new code is page-level wiring (Server Components + markup), verified by the Task 4 e2e rather than unit tests — consistent with how the `new`/`edit` pages are covered in this repo.

### Edge Cases Checklist
- [ ] `?from` absent → empty draft (current behavior preserved)
- [ ] `?from=<malformed>` → empty draft, no 500 (UUID guard)
- [ ] `?from=<another user's id>` → empty draft (user-scoped query returns undefined)
- [ ] `?from=<deleted id>` → empty draft
- [ ] Source workout with a blank set / blank name → seeds blanks / empty name
- [ ] Source weights render in the user's current unit (kg vs lb)
- [ ] Seeded fields suppress "last time" ghost placeholders (values present)
- [ ] Home row: Repeat link and detail link are independently focusable/tappable

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
npm test
```
EXPECT: All pass (108 existing remain green; `detailToDraft` coverage already covers seeding)

### Lint
```bash
npm run lint
```
EXPECT: Clean

### Build
```bash
npm run build
```
EXPECT: Succeeds; `/workout/new` still listed as a dynamic route

### E2E (live Clerk dev + Supabase)
```bash
npm run test:e2e -- repeat
```
EXPECT: repeat spec passes

### Manual Validation
- [ ] Log a workout with 2 exercises and a few sets
- [ ] From home, tap the row's Repeat icon → logger pre-filled; save → new row appears (now 2)
- [ ] From detail, tap "Repeat workout" → same seeding
- [ ] Toggle unit to lb, repeat a kg-logged workout → seeded values shown in lb
- [ ] Visit `/workout/new?from=not-a-uuid` → empty logger, no error

---

## Acceptance Criteria
- [ ] `/workout/new?from=<owned id>` opens the logger pre-seeded with that workout's exercises + sets (in the user's unit)
- [ ] Repeat is reachable from both the detail page and each home history row
- [ ] Saving a seeded draft creates a distinct new workout (source untouched)
- [ ] Invalid/foreign/deleted `from` degrades to an empty draft with no error
- [ ] All validation commands pass; no type/lint errors

## Completion Checklist
- [ ] Code follows discovered patterns (Server Component fetch, action-island links, `detailToDraft` reuse)
- [ ] Error handling matches codebase (graceful fallback, no thrown 500 on bad input)
- [ ] Tests follow the e2e harness pattern
- [ ] No hardcoded values beyond the UUID regex constant
- [ ] No new dependencies
- [ ] No unnecessary scope additions (no new action, no schema change)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Malformed `from` 500s the page via uuid cast | M | M | `UUID_RE` guard before querying (Task 1) |
| Nested interactives on home row break a11y/taps | M | M | Sibling `<Link>`s, not nested; `aria-label` on icon link (Task 3) |
| Seeded values confused with "last time" ghosts | L | L | Seeded fields hold real values; placeholders only render on empty fields — no overlap |
| Repeat-adoption metric not measurable post-ship | M | L | Out of scope here; note that attribution needs a future schema/analytics addition |

## Notes
- **PRD open question sidestep**: "Last time definition (most recent vs. completed)" does not affect Repeat — the user explicitly chooses the source workout by id, so there's no most-recent ambiguity to resolve here.
- **Why query param over a Server Action**: seeding is a read, idempotent, and shareable as a URL; pre-creating a workout id up front would orphan rows if the user backs out. Saving the seeded draft through the existing `saveWorkoutAction` is the natural "create a distinct new workout" moment.
- **Phase parallelism**: per the PRD, phase 3 is independent of phases 2 and 4; this plan touches the draft-creation surface only and does not conflict with the shipped phase 2 logger changes.
