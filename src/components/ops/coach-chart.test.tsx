import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { CoachChart, type CoachChartPoint } from './coach-chart'

/**
 * The composite chart's accessible name ends in a day count, so it carries an
 * ICU plural — asserted at one day AND at many. The two series labels used to
 * be frozen at module load, before any request could resolve a locale.
 */

const point = (label: string): CoachChartPoint => ({ label, traces: 4, cost: 0.12 })

const render = (points: CoachChartPoint[]) => renderStaticIntl(<CoachChart points={points} />)

describe('CoachChart copy', () => {
  test('reads the singular day form over a one-day window', () => {
    const html = render([point('Jul 19')])

    expect(html).toContain('Coach traces and cost per day, last 1 day')
    expect(html).not.toContain('last 1 days')
  })

  test('reads the plural day form over a multi-day window', () => {
    const html = render([point('Jul 19'), point('Jul 20'), point('Jul 21')])

    expect(html).toContain('Coach traces and cost per day, last 3 days')
  })

  test('resolves every key it references', () => {
    expect(render([point('Jul 19')])).not.toMatch(/CoachChart\.[a-zA-Z.]+/)
  })
})
