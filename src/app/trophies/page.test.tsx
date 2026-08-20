import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { emptyEvidence } from '@/lib/trophies'
import { LockedTrophyRow } from './page'

/**
 * The trophy case's copy contract. The page itself is an async server
 * component (auth + db), so the row that owns the surface's only
 * INTERPOLATED string — the progress bar's accessible name — is what gets
 * rendered here, through the real catalog.
 */

const evidence = { ...emptyEvidence(), completedCount: 25 }

describe('Trophies copy', () => {
  test('the progress bar names its percent and its trophy in one message', () => {
    const html = renderStaticIntl(
      <LockedTrophyRow kind="workouts_50" evidence={evidence} unit="kg" />,
    )
    expect(html).toContain('aria-valuenow="50"')
    expect(html).toContain('aria-label="50% toward 50 Workouts"')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(
      <LockedTrophyRow kind="workouts_50" evidence={evidence} unit="kg" />,
    )
    expect(html).not.toMatch(/Trophies\.[a-zA-Z.]+/)
  })
})
