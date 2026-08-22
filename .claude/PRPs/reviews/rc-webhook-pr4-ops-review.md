# Review: RevenueCat ops surface PR (worktree-rc-spike)

**Reviewed**: 2026-08-21
**Branch**: worktree-rc-spike → main
**Scope**: resyncFromRevenueCatAction + resolveRcEventAction (ops actions),
resolveEvent + listDeadLetterRows (inbox), RcResyncButton + RcDeadLetters
components (+stories), /ops/billing wiring, RcResync/RcDeadLetters message
namespaces, storybook action mocks + client-namespace registration
**Decision**: APPROVE

## Summary

The support surface the earlier reviews deferred to: one-click re-sync
through the same fetch-inside-lock path as the webhook (read-repair, so no
armed confirm), and dead-letter resolution with a required reason where the
note carries the attribution (the inbox has no actor column). Resolution is
what finally makes the lifetime dead-letter tally correct alerting — a
resolved row leaves the count.

## Findings

### CRITICAL / HIGH
None. Both actions re-assert isOpsUser; the actor is always the session,
never input; a resolved row is terminal-ignored, so an RC redelivery
dedupes against it; re-sync can only converge the ledger on what RC
attests (and PR 2's empty-snapshot guard protects it from config error).

### MEDIUM
None.

### LOW (accepted, recorded)
1. Re-syncing writes a `tier: free` projection row even for a user RC has
   never seen. Bounded: the button only renders for a looked-up existing
   member, and a free projection row grants nothing.
2. The dead-letter panel repurposes OpsPanel's `degraded` status to mean
   "has rows needing attention" rather than "data source unhealthy" — a
   deliberate stretch; the dot is the point.
3. The page imports listDeadLetterRows directly instead of through a
   lib/ops OpsResult wrapper; the .catch-to-empty (with a log) keeps the
   support lookup alive if the inbox read fails, which is the property the
   envelope exists for.

## Validation

| Check | Result |
|---|---|
| Type check (tsc --noEmit) | Pass (includes MockFidelity stub-drift check) |
| Lint (eslint, changed files) | Pass |
| Tests (full suite) | Pass — 5080/5080 |
| Storybook tests | Pass — 285/285 (incl. the 2 new components) |
| i18n report | No literals in changed files |

## Files reviewed

- src/app/ops/billing/actions.ts / .test.ts — Modified (2 new gated actions)
- src/db/rc-webhook-events.ts — Modified (resolveEvent, listDeadLetterRows)
- src/components/ops/rc-resync-button.tsx / .stories.tsx — Added
- src/components/ops/rc-dead-letters.tsx / .stories.tsx — Added
- src/app/ops/billing/page.tsx — Modified (wiring; dead-letter read degrades
  to empty, never fails the lookup)
- messages/en.json — Modified (RcResync, RcDeadLetters)
- .storybook/mocks/app-actions.ts — Modified (stubs + fidelity asserts)
- src/i18n/client-namespaces.ts — Modified (2 namespaces)
