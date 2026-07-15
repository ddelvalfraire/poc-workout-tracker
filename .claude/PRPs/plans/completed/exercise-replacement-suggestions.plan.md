# Plan: Exercise Replacement — Muscle-Matched Suggestions (Phase 2)

## Summary
Zero-thought alternatives in the replace sheet: a pure `rankAlternatives` helper scores the already-loaded wger catalog against the exercise being replaced — shared PRIMARY muscles required, movement-scale parity (compound↔compound / isolation↔isolation, approximated from muscle breadth), same-category boost, same-equipment penalty (the taken machine) — and the picker renders the top picks as a "Suggested" rail while the search box is empty. No new endpoints: `/api/exercises?all=1` already ships full `Exercise` objects (muscles/equipment included); the picker just types more of what it already has.

## User Story
As a lifter replacing a taken machine, I want sensible like-for-like alternatives offered before I type, so the swap takes two taps instead of a search.

## Problem → Solution
Replace mode opens an empty search box — you must know the substitute's name → rank the catalog by similarity to the outgoing exercise and surface the top 5 above the search, with search untouched as the fallback.

## Metadata
- **Complexity**: Small–Medium
- **Source PRD**: `.claude/PRPs/prds/exercise-replacement.prd.md`
- **PRD Phase**: Phase 2 — Muscle-matched suggestions
- **Estimated Files**: 6

---

## Design Decisions

1. **Client-side ranking over the loaded catalog.** Verified: `GET /api/exercises?all=1` returns `getAllExercises()` verbatim (`src/app/api/exercises/route.ts:27-30`) — full `Exercise` objects with `muscles`, `musclesSecondary`, `equipment`, `category`. The picker's `ExerciseResult` interface (`exercise-picker.tsx:8-12`) merely types the subset it uses. Phase 2 widens that interface with the optional fields; no API/server change, no second fetch.
2. **Shared PRIMARY muscle is a hard requirement.** A curl (primary: Biceps) never suggests a row (primary: Back; biceps only secondary) — the PRD's "compounds and isolation don't correlate" rule starts here.
3. **Movement-scale parity via muscle breadth.** wger has no compound flag; approximate: an exercise touching ≥2 distinct muscles (primary + secondary combined) is "compound". Parity (both compound or both isolation) earns a bonus, not a filter — a compound CAN fall back to an isolation when nothing else matches, it just ranks lower.
4. **Same-equipment penalty, not exclusion.** The current machine being taken makes identical equipment less useful, but "Barbell taken" is one rack, not all barbells — a mild penalty reorders, never hides.
5. **Rail renders only in replace mode and only while the search is empty** — typing anything collapses to plain search (the existing behavior, untouched). Unknown current id (or no muscle data) → no rail, search-only; the feature degrades to Phase 1 exactly.
6. **Score = sharedPrimary×3 + parity×2 + sameCategory×1 − sharedEquipment×1**, ties broken by name (localeCompare) for determinism. Integer weights, trivially tunable — the PRD's open ranking question resolves by shipping this and adjusting on feel.

---

## UX Design

### Before
```
Replace Bench Press
[ Add an exercise…          🔍 ]   ← must type to see anything
```

### After
```
Replace Bench Press
SUGGESTED                            ← caps-widest muted label
  Machine Chest Press · Chest  [Add]
  Incline Bench Press · Chest  [Add]
  Dumbbell Bench Press · Chest [Add]
  Push Up · Chest              [Add]
  Cable Fly · Chest            [Add]
[ Add an exercise…          🔍 ]   ← search unchanged; typing hides the rail
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Replace sheet, empty query | Blank under the input | Top-5 suggested rail | Same row layout + Add button as search results |
| Replace sheet, typing | Search results | Search results (rail hidden) | Zero change to search |
| Add mode ("+ Exercise") | — | — | No rail; `suggestFor` absent |
| No muscle data / unknown id | — | No rail | Graceful Phase 1 fallback |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/app/workout/new/exercise-picker.tsx` | all (187) | The component gaining the rail: catalog load, `ExerciseResult`, `matches`/`term` gating, `addExercise`, listbox row layout to reuse |
| P0 | `src/lib/wger.ts` | 38-47 (Exercise interface), 259-272 (getAllExercises/searchExercises) | The data shape being ranked (`muscles?: string[]`, `musclesSecondary?: string[]`, `equipment?: string[]`, `category`) |
| P1 | `src/lib/block-name.ts` + `src/lib/next-program-day.ts` | all | Pure-helper module convention (JSDoc policy statement, co-located test) |
| P1 | `src/app/workout/new/exercise-sheet.tsx` | 16-27, 99-109 | Props pass-through point (`heading` precedent from Phase 1) |
| P1 | `src/app/workout/new/workout-logger.tsx` | sheet render (~925-945, the dual-mode block Phase 1 added) | Where `suggestFor` is supplied from `replaceTargetIndex` |
| P2 | `src/app/api/exercises/route.ts` | 27-30 | Proof the full catalog (muscles included) already reaches the client |
| P2 | `src/app/workout/new/workout-draft.test.ts` | 1-30 | AAA test voice for the new pure-module test |

## External Documentation
None — established internal patterns only.

---

## Patterns to Mirror

### PURE_HELPER_MODULE
```ts
// SOURCE: src/lib/block-name.ts:1-21 (shape), src/lib/next-program-day.ts:7-22 (policy JSDoc)
/** End-anchored and exact-spelled so ... */
const BLOCK_SUFFIX = /\s—\sBlock\s(\d+)$/
export function nextBlockName(name: string): string { ... }
```

### PICKER_ROW (the rail reuses this exact row)
```tsx
// SOURCE: src/app/workout/new/exercise-picker.tsx:160-178
<li key={result.id} ... className="flex items-center justify-between gap-2 px-3 py-2.5 ...">
  <span className="min-w-0 truncate text-sm">
    {result.name}
    <span className="text-muted-foreground"> · {result.category}</span>
  </span>
  <Button size="sm" variant="outline" onClick={() => addExercise(result)}>Add</Button>
</li>
```

### EMPTY_QUERY_GATING (where the rail slots)
```ts
// SOURCE: src/app/workout/new/exercise-picker.tsx:68-79
const term = query.trim().toLowerCase()
const matches = useMemo(() => {
  if (!term) return []
  ...
}, [term, catalog])
```
Rail condition is the complement: `suggestFor !== undefined && !term && !loading && !error`.

### CAPS_SECTION_LABEL
```tsx
// SOURCE: src/app/workout/new/exercise-sheet.tsx:84-86 (sheet label voice)
<p className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-primary">
```
The rail label is the MUTED variant (`text-muted-foreground`, like stats-page section labels) — one volt label per sheet is enough.

### PROP_THREAD (Phase 1's heading precedent)
```tsx
// SOURCE: src/app/workout/new/workout-logger.tsx (dual-mode sheet render, Phase 1)
heading={replaceTargetIndex !== null ? `Replace ${draft.exercises[replaceTargetIndex]?.name ?? 'exercise'}` : undefined}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/exercise-alternatives.ts` | CREATE | Pure `rankAlternatives` + `isCompound` |
| `src/lib/exercise-alternatives.test.ts` | CREATE | TDD for ranking rules |
| `src/app/workout/new/exercise-picker.tsx` | UPDATE | Widen `ExerciseResult` with optional muscle/equipment fields; `suggestFor` prop; Suggested rail |
| `src/app/workout/new/exercise-sheet.tsx` | UPDATE | Pass-through `suggestFor?: number` |
| `src/app/workout/new/workout-logger.tsx` | UPDATE | Supply `suggestFor` in replace mode |
| `.claude/PRPs/prds/exercise-replacement.prd.md` | UPDATE | Phase 2 status at report time |

## NOT Building

- Server-side suggestions / API changes — the catalog is already client-side
- Custom exercises in suggestions (PRD NOT-building; picker is wger-only)
- Equipment-availability profiles — equipment is one ranking signal only
- Suggestions in ADD mode — the rail is a replace-mode affordance (`suggestFor` simply isn't passed)
- Recent-swap quick picks (PRD "Could")
- Tuning UI or persisted weights — integers in code, adjusted by edit

---

## Step-by-Step Tasks

### Task 1: Failing ranking tests (RED)
- **ACTION**: Create `src/lib/exercise-alternatives.test.ts`.
- **IMPLEMENT**: Fixture builder `ex(over)` returning `{ id, name, category: 'Chest', equipment: [], muscles: [], musclesSecondary: [], ...over }`. Cases:
  1. **requires a shared primary muscle**: curl `{ muscles: ['Biceps'] }` vs row `{ muscles: ['Back'], musclesSecondary: ['Biceps'] }` → row EXCLUDED (the PRD's "a curl never suggests a row").
  2. **ranks more shared primaries higher**: candidate sharing 2 primaries beats candidate sharing 1.
  3. **movement-scale parity**: replacing a compound bench `{ muscles: ['Chest'], musclesSecondary: ['Triceps','Shoulders'] }`, a compound press (shares Chest, has secondaries) outranks an isolation fly (shares Chest, no secondaries) when otherwise equal.
  4. **same-category boost**: equal-overlap candidates, same category wins.
  5. **same-equipment penalized**: equal candidates, the one sharing an equipment token with the current ranks below the one that doesn't.
  6. **excludes self**; **unknown currentId → []**; **current without muscle data → []**.
  7. **respects count** (6 qualifying, count 5 → 5) and **deterministic name tiebreak** (identical scores → alphabetical).
  8. **isCompound**: ≥2 distinct combined muscles → true; single-muscle → false; no data → false.
- **MIRROR**: PURE_HELPER_MODULE test voice (AAA, behavior names).
- **VALIDATE**: `npm test -- src/lib/exercise-alternatives.test.ts` → RED.

### Task 2: `rankAlternatives` (GREEN)
- **ACTION**: Create `src/lib/exercise-alternatives.ts`.
- **IMPLEMENT**:
  ```ts
  /** The catalog subset the ranker reads — structurally satisfied by both
   *  wger's Exercise and the picker's widened ExerciseResult. */
  export interface AlternativeCandidate {
    id: number
    name: string
    category: string
    equipment?: string[]
    muscles?: string[]
    musclesSecondary?: string[]
  }

  /** Compound ≈ touches ≥2 distinct muscles (primary + secondary) — wger has
   *  no explicit flag; muscle breadth is the honest proxy. No data → false. */
  export function isCompound(e: AlternativeCandidate): boolean {
    return new Set([...(e.muscles ?? []), ...(e.musclesSecondary ?? [])]).size >= 2
  }

  // Integer weights, deliberately simple/tunable. Parity matters because
  // compound and isolation loads don't correlate (PRD decision); equipment
  // is penalized because the CURRENT machine is the one that's taken.
  const SHARED_PRIMARY_WEIGHT = 3
  const SCALE_PARITY_BONUS = 2
  const SAME_CATEGORY_BONUS = 1
  const SHARED_EQUIPMENT_PENALTY = 1

  /**
   * Alternatives for the exercise being replaced, best first: candidates must
   * share ≥1 PRIMARY muscle (a curl never suggests a row); ranked by primary
   * overlap, movement-scale parity, category, equipment difference; ties
   * break alphabetically (deterministic rails). Unknown id or a current
   * without muscle data → [] — the sheet falls back to search-only.
   */
  export function rankAlternatives(
    currentId: number,
    catalog: readonly AlternativeCandidate[],
    count = 5,
  ): AlternativeCandidate[] {
    const current = catalog.find((e) => e.id === currentId)
    const currentPrimaries = current?.muscles ?? []
    if (!current || currentPrimaries.length === 0) return []
    const currentEquipment = new Set(current.equipment ?? [])
    const currentCompound = isCompound(current)

    return catalog
      .flatMap((candidate) => {
        if (candidate.id === current.id) return []
        const shared = (candidate.muscles ?? []).filter((m) => currentPrimaries.includes(m))
        if (shared.length === 0) return []
        const sharesEquipment = (candidate.equipment ?? []).some((t) => currentEquipment.has(t))
        const score =
          shared.length * SHARED_PRIMARY_WEIGHT +
          (isCompound(candidate) === currentCompound ? SCALE_PARITY_BONUS : 0) +
          (candidate.category === current.category ? SAME_CATEGORY_BONUS : 0) -
          (sharesEquipment ? SHARED_EQUIPMENT_PENALTY : 0)
        return [{ candidate, score }]
      })
      .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
      .slice(0, count)
      .map((s) => s.candidate)
  }
  ```
- **MIRROR**: PURE_HELPER_MODULE.
- **GOTCHA**: `flatMap` + fresh objects — no mutation of catalog entries; the module imports nothing from wger.ts (structural typing keeps it dependency-free and trivially testable).
- **VALIDATE**: Task 1 green; `npx tsc --noEmit`.

### Task 3: Picker rail
- **ACTION**: Update `src/app/workout/new/exercise-picker.tsx`.
- **IMPLEMENT**:
  1. Widen the local interface (the API already sends these fields):
     ```ts
     /** The subset of the `/api/exercises` result this picker surfaces. The
      *  optional muscle/equipment fields are present in the payload and feed
      *  the replace-mode suggestions rail. */
     interface ExerciseResult {
       id: number
       name: string
       category: string
       equipment?: string[]
       muscles?: string[]
       musclesSecondary?: string[]
     }
     ```
  2. Props: `suggestFor?: number` (JSDoc: the exercise being REPLACED — its presence is what makes this a replace-mode picker; suggestions rank against it from the same loaded catalog).
  3. Rail derivation: `const suggestions = useMemo(() => (suggestFor === undefined || term ? [] : rankAlternatives(suggestFor, catalog)), [suggestFor, term, catalog])`.
  4. Render between the error block and the search results, gated `!loading && !error && suggestions.length > 0`:
     ```tsx
     <div>
       <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
         Suggested
       </p>
       <ul aria-label="Suggested replacements"
         className="mt-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
         {suggestions.map((result) => (
           <li key={result.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
             <span className="min-w-0 truncate text-sm">
               {result.name}
               <span className="text-muted-foreground"> · {result.category}</span>
             </span>
             <Button size="sm" variant="outline" onClick={() => addExercise(result)}>Add</Button>
           </li>
         ))}
       </ul>
     </div>
     ```
- **MIRROR**: PICKER_ROW (row markup identical minus the combobox roles — the rail is a plain list, not part of the search listbox), CAPS_SECTION_LABEL (muted variant).
- **IMPORTS**: `rankAlternatives` from `@/lib/exercise-alternatives`.
- **GOTCHA 1**: The rail is NOT part of the combobox a11y model — no `role="option"`, no aria-activedescendant coupling; keyboard search behavior is untouched (arrows/Enter still drive the search listbox only).
- **GOTCHA 2**: `addExercise` already clears the query and fires `onAdd` — the sheet closes via its own onAdd wrapper; nothing extra to wire.
- **VALIDATE**: `npx tsc --noEmit`; `npx eslint src/app/workout/new/exercise-picker.tsx`.

### Task 4: Thread `suggestFor` through sheet + logger
- **ACTION**: Update `exercise-sheet.tsx` and `workout-logger.tsx`.
- **IMPLEMENT**:
  - Sheet: `suggestFor?: number` prop (JSDoc: forwarded to the picker; present only in replace mode), passed to `<ExercisePicker onAdd={...} suggestFor={suggestFor} />`.
  - Logger (the dual-mode sheet render): add
    ```tsx
    suggestFor={
      replaceTargetIndex !== null
        ? draft.exercises[replaceTargetIndex]?.wgerExerciseId
        : undefined
    }
    ```
- **MIRROR**: PROP_THREAD (heading precedent — same conditional shape, same spot).
- **GOTCHA**: `undefined` (not null) when absent so the picker's `suggestFor === undefined` gate reads naturally.
- **VALIDATE**: `npx tsc --noEmit`; `npm run build`.

### Task 5: Full validation
- **VALIDATE**: commands below; diff touches only listed files; manual dev pass.

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| shared-primary requirement | curl vs row (biceps secondary only) | row excluded | core |
| overlap ranks | 2-shared vs 1-shared | 2-shared first | |
| scale parity | compound current: press vs fly | press first | core |
| category boost | equal overlap, same vs other category | same-category first | |
| equipment penalty | equal candidates, shared vs distinct equipment | distinct-equipment first | |
| self excluded | current in catalog | never suggested | ✓ |
| unknown id / no muscles | — | [] | ✓ |
| count + tiebreak | 6 equal-score qualifiers | 5, alphabetical | ✓ |
| isCompound | ≥2 muscles / 1 / none | true / false / false | |

UI rail: no component tests — repo convention (build + manual).

### Edge Cases Checklist
- [x] Current exercise absent from catalog (custom/negative-id stopgap rows) → no rail
- [x] Catalog entries with missing muscle arrays → treated as empty, excluded
- [x] Typing hides the rail; clearing the query brings it back
- [x] Add-mode sheet unaffected (`suggestFor` never passed)
- [x] Suggestion tap flows through the SAME logged-work guard (it goes through `handleReplacePick` like any pick)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
npx eslint src/lib/exercise-alternatives.ts src/lib/exercise-alternatives.test.ts src/app/workout/new
```
EXPECT: zero errors

### Unit Tests
```bash
npm test -- src/lib/exercise-alternatives.test.ts
```
EXPECT: all pass

### Full Test Suite
```bash
npm test
```
EXPECT: 965 existing + new, no regressions

### Build
```bash
npm run build
```
EXPECT: clean

### Manual Validation
- [ ] Replace a machine press → suggested rail shows same-muscle presses before flyes, without typing
- [ ] Replace a curl → only arm/biceps-primary movements appear, never rows
- [ ] Typing collapses the rail into normal search; clearing restores it
- [ ] "+ Exercise" (add mode) shows no rail
- [ ] Suggestion tap on a completed exercise still hits the guard dialog

---

## Acceptance Criteria
- [ ] All tasks complete, TDD order respected
- [ ] Rail only in replace mode with an empty query; search behavior byte-identical otherwise
- [ ] Ranking enforces shared-primary + scale-parity + category + equipment rules deterministically
- [ ] Graceful fallback (no rail) for unknown/muscle-less current exercises
- [ ] Zero new network requests

## Completion Checklist
- [ ] Ranker is pure, dependency-free, integer-weighted (tunable by edit)
- [ ] Rail excluded from the combobox a11y model; own labeled list
- [ ] One volt label per sheet (rail label is muted)
- [ ] Self-contained — no codebase searching during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| wger taxonomy too coarse → mediocre suggestions | M | UX quality | Search one tap away; weights are integers in one file; PRD accepts tune-on-feel |
| Muscle names in the payload don't match across entries (localization/casing) | L | Empty rails | Exact-match on wger's English names (same convention muscleRowsFor relies on); manual pass verifies real rails |
| Rail pushes search below the fold on small screens | L | Cosmetic | Top-5 cap; sheet already scrolls (max-h-[85dvh]) |

## Notes
- Phase 3 (substitute targets) is independent of this plan — different files (server action + logger ghost re-key); parallel-safe per the PRD.
- The `AlternativeCandidate` interface is structural on purpose: custom exercises can feed `custom_exercises` rows (same field names) into the same ranker when `source` threading lands.
