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
): Promise<Map<string, string>> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.byId

  const byId = new Map<string, string>()
  let path: string | null = `/v2/projects/${projectId}/entitlements?limit=100`
  while (path) {
    const raw = await rcGet(path, apiKey)
    if (raw === null) break
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
  let path: string | null =
    `/v2/projects/${projectId}/customers/${encodeURIComponent(userId)}/active_entitlements?limit=100`
  while (path) {
    const raw = await rcGet(path, apiKey)
    if (raw === null) break // unknown customer → empty snapshot
    const page = activeEntitlementsSchema.parse(raw)
    if (page.items.length > 0) {
      const lookupKeys = await entitlementLookupKeys(apiKey, projectId)
      for (const item of page.items) {
        const lookupKey = lookupKeys.get(item.entitlement_id)
        const tier = lookupKey ? RC_ENTITLEMENT_TIERS[lookupKey] : undefined
        if (!lookupKey || !tier) {
          console.error(
            `[revenuecat] entitlement ${item.entitlement_id} (${lookupKey ?? 'unknown key'}) maps to no tier; skipping`,
          )
          continue
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

  return { userId, source: 'revenuecat', entitlements }
}
