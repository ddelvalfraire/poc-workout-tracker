import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { OpsPanel } from './panel'

/**
 * The unconfigured line is a `t.rich` message: the sentence wraps the env var
 * in a <code> element, and English happens to put it in the middle. Splitting
 * it into "Set" + <code> + "to light this up." froze that word order, so
 * these assert the ONE message renders its tag AND keeps the surrounding
 * words attached to it.
 */

describe('OpsPanel copy', () => {
  test('renders the unconfigured sentence with the env var inside its code tag', () => {
    const html = renderStaticIntl(
      <OpsPanel id="errors" title="Errors" status="unconfigured" envVar="SENTRY_API_TOKEN" />,
    )

    expect(html).toContain('Set ')
    expect(html).toContain('to light this up.')
    expect(html).toMatch(/<code[^>]*>SENTRY_API_TOKEN<\/code>/)
  })

  test('names each status in words, not just a coloured dot', () => {
    const live = renderStaticIntl(<OpsPanel id="errors" title="Errors" status="ok" />)
    const degraded = renderStaticIntl(<OpsPanel id="errors" title="Errors" status="degraded" />)
    const unconfigured = renderStaticIntl(
      <OpsPanel id="errors" title="Errors" status="unconfigured" envVar="X" />,
    )

    expect(live).toContain('Live')
    expect(degraded).toContain('Unavailable')
    expect(unconfigured).toContain('Not configured')
  })

  test('explains a degraded panel instead of showing an empty body', () => {
    const html = renderStaticIntl(<OpsPanel id="coach" title="Coach" status="degraded" />)

    expect(html).toContain('Upstream did not respond. It refreshes on reload.')
  })

  test('prefixes the stale-serve note', () => {
    const html = renderStaticIntl(
      <OpsPanel
        id="coach"
        title="Coach"
        status="ok"
        staleAt={new Date(Date.now() - 5 * 60_000).toISOString()}
      />,
    )

    expect(html).toContain('as of ')
  })

  test('resolves every key it references', () => {
    const html = renderStaticIntl(
      <OpsPanel id="errors" title="Errors" status="unconfigured" envVar="SENTRY_API_TOKEN" />,
    )

    expect(html).not.toMatch(/OpsPanel\.[a-zA-Z.]+/)
  })
})
