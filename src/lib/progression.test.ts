import { describe, it, expect } from 'vitest'
import {
  percentOf1RM,
  deriveWeekSets,
  DELOAD_LOAD_FACTOR,
  DELOAD_SET_FACTOR,
  type ProgramSetRowLike,
} from './progression'

/** A working reps_weight set with every optional target blank. */
function workingSet(overrides: Partial<ProgramSetRowLike> = {}): ProgramSetRowLike {
  return {
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: null,
    repMax: null,
    rir: null,
    rpe: null,
    suggestedLoadKg: null,
    tempo: null,
    durationSec: null,
    distanceM: null,
    technique: null,
    ...overrides,
  }
}

/** n working sets at the given base load, numbered 1..n. */
function workingSets(n: number, loadKg: number | null): ProgramSetRowLike[] {
  return Array.from({ length: n }, (_, i) =>
    workingSet({ setNumber: i + 1, suggestedLoadKg: loadKg }),
  )
}

const NO_HISTORY = { e1rmKg: null, lastSets: null }

describe('percentOf1RM', () => {
  // Values from the standard RTS chart (reps + RIR diagonal).
  it('returns known chart values', () => {
    expect(percentOf1RM(1, 10)).toBeCloseTo(1.0, 3)
    expect(percentOf1RM(2, 10)).toBeCloseTo(0.955, 3)
    expect(percentOf1RM(5, 8)).toBeCloseTo(0.811, 3) // 5 reps @ 2 RIR ≡ 7RM
    expect(percentOf1RM(8, 8)).toBeCloseTo(0.739, 3) // 8 reps @ 2 RIR ≡ 10RM
    expect(percentOf1RM(12, 6)).toBeCloseTo(0.626, 3) // 12 reps @ 4 RIR ≡ 16RM (chart floor)
  })

  it('interpolates half-step RPEs between adjacent whole-RIR values', () => {
    // 8 @ 7.5 sits between 8@8 (0.739 → 10RM) and 8@7 (0.707 → 11RM).
    expect(percentOf1RM(8, 7.5)).toBeCloseTo((0.739 + 0.707) / 2, 3)
  })

  it('snaps a finer RPE down to the nearest half step', () => {
    expect(percentOf1RM(5, 8.4)).toBe(percentOf1RM(5, 8))
    expect(percentOf1RM(5, 8.9)).toBe(percentOf1RM(5, 8.5))
  })

  it('returns null outside the reliable range', () => {
    expect(percentOf1RM(0, 8)).toBeNull()
    expect(percentOf1RM(13, 8)).toBeNull()
    expect(percentOf1RM(5, 5.5)).toBeNull()
    expect(percentOf1RM(5, 10.5)).toBeNull()
    expect(percentOf1RM(2.5, 8)).toBeNull() // non-integer reps
  })
})

describe('deriveWeekSets', () => {
  describe('no progression (template passthrough)', () => {
    it('returns the template unchanged on a normal week', () => {
      const derived = deriveWeekSets({
        sets: workingSets(3, 100),
        progression: null,
        week: 2,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived).toHaveLength(3)
      expect(derived.map((s) => s.loadKg)).toEqual([100, 100, 100])
      expect(derived.every((s) => s.derivedFrom === 'template')).toBe(true)
    })

    it('still deloads on the deload week', () => {
      const derived = deriveWeekSets({
        sets: workingSets(4, 100),
        progression: null,
        week: 4,
        mesocycleWeeks: 4,
        deloadWeek: 4,
        history: NO_HISTORY,
      })
      expect(derived).toHaveLength(Math.ceil(4 * DELOAD_SET_FACTOR))
      expect(derived[0].loadKg).toBeCloseTo(100 * DELOAD_LOAD_FACTOR, 5)
      expect(derived.every((s) => s.derivedFrom === 'deload')).toBe(true)
    })
  })

  describe('linear', () => {
    const linear = { scheme: 'linear' as const, incrementKg: 2.5 }

    it('adds one increment per prior non-deload week', () => {
      // deload week 2 does not count as a progression step: week 3 = base + 1 step.
      const derived = deriveWeekSets({
        sets: workingSets(2, 100),
        progression: linear,
        week: 3,
        mesocycleWeeks: 4,
        deloadWeek: 2,
        history: NO_HISTORY,
      })
      expect(derived.map((s) => s.loadKg)).toEqual([102.5, 102.5])
      expect(derived.every((s) => s.derivedFrom === 'scheme')).toBe(true)
    })

    it('leaves a null base load null', () => {
      const derived = deriveWeekSets({
        sets: workingSets(1, null),
        progression: linear,
        week: 3,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived[0].loadKg).toBeNull()
    })

    it('does not touch warmup sets', () => {
      const derived = deriveWeekSets({
        sets: [
          workingSet({ setNumber: 1, setType: 'warmup', suggestedLoadKg: 60 }),
          workingSet({ setNumber: 2, suggestedLoadKg: 100 }),
        ],
        progression: linear,
        week: 2,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived[0].loadKg).toBe(60)
      expect(derived[0].derivedFrom).toBe('template')
      expect(derived[1].loadKg).toBe(102.5)
    })

    it('clamps a week beyond the mesocycle to the last week', () => {
      const atLast = deriveWeekSets({
        sets: workingSets(1, 100),
        progression: linear,
        week: 4,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      const beyond = deriveWeekSets({
        sets: workingSets(1, 100),
        progression: linear,
        week: 9,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(beyond[0].loadKg).toBe(atLast[0].loadKg)
    })

    it('applies the deload factor on top of the progressed load', () => {
      const derived = deriveWeekSets({
        sets: workingSets(2, 100),
        progression: linear,
        week: 4,
        mesocycleWeeks: 4,
        deloadWeek: 4,
        history: NO_HISTORY,
      })
      // 3 non-deload weeks (1-3) precede week 4 → 107.5, then × deload factor.
      expect(derived).toHaveLength(1)
      expect(derived[0].loadKg).toBeCloseTo(107.5 * DELOAD_LOAD_FACTOR, 5)
      expect(derived[0].derivedFrom).toBe('deload')
    })
  })

  describe('double-progression', () => {
    const dp = { scheme: 'double-progression' as const, repMin: 8, repMax: 12, incrementKg: 2.5 }

    it('advances when every logged set hit repMax', () => {
      const derived = deriveWeekSets({
        sets: workingSets(2, 100),
        progression: dp,
        week: 2,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: {
          e1rmKg: null,
          lastSets: [
            { reps: 12, weightKg: 100 },
            { reps: 12, weightKg: 100 },
          ],
        },
      })
      expect(derived.map((s) => s.loadKg)).toEqual([102.5, 102.5])
    })

    it('holds when any logged set fell short of repMax', () => {
      const derived = deriveWeekSets({
        sets: workingSets(2, 100),
        progression: dp,
        week: 2,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: {
          e1rmKg: null,
          lastSets: [
            { reps: 12, weightKg: 100 },
            { reps: 10, weightKg: 100 },
          ],
        },
      })
      expect(derived.map((s) => s.loadKg)).toEqual([100, 100])
    })

    it('holds with no history', () => {
      const derived = deriveWeekSets({
        sets: workingSets(1, 100),
        progression: dp,
        week: 3,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived[0].loadKg).toBe(100)
    })
  })

  describe('percent-1rm', () => {
    const p1rm = {
      scheme: 'percent-1rm' as const,
      trainingMaxKg: 200,
      weekPercents: [0.7, 0.75, 0.8],
    }

    it('uses the week-indexed percent of the training max', () => {
      const derived = deriveWeekSets({
        sets: workingSets(1, 100),
        progression: p1rm,
        week: 2,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived[0].loadKg).toBeCloseTo(150, 5)
    })

    it('clamps past the end of weekPercents', () => {
      const derived = deriveWeekSets({
        sets: workingSets(1, 100),
        progression: p1rm,
        week: 4,
        mesocycleWeeks: 6,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived[0].loadKg).toBeCloseTo(160, 5) // percents[2]
    })
  })

  describe('rpe-target', () => {
    const rt = { scheme: 'rpe-target' as const, targetRpe: 8 }

    it('derives the load from history e1RM and the RPE chart', () => {
      const derived = deriveWeekSets({
        sets: [workingSet({ repMin: 5, repMax: 5, suggestedLoadKg: null })],
        progression: rt,
        week: 1,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: { e1rmKg: 100, lastSets: null },
      })
      expect(derived[0].loadKg).toBeCloseTo(81.1, 1) // 5 @ RPE 8 = 81.1%
      expect(derived[0].rpe).toBe(8)
    })

    it('seeds a null load (but still stamps the RPE) with no history', () => {
      const derived = deriveWeekSets({
        sets: [workingSet({ repMax: 5 })],
        progression: rt,
        week: 1,
        mesocycleWeeks: 4,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived[0].loadKg).toBeNull()
      expect(derived[0].rpe).toBe(8)
    })
  })

  describe('weekly-volume', () => {
    const wv = { scheme: 'weekly-volume' as const, mevSets: 8, mrvSets: 14 }

    it('interpolates the working-set count across non-deload weeks', () => {
      // 5-week meso, deload 5 → non-deload weeks 1-4 span mev→mrv: 8, 10, 12, 14.
      const counts = [1, 2, 3, 4].map(
        (week) =>
          deriveWeekSets({
            sets: workingSets(8, 100),
            progression: wv,
            week,
            mesocycleWeeks: 5,
            deloadWeek: 5,
            history: NO_HISTORY,
          }).length,
      )
      expect(counts).toEqual([8, 10, 12, 14])
    })

    it('keeps setNumbers 1-based contiguous after growing', () => {
      const derived = deriveWeekSets({
        sets: workingSets(8, 100),
        progression: wv,
        week: 4,
        mesocycleWeeks: 5,
        deloadWeek: 5,
        history: NO_HISTORY,
      })
      expect(derived.map((s) => s.setNumber)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
    })

    it('uses mev on a single-week mesocycle', () => {
      const derived = deriveWeekSets({
        sets: workingSets(10, 100),
        progression: wv,
        week: 1,
        mesocycleWeeks: 1,
        deloadWeek: null,
        history: NO_HISTORY,
      })
      expect(derived).toHaveLength(8)
    })

    it('halves the template count on the deload week (no interpolation)', () => {
      const derived = deriveWeekSets({
        sets: workingSets(8, 100),
        progression: wv,
        week: 5,
        mesocycleWeeks: 5,
        deloadWeek: 5,
        history: NO_HISTORY,
      })
      expect(derived).toHaveLength(Math.ceil(8 * DELOAD_SET_FACTOR))
    })

    it('never removes warmup sets when shrinking', () => {
      const derived = deriveWeekSets({
        sets: [
          workingSet({ setNumber: 1, setType: 'warmup', suggestedLoadKg: 60 }),
          ...workingSets(10, 100).map((s) => ({ ...s, setNumber: s.setNumber + 1 })),
        ],
        progression: wv,
        week: 1,
        mesocycleWeeks: 5,
        deloadWeek: 5,
        history: NO_HISTORY,
      })
      expect(derived.filter((s) => s.setType === 'warmup')).toHaveLength(1)
      expect(derived.filter((s) => s.setType === 'working')).toHaveLength(8)
    })
  })

  it('never emits a negative load', () => {
    const derived = deriveWeekSets({
      sets: workingSets(1, 1),
      progression: { scheme: 'linear', incrementKg: -50 },
      week: 2,
      mesocycleWeeks: 4,
      deloadWeek: null,
      history: NO_HISTORY,
    })
    expect(derived[0].loadKg).toBe(0)
  })
})
