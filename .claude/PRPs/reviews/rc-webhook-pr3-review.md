# Review: RevenueCat backstop PR 3 (worktree-rc-spike)

**Reviewed**: 2026-08-21
**Branch**: worktree-rc-spike → main
**Scope**: reconcile.ts + test, cron rider in /api/cron/reminders,
listVendorGrantUserIds (db/billing.ts), trimPayloads (rc-webhook-events.ts),
account-deletion purge coverage (purge-user-data.ts + roster test with
app_user_id drift-guard extension)
**Decision**: APPROVE

## Summary

The backstop closes the loop the earlier reviews were counting on: the
grant sweep re-projects every RC-granted user from vendor truth, the inbox
sweep reprocesses what the webhook path never finished (including the
lost-INITIAL_PURCHASE case, which has no grant row to sweep), payloads age
out at 90 days, and the inbox joined the account-deletion purge with the
drift guard extended to see app_user_id columns.

## Findings

### CRITICAL / HIGH
None. The mass-revoke hazard this sweep could have amplified was already
closed in PR 2's review (empty-snapshot guard); concurrent
cron-vs-webhook processing of the same user/event serializes on the
advisory lock and converges by idempotency.

### MEDIUM
None.

### LOW (accepted, recorded)
1. `listReprocessable` caps at 100 rows/run → a large backlog drains at
   100/day. At current scale unreachable; revisit with volume.
2. `trimPayloads` returns trimmed ids via RETURNING — unbounded memory on
   the very first trim after a long gap. Same scale argument.
3. Dead-letter tally stays lifetime totals (carried from PR 1 review) —
   the log line is the alerting seam until the ops resolve surface lands
   (follow-up PR: ops re-sync + orphan resolution).
4. A reconcile failure does not fail the cron run or block the heartbeat —
   deliberate (reminders were fine; reconcile is idempotent and daily), at
   the cost that ONLY logs surface a permanently-failing reconcile.
5. Sweep 1 and sweep 2 can re-project the same user twice in one run —
   idempotent, two RC calls of waste, not worth deduplicating yet.

## Validation

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass |
| Lint (eslint, changed files) | Pass |
| Tests (full suite) | Pass — 5067/5067 |

## Files reviewed

- src/lib/billing/revenuecat/reconcile.ts / .test.ts — Added
- src/app/api/cron/reminders/route.ts / .test.ts — Modified (rider; runs on
  the no-Redis path too, since reconcile needs no Redis)
- src/db/billing.ts — Modified (listVendorGrantUserIds)
- src/db/rc-webhook-events.ts — Modified (trimPayloads)
- src/db/purge-user-data.ts / .test.ts — Modified (inbox purge + drift guard)
