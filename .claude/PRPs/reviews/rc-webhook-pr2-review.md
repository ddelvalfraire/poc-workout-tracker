# Review: RevenueCat processor PR 2 (worktree-rc-spike, commit 4b5fd57 + fix)

**Reviewed**: 2026-08-21
**Branch**: worktree-rc-spike → main
**Scope**: GrantSource + tiers.ts, entitlements.ts extraction (applyGrantInTx /
revokeGrantInTx / listLiveGrantsInTx / reprojectInTx / lockUserInTx),
snapshot.ts + reconcileSnapshot, db/billing.ts projectFromVendor, RC client /
map / processor, route wiring, 5 test files
**Decision**: APPROVE (after fixing the HIGH in-branch)

## Summary

The processor implements the spike's design faithfully: payload routes,
fetched truth decides, fetch-inside-lock, set-diff re-projection. The
extraction preserved applyGrant/revokeGrant behavior (pinned by the existing
27 tests, unchanged). One HIGH found and fixed.

## Findings

### CRITICAL
None.

### HIGH
1. **An empty snapshot was trusted even when it was a misconfiguration.**
   A wrong `RC_PROJECT_ID` (or a key without project access) makes the
   customer fetch 404 exactly like an unknown customer → empty snapshot →
   the reconciler REVOKES the user's still-granting RC rows. Through the
   PR-3 backstop sweep, one bad deploy could mass-revoke every RC
   subscriber. **Fixed**: an empty snapshot is only attestable after the
   entitlement catalog (cheap, cached) proves the config can see the
   project; catalog 404 or empty catalog → RetryableBillingError instead of
   "holds nothing". Pinned by three new client tests.

### MEDIUM
None.

### LOW (fixed or accepted)
1. **Fixed**: extraction left a bare `{}` block inside applyGrantInTx —
   dedented.
2. Accepted: `applyGrant`'s input validation now runs inside the opened
   transaction (was before it) — a validation throw costs one BEGIN/ROLLBACK
   more than before; observable behavior identical.
3. Accepted: multi-user TRANSFER re-projection is sequential; a failure
   midway leaves the first user projected and returns retryable — RC's
   redelivery reprocesses both users idempotently.
4. Accepted: the catalog cache (5-min TTL) means a dashboard rename of an
   entitlement lookup_key can misresolve for up to 5 minutes. Renames are
   not a thing the dashboard flow encourages; events during the window fail
   visibly (unknown id → skip + warn) rather than silently.

## Validation

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint, changed files) | Pass |
| Tests (full suite) | Pass — 5060/5060 |
| Existing entitlements suite | Pass unchanged (27) — extraction is behavior-preserving |

## Files reviewed

- src/lib/entitlements/tiers.ts — Modified (GrantSource + 'revenuecat')
- src/db/entitlements.ts — Modified (extraction; no signature changes)
- src/lib/billing/snapshot.ts / .test.ts — Added
- src/db/billing.ts — Added (projectFromVendor, fetch-inside-lock)
- src/lib/billing/revenuecat/client.ts / .test.ts — Added
- src/lib/billing/revenuecat/map.ts / .test.ts — Added
- src/lib/billing/revenuecat/processor.ts / .test.ts — Added
- src/app/api/webhooks/revenuecat/route.ts / .test.ts — Modified (stub → processor)
