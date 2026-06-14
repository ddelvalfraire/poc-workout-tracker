# Local Review: Unit Preference (kg/lb)

**Reviewed**: 2026-06-14
**Branch**: worktree-feat+unit-preference-kg-lb → main (uncommitted)
**Decision**: APPROVE — all findings resolved (see Resolution below)

## Resolution (applied after review)

All five findings were fixed, plus a product change (default unit → **lb**):

- **M1** — `kgToDisplay` now returns the kg value verbatim (true identity); only
  the lb conversion is rounded. Added a test (`kgToDisplay(1.25,'kg') === 1.25`).
- **L1** — detail & edit pages now `Promise.all` the `getWorkoutDetail` +
  `getWeightUnit` reads.
- **L2** — added `src/app/actions.test.ts` covering the action's guard (rejects
  invalid unit, no write/revalidate) and the persist+revalidate path. A
  `UnitToggle` render test is deferred — the suite runs in the `node` env with no
  jsdom/RTL configured; adding that infra was out of scope.
- **L3** — `UnitToggle` wraps the action in try/catch and surfaces an accessible
  `role="alert"` cue on failure; the active unit is never optimistically changed,
  so the UI stays consistent.
- **L4** — the weight-bound error now reads "…0 and 9999.99 **kg**…".
- **Default unit → lb**: `DEFAULT_WEIGHT_UNIT`, the `user_preferences.unit`
  column default, and the relevant tests all updated; migration regenerated and
  pushed.

Post-fix validation: tsc ✅ · lint ✅ · 100 tests ✅ · build ✅

---

## Original Findings (for the record)

## Summary

Clean, well-scoped implementation that follows the codebase's established
patterns (data-access module as auth boundary, server action validating
`unknown` at the boundary, string↔numeric boundary mappers). Conversion is
correctly centralized in `src/lib/units.ts`; back-compat is preserved on the
save path. One MEDIUM display-precision finding contradicts the "no kg behavior
change" criterion; everything else is LOW. All validation passes.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — kg display silently rounds to 1 decimal place.**
`src/lib/units.ts:19` `kgToDisplay` runs `roundForDisplay` on the kg identity
path too, so the detail page now rounds kg weights to 1dp. A kg user who logged
`1.25 kg` (a real microplate increment) previously saw `8 × 1.25 kg`; they now
see `8 × 1.3 kg` (`src/app/workout/[id]/page.tsx:69`). The *stored* value is
untouched — this is display-only — but it contradicts the plan's acceptance
criterion "kg users see no behavior change (default path is identity)." The
display path is **not** identity for kg.
*Fix options:* (a) preserve precision for kg — `return unit === 'lb' ?
roundForDisplay(weightKg / KG_PER_LB) : weightKg`; or (b) accept it and amend the
criterion to "1dp display is intentional." Recommend (a): it makes the kg path a
true identity and only rounds the genuinely-irrational lb conversions.

### LOW

**L1 — Sequential independent queries on detail/edit pages.**
`src/app/workout/[id]/page.tsx:18,20` and `[id]/edit/page.tsx:18,20` await
`getWorkoutDetail` then `getWeightUnit` though both depend only on `userId`.
Could `Promise.all` to shave one round-trip. Trivial; the unit read is a PK
lookup.

**L2 — No tests for `setWeightUnitAction` or `UnitToggle`.**
The action's validation guard (throw on non-`kg`/`lb`) and the toggle's
no-op-on-same-unit logic are untested. The plan's testing strategy didn't require
them and the action is thin, but the guard is the security boundary for the write
— a single test asserting it throws would be cheap insurance.

**L3 — Toggle action has no error handling.**
`src/components/unit-toggle.tsx:25` calls `setWeightUnitAction` with no
try/catch; a failed call rejects the transition unhandled. Explicitly accepted as
a POC tradeoff in the plan (non-critical control), noted for completeness.

**L4 — Overflow error message is kg-denominated for lb users.**
A large lb entry converts to kg in `draftToInput`, then `parseWorkoutInput`
(`src/lib/workout-input.ts:76`) rejects with "must be a number between 0 and
9999.99" — a kg bound shown to a user thinking in lb. Edge case; acceptable.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | Pass |
| Tests (`vitest run`) | Pass — 96 (20 new) |
| Build (`next build`) | Pass |

## Files Reviewed

| File | Change |
|---|---|
| `src/lib/units.ts` | Added |
| `src/lib/units.test.ts` | Added |
| `src/db/preferences.ts` | Added |
| `src/db/preferences.test.ts` | Added |
| `src/components/unit-toggle.tsx` | Added |
| `src/app/actions.ts` | Added |
| `src/db/schema.ts` | Modified |
| `src/lib/format.ts` / `.test.ts` | Modified |
| `src/app/workout/new/workout-draft.ts` / `.test.ts` | Modified |
| `src/app/workout/new/workout-logger.tsx` | Modified |
| `src/app/workout/new/page.tsx` | Modified |
| `src/app/workout/[id]/page.tsx` | Modified |
| `src/app/workout/[id]/edit/page.tsx` | Modified |
| `src/app/page.tsx` | Modified |
| `drizzle/0001_*.sql`, `meta/*` | Added (generated) |

## Security Review

- Write path (`setWeightUnitAction`) authenticates via `requireUserId()` and
  validates the payload with `isWeightUnit` before persisting — no unvalidated
  input reaches the DB.
- `preferences.ts` is user-scoped (every query filters/keys on `userId`),
  consistent with the workouts module as the authorization boundary.
- Drizzle parameterizes queries — no injection. No secrets, no XSS sinks (unit is
  a constrained literal rendered as text).
