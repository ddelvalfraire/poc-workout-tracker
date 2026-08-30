import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../vitest.intl'
import {
  formatWorkoutDate,
  formatSet as setMessage,
  formatE1RM,
  formatLoggedSet as loggedSetMessage,
  formatVolume,
  formatVolumeParts,
  formatWorkoutDuration as durationMessage,
  formatElapsed,
  placeholderForSet,
  planPlaceholderForSet,
  resolvePlanTarget,
  resolveHistorySet,
  adoptableGhostValue,
  planSetGhost,
  previousChipLabel,
  completedSetsSummary as summaryMessage,
  stepWeightValue,
  resolveWeightStep,
  WEIGHT_STEP,
  WEIGHT_STEP_CHOICES,
} from './format'

/**
 * Four of these formatters now return message DESCRIPTORS rather than
 * sentences (I18N-KEYS §9): the words "reps", "BW", "set", "min" and "top"
 * are the catalog's, only the numbers are the formatter's. The existing
 * expectations below are kept verbatim, rendered through the REAL en.json —
 * that is the proof the copy only moved and did not change. The descriptor
 * DECISIONS get their own block at the end of the file.
 */
const render = (message: Parameters<typeof renderMessageIn>[1]) =>
  renderMessageIn('Format', message)

const formatSet = (...args: Parameters<typeof setMessage>) => render(setMessage(...args))
const formatLoggedSet = (...args: Parameters<typeof loggedSetMessage>) =>
  render(loggedSetMessage(...args))
const completedSetsSummary = (...args: Parameters<typeof summaryMessage>) =>
  render(summaryMessage(...args))
const formatWorkoutDuration = (...args: Parameters<typeof durationMessage>) => {
  const message = durationMessage(...args)
  return message === null ? null : render(message)
}

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

  it('quantizes a kg-derived load ghost to the lb grid (16.87 kg → 37.5, #226)', () => {
    const target = [{ repMin: 12, repMax: 12, loadKg: 16.87, restSec: null }]
    // Raw conversion is 37.2 lb — unloadable; the ghost snaps to 37.5.
    expect(planPlaceholderForSet(target, 0, 'lb')).toEqual({ reps: '12', weight: '37.5' })
  })

  it('converts the load ghost to the active unit (lb), on the 2.5 lb grid', () => {
    const targets = [{ repMin: 5, repMax: 5, loadKg: 100, restSec: null }]
    // 220.5 lb raw quantizes to the loadable 220 (#226).
    expect(planPlaceholderForSet(targets, 0, 'lb')).toEqual({ reps: '5', weight: '220' })
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

describe('planSetGhost', () => {
  it('passes the plan pair through for weight_reps', () => {
    expect(planSetGhost({ reps: '8–12', weight: '60' }, 'weight_reps')).toEqual({
      reps: '8–12',
      weight: '60',
    })
  })

  it('allows a legitimately partial plan target (rep range, no load)', () => {
    expect(planSetGhost({ reps: '8–12' }, 'weight_reps')).toEqual({
      reps: '8–12',
      weight: undefined,
    })
  })

  it('never ghosts a weight for BW-relative types', () => {
    expect(planSetGhost({ reps: '8', weight: '20' }, 'weighted_bodyweight')).toEqual({
      reps: '8',
      weight: undefined,
    })
    expect(planSetGhost({}, 'bodyweight_reps')).toEqual({ reps: undefined, weight: undefined })
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

describe('cardio ghosts and Prev (slice 1)', () => {
  it('placeholderForSet ghosts prior duration/distance in the input dialect', () => {
    const last = {
      sets: [{ reps: null, weight: null, durationSec: 750, distanceM: 2500 }],
    }
    expect(placeholderForSet(last, 0)).toEqual({
      reps: undefined,
      weight: undefined,
      duration: '12:30',
      distance: '2.5',
    })
  })

  it('planPlaceholderForSet ghosts the plan target duration/distance', () => {
    const targets = [
      { repMin: null, repMax: null, loadKg: null, restSec: null, durationSec: 1800, distanceM: 5000 },
    ]
    expect(planPlaceholderForSet(targets, 0)).toMatchObject({
      duration: '30:00',
      distance: '5',
    })
  })

  it('planSetGhost passes cardio fields through untouched for every logging type', () => {
    const ghost = planSetGhost({ duration: '30:00', distance: '5' }, 'bodyweight_reps')
    expect(ghost).toMatchObject({ duration: '30:00', distance: '5' })
  })

  it('previousChipLabel prefers the cardio duration over rep×weight fragments', () => {
    expect(previousChipLabel({ duration: '12:30', distance: '2.5' })).toBe('12:30')
    // No cardio history → the standing rules are untouched.
    expect(previousChipLabel({ reps: '8', weight: '60' })).toBe('60×8')
  })
})

describe('format descriptors (the DECISION, not the sentence)', () => {
  it('names the branch and hands the Intl-formatted weight to the catalog', () => {
    expect(setMessage(5, 100)).toEqual({ key: 'set', values: { reps: 5, weight: '100 kg' } })
    expect(setMessage(5, null)).toEqual({ key: 'setReps', values: { reps: 5 } })
    expect(setMessage(null, 100, 'lb')).toEqual({ key: 'setWeight', values: { weight: '220.5 lb' } })
    expect(setMessage(null, null)).toEqual({ key: 'empty' })
  })

  it('selects the bodyweight arm instead of splicing "BW" into a string', () => {
    expect(setMessage(12, null, 'kg', 'bodyweight_reps')).toEqual({
      key: 'setBodyweightReps',
      values: { kind: 'plain', load: 0, reps: 12 },
    })
    expect(setMessage(8, 25, 'kg', 'weighted_bodyweight')).toEqual({
      key: 'setBodyweightReps',
      values: { kind: 'added', load: 25, reps: 8 },
    })
    expect(setMessage(6, 20, 'kg', 'assisted_bodyweight')).toEqual({
      key: 'setBodyweightReps',
      values: { kind: 'assisted', load: 20, reps: 6 },
    })
  })

  it('splits the duration into hours and minutes for the catalog to word', () => {
    const start = new Date('2026-06-14T10:00:00Z')
    expect(durationMessage(start, new Date('2026-06-14T10:42:00Z'))).toEqual({
      key: 'duration',
      values: { minutes: 42 },
    })
    expect(durationMessage(start, new Date('2026-06-14T11:05:00Z'))).toEqual({
      key: 'durationHours',
      values: { hours: 1, minutes: 5 },
    })
  })

  it('carries the top-set shape as arguments, not as pre-built copy', () => {
    expect(summaryMessage([{ reps: '8', weight: '100' }], 'weight_reps')).toEqual({
      key: 'summaryTop',
      values: { count: 1, kind: 'plain', load: 100, reps: '8' },
    })
    expect(summaryMessage([{ reps: '', weight: '' }], 'weight_reps')).toEqual({
      key: 'summary',
      values: { count: 1 },
    })
  })

  // Every plural at BOTH one and many — separately, because a single-branch
  // plural reads fine at one value and wrong at every other.
  it('agrees the set count at one and at many', () => {
    expect(completedSetsSummary([{ reps: '', weight: '' }], 'weight_reps')).toBe('1 set')
    expect(
      completedSetsSummary(
        [
          { reps: '', weight: '' },
          { reps: '', weight: '' },
        ],
        'weight_reps',
      ),
    ).toBe('2 sets')
  })

  it('agrees the rep count at one and at many (it used to read "1 reps")', () => {
    expect(formatSet(1, null)).toBe('1 rep')
    expect(formatSet(5, null)).toBe('5 reps')
  })

  it('leaves no unresolved key path in any set shape', () => {
    for (const message of [
      setMessage(5, 100),
      setMessage(5, null),
      setMessage(null, 100),
      setMessage(null, null),
      setMessage(8, 25, 'kg', 'weighted_bodyweight'),
      loggedSetMessage({
        reps: null,
        weight: null,
        metricMode: 'duration_distance',
        durationSec: 750,
        distanceM: 2500,
      }),
      summaryMessage([{ reps: '8', weight: '100' }], 'assisted_bodyweight'),
    ]) {
      expect(render(message)).not.toMatch(/Format\.[a-zA-Z.]+/)
    }
  })
})

describe('Intl, not hand-assembly', () => {
  const date = new Date('2026-06-14T12:00:00Z')

  it('formats the workout date with Intl.DateTimeFormat for the resolved locale', () => {
    expect(formatWorkoutDate(date, 'en')).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date),
    )
  })

  it('defaults to the app locale rather than a hardcoded en-US', () => {
    expect(formatWorkoutDate(date)).toBe(formatWorkoutDate(date, 'en'))
  })

  it('formats volume and e1RM through Intl unit style, grouping only the total', () => {
    expect(formatVolume(5200.4, 'kg', 'en')).toBe(
      new Intl.NumberFormat('en', {
        style: 'unit',
        unit: 'kilogram',
        unitDisplay: 'short',
        useGrouping: true,
      }).format(5200),
    )
    expect(formatE1RM(455, 'lb', 'en')).toBe(
      new Intl.NumberFormat('en', {
        style: 'unit',
        unit: 'pound',
        unitDisplay: 'short',
        useGrouping: false,
      }).format(1003.1),
    )
  })

  it('splits a volume by Intl parts, never on a space the locale may not use', () => {
    // `.split(' ')` on the rendered string tears the number in half in every
    // locale that groups with a narrow no-break space.
    expect(formatVolumeParts(5200.4, 'kg', 'en')).toEqual({ value: '5,200', unit: 'kg' })
    expect(formatVolumeParts(0, 'lb', 'en')).toEqual({ value: '0', unit: 'lb' })
  })
})

describe('resolveWeightStep', () => {
  it('uses the unit default when nothing is stored', () => {
    expect(resolveWeightStep(null, 'kg')).toBe(WEIGHT_STEP.kg)
    expect(resolveWeightStep(undefined, 'lb')).toBe(WEIGHT_STEP.lb)
  })

  it('honours a stored step this unit actually offers', () => {
    expect(resolveWeightStep(1.25, 'kg')).toBe(1.25)
    expect(resolveWeightStep(10, 'lb')).toBe(10)
  })

  it('falls back when the stored step belongs to the OTHER unit', () => {
    // The preference is unit-native and never converted, so a kg user's 1.25
    // must not survive a switch to lb as "1.25 lb" - lb does not offer it.
    expect(WEIGHT_STEP_CHOICES.lb).not.toContain(1.25)
    expect(resolveWeightStep(1.25, 'lb')).toBe(WEIGHT_STEP.lb)
    // 5 is on BOTH lists, so it legitimately survives the switch.
    expect(resolveWeightStep(5, 'kg')).toBe(5)
    expect(resolveWeightStep(5, 'lb')).toBe(5)
  })

  it('refuses junk rather than stepping by it', () => {
    for (const junk of [0, -2.5, Number.NaN, Number.POSITIVE_INFINITY, 3.7]) {
      expect(resolveWeightStep(junk, 'kg')).toBe(WEIGHT_STEP.kg)
    }
  })
})

describe('stepWeightValue with a custom step', () => {
  it('steps by the step it is given, not the unit default', () => {
    expect(stepWeightValue('60', undefined, 1, 'kg', 1)).toBe('61')
    expect(stepWeightValue('60', undefined, -1, 'kg', 0.5)).toBe('59.5')
  })

  it('still floors at 0 and still seeds from the ghost', () => {
    expect(stepWeightValue('0.5', undefined, -1, 'kg', 1)).toBe('0')
    expect(stepWeightValue('', '100', 1, 'kg', 1)).toBe('101')
  })

  it('defaults to the unit step so existing callers are unchanged', () => {
    expect(stepWeightValue('60', undefined, 1, 'kg')).toBe(
      stepWeightValue('60', undefined, 1, 'kg', WEIGHT_STEP.kg),
    )
  })
})

describe('resolvePlanTarget', () => {
  const target = (loadKg: number, setType?: 'warmup') => ({
    repMin: 5,
    repMax: 5,
    loadKg,
    restSec: null,
    ...(setType ? { setType } : {}),
  })
  const working = { tag: 'working' }
  const warmup = { tag: 'warmup' }

  it('degenerates to positional lookup when roles line up (a seeded session)', () => {
    // Arrange — prescribed warm-up + 2 working, seeded rows in the same order
    const targets = [target(40, 'warmup'), target(100), target(100)]
    const sets = [warmup, working, working]

    // Act + Assert
    expect(resolvePlanTarget(targets, sets, 0)).toBe(targets[0])
    expect(resolvePlanTarget(targets, sets, 1)).toBe(targets[1])
    expect(resolvePlanTarget(targets, sets, 2)).toBe(targets[2])
  })

  it('keeps a mid-session warm-up from consuming a working prescription', () => {
    // Arrange — plan prescribes 3 working sets; the lifter retagged row 0 as
    // a warm-up and added a row, so working rows sit at 1..3
    const targets = [target(100), target(102.5), target(105)]
    const sets = [warmup, working, working, working]

    // Act + Assert — the warm-up gets NO slot; working sets keep 1:1 targets
    expect(resolvePlanTarget(targets, sets, 0)).toBeUndefined()
    expect(resolvePlanTarget(targets, sets, 1)).toBe(targets[0])
    expect(resolvePlanTarget(targets, sets, 2)).toBe(targets[1])
    expect(resolvePlanTarget(targets, sets, 3)).toBe(targets[2])
  })

  it('pairs warm-up rows with warm-up targets by ordinal, wherever they sit', () => {
    // Arrange — two prescribed warm-ups, one working
    const targets = [target(40, 'warmup'), target(60, 'warmup'), target(100)]
    const sets = [warmup, warmup, working]

    // Act + Assert
    expect(resolvePlanTarget(targets, sets, 0)).toBe(targets[0])
    expect(resolvePlanTarget(targets, sets, 1)).toBe(targets[1])
    expect(resolvePlanTarget(targets, sets, 2)).toBe(targets[2])
  })

  it('resolves undefined past the class’s targets (no clamping, mirroring planPlaceholderForSet)', () => {
    // Arrange — 1 working target, an extra working set and an extra warm-up
    const targets = [target(100)]
    const sets = [working, working, warmup]

    // Act + Assert
    expect(resolvePlanTarget(targets, sets, 1)).toBeUndefined()
    expect(resolvePlanTarget(targets, sets, 2)).toBeUndefined()
  })

  it('returns undefined with no targets or an out-of-range set index', () => {
    expect(resolvePlanTarget(undefined, [working], 0)).toBeUndefined()
    expect(resolvePlanTarget([target(100)], [working], 5)).toBeUndefined()
  })
})

describe('resolveHistorySet', () => {
  const row = (weight: number, setType?: 'warmup') => ({
    reps: 5,
    weight,
    ...(setType ? { setType } : {}),
  })
  const working = { tag: 'working' }
  const warmup = { tag: 'warmup' }

  it('skips last session’s warm-ups for today’s working rows (no warm-up today)', () => {
    // Arrange — last time: warm-up 60, working 100/105; today: working only
    const last = { sets: [row(60, 'warmup'), row(100), row(105)] }
    const sets = [working, working]

    // Act + Assert — working rows read the working history, never the 60
    expect(resolveHistorySet(last, sets, 0)).toBe(last.sets[1])
    expect(resolveHistorySet(last, sets, 1)).toBe(last.sets[2])
  })

  it('pairs warm-up rows with last session’s warm-ups by ordinal', () => {
    const last = { sets: [row(60, 'warmup'), row(100)] }
    const sets = [warmup, working]

    expect(resolveHistorySet(last, sets, 0)).toBe(last.sets[0])
    expect(resolveHistorySet(last, sets, 1)).toBe(last.sets[1])
  })

  it('reads rows without a setType as non-warm-up (pre-column history, old positional behavior)', () => {
    const last = { sets: [row(100), row(105)] }
    const sets = [working, working]

    expect(resolveHistorySet(last, sets, 0)).toBe(last.sets[0])
    expect(resolveHistorySet(last, sets, 1)).toBe(last.sets[1])
  })

  it('resolves undefined past the class’s history (no clamping) and with no history', () => {
    const last = { sets: [row(100)] }

    expect(resolveHistorySet(last, [working, working], 1)).toBeUndefined()
    expect(resolveHistorySet(last, [warmup], 0)).toBeUndefined()
    expect(resolveHistorySet(null, [working], 0)).toBeUndefined()
  })
})
