# Code Review: MCP Auth & Write Ergonomics (branch `feat/mcp-auth-and-write-ergonomics`)

**Reviewed**: 2026-06-28
**Base**: 8012dfa → HEAD (4 commits, Phases 6/7/5/8)
**Mode**: Local (branch diff vs base), security-reviewer + typescript-reviewer passes
**Decision**: APPROVE with comments (HIGH findings fixed in follow-up commit)

## Summary
Clerk-OAuth auth + not-found/backdate/partial-edit write ergonomics. The
security-critical path — `resolveUserId` token-wins precedence (no impersonation),
user-scoped DB ops via `findOwnedExerciseId` ownership join, leak-safe error split,
and zod/`parseWorkoutInput` validation — is correctly implemented. No CRITICAL or
security-HIGH issues. Two quality-HIGH findings were fixed before merge.

## Findings

### CRITICAL
None.

### HIGH (fixed)
- **`patch-tools.ts` `update_set` — `basis as WeightUnit` cast.** The cast was
  logically sound but not enforced by the type system; a future reorder could feed
  `undefined` into `displayToKg` → silent `NaN`. **Fixed**: replaced with structural
  narrowing (`let basis`; resolve inside the `if (weight !== undefined)` block).
- **Truthiness guard on `Date` fields.** `parsedStartedAt ? …` / `meta.startedAt ? …`
  / `input.startedAt ? …` used truthiness on `Date | undefined`, inconsistent with the
  `name` field's `!== undefined` in the same literal. **Fixed**: all switched to
  `!== undefined` in `patch-tools.ts` and `db/workouts.ts`.

### MEDIUM
- **`addSet` max-read + insert race.** **Fixed (`ef7142c`)**: added a `DEFERRABLE
  INITIALLY DEFERRED` unique constraint on `sets(workout_exercise_id, set_number)`
  (schema + migration `0002`). Deferred so `removeSet`'s decrement-renumber — which
  transiently collides mid-statement — still commits, while two concurrent `add_set`
  calls can't commit the same set number. **Owner must run `db:migrate` at deploy**
  (the constraint creation will fail if pre-existing duplicate set numbers exist —
  none should, since all writes go through the sequential-numbering code).
- **Test gap: `add_set` with `weight: null`.** **Fixed (`038670a`)**: test asserts no
  unit lookup and no `unit` echo for an explicit blank weight.
- **`patch-sets.test.ts` mock couldn't assert the update's target table.** **Fixed
  (`ef7142c`)**: the mock now derives the real table name via `getTableName`, so the
  renumber test asserts it targets `sets` (not just that *an* update occurred).

### LOW
- **`verifyToken` silent dev failure / redundant-token comment.** **Fixed (`ef7142c`)**:
  warns in dev when a bearer token is present but Clerk verification fails (so the
  `MCP_DEV_USER_ID` fallback doesn't mask a real token problem); added a comment
  explaining the `token` / `auth()` cross-check.
- UUID regex is "v4-ish" (version/variant bits unchecked) — **deliberately left**: its
  job is to surface a clean not-found for obviously-malformed ids before the DB; the
  ownership join is the real gate, and Postgres accepts all UUID variants anyway.
- `parseStartedAt` dual-mode `Date | string` API — **left**: harmless; the `Date` branch
  serves `parseWorkoutInput`'s contract, the tool layer always passes a validated string.
- **No rate limiting on MCP write endpoints** — **deliberately deferred**: a correct
  implementation (Upstash ratelimit keyed per authenticated user, wrapped around
  `withMcpAuth`) is a design choice + new dependency wiring, not a quick fix, and would
  risk the auth path. Recommended as a separate hardening task before scale.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint src`) | Pass |
| Tests (`vitest run src`) | Pass — 245 tests, 27 files |
| Build (`next build`) | Pass |

## Files Reviewed
23 source files (6 added, 17 modified) across Phases 6/7/5/8 — see
`reports/mcp-auth-and-write-ergonomics-report.md` for the per-file list.
