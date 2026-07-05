import { describe, it, expect } from 'vitest'
import {
  percentOf1RM,
  deriveWeekSets,
  applyOverride,
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

  describe('rep-progression', () => {
    const base = { mesocycleWeeks: 7, deloadWeek: 7, history: NO_HISTORY }

    it('adds incrementReps per prior non-deload week to repMin and repMax, load untouched', () => {
      const derived = deriveWeekSets({
        sets: [workingSet({ repMin: 12, repMax: 15, suggestedLoadKg: 20 })],
        progression: { scheme: 'rep-progression', incrementReps: 1, incrementSec: 0 },
        week: 4,
        ...base,
      })
      expect(derived[0].repMin).toBe(15) // 12 + 1×3 prior weeks
      expect(derived[0].repMax).toBe(18)
      expect(derived[0].loadKg).toBe(20)
      expect(derived[0].derivedFrom).toBe('scheme')
    })

    it('clamps reps at maxReps', () => {
      const derived = deriveWeekSets({
        sets: [workingSet({ repMin: 12 })],
        progression: { scheme: 'rep-progression', incrementReps: 2, incrementSec: 0, maxReps: 15 },
        week: 6,
        ...base,
      })
      expect(derived[0].repMin).toBe(15)
    })

    it('never lowers a template target when the cap sits below it', () => {
      const derived = deriveWeekSets({
        sets: [workingSet({ repMin: 12 })],
        progression: { scheme: 'rep-progression', incrementReps: 1, incrementSec: 0, maxReps: 10 },
        week: 3,
        ...base,
      })
      expect(derived[0].repMin).toBe(12) // cap halts the climb; it must not shrink the template
    })

    it('progresses durationSec on timed sets, clamped at maxSec', () => {
      const timed = workingSet({ metricMode: 'duration', durationSec: 60 })
      const progression = {
        scheme: 'rep-progression',
        incrementReps: 0,
        incrementSec: 15,
        maxSec: 100,
      } as const
      const week3 = deriveWeekSets({ sets: [timed], progression, week: 3, ...base })
      expect(week3[0].durationSec).toBe(90) // 60 + 15×2
      const week6 = deriveWeekSets({ sets: [timed], progression, week: 6, ...base })
      expect(week6[0].durationSec).toBe(100) // capped, not 135
    })

    it('reverts to template reps on the deload week (sets still halve)', () => {
      const derived = deriveWeekSets({
        sets: [
          workingSet({ setNumber: 1, repMin: 12 }),
          workingSet({ setNumber: 2, repMin: 12 }),
          workingSet({ setNumber: 3, repMin: 12 }),
        ],
        progression: { scheme: 'rep-progression', incrementReps: 1, incrementSec: 0 },
        week: 7,
        ...base,
      })
      expect(derived.every((s) => s.repMin === 12)).toBe(true)
      expect(derived.filter((s) => s.setType === 'working')).toHaveLength(2) // ceil(3×0.5)
    })

    it('leaves warmups and null fields untouched', () => {
      const derived = deriveWeekSets({
        sets: [
          workingSet({ setNumber: 1, setType: 'warmup', repMin: 10 }),
          workingSet({ setNumber: 2, repMin: 12, repMax: null, durationSec: null }),
        ],
        progression: { scheme: 'rep-progression', incrementReps: 1, incrementSec: 10 },
        week: 3,
        ...base,
      })
      expect(derived[0].repMin).toBe(10) // warmup passes through
      expect(derived[1].repMin).toBe(14)
      expect(derived[1].repMax).toBeNull()
      expect(derived[1].durationSec).toBeNull()
    })
  })

  describe('amrap-cycle', () => {
    // Classic 5/3/1 wave: percents of the training max per set, per wave week.
    const p531 = {
      scheme: 'amrap-cycle' as const,
      trainingMaxKg: 100,
      incrementKg: 5,
      wave: [
        [0.65, 0.75, 0.85],
        [0.7, 0.8, 0.9],
        [0.75, 0.85, 0.95],
      ],
      waveReps: [
        [5, 5, 5],
        [3, 3, 3],
        [5, 3, 1],
      ],
    }
    /** Two working sets + a final AMRAP set, no template loads. */
    const sets531 = (): ProgramSetRowLike[] => [
      workingSet({ setNumber: 1 }),
      workingSet({ setNumber: 2 }),
      workingSet({ setNumber: 3, setType: 'amrap' }),
    ]
    const base = { mesocycleWeeks: 7, deloadWeek: 7, history: NO_HISTORY }

    it('derives per-set loads and reps from the wave row for the week', () => {
      const derived = deriveWeekSets({ sets: sets531(), progression: p531, week: 1, ...base })
      expect(derived.map((s) => s.loadKg)).toEqual([65, 75, 85])
      expect(derived.map((s) => s.repMin)).toEqual([5, 5, 5])
      expect(derived.every((s) => s.derivedFrom === 'scheme')).toBe(true)
    })

    it('advances to the next wave row each non-deload week', () => {
      const derived = deriveWeekSets({ sets: sets531(), progression: p531, week: 2, ...base })
      expect(derived.map((s) => s.loadKg)).toEqual([70, 80, 90])
      expect(derived.map((s) => s.repMin)).toEqual([3, 3, 3])
    })

    it('bumps the training max once per completed wave and restarts the wave', () => {
      // Week 4 = wave week 1 of cycle 2: TM 105.
      const derived = deriveWeekSets({ sets: sets531(), progression: p531, week: 4, ...base })
      expect(derived.map((s) => s.loadKg)).toEqual([68.25, 78.75, 89.25])
      expect(derived.map((s) => s.repMin)).toEqual([5, 5, 5])
    })

    it('clamps to the last percent when a day has more sets than the wave row', () => {
      const derived = deriveWeekSets({
        sets: [...sets531(), workingSet({ setNumber: 4 })],
        progression: p531,
        week: 1,
        ...base,
      })
      expect(derived[3].loadKg).toBe(85)
    })

    it('keeps template reps when waveReps is omitted', () => {
      const noReps = { scheme: p531.scheme, trainingMaxKg: 100, incrementKg: 5, wave: p531.wave }
      const derived = deriveWeekSets({
        sets: [workingSet({ setNumber: 1, repMin: 8, repMax: 10 })],
        progression: noReps,
        week: 1,
        ...base,
      })
      expect(derived[0].repMin).toBe(8)
      expect(derived[0].repMax).toBe(10)
      expect(derived[0].loadKg).toBe(65)
    })

    it('indexes percents among progressed sets only (warmups pass through)', () => {
      const derived = deriveWeekSets({
        sets: [
          workingSet({ setNumber: 1, setType: 'warmup', suggestedLoadKg: 40, repMin: 10 }),
          workingSet({ setNumber: 2 }),
          workingSet({ setNumber: 3 }),
        ],
        progression: p531,
        week: 1,
        ...base,
      })
      expect(derived[0].loadKg).toBe(40) // warmup untouched
      expect(derived[0].repMin).toBe(10)
      expect(derived[1].loadKg).toBe(65) // first PROGRESSED set gets the first percent
      expect(derived[2].loadKg).toBe(75)
    })

    it('applies the standard deload on top of the wave-derived loads', () => {
      const derived = deriveWeekSets({ sets: sets531(), progression: p531, week: 7, ...base })
      // Week 7: 6 prior non-deload weeks = 2 complete waves → TM 110, wave row 0.
      expect(derived.filter((s) => s.setType === 'working')).toHaveLength(1) // ceil(2×0.5)
      expect(derived[0].loadKg).toBeCloseTo(110 * 0.65 * DELOAD_LOAD_FACTOR, 5)
      expect(derived[0].derivedFrom).toBe('deload')
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

describe('applyOverride', () => {
  const base = {
    setNumber: 1,
    setType: 'working',
    metricMode: 'reps_weight',
    repMin: 8,
    repMax: 12,
    rir: null,
    rpe: null,
    loadKg: 102.5,
    tempo: null,
    durationSec: null,
    distanceM: null,
    technique: null,
    derivedFrom: 'scheme',
    sourceIndex: 0,
  } as const

  it('lets a non-null override field win over the derived value', () => {
    const result = applyOverride(base, { suggestedLoadKg: 95, repMin: null, repMax: null, rir: null, rpe: null, tempo: null, durationSec: null, distanceM: null, technique: null })
    expect(result.loadKg).toBe(95)
    expect(result.repMin).toBe(8) // null override field = not overridden
    expect(result.derivedFrom).toBe('override')
  })

  it('returns the set untouched when there is no override row', () => {
    expect(applyOverride(base, undefined)).toBe(base)
  })

  it('returns the set untouched when the override row is all-null', () => {
    const result = applyOverride(base, { suggestedLoadKg: null, repMin: null, repMax: null, rir: null, rpe: null, tempo: null, durationSec: null, distanceM: null, technique: null })
    expect(result).toEqual(base)
    expect(result.derivedFrom).toBe('scheme')
  })
})
