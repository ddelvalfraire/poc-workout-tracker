import { test, expect, type Response } from '@playwright/test'
import { gunzipSync } from 'node:zlib'

/**
 * PostHog pipeline, end to end and signed OUT — the anonymous acquisition
 * funnel is the whole point of the /_i proxy, so nothing here signs in.
 *
 * Three layers, each proving the one below it:
 *  1. The /_i rewrite reaches PostHog's real ingest (request fixture, no
 *     browser): a capture POST through the proxy is ACCEPTED (status 1).
 *     This exercises the middleware public-route entry, the trailing-slash
 *     passthrough, and the rewrite in one shot.
 *  2. The browser boots posthog-js through the proxy AND captures through it:
 *     the SDK's lazy chunks arrive from /_i/static, the automatic $pageview
 *     round-trips 200 on load, and an in-app navigation produces a second one.
 *     This proves the proxy path from the BROWSER, which layer 1 cannot, and
 *     it is the anonymous acquisition funnel itself — the whole reason the
 *     proxy exists. Read the bot-signal note on that test before touching it.
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

  // A capture body is compressed (gzip, or base64 when gzip is unavailable),
  // so the event name is not readable in the raw POST data.
  const captureBodyText = (body: Buffer | null): string => {
    if (!body) return ''
    try {
      return gunzipSync(body).toString('utf8')
    } catch {
      const raw = body.toString('utf8')
      const encoded = /^data=([\s\S]*)$/.exec(raw)
      if (!encoded) return raw
      try {
        return Buffer.from(decodeURIComponent(encoded[1]), 'base64').toString('utf8')
      } catch {
        return raw
      }
    }
  }

  // Ingest is /_i/e/ until PostHog's remote config lands and moves it to
  // /_i/i/v0/e/ — that switch happens mid-page-load, so a matcher pinned to
  // either path alone is a race.
  const isCaptureUrl = (url: string) => /\/_i\/(i\/v0\/)?e\//.test(url)

  // The round-tripped $pageview for one path. Matching $current_url as well as
  // the event name is what separates "the pageview for THIS navigation" from
  // one still in flight for the previous page. Compare parsed pathnames rather
  // than substrings: the legal nav also links /health-privacy, which a
  // suffix or `includes` match on '/privacy' would happily accept.
  const pageviewFor = (pathname: string) => (r: Response) => {
    const req = r.request()
    if (req.method() !== 'POST' || !isCaptureUrl(r.url()) || r.status() !== 200) return false
    const body = captureBodyText(req.postDataBuffer())
    if (!body.includes('"$pageview"')) return false
    // A request can carry a batch, so check every $current_url it contains.
    return [...body.matchAll(/"\$current_url"\s*:\s*"([^"]+)"/g)].some((m) => {
      try {
        return new URL(m[1]).pathname === pathname
      } catch {
        return false
      }
    })
  }

  test('browser captures the automatic $pageview through the proxy', async ({ page }) => {
    // posthog-js drops EVERY event when it decides the visitor is a bot, and
    // it decides that from navigator.webdriver plus the UA and userAgentData
    // brands — all of which Playwright sets, headless AND headed. The drop is
    // SILENT (capture() just returns: no log, no request), so without this
    // override the SDK boots, fetches flags, loads its extensions and sends
    // nothing at all, which reads exactly like a broken client. Clearing the
    // signals is what makes the assertions below exercise the real visitor
    // path instead of PostHog's bot filter.
    //
    // This does NOT weaken production: opt_out_useragent_filter stays off in
    // instrumentation-client.ts, so genuine bots are still dropped there.
    // Delete this block and the waits below time out — if you land here from a
    // red build, restore the override rather than relaxing the assertions.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        get: () => ({
          brands: [
            { brand: 'Chromium', version: '141' },
            { brand: 'Google Chrome', version: '141' },
          ],
          mobile: false,
          platform: 'macOS',
        }),
      })
    })

    const sdkChunk = page.waitForResponse(
      (r) => r.url().includes('/_i/static/') && r.status() === 200,
      { timeout: 20_000 },
    )
    const initialPageview = page.waitForResponse(pageviewFor('/privacy'), { timeout: 20_000 })

    // A public APP page, not /sign-in. /sign-in is public but it 307s straight
    // to the identity provider, so the browser ends up on a foreign origin and
    // NONE of our client code runs — including instrumentation-client.ts,
    // which is what boots the SDK. The old spec waited 20s for traffic that
    // could never happen. /privacy is public because signed-out readability is
    // a legal requirement, and it renders our own layout.
    await page.goto('/privacy')

    // The SDK's lazy sub-chunks arrive from /_i/static/, and the pageview it
    // fires on init round-trips 200 through the proxy. That initial capture is
    // not a history change, so this also pins that `defaults: '2026-06-25'`
    // (which sets capture_pageview: 'history_change') still captures on load.
    await sdkChunk
    const pageview = await initialPageview

    // The anonymous-until-consent posture, pinned on the host that used to
    // break it. `defaults: '2026-06-25'` would otherwise set
    // internal_or_test_user_hostname to /^(localhost|127\.0\.0\.1)$/, and the
    // setInternalOrTestUser() that fires on a match persists $epp — after
    // which every event is person-processed and a profile exists with no
    // identify() ever called. instrumentation-client.ts opts out; this fails
    // if that opt-out is dropped or a future `defaults` bump re-enables it.
    expect(captureBodyText(pageview.request().postDataBuffer())).toMatch(
      /"\$process_person_profile"\s*:\s*false/,
    )

    // The other half of that preset. This link is a next/link, so the second
    // pageview exists only because the SDK patches the History API — no
    // document load happens. A regression that silenced SPA pageviews would
    // take most of the in-app funnel with it and be invisible above.
    const spaPageview = page.waitForResponse(pageviewFor('/terms'), { timeout: 20_000 })
    await page.locator('a[href="/terms"]').first().click()
    await expect(page).toHaveURL(/\/terms$/)
    await spaPageview
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
