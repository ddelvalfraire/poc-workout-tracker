# Review: RevenueCat webhook PR 1 (worktree-rc-spike, commits d9b3e3f + 03cbcce)

**Reviewed**: 2026-08-21
**Branch**: worktree-rc-spike → main
**Scope**: docs/SPIKE-REVENUECAT.md, migration 0053, schema, inbox module,
verify module, RC types, webhook route, proxy exemption, 3 test files
**Decision**: APPROVE (after fixing the HIGH in-branch)

## Summary

The endpoint matches the spike's architecture and the house idioms
(fail-closed constant-time auth, insert-first inbox, thin route). One HIGH
found and fixed before this record: an env-handling bug that the tests were
green *around* rather than against.

## Findings

### CRITICAL
None.

### HIGH
1. **`expectedEnvironment()` honored an empty-string env var** (`??` instead
   of `||`): `RC_EXPECTED_ENVIRONMENT=''` became "expect `''`", which
   silently sends EVERY event down the ignored-environment path. Compounding
   it, route tests stubbed exactly that empty string and asserted only
   status codes — both the accepted and the ignored path return 200, so the
   accepted path was never actually exercised while the suite stayed green.
   **Fixed**: `||` fallback with a comment; tests now assert the response
   body discriminant (`accepted: true` vs `ignored: 'environment'`), assert
   `markIgnored` was NOT called on the accept path, and a dedicated test
   pins empty-string-means-unset.

### MEDIUM
None.

### LOW (accepted, recorded — not fixed)
1. **A thrown `recordEvent` (DB down) surfaces as an unhandled 500** rather
   than a deliberate 503. Same effect on RC (non-200 → retry), so accepted;
   PR 2's processor will bring structured failure handling anyway.
2. **`countDeadLetters` tallies lifetime totals** — orphaned rows never
   leave the count, so naive alerting would fire forever. Deferred to PR 3,
   where the alerting semantics live; noted so it is designed, not
   discovered.
3. **No rate limiting on the endpoint** (house checklist item). Accepted:
   the route is auth-gated with constant-time compares and does at most one
   insert for unauthenticated traffic (none — 401 precedes the DB); RC
   publishes no source IPs to scope a limiter to, and limiting the real
   caller loses events. Revisit if the endpoint ever handles per-event
   fan-out.
4. **Sandbox events on prod are stored before the environment filter** —
   deliberate (dedupe must precede everything), but it means the prod inbox
   accrues ignored sandbox rows. The 90-day payload trim (PR 3) bounds it.

## Validation

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint, new files) | Pass |
| Tests (full suite) | Pass — 5008/5008 pre-fix; 35 targeted post-fix |
| Build | Not run (no build-relevant config change) |

## Files reviewed

- docs/SPIKE-REVENUECAT.md — Added
- drizzle/0053_thankful_energizer.sql (+ meta) — Added (additive only)
- src/db/schema.ts — Modified (new table, additive)
- src/db/rc-webhook-events.ts / .test.ts — Added
- src/lib/billing/revenuecat/verify.ts / .test.ts — Added
- src/lib/billing/revenuecat/types.ts — Added
- src/app/api/webhooks/revenuecat/route.ts / .test.ts — Added
- src/proxy.ts — Modified (public route entry)
