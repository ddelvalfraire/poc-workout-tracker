import { describe, expect, test, vi } from 'vitest'
import { useTranslations } from 'next-intl'
import { renderStaticIntl } from '../../../vitest.intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { MeasurementsSection, type MeasurementEntry } from './measurements-section'

/**
 * Tape measurements are health data, so this copy is relocated verbatim —
 * these assertions are the proof of that, not just of resolution. The status
 * line is the interesting one: it wraps the reading in an emphasis tag AND
 * carries an optional delta clause, so it is one t.rich message with a
 * select rather than a sentence glued around a <span>.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function entryOf(overrides: Partial<MeasurementEntry> = {}): MeasurementEntry {
  return {
    id: 'm1',
    site: 'waist',
    dateLabel: 'Jan 2',
    measuredAtMs: Date.now(),
    value: 85,
    ...overrides,
  }
}

/** The delta clause only exists after the mount effect reads "now", which a
 *  static render never does — so the populated branch is resolved directly. */
function DeltaProbe({ delta }: { delta: string }) {
  const t = useTranslations('MeasurementsSection')
  return (
    <p>
      {t.rich('latestSummary', {
        site: 'Waist',
        value: 85,
        unit: 'cm',
        days: 90,
        delta,
        reading: (chunks) => <span>{chunks}</span>,
      })}
    </p>
  )
}

describe('MeasurementsSection status line', () => {
  test('renders the reading inside its emphasis tag', () => {
    const html = renderStaticIntl(<MeasurementsSection unit="cm" entries={[entryOf()]} />)
    expect(html).toContain('Waist: <span class="font-medium text-foreground">85 cm</span>')
  })

  test('omits the delta clause when there is no window delta', () => {
    const html = renderStaticIntl(<DeltaProbe delta="none" />)
    expect(html).toContain('Waist: <span>85 cm</span>')
    expect(html).not.toContain('90d')
  })

  test('appends the delta clause when there is one', () => {
    expect(renderStaticIntl(<DeltaProbe delta="−1.2" />)).toContain(' · −1.2 cm / 90d')
    expect(renderStaticIntl(<DeltaProbe delta="+0.5" />)).toContain(' · +0.5 cm / 90d')
  })
})

describe('MeasurementsSection form and history', () => {
  test('the input label and CTA resolve through the catalog', () => {
    const html = renderStaticIntl(<MeasurementsSection unit="in" entries={[entryOf()]} />)
    expect(html).toContain('Waist (in)')
    expect(html).toContain('Log measurement')
    expect(html).toContain('e.g. 33.5')
  })

  test('the site picker is named', () => {
    const html = renderStaticIntl(<MeasurementsSection unit="cm" entries={[]} />)
    expect(html).toContain('aria-label="Measurement site"')
  })

  test('the per-site empty state names the site', () => {
    const html = renderStaticIntl(<MeasurementsSection unit="cm" entries={[]} />)
    expect(html).toContain(
      'No waist entries yet. Tape measurements catch changes the scale misses.',
    )
  })

  test('the history list and its rows resolve their names', () => {
    const html = renderStaticIntl(<MeasurementsSection unit="cm" entries={[entryOf()]} />)
    expect(html).toContain('aria-label="Waist history"')
    expect(html).toContain('aria-label="Delete entry from Jan 2"')
    expect(html).toContain('85 cm')
  })

  test('the chart label pluralises its entry count at both branches', () => {
    const twoPoints = [
      entryOf(),
      entryOf({ id: 'm2', measuredAtMs: Date.now() - DAY_MS, value: 84 }),
    ]
    const html = renderStaticIntl(<MeasurementsSection unit="cm" entries={twoPoints} />)
    expect(html).toContain('Waist trend, 84 to 85 cm over 2 entries')

    function ChartLabelProbe({ count }: { count: number }) {
      const t = useTranslations('MeasurementsSection')
      return <p>{t('chartLabel', { site: 'Waist', from: 84, to: 85, unit: 'cm', count })}</p>
    }
    expect(renderStaticIntl(<ChartLabelProbe count={1} />)).toContain('over 1 entry')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(
      <MeasurementsSection
        unit="cm"
        entries={[entryOf(), entryOf({ id: 'm2', measuredAtMs: Date.now() - DAY_MS, value: 84 })]}
      />,
    )
    expect(html).not.toMatch(/MeasurementsSection\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/MeasurementEntryRow\.[a-zA-Z.]+/)
  })
})
