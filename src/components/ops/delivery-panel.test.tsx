import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { DeliveryPanel } from './delivery-panel'
import type { OpsResult } from '@/lib/ops/types'
import type { VercelSnapshot } from '@/lib/ops/vercel'
import type { HealthchecksSnapshot } from '@/lib/ops/healthchecks'

/**
 * Two sources share this panel and each half degrades on its own, so the
 * inline degrade line renders twice with different env vars. It is a `t.rich`
 * message — the env var sits inside a <code> element mid-sentence — which is
 * exactly the shape that used to be three concatenated fragments.
 */

const down = (reason: 'unconfigured' | 'unavailable'): OpsResult<never> => ({ ok: false, reason })

const emptyVercel: OpsResult<VercelSnapshot> = { ok: true, data: { deployments: [] } }
const emptyChecks: OpsResult<HealthchecksSnapshot> = { ok: true, data: { checks: [], downCount: 0 } }

describe('DeliveryPanel copy', () => {
  test('names both sections and their empty states', () => {
    const html = renderStaticIntl(
      <DeliveryPanel vercel={emptyVercel} healthchecks={emptyChecks} />,
    )

    expect(html).toContain('Production deploys')
    expect(html).toContain('Cron checks')
    expect(html).toContain('No production deployments yet.')
    expect(html).toContain('No checks configured.')
  })

  test('renders the unconfigured half as one sentence around its code tag', () => {
    const html = renderStaticIntl(
      <DeliveryPanel vercel={down('unconfigured')} healthchecks={emptyChecks} />,
    )

    expect(html).toContain('Set ')
    expect(html).toContain('to light this up.')
    expect(html).toMatch(/<code[^>]*>VERCEL_API_TOKEN<\/code>/)
  })

  test('names the env var of whichever half is unconfigured', () => {
    const html = renderStaticIntl(
      <DeliveryPanel vercel={emptyVercel} healthchecks={down('unconfigured')} />,
    )

    expect(html).toMatch(/<code[^>]*>HEALTHCHECKS_API_KEY<\/code>/)
  })

  test('explains an unavailable half instead of leaving it blank', () => {
    const html = renderStaticIntl(
      <DeliveryPanel vercel={down('unavailable')} healthchecks={emptyChecks} />,
    )

    expect(html).toContain('Upstream did not respond. It refreshes on reload.')
  })

  test('resolves every key it references', () => {
    const html = renderStaticIntl(
      <DeliveryPanel vercel={down('unconfigured')} healthchecks={down('unavailable')} />,
    )

    expect(html).not.toMatch(/DeliveryPanel\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/OpsPanel\.[a-zA-Z.]+/)
  })
})
