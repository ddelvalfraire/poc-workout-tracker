# PR Review: #259 — feat: GUC-gated consent pseudonymization path (deletion PR 1/2)

**Reviewed**: 2026-08-18
**Author**: ddelvalfraire
**Branch**: feat/consent-pseudonymize → main
**Decision**: APPROVE (with comments)

## Summary
The GUC-gated trigger replacement is correctly scoped: `current_setting('app.consent_pseudonymize', true)` returns NULL when unset (NULL = 'on' is not true → RAISE), `SET LOCAL` dies at commit and is safe under the Supabase transaction pooler, and the sanctioned path does GUC → reconcile → projection delete → pseudonymize in one transaction. Pseudonym is `deleted:` + random uuid — irreversible, single value per deletion. No CRITICAL/HIGH findings.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
- **src/db/consent.ts (`markDownstreamAction`)** — no direct unit test; it is only exercised as a mock in PR 2's orchestration test. A recording-stub test asserting the `completedAt`-only-on-success rule would pin the evidence semantics. Suggested: add alongside the pseudonymize tests.
- **src/db/consent.ts (`pseudonymizeConsentRecords`)** — no advisory lock against a concurrent `recordConsent` for the same user: an event inserted after the UPDATE commits keeps the live user id, and a concurrent projection upsert can re-create a `consent_current` row post-delete. Requires the user consenting in another tab mid-deletion; the orchestrator deletes the Clerk user right after, bounding the window. Acceptable now; consider a user-scoped `pg_advisory_xact_lock` if consent surfaces multiply.

### LOW
- **src/db/consent.test.ts** — the pseudonym regex (`/^deleted:[0-9a-f]{8}-[0-9a-f-]{27}$/`) is looser than a strict uuid pattern; fine as a shape check.
- **drizzle/0049** — a session-level `SET app.consent_pseudonymize = 'on'` by a privileged connection would open the gate for that session. Inherent to the GUC design; the migration comment documents that the threat model is careless migrations/app credentials, not a hostile superuser.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (eslint, changed files) | Pass |
| Tests (`vitest run`) | Pass — 3878/3878 (47 storybook browser suites fail in this worktree from a node_modules path quirk; pre-existing/environmental) |
| Build (`next build`) | Compiles + typechecks; page-data collection fails only on missing `DATABASE_URL` in the worktree (environmental) |

## Files Reviewed
- drizzle/0049_consent_pseudonymize_guc.sql — Added
- drizzle/meta/0049_snapshot.json — Added (generated; copied-forward snapshot, id/prevId chain verified)
- drizzle/meta/_journal.json — Modified (idx 49 entry)
- src/db/consent.ts — Modified (pseudonymizeConsentRecords, markDownstreamAction)
- src/db/consent.test.ts — Modified (stub extensions + 6 new tests incl. SQL-fixture pins)
