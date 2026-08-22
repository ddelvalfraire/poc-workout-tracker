# Adversarial review — RevenueCat adapter (PR #295)

**Date**: 2026-08-21
**Method**: hostile agent, scoped to break money/access correctness,
concurrency, forgeability. Out of scope (already fixed): the four
pr-295-review.md findings. Every claim required a proof (failing test or
reproduced trace on the scratch DB).
**Outcome**: 0 CRITICAL, 1 proven access-loss (M1), 3 LOW. Crown-jewel
properties held.

## Fixed (commit bac0c1e)

### M1 — customer 404 revoked a paying user (access loss). PROVEN, FIXED.
A customer 404 from RC produced an empty snapshot indistinguishable from a
real cancel (200 + empty list), so `reconcileSnapshot` put the still-live
grant in `toRevoke` and the user dropped to Free. The empty-snapshot config
guard could not catch it: it read the CACHED catalog, so once any user
warmed the cache in a nightly sweep, every subsequent 404 sailed through.
Realistic trigger: the WorkOS id-rewrite migration + a skipped RC customer
transfer; escalation: RC returning 200-empty for an active customer during
an incident would mass-revoke.
**Fix**: `EntitlementSnapshot.customerKnown` distinguishes 404 (unknown)
from 200-empty (confirmed nothing); `projectFromVendor` freezes (throws,
rolls back, dead-letters) when an unknown customer still has a live grant,
rather than revoking; the guard's catalog probe is now a fresh (uncached)
fetch. Proven closed on the scratch DB (grant → delete RC customer → sync →
grant frozen, user keeps max+coach) and pinned by src/db/billing.test.ts +
client.test.ts.

### L4 — ops re-sync accepted an unvalidated user id. FIXED.
`resyncFromRevenueCatAction` now rejects non-`user_`-shaped ids before
projecting, so an operator typo can't re-project the wrong account.

## Accepted / follow-up (not fixed in this PR)

### L2 — public Web Billing key + app_user_id-shape trust = griefing. ACCEPTED.
`NEXT_PUBLIC_RC_WEB_BILLING_KEY` is browser-exposed (inherent to RC Web
Billing), and `affectedUserIds` trusts any `user_`-prefixed app_user_id. An
attacker who knows a victim's WorkOS id could purchase AS the victim
(attacker pays), planting then refunding a grant to cause an access flicker
and ledger noise. Not theft (attacker pays; a real concurrent sub survives
the refund via entitlement-union). Accepted for now; if it ever matters,
bind purchases to the authenticated session server-side (mint a short-lived
purchase token) rather than trusting the client-supplied app_user_id. In
our own flow the SDK is always configured with the session user id, so this
is only reachable by going around our app directly against RC.

### L3 — permanently-failing inbox rows reprocess forever. FOLLOW-UP.
`listReprocessable` has no attempts cap, so a row that always throws
(RetryableBillingError) is re-fetched from RC on every nightly sweep,
burning the shared 480-rpm budget and never escalating past the flat
dead-letter tally. Low at current volume. Fix when convenient: cap attempts
(RC itself stops at 6) and move exhausted rows to a terminal `dead` status
the sweep skips; surface them distinctly in the ops dead-letter panel.

## Held under attack (negative results)

- **Forgeability**: no event class trusts the payload for grant contents; a
  forged/replayed/spoofed webhook (even a TRANSFER naming a victim on both
  sides) can only trigger truth-fetches.
- **Concurrency**: webhook / nightly sweep / ops re-sync / self-sync all
  funnel through `projectFromVendor`'s lock-then-fetch-inside-tx; the later
  commit's fetch is strictly after the earlier commit, so the final
  projection always derives from the freshest truth. The only non-serialized
  shared state (catalog cache) carries no per-customer truth — except as M1
  exploited it, now fixed.
- **Idempotency / precedence**: renewal supersede keeps the partial unique
  index satisfied; `sourceRef` embeds the user id so cross-user collision is
  structurally impossible; lifetime-grant refund revokes correctly;
  manual-comp + revenuecat coexistence resolves by tier then longevity
  without a revenuecat re-project touching the manual grant (set-diff scoped
  by source); clock-skew at expiry absorbed by the `endsAt > now` filter.
