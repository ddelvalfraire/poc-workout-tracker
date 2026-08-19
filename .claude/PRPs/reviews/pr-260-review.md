# PR Review: #260 — feat: account deletion — settings flow, data purge, processor fan-out (deletion PR 2/2)

**Reviewed**: 2026-08-18
**Author**: ddelvalfraire
**Branch**: feat/account-deletion → feat/consent-pseudonymize
**Decision**: APPROVE (with comments)

## Summary
The orchestration order is failure-honest (evidence event first, Clerk last so auth survives retries; PostHog failure recorded on the evidence row without aborting) and the purge is verified against the schema: all 17 user-keyed ownership roots, every child table rides `onDelete: 'cascade'`, `workouts`' provenance FKs are `set null`, `goals`' exercise ref is denormalized (no FK) — so the delete order cannot hit a restrict. Auth is server-derived (no IDOR surface: the action deletes only `requireUserId()`'s account) and the confirm phrase is re-validated server-side. No CRITICAL/HIGH findings.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
- **src/lib/account-deletion.ts:66 (`deleteObjects(photoBlobKeys)`)** — one DELETE request for all photo keys. A photo-heavy account (hundreds of photos × 2 keys) makes a large request body; if the storage API ever rejects it, deletion blocks at step 3 for exactly those users, and retries hit the same wall. Chunking into batches of ~100 keys would make this untrippable.
- **src/app/settings/delete-account/actions.ts** — no rate limit on the action. Bounded blast radius (a user can only delete their own account, and Clerk deletion kills auth), but each retry appends a withdrawal event + 2 fan-out rows, so a hostile user could inflate `consent_events` by looping the failure path. A modest per-user cap (the coach limiter pattern) would close it.

### LOW
- **src/lib/posthog-person-deletion.ts:36** — only `results[0]` is deleted. PostHog merges persons sharing a distinct_id, so one person is the expected case; a split-person edge would leave a remnant. Acceptable; note it if support tickets ever surface.
- **src/app/settings/page.tsx** — the "Delete account" row is visually identical to the other Data rows (no destructive tint). Deliberate per the row comment (the destination page carries the warning), but worth a design pass if store reviewers expect a red affordance.
- **src/lib/account-deletion.ts (`clearUserRedisKeys`)** — coach rate-limit keys are deleted for today + yesterday only; correct given the 26h TTL, but the coupling to `KEY_TTL_SECONDS` is implicit. A comment cross-reference exists; a shared constant would be sturdier.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (eslint, changed files) | Pass |
| Tests (`vitest run`) | Pass — 3878/3878 incl. 20 new (orchestration sequence/evidence, purge roster pin, PostHog client, action gate) |
| Build (`next build`) | Compiles + typechecks; page-data collection fails only on missing `DATABASE_URL` in the worktree (environmental) |

## Files Reviewed
- src/app/settings/delete-account/page.tsx — Added
- src/app/settings/delete-account/delete-account-form.tsx — Added
- src/app/settings/delete-account/actions.ts — Added
- src/app/settings/delete-account/actions.test.ts — Added
- src/app/settings/delete-account/confirm-phrase.ts — Added
- src/app/settings/page.tsx — Modified (Data-zone LinkRow)
- src/lib/account-deletion.ts — Added
- src/lib/account-deletion.test.ts — Added
- src/lib/posthog-person-deletion.ts — Added
- src/lib/posthog-person-deletion.test.ts — Added
- src/db/purge-user-data.ts — Added
- src/db/purge-user-data.test.ts — Added
- .env.example — Modified (POSTHOG private-pair comment)
