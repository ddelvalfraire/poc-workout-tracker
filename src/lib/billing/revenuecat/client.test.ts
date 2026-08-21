import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchCustomerSnapshot,
  clearCatalogCacheForTests,
  RetryableBillingError,
} from './client'

/**
 * The API v2 read against a mocked global fetch: response shapes are the
 * documented ones (customer.active_entitlement items carry the entitlement
 * OBJECT id; the catalog resolves ids to lookup keys).
 */

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

const CATALOG = {
  object: 'list',
  items: [
    { object: 'entitlement', id: 'entl_max', lookup_key: 'max' },
    { object: 'entitlement', id: 'entl_pro', lookup_key: 'pro' },
  ],
  next_page: null,
}

function activeEntitlements(items: unknown[]): unknown {
  return { object: 'list', items, next_page: null }
}

beforeEach(() => {
  clearCatalogCacheForTests()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('RC_API_V2_KEY', 'sk_test_synthetic')
  vi.stubEnv('RC_PROJECT_ID', 'proj_synthetic')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchCustomerSnapshot', () => {
  it('maps active entitlements through the catalog to tiers and sourceRefs', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          activeEntitlements([
            {
              object: 'customer.active_entitlement',
              entitlement_id: 'entl_max',
              expires_at: 1789999999000,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, CATALOG))

    const snapshot = await fetchCustomerSnapshot('user_01SYNTHETIC')
    expect(snapshot).toEqual({
      userId: 'user_01SYNTHETIC',
      source: 'revenuecat',
      entitlements: [
        {
          tier: 'max',
          sourceRef: 'user_01SYNTHETIC:max',
          endsAt: new Date(1789999999000),
          detail: 'entitlement=max',
        },
      ],
    })
    // Bearer auth on every call.
    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.authorization).toBe('Bearer sk_test_synthetic')
  })

  it('treats a 404 customer as an empty snapshot once the catalog proves the config sees the project', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(200, CATALOG))
    const snapshot = await fetchCustomerSnapshot('user_01UNKNOWN')
    expect(snapshot.entitlements).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('REFUSES an empty snapshot when the catalog 404s — a wrong project id must not revoke anyone', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 404 })) // customer fetch: wrong project 404s like unknown customer
      .mockResolvedValueOnce(new Response('', { status: 404 })) // catalog: proves the config cannot see the project
    await expect(fetchCustomerSnapshot('user_01SYNTHETIC')).rejects.toBeInstanceOf(
      RetryableBillingError,
    )
  })

  it('REFUSES an empty snapshot when the catalog is empty — half-configured project, nothing attestable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, activeEntitlements([])))
      .mockResolvedValueOnce(jsonResponse(200, { object: 'list', items: [], next_page: null }))
    await expect(fetchCustomerSnapshot('user_01SYNTHETIC')).rejects.toBeInstanceOf(
      RetryableBillingError,
    )
  })

  it('treats a missing expires_at as lifetime', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          activeEntitlements([
            { object: 'customer.active_entitlement', entitlement_id: 'entl_pro' },
          ]),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, CATALOG))
    const snapshot = await fetchCustomerSnapshot('user_01SYNTHETIC')
    expect(snapshot.entitlements[0].endsAt).toBeNull()
  })

  it('skips an entitlement whose id maps to no tier instead of failing the customer', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          activeEntitlements([
            {
              object: 'customer.active_entitlement',
              entitlement_id: 'entl_typo',
              expires_at: 1789999999000,
            },
            {
              object: 'customer.active_entitlement',
              entitlement_id: 'entl_max',
              expires_at: 1789999999000,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(200, CATALOG))
    const snapshot = await fetchCustomerSnapshot('user_01SYNTHETIC')
    expect(snapshot.entitlements).toHaveLength(1)
    expect(snapshot.entitlements[0].tier).toBe('max')
  })

  it('throws RetryableBillingError on 429/5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))
    await expect(fetchCustomerSnapshot('user_01SYNTHETIC')).rejects.toBeInstanceOf(
      RetryableBillingError,
    )
  })

  it('throws RetryableBillingError on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(fetchCustomerSnapshot('user_01SYNTHETIC')).rejects.toBeInstanceOf(
      RetryableBillingError,
    )
  })

  it('throws RetryableBillingError when unconfigured — fail the event, never grant nothing silently', async () => {
    vi.stubEnv('RC_API_V2_KEY', '')
    await expect(fetchCustomerSnapshot('user_01SYNTHETIC')).rejects.toBeInstanceOf(
      RetryableBillingError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches the catalog across calls', async () => {
    const items = activeEntitlements([
      {
        object: 'customer.active_entitlement',
        entitlement_id: 'entl_max',
        expires_at: 1789999999000,
      },
    ])
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, items))
      .mockResolvedValueOnce(jsonResponse(200, CATALOG))
      .mockResolvedValueOnce(jsonResponse(200, items))
    await fetchCustomerSnapshot('user_01SYNTHETIC')
    await fetchCustomerSnapshot('user_01SYNTHETIC')
    // 3 calls total: entitlements + catalog + entitlements — no second catalog fetch.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
