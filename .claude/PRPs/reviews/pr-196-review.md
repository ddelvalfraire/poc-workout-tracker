# PR Review: #196 — feat: pre-deploy migration guard (db:check gates npm run deploy)

**Reviewed**: 2026-08-10
**Author**: ddelvalfraire
**Branch**: feat/migration-guard → main
**Decision**: APPROVE

## Summary
Small, well-scoped pipeline guard born from today's /programs outage: `npm run deploy` now refuses to ship while the DB is missing journal migrations (or is ahead of the checkout). Pure comparison logic is unit-tested; the IO script fails closed.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
- `scripts/check-migrations.ts` uses `console.log/error` — acceptable for a CLI script (the no-console rule targets app code).
- `Number(created_at)` narrows a bigint-as-string; epoch-ms values stay well inside double precision.

## Design notes
- Hash comparison was deliberately dropped after live-fire: migration 0002 was edited after being applied (its DB hash matches no current file), shifting a strict positional hash check into permanent false positives. The shipped guard mirrors drizzle-kit's own apply rule (journal `when` > max applied `created_at`), so it can never be stricter than the migrator it fronts.
- Fail-closed: any error (bad env, unreachable DB, malformed journal) sets exit code 1 — an unverifiable deploy is a blocked deploy.
- The DB-ahead case fails too: deploying a checkout older than the schema is the mirror-image outage.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (`tsc --noEmit`) |
| Lint | Pass (eslint on new files) |
| Tests | Pass (3,026 / 208 files; 6 new) |
| Live-fire | Pass ("in sync (42 journal migrations applied)"); strict draft correctly flagged the pre-fix outage state |

## Files Reviewed
- `src/lib/migration-guard.ts` — Added (pure diff)
- `src/lib/migration-guard.test.ts` — Added (6 tests)
- `scripts/check-migrations.ts` — Added (IO wrapper, fail-closed)
- `package.json` — Modified (`db:check`, `deploy` scripts)
