import { describe, expect, test, vi } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { BodyweightLogForm } from './log-form'
import { BodyweightEntryRow } from './entry-row'

/**
 * The weigh-in input and one history row. Both carry unit-dependent copy —
 * the label and the placeholder change with the display unit, so the unit is
 * an ICU argument rather than two hardcoded English strings.
 */

describe('BodyweightLogForm', () => {
  test('the label names the display unit', () => {
    expect(renderStaticIntl(<BodyweightLogForm unit="kg" />)).toContain('Today’s weight (kg)')
    expect(renderStaticIntl(<BodyweightLogForm unit="lb" />)).toContain('Today’s weight (lb)')
  })

  test('the placeholder example follows the unit', () => {
    expect(renderStaticIntl(<BodyweightLogForm unit="kg" />)).toContain('placeholder="e.g. 82.5"')
    expect(renderStaticIntl(<BodyweightLogForm unit="lb" />)).toContain('placeholder="e.g. 181.5"')
  })

  test('the CTA resolves through the catalog', () => {
    const html = renderStaticIntl(<BodyweightLogForm unit="kg" />)
    expect(html).toContain('Log weight')
    expect(html).not.toMatch(/BodyweightLogForm\.[a-zA-Z.]+/)
  })
})

describe('BodyweightEntryRow', () => {
  test('the delete control names the entry it removes', () => {
    const html = renderStaticIntl(
      <BodyweightEntryRow id="log-1" dateLabel="Jan 2" weightLabel="181.5 lb" />,
    )
    expect(html).toContain('aria-label="Delete entry from Jan 2"')
    expect(html).toContain('181.5 lb')
    expect(html).not.toMatch(/BodyweightEntryRow\.[a-zA-Z.]+/)
  })
})
