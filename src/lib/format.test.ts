import { describe, it, expect } from 'vitest'
import {
  formatWorkoutDate,
  formatSet,
  formatE1RM,
  formatLoggedSet,
  formatVolume,
  formatWorkoutDuration,
  formatElapsed,
  placeholderForSet,
  planPlaceholderForSet,
  adoptableGhostValue,
  previousChipLabel,
  completedSetsSummary,
  stepWeightValue,
} from './format'

describe('formatSet', () => {
  it('formats reps and weight together', () => {
    expect(formatSet(5, 100)).toBe('5 × 100 kg')
  })

  it('formats reps only when weight is blank', () => {
    expect(formatSet(5, null)).toBe('5 reps')
  })

  it('formats weight only when reps is blank', () => {
    expect(formatSet(null, 100)).toBe('100 kg')
  })

  it('shows a dash when both are blank', () => {
    expect(formatSet(null, null)).toBe('—')
  })

  it('preserves fractional plate weights', () => {
    expect(formatSet(8, 2.5)).toBe('8 × 2.5 kg')
  })

  it('converts stored kg to lb when unit is lb', () => {
    expect(formatSet(5, 100, 'lb')).toBe('5 × 220.5 lb')
  })

  it('converts a weight-only set to lb', () => {
    expect(formatSet(null, 100, 'lb')).toBe('220.5 lb')
  })

  it('defaults to kg when no unit is given (back-compat)', () => {
    expect(formatSet(5, 100)).toBe('5 × 100 kg')
  })

  describe('bodyweight logging types (load-first, no unit suffix)', () => {
    it('renders a bodyweight set as BW × reps, ignoring any stored weight', () => {
      expect(formatSet(12, null, 'kg', 'bodyweight_reps')).toBe('BW × 12')
      expect(formatSet(12, 100, 'kg', 'bodyweight_reps')).toBe('BW × 12')
    })

    it('renders added load as BW+weight in the display unit', () => {
      expect(formatSet(8, 25, 'kg', 'weighted_bodyweight')).toBe('BW+25 × 8')
      // 25 kg → 55.1 lb
      expect(formatSet(8, 25, 'lb', 'weighted_bodyweight')).toBe('BW+55.1 × 8')
    })

    it('renders assistance as BW−weight', () => {
      expect(formatSet(6, 20, 'kg', 'assisted_bodyweight')).toBe('BW−20 × 6')
    })

    it('renders a blank added/assist weight as plain BW × reps', () => {
      expect(formatSet(8, null, 'kg', 'weighted_bodyweight')).toBe('BW × 8')
      expect(formatSet(6, null, 'kg', 'assisted_bodyweight')).toBe('BW × 6')
    })

    it('falls back to a dash when reps are blank and nothing else is loggable', () => {
      expect(formatSet(null, null, 'kg', 'bodyweight_reps')).toBe('—')
    })
  })
})

describe('formatE1RM', () => {
  it('formats a kg estimate with the kg unit (identity, no rounding)', () => {
    expect(formatE1RM(117)).toBe('117 kg')
  })

  it('defaults to kg when no unit is given', () => {
    expect(formatE1RM(117)).toBe('117 kg')
  })

  it('converts a kg estimate to lb, rounded to 1dp', () => {
    expect(formatE1RM(100, 'lb')).toBe('220.5 lb')
  })
})

describe('placeholderForSet', () => {
  const last = { sets: [{ reps: 5, weight: 100 }] }

  it('returns the prior set as ghost strings (kg)', () => {
    expect(placeholderForSet(last, 0)).toEqual({ reps: '5', weight: '100' })
  })

  it('converts the weight ghost to the active unit (lb)', () => {
    expect(placeholderForSet(last, 0, 'lb')).toEqual({ reps: '5', weight: '220.5' })
  })

  it('returns {} when there is no history', () => {
    expect(placeholderForSet(null, 0)).toEqual({})
  })

  it('returns {} when there are more sets than history', () => {
    expect(placeholderForSet(last, 1)).toEqual({})
  })

  it('omits a field that was blank last time', () => {
    expect(placeholderForSet({ sets: [{ reps: 5, weight: null }] }, 0)).toEqual({
      reps: '5',
      weight: undefined,
    })
  })
})

describe('adoptableGhostValue', () => {
  it('adopts plain numeric ghosts verbatim', () => {
    expect(adoptableGhostValue('8')).toBe('8')
    expect(adoptableGhostValue('102.5')).toBe('102.5')
  })

  it('adopts the floor of a rep-range ghost (the plan minimum)', () => {
    // A "8–12" plan ghost must not be silently dropped — that left one-tap
    // completion recording weight with NO reps.
    expect(adoptableGhostValue('8–12')).toBe('8')
    // Guard against upstream formatting drift: a degenerate "8–8" range
    // (today collapsed to "8" by planPlaceholderForSet) must still adopt.
    expect(adoptableGhostValue('8–8')).toBe('8')
  })

  it('rejects non-numeric and absent ghosts', () => {
    expect(adoptableGhostValue(undefined)).toBeUndefined()
    expect(adoptableGhostValue('')).toBeUndefined()
    expect(adoptableGhostValue('abc')).toBeUndefined()
    expect(adoptableGhostValue('8-12x')).toBeUndefined()
  })
})

describe('planPlaceholderForSet', () => {
  it('ghosts a fixed rep target and derived load (kg)', () => {
    const targets = [{ repMin: 8, repMax: 8, loadKg: 100, restSec: null }]
    expect(planPlaceholderForSet(targets, 0)).toEqual({ reps: '8', weight: '100' })
  })

  it('renders a rep range as min–max', () => {
    const targets = [{ repMin: 8, repMax: 12, loadKg: null, restSec: null }]
    expect(planPlaceholderForSet(targets, 0)).toEqual({ reps: '8–12', weight: undefined })
  })

  it('uses the single bound when only one is set', () => {
    expect(planPlaceholderForSet([{ repMin: 10, repMax: null, loadKg: null, restSec: null }], 0)).toEqual({
      reps: '10',
      weight: undefined,
    })
    expect(planPlaceholderForSet([{ repMin: null, repMax: 12, loadKg: null, restSec: null }], 0)).toEqual({
      reps: '12',
      weight: undefined,
    })
  })

  it('converts the load ghost to the active unit (lb)', () => {
    const targets = [{ repMin: 5, repMax: 5, loadKg: 100, restSec: null }]
    expect(planPlaceholderForSet(targets, 0, 'lb')).toEqual({ reps: '5', weight: '220.5' })
  })

  it('returns {} when there is no plan', () => {
    expect(planPlaceholderForSet(undefined, 0)).toEqual({})
  })

  it('returns {} for a set index beyond the plan (user-added set)', () => {
    expect(planPlaceholderForSet([{ repMin: 8, repMax: 8, loadKg: null, restSec: null }], 1)).toEqual({})
  })

  it('omits both fields when the planned set has no targets', () => {
    expect(planPlaceholderForSet([{ repMin: null, repMax: null, loadKg: null, restSec: null }], 0)).toEqual({
      reps: undefined,
      weight: undefined,
    })
  })
})

const loggedSet = (over: Partial<Parameters<typeof formatLoggedSet>[0]> = {}) => ({
  reps: null,
  weight: null,
  metricMode: 'reps_weight',
  durationSec: null,
  distanceM: null,
  ...over,
})

describe('formatLoggedSet', () => {
  it('formats reps_weight sets like formatSet', () => {
    expect(formatLoggedSet(loggedSet({ reps: 5, weight: 100 }))).toBe('5 × 100 kg')
    expect(formatLoggedSet(loggedSet({ reps: 5, weight: 100 }), 'lb')).toBe('5 × 220.5 lb')
    expect(formatLoggedSet(loggedSet())).toBe('—')
  })

  it('passes the exercise loggingType through to formatSet', () => {
    expect(formatLoggedSet(loggedSet({ reps: 12 }), 'kg', 'bodyweight_reps')).toBe('BW × 12')
    expect(formatLoggedSet(loggedSet({ reps: 8, weight: 25 }), 'kg', 'weighted_bodyweight')).toBe(
      'BW+25 × 8',
    )
  })

  it('formats duration sets as a clock', () => {
    expect(formatLoggedSet(loggedSet({ metricMode: 'duration', durationSec: 90 }))).toBe('1:30')
    expect(formatLoggedSet(loggedSet({ metricMode: 'duration', durationSec: 45 }))).toBe('0:45')
    expect(formatLoggedSet(loggedSet({ metricMode: 'duration', durationSec: 3900 }))).toBe(
      '1:05:00',
    )
  })

  it('renders — for a duration set with nothing logged', () => {
    expect(formatLoggedSet(loggedSet({ metricMode: 'duration' }))).toBe('—')
  })

  it('formats duration_distance sets with both metrics', () => {
    expect(
      formatLoggedSet(loggedSet({ metricMode: 'duration_distance', durationSec: 750, distanceM: 2500 })),
    ).toBe('12:30 · 2.5 km')
  })

  it('formats distance alone, in m below 1 km and km above', () => {
    expect(formatLoggedSet(loggedSet({ metricMode: 'duration_distance', distanceM: 800 }))).toBe(
      '800 m',
    )
    expect(formatLoggedSet(loggedSet({ metricMode: 'duration_distance', distanceM: 1000 }))).toBe(
      '1 km',
    )
  })
})

describe('formatVolume', () => {
  it('formats kg volume with grouping', () => {
    expect(formatVolume(5200.4)).toBe('5,200 kg')
  })

  it('converts to lb and rounds', () => {
    expect(formatVolume(1000, 'lb')).toBe('2,205 lb')
  })
})

describe('formatWorkoutDuration', () => {
  const start = new Date('2026-07-04T10:00:00Z')

  it('formats minutes', () => {
    expect(formatWorkoutDuration(start, new Date('2026-07-04T10:42:30Z'))).toBe('42 min')
  })

  it('formats hours + minutes past the hour', () => {
    expect(formatWorkoutDuration(start, new Date('2026-07-04T11:05:00Z'))).toBe('1 h 5 min')
  })

  it('returns null when there is no completion time', () => {
    expect(formatWorkoutDuration(start, null)).toBeNull()
  })

  it('returns null for implausible durations (instant saves, backdated logs)', () => {
    expect(formatWorkoutDuration(start, new Date('2026-07-04T10:00:30Z'))).toBeNull()
    expect(formatWorkoutDuration(start, new Date('2026-07-04T17:01:00Z'))).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('formats sub-hour spans as M:SS', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(42 * 60_000 + 30_000)).toBe('42:30')
  })

  it('formats hour-plus spans as H:MM:SS with padded minutes', () => {
    expect(formatElapsed(3_661_000)).toBe('1:01:01')
    expect(formatElapsed(2 * 3_600_000 + 5_000)).toBe('2:00:05')
  })

  it('floors partial seconds', () => {
    expect(formatElapsed(1_999)).toBe('0:01')
  })

  it('returns null for negative (clock skew) and implausible spans', () => {
    expect(formatElapsed(-1)).toBeNull()
    expect(formatElapsed(7 * 3_600_000)).toBeNull()
  })

  it('treats the 6 h plausibility ceiling as inclusive', () => {
    expect(formatElapsed(6 * 3_600_000)).toBe('6:00:00')
    expect(formatElapsed(6 * 3_600_000 + 1)).toBeNull()
  })
})

describe('formatWorkoutDate', () => {
  it('renders the year (locale-tolerant)', () => {
    // Midday UTC so the date can't roll to the prior day in negative offsets.
    const result = formatWorkoutDate(new Date('2026-06-14T12:00:00Z'))
    expect(result).toContain('2026')
  })
})

describe('previousChipLabel', () => {
  it('joins weight and reps compactly', () => {
    expect(previousChipLabel({ reps: '8', weight: '60' })).toBe('60×8')
  })

  it('hides partial history for weighted exercises (dash beats a "×10" fragment)', () => {
    expect(previousChipLabel({ reps: '12' })).toBeNull()
    expect(previousChipLabel({ weight: '60' })).toBeNull()
    expect(previousChipLabel({ reps: '12' }, 'weight_reps')).toBeNull()
  })

  it('keeps reps-only labels for bodyweight types, where reps are the whole story', () => {
    expect(previousChipLabel({ reps: '12' }, 'bodyweight_reps')).toBe('×12')
    expect(previousChipLabel({ reps: '8' }, 'weighted_bodyweight')).toBe('×8')
    expect(previousChipLabel({ reps: '6' }, 'assisted_bodyweight')).toBe('×6')
  })

  it('renders empty ghosts as null', () => {
    expect(previousChipLabel({}, 'bodyweight_reps')).toBeNull()
    expect(previousChipLabel({})).toBeNull()
  })

  it('keeps plan rep ranges verbatim', () => {
    expect(previousChipLabel({ reps: '8–12', weight: '60' })).toBe('60×8–12')
  })
})

describe('completedSetsSummary', () => {
  it('summarizes with the heaviest set and its reps', () => {
    expect(
      completedSetsSummary(
        [
          { reps: '8', weight: '100' },
          { reps: '10', weight: '90' },
        ],
        'weight_reps',
      ),
    ).toBe('2 sets · top 100×8')
  })

  it('falls back to the highest rep count when no set has weight', () => {
    expect(
      completedSetsSummary(
        [
          { reps: '12', weight: '' },
          { reps: '15', weight: '' },
        ],
        'weight_reps',
      ),
    ).toBe('2 sets · top ×15')
  })

  it('singularizes one set and survives empty fields', () => {
    expect(completedSetsSummary([{ reps: '', weight: '' }], 'weight_reps')).toBe('1 set')
  })

  it('labels added load and keeps max-wins for weighted bodyweight', () => {
    expect(
      completedSetsSummary(
        [
          { reps: '5', weight: '45' },
          { reps: '8', weight: '25' },
        ],
        'weighted_bodyweight',
      ),
    ).toBe('2 sets · top BW+45×5')
  })

  it('treats LESS assistance as the top set for assisted bodyweight', () => {
    expect(
      completedSetsSummary(
        [
          { reps: '8', weight: '20' },
          { reps: '5', weight: '40' },
        ],
        'assisted_bodyweight',
      ),
    ).toBe('2 sets · top BW−20×8')
  })

  it('is reps-only for bodyweight sets even if a weight string leaks in', () => {
    expect(
      completedSetsSummary(
        [
          { reps: '12', weight: '10' },
          { reps: '15', weight: '' },
        ],
        'bodyweight_reps',
      ),
    ).toBe('2 sets · top ×15')
  })
})

describe('stepWeightValue', () => {
  it('steps a typed value by the unit jump', () => {
    expect(stepWeightValue('60', undefined, 1, 'kg')).toBe('62.5')
    expect(stepWeightValue('60', undefined, -1, 'kg')).toBe('57.5')
    expect(stepWeightValue('135', undefined, 1, 'lb')).toBe('140')
  })

  it('adopts the ghost first when the field is empty', () => {
    expect(stepWeightValue('', '100', 1, 'kg')).toBe('102.5')
  })

  it('steps from zero with no ghost and floors at zero', () => {
    expect(stepWeightValue('', undefined, 1, 'kg')).toBe('2.5')
    expect(stepWeightValue('1', undefined, -1, 'kg')).toBe('0')
  })

  it('avoids float drift across fractional steps', () => {
    expect(stepWeightValue('0.1', undefined, 1, 'kg')).toBe('2.6')
  })

  it('refuses to step non-numeric input', () => {
    expect(stepWeightValue('heavy', undefined, 1, 'kg')).toBeNull()
  })
})
