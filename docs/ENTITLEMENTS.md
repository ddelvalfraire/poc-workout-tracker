# Entitlements

What a user is *allowed to do*, as a fact this application owns — never a
question asked of a payment processor at request time.

## Why this is its own system

Three forces make "just read the Stripe subscription" wrong here:

1. **Two payment sources are already planned.** Web goes through Stripe;
   native iOS/Android must go through Apple/Google IAP (store policy, not
   preference). Both have to resolve to one answer to "does this user have
   Max?". Access logic that reads Stripe directly cannot see an IAP customer
   at all.
2. **The processor is not the product.** The Clerk → WorkOS migration is the
   standing proof that a vendor can be replaced. An entitlement we own
   outlives the processor that caused it.
3. **Latency and blast radius.** Every gated render would otherwise depend on
   a third party being up.

The same reasoning that ruled out Clerk Billing rules out WorkOS billing.

## Entitlements are not feature flags

Already-shipped and deliberately separate:

|            | Feature flags (PostHog)      | Entitlements (this)          |
|------------|------------------------------|------------------------------|
| Question   | Is this released to you yet? | Have you paid for this?      |
| Owner      | Rollout                      | Commerce                     |
| Fail mode  | Closed → feature stays dark  | Closed → tier drops to Free  |
| Lifetime   | Deleted once fully rolled out| Permanent                    |

A gated surface may need both. `coach` is the live example: the PostHog
`coach-access` flag decides whether the coach exists for you at all, and the
`coach` entitlement decides whether you may use it. Neither subsumes the
other, and conflating them is how a paying subscriber gets told they have not
paid.

## The model

### Tiers are what we sell; features are what we check

Call sites never ask "is this user Pro?". They ask `hasFeature(userId,
'coach')` or `activeProgramLimit(userId)`. The tier → feature mapping lives in
one table in `src/lib/entitlements/tiers.ts`.

This is what makes a comp, a grandfathered price, or a re-packaged plan a
data change rather than a code change — the reason vendors of this
(Stripe's own Entitlements API included) model features separately from
prices.

### Grants are an append-only ledger

Every reason a user has a tier is a row in `entitlement_grants`: a Stripe
subscription, an Apple transaction, a support comp, a promo. Rows are never
edited to reflect a new truth. Revocation is a status change plus a reason and
an actor — the row that granted it stays legible forever.

This mirrors `consent_events` / `consent_current`, which is already the
repository's house pattern for "a fact with legal weight plus a fast
projection of it".

### `entitlements_current` is a projection, and carries its own expiry

Rewritten inside the same transaction as every grant write. Hot-path reads are
one primary-key lookup.

It stores `expiresAt`, and the read compares it to the clock. A grant that
simply lapses needs no event, no cron, and no webhook to stop granting
access — a stale projection resolves *down*, never up. This is the one piece
of state where being out of date must not be able to hand out something paid
for.

### Precedence when more than one grant is active

Highest tier wins; ties break to the grant that expires last (perpetual last
of all). A user who subscribes on web and again on iOS gets the better of the
two rather than a race, and neither purchase is silently discarded. Refund
coordination for genuine double-purchases is a support action, not an
automatic one — the ops surface shows both grants so a human can see it.

### Failure resolves to Free, not to an error and not to Max

If the projection cannot be read, the user is Free. Free is a real, usable
tier — unlimited logging — so degrading to it keeps the product working
while never leaking a paid feature. This is why Free must stay genuinely
useful: it is also the failure mode.

## The grantor seam

`applyGrant()` is the only way a tier is ever conferred, and it does not know
what caused the grant. Today two callers exist:

- the ops surface (manual comps, support, testing)
- *(pending)* the Stripe webhook adapter

Apple's App Store Server Notifications V2 and Google Play RTDN become two more
adapters that translate a store notification into the same call. Nothing
downstream of `applyGrant` learns a new concept when they land.

### Notes for the payment adapters, from the research

Recorded here so they are not rediscovered later:

- **Stripe does not guarantee webhook ordering.** `customer.subscription.
  updated` can arrive before `created`. Adapters must not treat the event
  payload as current state — refetch the subscription and project *that*.
- **Deduplicate on `event.id`** with a unique constraint, insert-first. A
  collision means it is already handled; return 200.
- **Provision on** `checkout.session.completed` / `invoice.paid` with status
  `active` or `trialing`. **De-provision on** `canceled` and `unpaid`.
  `past_due` deliberately keeps access — that is the dunning window, and
  cutting a customer off mid-retry costs more than it saves.
- **Google Play only reports currently-active subscriptions**; Apple and
  Stripe give full history. Restoration logic cannot assume parity.

## Account deletion

Both tables are purged with the rest of the user's data. They are deliberately
*not* treated like `consent_events`, which survives deletion because it is
legal evidence: Stripe independently retains the record of any actual payment,
and a support comp for a deleted account has no continuing business purpose.

The trade-off accepted: a user could delete and re-register to claim a second
comp. At this scale that is cheaper than retaining billing records nobody
needs.

## Ops

`/ops/billing` is the support surface — user lookup, effective tier, the full
grant ledger, and manual grant/revoke.

It is append-only in the UI as well as the schema: there is no edit, every
action requires a reason, and every action records which operator took it.
Granting Max is giving away money, so it reads like a deliberate act rather
than a toggle.

Gated by `OPS_ALLOWED_USER_IDS` → 404 (never 403), and — as with the rest of
/ops — deliberately not flag-controlled. Admin authz stays in env where a
third-party dashboard outage or compromise cannot widen it.
