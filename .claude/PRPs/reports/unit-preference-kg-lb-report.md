# Implementation Report: Unit Preference (kg/lb)

## Summary

Added a per-user weight-unit preference (kg or lb). Weights remain stored
canonically in kg; a single conversion utility (`src/lib/units.ts`) converts to
the user's chosen unit at every display point and back to kg at save time. A
segmented toggle on the home header persists the choice in a new
`user_preferences` table, read server-side so SSR renders the correct unit with
no client flicker.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | — | High — followed established internal patterns |
| Files Changed | 13 (5 created, 8 updated) + generated migration | 18 (8 created, 10 updated) |

The actual count is higher because the plan counted the generated migration as
one item; in practice `db:generate` produced both `drizzle/0001_*.sql` and
`drizzle/meta/0001_snapshot.json` + a `_journal.json` update.

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Conversion utility `units.ts` | ✅ Complete | |
| 2 | Units tests | ✅ Complete | Fixed plan's miscalculated expected value (see Deviations) |
| 3 | `userPreferences` schema | ✅ Complete | |
| 4 | Generate + apply migration | ✅ Complete | Applied via `db:push`, not `db:migrate` (see Deviations) |
| 5 | Preferences data access | ✅ Complete | |
| 6 | Preferences tests | ✅ Complete | |
| 7 | Unit-aware `formatSet` | ✅ Complete | |
| 8 | Extend `format.test.ts` | ✅ Complete | |
| 9 | Unit-aware draft mappers | ✅ Complete | |
| 10 | Extend `workout-draft.test.ts` | ✅ Complete | |
| 11 | Logger accepts `unit` | ✅ Complete | |
| 12 | New-workout page passes unit | ✅ Complete | |
| 13 | Edit page passes unit | ✅ Complete | |
| 14 | Detail page passes unit | ✅ Complete | |
| 15 | Server action + toggle + header | ✅ Complete | |
| 16 | Full verification | ✅ Complete | |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`tsc --noEmit`) | ✅ Pass | Zero type errors |
| Lint (`eslint`) | ✅ Pass | Zero errors |
| Unit Tests (`vitest run`) | ✅ Pass | 96 tests across 13 files (was 76); 20 new |
| Build (`next build`) | ✅ Pass | Compiled + 10 static pages generated |
| Database | ✅ Pass | `user_preferences` created (PK `user_id`, `unit` default 'kg', `updated_at`) |
| Edge Cases | ✅ Pass | default fallback, corrupt-value guard, blank weight, identity kg path |

Manual browser smoke test (toggle persist, lb display, round-trip) not run in
this session — left for the reviewer; the build + unit coverage exercise every
conversion path.

## Files Changed

| File | Action |
|---|---|
| `src/lib/units.ts` | CREATED |
| `src/lib/units.test.ts` | CREATED |
| `src/db/preferences.ts` | CREATED |
| `src/db/preferences.test.ts` | CREATED |
| `src/components/unit-toggle.tsx` | CREATED |
| `src/app/actions.ts` | CREATED |
| `drizzle/0001_sleepy_secret_warriors.sql` | CREATED (generated) |
| `drizzle/meta/0001_snapshot.json` | CREATED (generated) |
| `src/db/schema.ts` | UPDATED (+ `userPreferences`) |
| `src/lib/format.ts` | UPDATED (unit-aware `formatSet`) |
| `src/lib/format.test.ts` | UPDATED (lb cases) |
| `src/app/workout/new/workout-draft.ts` | UPDATED (unit-aware mappers) |
| `src/app/workout/new/workout-draft.test.ts` | UPDATED (lb cases) |
| `src/app/workout/new/workout-logger.tsx` | UPDATED (`unit` prop) |
| `src/app/workout/new/page.tsx` | UPDATED (read + pass unit) |
| `src/app/workout/[id]/edit/page.tsx` | UPDATED (read + pass unit) |
| `src/app/workout/[id]/page.tsx` | UPDATED (read + pass unit) |
| `src/app/page.tsx` | UPDATED (mount `UnitToggle`) |
| `drizzle/meta/_journal.json` | UPDATED (generated) |

## Post-Review Changes

After `/code-review`, all findings were addressed and the **default unit was
changed to lb** (product decision):

- `DEFAULT_WEIGHT_UNIT = 'lb'` and `user_preferences.unit` column default `'lb'`
  (migration regenerated as `0001_parched_joystick.sql` and pushed).
- `kgToDisplay` made a true identity for kg (full precision preserved; only lb
  rounds) — resolves the "no kg behavior change" criterion honestly.
- Detail/edit pages parallelize their two reads with `Promise.all`.
- Added `src/app/actions.test.ts` for the server-action validation guard.
- `UnitToggle` now has try/catch + an accessible failure cue.
- Weight-bound validation error clarified to state the limit is in kg.

Test count rose 96 → 100. tsc / lint / build remain green.

## Deviations from Plan

1. **Units test expected value corrected.** The plan asserted
   `displayToKg(220.5, 'lb') ≈ 100.04`. The exact arithmetic is
   `220.5 × 0.45359237 = 100.017…` → `100.02` at 2dp. The implementation is
   correct per the NIST factor; the test now asserts `100.02`. (Plan arithmetic
   error, not an implementation change.)

2. **Migration applied via `db:push`, not `db:migrate`.** This dev database was
   originally bootstrapped with `db:push`: the `__drizzle_migrations` journal is
   empty even though `workouts`/`sets` exist. Running `db:migrate` therefore
   tries to re-run `0000` and fails with "relation already exists" before it
   reaches `0001`. `db:push --force` was used to sync the additive new table
   (it leaves existing tables untouched). The generated `0001_*.sql` migration
   file is kept as schema documentation / for fresh migrate-based setups.

## Issues Encountered

- `db:migrate` failure (above), resolved by using `db:push` — the workflow this
  DB actually uses.

## Tests Written

| Test File | New Tests | Coverage |
|---|---|---|
| `src/lib/units.test.ts` | 7 | kg/lb conversion both directions, identity, guard |
| `src/db/preferences.test.ts` | 4 | default fallback, valid read, corrupt-value guard, upsert payload |
| `src/lib/format.test.ts` | +3 | lb display, weight-only lb, kg back-compat default |
| `src/app/workout/new/workout-draft.test.ts` | +2 | lb→kg on save, kg→lb on edit pre-fill |

## Next Steps
- [ ] Manual browser smoke test (toggle persist, lb round-trip, edit pre-fill)
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
