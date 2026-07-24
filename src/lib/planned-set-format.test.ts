import { describe, it, expect } from 'vitest'
import {
  formatPlannedScheme,
  plannedSetChips,
  groupPlannedSets,
  type PlannedSetShape,
} from './planned-set-format'

describe('formatPlannedScheme', () => {
  it('renders a rep range as N×min–max', () => {
    // Arrange
    const set: PlannedSetShape = { repMin: 8, repMax: 12 }

    // Act / Assert
    expect(formatPlannedScheme(set, 3, 'kg')).toBe('3×8–12')
  })

  it('collapses an equal rep range to a single number', () => {
    expect(formatPlannedScheme({ repMin: 5, repMax: 5 }, 3, 'kg')).toBe('3×5')
  })

  it('appends a suggested load in the display unit', () => {
    const set: PlannedSetShape = { repMin: 5, repMax: 5, suggestedLoadKg: 100 }

    expect(formatPlannedScheme(set, 3, 'kg')).toBe('3×5 @ 100 kg')
    expect(formatPlannedScheme(set, 3, 'lb')).toBe('3×5 @ 220.5 lb')
  })

  it('renders AMRAP sets regardless of missing rep targets', () => {
    expect(formatPlannedScheme({ setType: 'amrap' }, 1, 'kg')).toBe('1×AMRAP')
  })

  it('renders timed sets with seconds, promoting whole minutes', () => {
    expect(formatPlannedScheme({ metricMode: 'duration', durationSec: 45 }, 2, 'kg')).toBe('2×45s')
    expect(formatPlannedScheme({ metricMode: 'duration', durationSec: 120 }, 2, 'kg')).toBe(
      '2×2 min',
    )
    expect(formatPlannedScheme({ metricMode: 'duration', durationSec: 90 }, 1, 'kg')).toBe('1×90s')
  })

  it('degrades a rep set with no targets to a set count', () => {
    expect(formatPlannedScheme({}, 3, 'kg')).toBe('3 sets')
    expect(formatPlannedScheme({}, 1, 'kg')).toBe('1 set')
  })

  it('appends RIR and RPE tails', () => {
    expect(formatPlannedScheme({ repMin: 8, repMax: 8, rir: 2 }, 3, 'kg')).toBe('3×8 · RIR 2')
    expect(formatPlannedScheme({ repMin: 8, repMax: 8, rpe: 8 }, 3, 'kg')).toBe('3×8 · RPE 8')
  })
})

describe('plannedSetChips', () => {
  it('returns no chips for a plain reps×weight set', () => {
    expect(plannedSetChips({ repMin: 8, repMax: 12 })).toEqual([])
  })

  it('marks timed sets and planned rest', () => {
    expect(plannedSetChips({ metricMode: 'duration', durationSec: 60, restSec: 90 })).toEqual([
      'Timed',
      'Rest 90s',
    ])
    expect(plannedSetChips({ repMin: 5, restSec: 180 })).toEqual(['Rest 3 min'])
  })

  it('ignores zero rest', () => {
    expect(plannedSetChips({ repMin: 5, restSec: 0 })).toEqual([])
  })
})

describe('groupPlannedSets', () => {
  it('collapses adjacent identical sets into one counted run', () => {
    // Arrange — the mapper replicates one shape `sets` times
    const shape: PlannedSetShape = { repMin: 8, repMax: 12, restSec: 90 }
    const sets = [{ ...shape }, { ...shape }, { ...shape }]

    // Act
    const groups = groupPlannedSets(sets)

    // Assert
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
  })

  it('keeps differing sets in separate runs, adjacency-only', () => {
    const heavy: PlannedSetShape = { repMin: 5, repMax: 5, suggestedLoadKg: 100 }
    const light: PlannedSetShape = { repMin: 10, repMax: 10 }

    const groups = groupPlannedSets([heavy, light, { ...heavy }])

    expect(groups.map((g) => g.count)).toEqual([1, 1, 1])
  })

  it('treats omitted and null fields as the same shape', () => {
    const groups = groupPlannedSets([{ repMin: 8, repMax: 8, rir: null }, { repMin: 8, repMax: 8 }])

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
  })

  it('returns an empty list for no sets', () => {
    expect(groupPlannedSets([])).toEqual([])
  })
})
