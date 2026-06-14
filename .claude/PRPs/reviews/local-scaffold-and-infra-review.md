# Local Review: scaffold-and-infra

**Reviewed**: 2026-06-13
**Branch**: feat/scaffold-and-infra (no commits yet — initial scaffold, all files untracked)
**Decision**: APPROVE with comments

## Summary
Clean Next.js 16 + Clerk + Drizzle/Supabase scaffold. Auth is wired correctly
(`src/proxy.ts` is the valid Next 16 middleware convention — build confirms
`ƒ Proxy (Middleware)`), home page adds defense-in-depth via `requireUserId()`,
and no secrets leak into committable files. All four validation checks pass.
Findings are forward-looking infra hygiene, not defects.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
- **Missing startup validation of required env vars** — `src/db/index.ts:6`
  (`process.env.DATABASE_URL!`) and `drizzle.config.ts:12` (`DATABASE_URL_DIRECT!`)
  use non-null assertions. If unset, failure is a cryptic runtime/driver error
  rather than a clear "DATABASE_URL not configured" at boot. Add a small assert or
  a zod env schema. (Global security rule: validate required secrets at startup.)
- **No authorization at the data layer (forward-looking)** — Clerk supplies
  `userId`, but Clerk JWTs are not wired to Postgres, so Supabase RLS is not in
  play. Every query against `workouts` MUST filter `where user_id = <clerk id>`.
  A single missed filter = cross-tenant data exposure (IDOR). Worth deciding now,
  while the DB layer is being scaffolded, whether to enforce via RLS + Clerk JWT
  template or a mandatory repository helper that injects the userId filter.
- **Secret hygiene** — The Supabase DB password was transmitted in plaintext
  during setup and persists in session summaries on disk (outside the repo). The
  repo itself is clean: the live value exists only in `.env.local`, which is
  gitignored and untracked. Recommend rotating the Supabase DB password and
  sourcing it only from `.env.local` going forward.

### LOW
- **Module-level DB client** — `src/db/index.ts:6` instantiates the `postgres`
  client at import time. In dev (HMR) this can accumulate connections across
  reloads. Cache on `globalThis` in non-production. Minor with the transaction
  pooler, but tidy.
- **`weight: real('weight')`** — `src/db/schema.ts:43` uses float4 for a measured
  value; repeated fractional increments (e.g. 2.5 kg) accrue FP rounding.
  `numeric`/`decimal` is more correct. Fine for POC.
- **`sets.completed`** — `src/db/schema.ts:44` is `.default(false)` but not
  `.notNull()`, leaving a tri-state (true/false/null). Add `.notNull()` unless
  null is meaningful.
- **Thin tests** — `src/db/schema.test.ts` is a single table-name smoke test.
  Relations, cascade deletes, and `requireUserId` redirect behavior are untested
  (below the 80% bar). Acceptable for the scaffold phase; expand as features land.

## Validation Results

| Check      | Result |
|------------|--------|
| Type check | Pass   |
| Lint       | Pass   |
| Tests      | Pass (1/1) |
| Build      | Pass   |

## Files Reviewed (all Added)
- src/proxy.ts, src/lib/auth.ts
- src/db/index.ts, src/db/schema.ts, src/db/schema.test.ts
- src/app/layout.tsx, src/app/page.tsx
- src/app/sign-in/[[...sign-in]]/page.tsx, src/app/sign-up/[[...sign-up]]/page.tsx
- src/components/ui/button.tsx, src/lib/utils.ts
- drizzle.config.ts, next.config.ts, vitest.config.ts, tsconfig.json, package.json, .env.example
