# Review: RevenueCat checkout PR 5 (worktree-rc-spike)

**Reviewed**: 2026-08-21
**Branch**: worktree-rc-spike → main
**Scope**: @revenuecat/purchases-js dependency, UpgradePanel (+stories),
PlanSurface checkout slot (+story), plan page wiring (env-gated),
syncMyRcEntitlementsAction (+test), UpgradePanel i18n namespace,
client-namespace + storybook mock/alias registration. Plus the RC project
catalog itself, configured via API v2 (entitlements pro/max by the owner;
products pro_monthly/max_monthly, attachments, and a cleaned default
offering by Claude).
**Decision**: APPROVE

## Summary

Checkout is a client island whose ONLY job is checkout: entitlements never
come from the SDK. The purchase lands via the webhook (durable) and the
self-serve sync action (fast); the page then re-reads OUR store. The panel
is env-gated — no key, and the plan page keeps its honest
"nothing can be bought" notice.

## Findings

### CRITICAL / HIGH
None. The sync action can only act on the session user and can only
converge on what RC attests; the SDK is always configured with the
signed-in WorkOS id (never anonymous); a cancelled checkout is a no-op,
not an error.

### MEDIUM (recorded — a live-launch precondition, not a code defect)
1. **The API-snapshot path has no environment filter.** The webhook drops
   SANDBOX events, but `customer.active_entitlement` carries no
   environment field — so a Test Store purchase grants a REAL tier through
   the sync action / ops re-sync / nightly reconcile. Harmless while every
   purchase is a test purchase by our own accounts; before live launch,
   either move production to its own RC project (recommended, and RC's
   normal pattern) or delete the Test Store app. Recorded in the spike doc
   as a launch precondition.

### LOW (accepted)
1. The panel shows every package in the current offering, including the
   tier the member already holds — buying it again is an RC-side no-op /
   manageable state, and filtering by tier needs package→entitlement
   knowledge the client deliberately does not have.
2. Test Store products carry simulated prices; displayed prices become
   real when Web Billing + Stripe replace the Test Store.
3. `realClient` re-fetches offerings on purchase — one extra API call
   buying freedom from stale-package state; fine at human click rates.

## Validation

| Check | Result |
|---|---|
| Type check (tsc --noEmit, incl. MockFidelity) | Pass |
| Lint (eslint, changed files) | Pass (one react-hooks set-state-in-effect finding fixed during review) |
| Tests (full suite) | Pass — 5090/5090 |
| Storybook tests | Pass — 292/292 (6 new UpgradePanel stories, 1 PlanSurface) |
| Production build | Pass |
| RC catalog (live API) | Verified: pro/max entitlements, products attached, offering holds exactly pro_monthly + max_monthly |

## Files reviewed

- package.json — @revenuecat/purchases-js ^1.53.1
- src/components/plan/upgrade-panel.tsx / .stories.tsx — Added
- src/components/plan/plan-surface.tsx / .stories.tsx — Modified (checkout slot)
- src/app/settings/plan/page.tsx — Modified (env-gated wiring)
- src/app/settings/plan/actions.ts / .test.ts — Added (self-serve sync)
- messages/en.json — Modified (UpgradePanel)
- src/i18n/client-namespaces.ts, .storybook/main.ts, .storybook/mocks/app-actions.ts — registrations
