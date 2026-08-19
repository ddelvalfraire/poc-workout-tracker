import { test, expect } from '@playwright/test'

/**
 * PostHog pipeline, end to end and signed OUT — the anonymous acquisition
 * funnel is the whole point of the /_i proxy, so nothing here signs in.
 *
 * Three layers, each proving the one below it:
 *  1. The /_i rewrite reaches PostHog's real ingest (request fixture, no
 *     browser): a capture POST through the proxy is ACCEPTED (status 1).
 *     This exercises the middleware public-route entry, the trailing-slash
 *     passthrough, and the rewrite in one shot.
 *  2. The browser boots posthog-js through the proxy: the SDK chunk arrives
 *     from /_i/static and the automatic $pageview capture round-trips 200.
 *  3. (Gated on POSTHOG_PERSONAL_API_KEY) the Query API reads the layer-1
 *     event back out — proof of ingestion, not just acceptance.
 *
 * The spec SKIPS (not fails) when NEXT_PUBLIC_POSTHOG_KEY is absent, because
 * the integration is env-gated by design and CI may run keyless.
 */

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

test.describe('PostHog analytics pipeline', () => {
  test.skip(!posthogKey, 'NEXT_PUBLIC_POSTHOG_KEY not set — analytics is off by design')

  test('capture POST through the /_i proxy is accepted by PostHog ingest', async ({
    request,
  }) => {
    // Trailing slash on /e/ is load-bearing: it pins that the middleware's
    // 308 restoration EXCLUDES /_i (a redirect would break the rewrite).
    const res = await request.post('/_i/e/', {
      data: {
        api_key: posthogKey,
        event: 'e2e_proxy_check',
        distinct_id: 'e2e-proxy-check',
        properties: { source: 'playwright' },
      },
    })

    expect(res.status()).toBe(200)
    const body = await res.json()
    // Ingest acks with status "Ok" (older deployments used 1) — accept both.
    expect([1, 'Ok']).toContain(body.status)
  })

  test('browser loads posthog-js via the proxy and the $pageview round-trips', async ({
    page,
  }) => {
    const sdkChunk = page.waitForResponse(
      (r) => r.url().includes('/_i/static/') && r.status() === 200,
      { timeout: 20_000 },
    )
    const capture = page.waitForResponse(
      (r) =>
        r.url().includes('/_i/') &&
        !r.url().includes('/_i/static/') &&
        r.request().method() === 'POST' &&
        r.status() === 200,
      { timeout: 20_000 },
    )

    // Sign-in is public — this is the anonymous visitor path.
    await page.goto('/sign-in')

    await sdkChunk
    await capture
  })

  test('event reads back out of the Query API', async ({ request }) => {
    const personalKey = process.env.POSTHOG_PERSONAL_API_KEY
    const projectId = process.env.POSTHOG_PROJECT_ID
    test.skip(
      !personalKey || !projectId,
      'POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID not set — read-back needs a personal key (Settings -> User -> Personal API keys, query:read scope)',
    )

    // Ingestion is async; poll briefly rather than asserting instantly.
    await expect
      .poll(
        async () => {
          const res = await request.post(
            `https://us.posthog.com/api/projects/${projectId}/query/`,
            {
              headers: { Authorization: `Bearer ${personalKey}` },
              data: {
                query: {
                  kind: 'HogQLQuery',
                  query:
                    "select count() from events where event = 'e2e_proxy_check' and timestamp > now() - interval 1 hour",
                },
              },
            },
          )
          if (!res.ok()) return -1
          const body = await res.json()
          return Number(body.results?.[0]?.[0] ?? 0)
        },
        { timeout: 60_000, intervals: [5_000] },
      )
      .toBeGreaterThan(0)
  })
})
