import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { ErrorsPanel } from './errors-panel'
import type { OpsResult } from '@/lib/ops/types'
import type { SentryPeriod, SentrySnapshot } from '@/lib/ops/sentry'

/**
 * The headline's second half — "unresolved · 24h" — used to be literal text
 * beside a `{period}` expression, which strands the sentence: the separator
 * and the word order both move in translation. It is ONE message with a
 * `{period}` argument now, and a dropped argument would render the raw
 * pattern.
 */

function snapshot(over: Partial<SentrySnapshot> = {}): OpsResult<SentrySnapshot> {
  return {
    ok: true,
    data: { unresolvedCount: 0, period: '24h', topIssues: [], ...over } as SentrySnapshot,
  }
}

const results = (over: Partial<SentrySnapshot> = {}) =>
  ({ '24h': snapshot(over), '14d': snapshot(over) }) as Record<
    SentryPeriod,
    OpsResult<SentrySnapshot>
  >

const render = (over: Partial<SentrySnapshot> = {}) =>
  renderStaticIntl(<ErrorsPanel results={results(over)} sentryUrl="https://example.test" />)

describe('ErrorsPanel copy', () => {
  test('keeps the window inside the unresolved summary', () => {
    const html = render()

    expect(html).toContain('unresolved · 24h')
    expect(html).not.toContain('{period}')
  })

  test('says the board is clean rather than showing an empty table', () => {
    expect(render()).toContain('No unresolved issues. Clean.')
  })

  test('names the table columns once there are issues', () => {
    const html = render({
      unresolvedCount: 1,
      topIssues: [
        {
          title: 'TypeError',
          culprit: 'app/page',
          level: 'error',
          count: '2',
          userCount: 1,
          permalink: 'https://example.test/1',
          firstSeen: '2026-03-04T10:00:00.000Z',
          lastSeen: '2026-03-04T11:00:00.000Z',
        },
      ],
    } as Partial<SentrySnapshot>)

    expect(html).toContain('Issue')
    expect(html).toContain('Events')
    expect(html).toContain('Users')
    expect(html).toContain('First')
    expect(html).toContain('Last')
  })

  test('resolves every key it references', () => {
    expect(render()).not.toMatch(/ErrorsPanel\.[a-zA-Z.]+/)
  })
})
