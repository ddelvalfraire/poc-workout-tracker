import { z } from 'zod'
import type { EntitlementSnapshot } from '@/lib/billing/snapshot'
import { RC_ENTITLEMENT_TIERS } from './map'

/**
 * The RevenueCat API v2 read side: turn "what does RC say this user holds
 * RIGHT NOW" into an EntitlementSnapshot. This is the fetcher
 * projectFromVendor runs INSIDE the user lock, so it carries its own timeout
 * — a hung call must not pin the connection.
 *
 * Wire shapes verified against the API v2 reference (2026-08-21):
 *   GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements
 *   → { object: "list", items: [{ object: "customer.active_entitlement",
 *       entitlement_id: "entla1b2c3d4e5", expires_at: 1658399423658 }],
 *       next_page, url }
 * `entitlement_id` is RC's OBJECT id, not the human lookup_key — the catalog
 * fetch below resolves ids to lookup keys, cached, because the catalog
 * changes roughly never. `expires_at` is unix ms; absent/null = lifetime.
 * The v2 customer_id is the app_user_id, which for us is the WorkOS user id.
 */

// Host only: RC paths (including the `next_page` values it returns, e.g.
// "/v2/projects/...") already carry the /v2 prefix.
const RC_API_BASE = 'https://api.revenuecat.com'
const FETCH_TIMEOUT_MS = 10_000
const CATALOG_TTL_MS = 5 * 60 * 1000

/** The webhook environment this deployment accepts: PRODUCTION on the prod
 *  deployment, SANDBOX everywhere else, overridable for harnesses. Shared by
 *  the route filter and the reconcile inbox sweep — a sandbox event must not
 *  slip through either door. `||` not `??`: empty-string means unset. */
export function expectedRcEnvironment(): string {
  return (
    process.env.RC_EXPECTED_ENVIRONMENT ||
    (process.env.VERCEL_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX')
  )
}

/** Transient RC-side failure (429/5xx/network/timeout): the caller returns a
 *  5xx so RC's redelivery schedule becomes the retry loop. */
export class RetryableBillingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableBillingError'
  }
}

const activeEntitlementsSchema = z.object({
  items: z.array(
    z
      .object({
        entitlement_id: z.string(),
        expires_at: z.number().nullable().optional(),
      })
      .loose(),
  ),
  next_page: z.string().nullable().optional(),
})

const entitlementCatalogSchema = z.object({
  items: z.array(z.object({ id: z.string(), lookup_key: z.string() }).loose()),
  next_page: z.string().nullable().optional(),
})

function config(): { apiKey: string; projectId: string } {
  const apiKey = process.env.RC_API_V2_KEY
  const projectId = process.env.RC_PROJECT_ID
  if (!apiKey || !projectId) {
    // Config, not weather: retrying cannot fix it, but failing the event
    // (and letting RC retry into the fix) beats silently granting nothing.
    throw new RetryableBillingError('RC_API_V2_KEY / RC_PROJECT_ID not configured')
  }
  return { apiKey, projectId }
}

async function rcGet(path: string, apiKey: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${RC_API_BASE}${path}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (error: unknown) {
    throw new RetryableBillingError(`RC API unreachable: ${String(error)}`)
  }
  if (response.status === 404) return null
  if (!response.ok) {
    // 429 and 5xx are the expected transient cases; an auth/permission 4xx
    // lands here too and also wants eyes rather than a silent skip.
    throw new RetryableBillingError(`RC API ${response.status} for ${path}`)
  }
  return response.json()
}

/** entitlement object id → lookup_key, cached: the catalog is dashboard
 *  config and changes on the order of releases, not requests. */
let catalogCache: { at: number; byId: Map<string, string> } | null = null

async function entitlementLookupKeys(
  apiKey: string,
  projectId: string,
  fresh = false,
): Promise<Map<string, string>> {
  // `fresh` bypasses the cache: the empty-snapshot guard needs a LIVE proof
  // the project is reachable right now, not a cached one a warm cache would
  // rubber-stamp (that gap let a customer 404 revoke a paying user — see the
  // guard below).
  if (!fresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.byId
  }

  const byId = new Map<string, string>()
  let path: string | null = `/v2/projects/${projectId}/entitlements?limit=100`
  while (path) {
    const raw = await rcGet(path, apiKey)
    if (raw === null) {
      // A 404 on the CATALOG is not a fact about any customer — it means our
      // project id or key cannot see the project. Never cache it.
      throw new RetryableBillingError('RC entitlement catalog not found — check RC_PROJECT_ID')
    }
    const page = entitlementCatalogSchema.parse(raw)
    for (const item of page.items) byId.set(item.id, item.lookup_key)
    path = page.next_page ?? null
  }
  catalogCache = { at: Date.now(), byId }
  return byId
}

/** Test seam: the module-level cache survives between vitest cases. */
export function clearCatalogCacheForTests(): void {
  catalogCache = null
}

/**
 * What RC currently attests for one of our users. 404 = RC has never seen
 * this customer = they hold nothing (an empty snapshot, not an error).
 * Entitlement ids that map to no tier are skipped with a warning — a
 * dashboard typo must not poison the whole customer.
 */
export async function fetchCustomerSnapshot(userId: string): Promise<EntitlementSnapshot> {
  const { apiKey, projectId } = config()

  const entitlements: EntitlementSnapshot['entitlements'] = []
  // A 404 on the first page means RC has never heard of this customer —
  // materially different from a 200 with an empty list ("known, holds
  // nothing"). Only the latter may revoke a live grant; see the return.
  let customerKnown = false
  let path: string | null =
    `/v2/projects/${projectId}/customers/${encodeURIComponent(userId)}/active_entitlements?limit=100`
  while (path) {
    const raw = await rcGet(path, apiKey)
    if (raw === null) break // 404: unknown customer — customerKnown stays false
    customerKnown = true
    const page = activeEntitlementsSchema.parse(raw)
    if (page.items.length > 0) {
      const lookupKeys = await entitlementLookupKeys(apiKey, projectId)
      for (const item of page.items) {
        const lookupKey = lookupKeys.get(item.entitlement_id)
        const tier = lookupKey ? RC_ENTITLEMENT_TIERS[lookupKey] : undefined
        if (!lookupKey || !tier) {
          // NEVER skip: an attested entitlement missing from the snapshot is
          // how the set diff REVOKES — a dashboard rename or unmapped id
          // would silently strip every affected subscriber via the nightly
          // sweep. Failing retryable freezes this user's projection (they
          // keep what they have) until the mapping is fixed, and the
          // dead-letter view makes the mismatch loud. (Review finding,
          // pr-295-review.md HIGH-2.)
          throw new RetryableBillingError(
            `RC entitlement ${item.entitlement_id} (${lookupKey ?? 'unknown key'}) maps to no tier — fix RC_ENTITLEMENT_TIERS or the dashboard before projecting`,
          )
        }
        entitlements.push({
          tier,
          sourceRef: `${userId}:${lookupKey}`,
          endsAt: item.expires_at == null ? null : new Date(item.expires_at),
          detail: `entitlement=${lookupKey}`,
        })
      }
    }
    path = page.next_page ?? null
  }

  if (entitlements.length === 0) {
    // An empty snapshot REVOKES still-granting rows downstream, so it must
    // be a fact about the customer, not an artifact of misconfiguration. A
    // customer 404 (unknown customer, a wrong project id, or an id that was
    // migrated without the RC-side transfer) reads exactly like "holds
    // nothing". The guard is a LIVE catalog fetch (fresh, never the cache):
    // a wrong/unreachable project 404s or empties it → RetryableBillingError,
    // which freezes the user's projection instead of revoking. `fresh` is the
    // point — a cached catalog would rubber-stamp every 404 in a nightly
    // sweep after the first user warmed it. (Adversarial finding M1.)
    const catalog = await entitlementLookupKeys(apiKey, projectId, true)
    if (catalog.size === 0) {
      throw new RetryableBillingError(
        'empty snapshot with an empty entitlement catalog — refusing to attest; check RC config',
      )
    }
  }

  // customerKnown rides along: an empty snapshot for an UNKNOWN customer
  // (404) must not revoke a live grant — projectFromVendor turns that into a
  // freeze. An empty snapshot for a KNOWN customer (200, empty list) is a
  // real cancel/expire and revokes as normal.
  return { userId, source: 'revenuecat', entitlements, customerKnown }
}
