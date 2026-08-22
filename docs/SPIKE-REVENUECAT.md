# Spike: RevenueCat integration scope

RevenueCat is the settled billing vendor (needed for IAP either way; see the
billing-vendor decision record). This spike answers: **what do we implement,
what does RC own, and which decisions remain open.** Doc claims below were
fetched from RC's current docs in Aug 2026; URLs at the end.

## The shape: RC is one more adapter, not a source of truth

Nothing about the entitlement layer changes. RC plugs into the existing seam:

```
RC webhook ──▶ /api/webhooks/revenuecat ──▶ applyGrant() ──▶ entitlements_current
                (verify, dedupe, map)          (unchanged)        (unchanged)
```

This is not us fighting the vendor — RC's own webhooks doc recommends exactly
this pattern: treat the webhook as a trigger, re-fetch the customer from their
REST API, and sync into your own database. Our `expires_at`-checked-on-read
projection also matches RC's model: entitlements are expiration-timestamp
based, so a lapsed grant needs no event to stop granting (their `EXPIRATION`
event is advisory; `expiration_at_ms` is authoritative).

## RC concepts → our concepts

| RC | Ours | Mapping |
|---|---|---|
| Entitlement (project-scoped, arbitrary string id) | Tier | RC entitlements named `pro` and `max`. NOT feature keys — `applyGrant` grants a tier; the tier→feature map stays ours in `tiers.ts`. |
| Product (per-store SKU) | — | RC-only. Products attach to entitlements in the RC dashboard. |
| Offering / Package | — | RC-only paywall presentation. |
| Customer `app_user_id` | Our WorkOS user id | Always `configure(apiKey, userId)` — never let the SDK run anonymous (anonymous ids cause alias churn and transfer hazards). |
| Webhook event | `applyGrant` input | See adapter below. |

## What we implement

1. **Webhook route** — `src/app/api/webhooks/revenuecat/route.ts`
   - Verify the per-endpoint Authorization header AND the HMAC signature
     (`X-RevenueCat-Webhook-Signature`, timestamp + HMAC-SHA256 over the raw
     body, constant-time compare — same discipline as the cron secret).
   - Drop `environment: SANDBOX` events in prod (same stream, only this field
     distinguishes them).
   - Dedupe on event `id` (retries reuse the same id; delivery is
     at-least-once with NO ordering guarantee — 5 retries at 5/10/20/40/80m).
   - On entitlement-bearing events, **re-fetch the customer's active
     entitlements from API v2** rather than trusting the event payload
     (the same refetch-don't-trust rule already recorded for Stripe in
     docs/ENTITLEMENTS.md), then call `applyGrant`.
2. **Grant mapping**
   - `source: 'revenuecat'` — a new `GrantSource` value (enum + migration).
     Chosen over mapping RC's `store` field onto `apple`/`google`/`stripe`
     because RC Web Billing's store is `RC_BILLING` (no clean existing
     source), and because the `(source, sourceRef)` dedupe invariant should be
     scoped to the one adapter that actually writes it. The per-store origin
     (`APP_STORE` / `PLAY_STORE` / `STRIPE` / `RC_BILLING`) goes in the
     grant's `reason`, so the ledger still says where the money moved.
   - `sourceRef`: **`{rcCustomerId}:{entitlementId}`** — NOT the store's
     transaction id. Google Play immediate product changes arrive as a *new*
     purchase (new transaction lineage) while App Store keeps the lineage, and
     transfers re-home the subscription; keying on transaction ids would
     fragment the idempotence key across those. Customer+entitlement is the
     stable identity of "this user's access to this tier". A renewal that
     moves `expiration_at_ms` supersedes the prior grant window via
     `applyGrant`'s existing path; redeliveries with unchanged terms come
     back `deduplicated: true` for free.
   - `endsAt`: the entitlement's expiration. Normal lapse needs no event —
     expiry is enforced at read time. **But `EXPIRATION` must still be
     processed**: a refund surfaces as `CANCELLATION` (reason refund) then
     `EXPIRATION`, and RC pulls the entitlement *immediately* while our
     stored `endsAt` is still in the future — re-projecting on `EXPIRATION`
     closes the grant. `CANCELLATION` alone revokes nothing (auto-renew off;
     access runs to period end).
3. **TRANSFER handling** — the one event that must actively revoke: a restore
   on a second account moves the subscription and the webhook fires **only
   for the destination user** (`transferred_from` / `transferred_to`). The
   adapter revokes the source user's live `revenuecat` grants and grants the
   destination. Also: set project restore behavior to **"Transfer if there
   are no active subscriptions"** — safest given we always identify with our
   own user id.
4. **Web purchase surface** — `@revenuecat/purchases-js` on the plan page
   (client island), `purchase()` on a package; grant lands via the webhook,
   not the client response. (Engine choice is an open decision — below.)
5. **Env + config** — `REVENUECAT_WEBHOOK_AUTH`, webhook signing secret, API
   v2 secret key (v1 keys don't work with v2). Dashboard setup: project,
   entitlements `pro`/`max`, products, offering, webhook endpoint.
6. **Tests** — adapter mapping (event → ApplyGrantInput), signature
   verification, dedupe, TRANSFER revoke+grant, sandbox filtering. The
   `applyGrant` layer below the seam is already tested.

## What RC owns (what we do NOT build)

- Store receipt validation and Apple/Google subscription lifecycle plumbing
  (the entire reason RC was chosen — App Store Server Notifications and Play
  RTDN adapters never get written).
- Cross-platform subscription status: iOS later = add the App Store app to
  the same RC project, attach StoreKit products to the same `pro`/`max`
  entitlements, same `app_user_id`. **The webhook adapter needs zero changes**
  — iOS events arrive on the same endpoint with `store: APP_STORE`.
- Checkout UI (hosted Web Purchase Links or Web Paywalls, if we want them),
  dunning/billing-issue retries, price experiment tooling.

## Cost

Free under $2,500 monthly tracked revenue; 1% of MTR on Pro above that. Web
Billing transactions additionally bear Stripe's 2.9% + $0.30 (RC adds no
extra platform fee for web). At current scale: $0.

## Webhook architecture (researched 2026-08-21)

The design that survived research, sized for one Vercel project with no queue
infrastructure. RC facts confirmed from current docs: 60s response window,
5 retries at 5/10/20/40/80 min reusing the same event `id`, at-least-once,
no ordering guarantee, and an official recommendation to re-fetch customer
state after any webhook rather than trust the payload.

### Sync, inline, 5xx-as-retry — no queue

Verify → inbox insert → RC API fetch → `applyGrant` → 200, all inline. The
critical path is one HTTP call and one transaction against a 60s budget.
**RC's five retries ARE the retry queue**: any transient failure (RC 5xx/429,
DB error) returns 5xx and lets RC redeliver — ~2.5h of durable retry with
zero infrastructure. Never ack-then-process via `after()`/`waitUntil`: once
we return 200 RC never retries, so a failed deferred grant is silently lost.
Permanent failures (unknown user, unmappable payload) return **200** with the
inbox row marked, or they burn all five retries on something retrying can't
fix. Outages longer than the retry window are the backstop cron's job.

### Inbox table: `rc_webhook_events`

Insert-first dedupe, Stripe's own documented pattern. Columns: `id` (RC event
id, PK — retries reuse it, so this is the dedupe key), `type`,
`app_user_id`, `environment`, `payload` jsonb, `received_at`,
`processed_at`, `status` (`received`→`processed`|`ignored`|`failed`|
`orphaned`), `attempts`, `last_error`. `INSERT … ON CONFLICT DO NOTHING`
first; an existing `processed`/`ignored` row → 200 immediately. The inbox is
also the dead-letter table — no separate mechanism. Raw payloads are kept
(RC has no self-serve replay once retries exhaust) with a retention trim
(null the payload after ~90 days) riding the existing cron, and the table
joins the account-deletion purge roster (payloads can carry
subscriber-attribute PII).

### Ordering: fetch inside the lock

Refetch-current-state makes event order irrelevant — with one race left: two
concurrent events fetch, and the staler fetch acquires the user lock second
and wins. RC's API has no version/etag to fence with. **Fix: the RC API
fetch happens inside the per-user advisory-lock critical section** (lock →
fetch `GET /projects/{id}/customers/{id}/entitlements` → map → grant →
commit). Every projection is then derived from a fetch made after the
previous writer committed — monotonic by construction. Costs one HTTP call
of lock hold time (bound it with a fetch timeout so a hung call can't pin
the connection). Implementation note: `applyGrant` currently opens its own
transaction and takes the lock internally — the processor needs a seam
change (accept an external tx/lock, or a sibling entry point) rather than a
behavior change. The payload only routes (which user, which event class);
the fetch decides grant contents. Rate limit (480 rpm on customer reads) is
~8 entitlement events/sec sustained — not a real constraint, and a 429
becomes a 5xx that RC's backoff absorbs.

### Event triage

Everything collapses to "could this change entitlements? → re-project".

- **Re-project (grant path):** `INITIAL_PURCHASE`, `RENEWAL`,
  `NON_RENEWING_PURCHASE`, `UNCANCELLATION`, `PRODUCT_CHANGE` (immediate and
  deferred both come out right because the fetch is truth),
  `SUBSCRIPTION_EXTENDED`, `REFUND_REVERSED`, `TEMPORARY_ENTITLEMENT_GRANT`
  (honor it: RC grants ≤24h during store outages; refusing punishes paying
  users, and expiry-at-read self-limits it).
- **Re-project (revoke path):** `EXPIRATION` (the refund case — see grant
  mapping above), `TRANSFER` (the one payload-driven mutation: revoke every
  `transferred_from` user's revenuecat grants, re-project every
  `transferred_to`; the webhook only fires for the destination user).
- **Log-only, 200:** `CANCELLATION` (auto-renew off — optionally store a
  will-not-renew flag for UX), `SUBSCRIPTION_PAUSED` (Play; revocation
  arrives as `EXPIRATION` with reason `SUBSCRIPTION_PAUSED`),
  `BILLING_ISSUE` (grace period keeps access), `TEST`, `INVOICE_ISSUANCE`,
  paywall/experiment/price-consent events, and **any unknown type** (never
  5xx on unknown — that would burn retries forever as RC adds types).

### Security

- Raw body first: `await req.text()`, verify, then parse — never
  `req.json()` first (re-serialization breaks the signature).
- **Both layers**: constant-time Authorization header check (the cron
  route's `timingSafeEqual` idiom) as the cheap first reject, then HMAC:
  header `X-RevenueCat-Webhook-Signature: t=<ts>,v1=<hex>`, signed string
  `"<ts>.<raw body>"`, 5-minute replay tolerance. NOTE: signatures are a
  **Pro-plan feature** — on the free plan the Authorization header is the
  only layer, which is another reason it must be required.
- Rotation: RC has no dual-secret overlap window; accept an optional
  `_OLD` secret env var to rotate gaplessly.
- No IP allowlist — RC publishes no source IPs (confirmed by RC staff).
- Environment filter before processing: sandbox and prod share one stream,
  distinguished only by `environment`; a sandbox purchase must never grant
  prod access. Route goes in `PUBLIC_ROUTES` (src/proxy.ts) like the cron.

### Failure modes + backstop

- Unknown `app_user_id` (a deleted account with a live store subscription —
  a real state given Clerk/WorkOS-last deletion ordering): mark `orphaned`,
  200, warn. Nobody to grant to; the store keeps billing; heals via
  reconciliation if the account returns.
- Dead letters = `failed` rows with exhausted attempts or stale `received`
  rows; the existing cron counts them and the orphans, and alerts.
- **Reconciliation cron (build it):** RC has no "all active entitlements
  across the project" endpoint, so reconcile from our side — iterate active
  `revenuecat` grants (plus recent), refetch each customer, re-project
  mismatches through the same fetch-inside-lock path. Daily; also catches
  events lost beyond RC's retry horizon. This backstop is what makes every
  "return 200 and move on" decision above safe.

### Edge cases (adversarial pass, 2026-08-21)

Three design changes fell out of walking the edge cases:

1. **Re-project is a SET DIFF, not applyGrant calls.** `applyGrant` has no
   notion of absence: a refund pulls the entitlement at RC, the refetch
   returns nothing active, but the existing grant row is still live with a
   future `endsAt`. The processor must diff — fetched entitlements not
   granted → grant; live `revenuecat` grants absent from the fetch → revoke
   ("absent from RC on re-project"). Without this the refund path silently
   fails despite handling `EXPIRATION`.
2. **TRANSFER re-projects, never blind-revokes.** Revoking on payload
   say-so made TRANSFER the one event where a forged request could remove
   access. Instead: re-project every user in `transferred_from` ∪
   `transferred_to` through the same fetch-inside-lock path. Result: NO
   event class trusts the payload for grant contents — a forged webhook can
   neither grant nor revoke, it can only cause a re-fetch of truth. This is
   the property that makes the free-plan (no-HMAC) posture tolerable.
3. **The backstop cron must also sweep the inbox.** Sweeping active grants
   misses a lost `INITIAL_PURCHASE` — a new subscriber has no grant row to
   sweep. The cron additionally reprocesses `failed` / stale-`received`
   inbox rows (the row carries `app_user_id`). Plus an ops action on
   /ops/billing: "re-sync this user from RC" — covers the only invisible
   case (event never received, retries exhausted) via a support ticket.

Verified-absorbed (no change): concurrent same-user events (lock +
fetch-inside-lock), concurrent duplicate deliveries (unique constraint;
both process idempotently), death mid-processing (no response → RC
retries), grace periods, deferred downgrades, lifetime purchases
(`endsAt: null`), trials (tier granted during trial — intended), request
replay (event-id dedupe).

Policy calls, decided later but recorded now:

- **Anonymous purchases can't be healed.** Never mount the purchase
  surface before auth. Resolver rule: if `app_user_id` isn't ours, accept
  exactly one WorkOS-shaped id from `aliases`; zero or several → orphan +
  warn, never guess.
- **RC promotional entitlements are a bypass of the ops comp discipline**
  (fetch-as-truth would import them without reason/actor). Policy: comps go
  through /ops/billing only; RC's promotional grants stay unused.
- **Double-subscribe visibility moves to RC's dashboard.** The
  `customerId:entitlementId` sourceRef collapses web+iOS double-purchases
  into one grant row — the ledger no longer shows both. Amends the
  docs/ENTITLEMENTS.md promise; accepted.
- **Delete-then-re-register with a live sub**: correct that the new account
  gets nothing (entitlements purge on deletion by design). Runbook: RC API
  v2 customer transfer to the new id, then ops re-sync.
- Implementation-phase check: confirm in sandbox whether
  `TEMPORARY_ENTITLEMENT_GRANT` shows in the API refetch; if not, it is
  the single payload-built grant, bounded at 24h.

### Prior art checked

The OSS landscape is weak: RC's official Firebase extension validates and
projects entitlements as a set (same philosophy as ours) but has no dedupe
and predates HMAC; typical community Next.js handlers verify nothing and
mutate per-event (an anti-pattern catalog). The strongest prior art is
Stripe's own webhook-consumer guidance, which this design follows.

## Code blueprint (layers, seams, signatures)

House style applies throughout: modules and functions, not classes (except
Error subclasses); pure logic separated from transactional code; Zod at
boundaries; thin routes. The vendor-neutral core is designed so a Stripe (or
direct-Apple) adapter later adds a folder, not a refactor.

### Layer map

```
edges        route.ts        cron rider          ops action
                └───────────────┼───────────────────┘
orchestration           processor.ts  (per-vendor)
                                │
vendor         verify.ts   client.ts   map.ts   types.ts   (per-vendor)
                                │ produces
contract              EntitlementSnapshot  ──▶  reconcileSnapshot()   (pure)
                                │
persistence    projectFromVendor()  ──▶  applyGrantInTx / revokeGrantInTx
               rc-webhook-events inbox          (existing, seam change)
```

### Layer 0 — existing code, minimal seam change

- `src/lib/entitlements/tiers.ts`: add `'revenuecat'` to `GrantSource`.
- `src/db/entitlements.ts`: extract the transactional cores so a caller can
  compose them under ONE lock/transaction (fetch-inside-lock needs this):

```ts
// extracted from the bodies of applyGrant/revokeGrant; public fns now wrap these
applyGrantInTx(tx: Tx, input: ApplyGrantInput): Promise<ApplyGrantResult>
revokeGrantInTx(tx: Tx, input: { grantId; reason; actorId }): Promise<...>
listLiveGrantsInTx(tx: Tx, userId: string, source: GrantSource): Promise<EntitlementGrant[]>
```

  Behavior of `applyGrant`/`revokeGrant` is unchanged; this is extraction,
  not redesign. `reproject` already runs per-write and needs no change.

### Contract — `src/lib/billing/snapshot.ts` (vendor-neutral, pure)

The adapter interface is a DATA shape plus one pure function — not an OO
interface. Any vendor that can produce a snapshot plugs in.

```ts
/** What a vendor says one user currently holds. The unit of truth-transfer. */
export interface SnapshotEntitlement {
  tier: Tier
  sourceRef: string          // stable per-vendor identity, e.g. `${rcCustomerId}:${entitlementId}`
  startsAt: Date
  endsAt: Date | null        // null = lifetime
  detail: string             // human context for the grant reason, e.g. 'store=APP_STORE product=max_annual'
}
export interface EntitlementSnapshot {
  userId: string
  source: GrantSource
  entitlements: SnapshotEntitlement[]
}

/** The set diff — the heart of re-projection. Pure; exhaustively unit-tested. */
export function reconcileSnapshot(
  live: readonly EntitlementGrant[],      // live grants for (userId, source) only
  snapshot: EntitlementSnapshot,
): ReconcilePlan

export interface ReconcilePlan {
  toGrant: ApplyGrantInput[]              // in snapshot, not live (applyGrant supersedes term changes itself)
  toRevoke: Array<{ grantId: string; reason: string }>  // live, absent from snapshot
}
```

- Same `(sourceRef)` present with changed terms → goes in `toGrant`;
  `applyGrantInTx`'s existing supersede path handles it. Absent → `toRevoke`
  (reason `'absent from vendor on re-project'`).

### Persistence — `src/db/billing.ts` + `src/db/rc-webhook-events.ts`

```ts
// src/db/billing.ts — the ONE place fetch-inside-lock is implemented
export async function projectFromVendor(
  userId: string,
  source: GrantSource,
  fetchSnapshot: () => Promise<EntitlementSnapshot>,  // called INSIDE the lock
): Promise<ResolvedEntitlement>
// tx → lockUser → snapshot = await fetchSnapshot() → live = listLiveGrantsInTx
// → plan = reconcileSnapshot(live, snapshot) → apply/revoke InTx → commit.
// Every writer for a vendor-sourced grant goes through here: webhook
// processor, reconciliation cron, ops re-sync. One code path, one ordering
// guarantee.
```

```ts
// src/db/rc-webhook-events.ts — the inbox (schema per architecture section)
export type InboxDisposition = 'new' | 'retry' | 'already-done'
export async function recordEvent(e: { id; type; appUserId; environment; payload }): Promise<InboxDisposition>
// INSERT ON CONFLICT DO NOTHING; on conflict read status:
// processed|ignored → 'already-done'; received|failed → 'retry' (attempts++)
export async function markProcessed(id: string): Promise<void>
export async function markIgnored(id: string): Promise<void>
export async function markOrphaned(id: string, note: string): Promise<void>
export async function markFailed(id: string, error: string): Promise<void>
export async function listReprocessable(opts): Promise<InboxRow[]>   // failed + stale 'received' — cron backstop
export async function countDeadLetters(): Promise<{ failed: number; orphaned: number }>  // alerting
```

### Vendor module — `src/lib/billing/revenuecat/`

```ts
// types.ts — Zod schemas; the ONLY place RC's wire shapes exist
export const rcEventSchema = z.object({ ... })        // envelope: api_version, event{ id, type, app_user_id, aliases, environment, ... }
export type RcEvent = z.infer<typeof rcEventSchema>
export const rcEntitlementsResponseSchema = z.object({ ... })  // API v2 customer entitlements

// verify.ts — pure given inputs; both layers, fail closed
export function verifyAuthorization(header: string | null, expected: string): boolean  // timingSafeEqual, cron idiom
export function verifySignature(
  rawBody: string,
  header: string | null,          // 't=<ts>,v1=<hex>'
  secrets: string[],              // [current, old?] for gapless rotation
  now: Date,                      // injected for testability; 5-min tolerance
): boolean

// client.ts — the API v2 read; the injected fetchSnapshot
export class RetryableBillingError extends Error {}   // drives the 503 path
export async function fetchCustomerSnapshot(appUserId: string): Promise<EntitlementSnapshot>
// GET /projects/{id}/customers/{appUserId}/entitlements, AbortSignal.timeout,
// 404 → empty snapshot (user unknown to RC = holds nothing);
// 429/5xx/network → RetryableBillingError; maps entitlement ids via map.ts.

// map.ts — pure mapping + triage
export const RC_ENTITLEMENT_TIERS: Record<string, Tier> = { pro: 'pro', max: 'max' }
// unknown id → logged + skipped, never a throw (a dashboard typo must not poison every event)
export type EventClass = 'reproject' | 'transfer' | 'log-only'
export function classifyEvent(type: string): EventClass       // unknown types → 'log-only'
export function affectedUserIds(event: RcEvent): { userIds: string[] } | { orphaned: string }
// reproject → resolve ONE id (app_user_id if ours, else exactly one WorkOS-shaped alias; ambiguity → orphaned)
// transfer  → transferred_from ∪ transferred_to, each resolved the same way, unresolvable ids dropped with a warn
```

```ts
// processor.ts — the per-event orchestration; edges stay thin
export type ProcessOutcome =
  | { kind: 'processed' } | { kind: 'ignored' }
  | { kind: 'orphaned'; note: string }
  | { kind: 'retryable'; error: string }
export async function processRcEvent(event: RcEvent): Promise<ProcessOutcome>
// classify → resolve users → for each:
//   projectFromVendor(userId, 'revenuecat', () => fetchCustomerSnapshot(rcCustomerId))
// TRANSFER is just "reproject every affected user" — no payload-driven revoke.
// RetryableBillingError → { retryable }; everything else per triage.

// reconcile.ts — the backstop, same path
export async function reconcileRevenueCat(): Promise<ReconcileReport>
// sweep 1: users with live 'revenuecat' grants → projectFromVendor each
// sweep 2: listReprocessable() inbox rows → processRcEvent again
// returns counts for the cron's response + dead-letter tally for alerting
```

### Edges (all thin — parse, delegate, map outcome to status)

```ts
// src/app/api/webhooks/revenuecat/route.ts   (+ PUBLIC_ROUTES in src/proxy.ts)
export async function POST(req: Request)
// req.text() → verifyAuthorization (401) → verifySignature if secret configured (401)
// → JSON.parse + rcEventSchema (400) → environment mismatch → recordEvent + markIgnored (200)
// → recordEvent: 'already-done' → 200
// → processRcEvent → processed/ignored/orphaned → mark + 200; retryable → markFailed + 503

// cron: reconcileRevenueCat() rides the existing daily cron run (same bearer gate)
// ops:  resyncUserFromRc(userId) server action on /ops/billing — re-asserts
//       isOpsUser, calls projectFromVendor directly. The support runbook button.
```

### Test map (what pins each layer)

- `reconcileSnapshot`: the exhaustive suite — grant/revoke/supersede/lifetime/
  empty-snapshot/refund matrices. Pure, so cheap to be thorough.
- `verify.ts`: signature vectors, tolerance edges, rotation (old secret), tamper.
- `map.ts`: triage table incl. unknown types; alias resolution incl. ambiguity.
- `processor` + inbox: dedupe dispositions, orphan path, retryable → failed.
- `projectFromVendor`: concurrency (two writers, one lock), fetch-throw rolls back.
- Route: integration-style with mocked processor — status-code contract.

### Why no `VendorAdapter` interface

The reusable contract is `EntitlementSnapshot` + `reconcileSnapshot` +
`projectFromVendor`. A future Stripe adapter (hybrid option) or direct-Apple
adapter (DIY option) writes its own verify/client/map/processor against the
same three — different webhook shapes and different truth-fetches make a
shared OO interface a straitjacket that would only ever have one honest
method. If a second adapter reveals real shared structure, extract it then
(YAGNI, per house rules).

### PR mapping

1. **PR 1**: inbox migration + `rc-webhook-events.ts` + route with
   verify/dedupe/env-filter (processor stubbed to `ignored`) + proxy entry.
2. **PR 2**: `GrantSource` migration + Layer-0 extraction + `snapshot.ts` +
   `billing.ts` + vendor module + real processor. (Largest; if >300 lines,
   split the Layer-0 extraction + contract into its own PR.)
3. **PR 3**: `reconcile.ts` + cron rider + dead-letter alerting + ops re-sync.
4. **PR 4** (needs creds + engine decision): purchase surface + sandbox E2E.

## Open decisions (not resolved by this spike)

1. **Which web engine — RESOLVED 2026-08-21: none of them. Web sells Stripe
   DIRECT, with no RC in the web path.** The deciding facts from RC's docs:
   every RC engine puts web revenue into RC's 1% MTR, and the
   Stripe-Billing-through-RC engine additionally bears Stripe Billing's own
   0.7% fee — while Stripe direct pays processing only (2.9% + 30¢). Owning
   the entitlement store makes this the cheap option: the web side becomes a
   Stripe adapter (its own verify/client/inbox folder) into the same
   EntitlementSnapshot → reconcileSnapshot → projectFromVendor contract, and
   RC never needs to see web subscribers because cross-platform status lives
   in our projection. RC is thereby scoped to IAP only — this adapter — and
   its account/dashboard setup defers to iOS-port scoping. (Original
   comparison, for the record: RC Web Billing = RC-hosted catalog, Stripe
   processing, least glue; Stripe Billing integration = catalog in Stripe,
   optional Managed Payments as merchant of record.)
2. **Whether to sell inside the iOS app** — unchanged from the decision
   record (US link-out commission still unsettled after the Dec 2025 Ninth
   Circuit partial reversal; EU external-link entitlement forbids mixing with
   IAP in one app). Decide when scoping the iOS port.
3. **Charging is still gated on the LLC** — the adapter and sandbox testing
   are not.

## Sources

- Web overview: https://www.revenuecat.com/docs/web/overview
- Web SDK: https://www.revenuecat.com/docs/web/web-billing/web-sdk
- Webhooks: https://www.revenuecat.com/docs/integrations/webhooks
- Event types & fields: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- Entitlements: https://www.revenuecat.com/docs/getting-started/entitlements
- User IDs: https://www.revenuecat.com/docs/customers/user-ids
- API v2: https://www.revenuecat.com/docs/api-v2
- Restore behavior: https://www.revenuecat.com/docs/projects/restore-behavior
- Projects: https://www.revenuecat.com/docs/projects/overview
- Pricing: https://www.revenuecat.com/pricing
- Stripe engine / Managed Payments: https://www.revenuecat.com/docs/web/integrations/stripe
