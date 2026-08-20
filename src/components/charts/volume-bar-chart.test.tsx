import { describe, expect, test } from 'vitest'
import { renderStaticIntl } from '../../../vitest.intl'
import { VolumeBarChart } from './volume-bar-chart'
import type { MuscleGroupVolume } from '@/db/muscle-volume'

/**
 * A chart's accessible name is the only copy a screen reader gets from it,
 * and it ends in a count — so it carries an ICU plural, asserted here at one
 * group AND at many. The series labels used to be built at module load, which
 * is before any request and therefore before any locale could be resolved.
 */

const group = (name: string): MuscleGroupVolume =>
  ({ group: name, currentSets: 3, previousSets: 2 }) as MuscleGroupVolume

const render = (groups: MuscleGroupVolume[]) =>
  renderStaticIntl(<VolumeBarChart groups={groups} />)

describe('VolumeBarChart copy', () => {
  test('reads the singular group form with one muscle group', () => {
    const html = render([group('Chest')])

    expect(html).toContain('Sets per muscle group, this week vs last, 1 group')
    expect(html).not.toContain('1 groups')
  })

  test('reads the plural group form with several muscle groups', () => {
    const html = render([group('Chest'), group('Back'), group('Legs')])

    expect(html).toContain('Sets per muscle group, this week vs last, 3 groups')
  })

  test('resolves every key it references', () => {
    expect(render([group('Chest')])).not.toMatch(/VolumeBarChart\.[a-zA-Z.]+/)
  })
})
