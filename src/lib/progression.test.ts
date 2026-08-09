import { describe, it, expect } from 'vitest'
import {
  percentOf1RM,
  deriveWeekSets,
  applyOverride,
  amrapCompletedWaves,
  amrapBankableWaves,
  resolveDeloadPolicy,
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
    restSec: null,
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

    it('does not double-count waves already banked into the persisted TM', () => {
      // Arrange — the wave-boundary persist folded wave 1 into the TM
      // (100 + 5 → 105, bankedWaves 1). Week 4 must derive the SAME loads
      // the virtual math produced before the persist.
      const banked = { ...p531, trainingMaxKg: 105, bankedWaves: 1 }

      // Act
      const derived = deriveWeekSets({ sets: sets531(), progression: banked, week: 4, ...base })

      // Assert — identical to the unbanked week-4 expectation above.
      expect(derived.map((s) => s.loadKg)).toEqual([68.25, 78.75, 89.25])
    })

    it('never subtracts when re-deriving an earlier week after a bank', () => {
      // Arrange — TM banked at 105; browsing back to week 1 (0 completed
      // waves) must use the persisted TM, not TM minus an increment.
      const banked = { ...p531, trainingMaxKg: 105, bankedWaves: 1 }

      // Act
      const derived = deriveWeekSets({ sets: sets531(), progression: banked, week: 1, ...base })

      // Assert — 105 × wave row 1, not 100 ×.
      expect(derived.map((s) => s.loadKg)).toEqual([105 * 0.65, 105 * 0.75, 105 * 0.85])
    })

    it('amrapCompletedWaves counts whole waves on the non-deload axis', () => {
      // Arrange + Act + Assert — 3-week wave, deload at week 7 of 8.
      expect(amrapCompletedWaves(1, 8, 7, 3)).toBe(0)
      expect(amrapCompletedWaves(3, 8, 7, 3)).toBe(0)
      expect(amrapCompletedWaves(4, 8, 7, 3)).toBe(1)
      expect(amrapCompletedWaves(6, 8, 7, 3)).toBe(1)
      // Week 7 is the deload: 6 non-deload steps before it → 2 waves done.
      expect(amrapCompletedWaves(7, 8, 7, 3)).toBe(2)
      expect(amrapCompletedWaves(8, 8, 7, 3)).toBe(2)
      // Degenerate wave length never divides by zero.
      expect(amrapCompletedWaves(4, 8, null, 0)).toBe(0)
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

describe('restSec passthrough', () => {
  it('carries the template restSec through untouched on a normal week', () => {
    // Arrange — rest is not load-periodized: no scheme may alter it
    const sets = [workingSet({ restSec: 90 }), workingSet({ setNumber: 2, restSec: null })]

    // Act
    const derived = deriveWeekSets({
      sets,
      progression: { scheme: 'linear', incrementKg: 2.5 },
      week: 3,
      mesocycleWeeks: 4,
      deloadWeek: null,
      history: NO_HISTORY,
    })

    // Assert — scheme changed loads, never rest
    expect(derived.map((s) => s.restSec)).toEqual([90, null])
  })

  it('leaves restSec untouched on the deload week (loads scale, rest does not)', () => {
    // Arrange
    const sets = [workingSet({ suggestedLoadKg: 100, restSec: 120 })]

    // Act
    const derived = deriveWeekSets({
      sets,
      progression: null,
      week: 4,
      mesocycleWeeks: 4,
      deloadWeek: 4,
      history: NO_HISTORY,
    })

    // Assert
    expect(derived[0].loadKg).toBeCloseTo(100 * DELOAD_LOAD_FACTOR, 5)
    expect(derived[0].restSec).toBe(120)
  })

  it('clones inherit their source set’s restSec when weekly-volume grows the day', () => {
    // Arrange — 2 working sets growing toward 4 by the last week
    const sets = [
      workingSet({ setNumber: 1, restSec: 60 }),
      workingSet({ setNumber: 2, restSec: 180 }),
    ]

    // Act
    const derived = deriveWeekSets({
      sets,
      progression: { scheme: 'weekly-volume', mevSets: 2, mrvSets: 4 },
      week: 3,
      mesocycleWeeks: 3,
      deloadWeek: null,
      history: NO_HISTORY,
    })

    // Assert — grown sets are clones of the LAST working set, rest included
    expect(derived.map((s) => s.restSec)).toEqual([60, 180, 180, 180])
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
    restSec: null,
    technique: null,
    derivedFrom: 'scheme',
    sourceIndex: 0,
  } as const

  it('lets a non-null override field win over the derived value', () => {
    const result = applyOverride(base, { suggestedLoadKg: 95, repMin: null, repMax: null, rir: null, rpe: null, tempo: null, durationSec: null, distanceM: null, restSec: null, technique: null })
    expect(result.loadKg).toBe(95)
    expect(result.repMin).toBe(8) // null override field = not overridden
    expect(result.derivedFrom).toBe('override')
  })

  it('lets a non-null override restSec win over the template rest', () => {
    // Arrange — base carries no rest; the week pins 150 s
    const override = { suggestedLoadKg: null, repMin: null, repMax: null, rir: null, rpe: null, tempo: null, durationSec: null, distanceM: null, restSec: 150, technique: null }

    // Act
    const result = applyOverride(base, override)

    // Assert — restSec is overridable like every other target field
    expect(result.restSec).toBe(150)
    expect(result.derivedFrom).toBe('override')
  })

  it('returns the set untouched when there is no override row', () => {
    expect(applyOverride(base, undefined)).toBe(base)
  })

  it('returns the set untouched when the override row is all-null', () => {
    const result = applyOverride(base, { suggestedLoadKg: null, repMin: null, repMax: null, rir: null, rpe: null, tempo: null, durationSec: null, distanceM: null, restSec: null, technique: null })
    expect(result).toEqual(base)
    expect(result.derivedFrom).toBe('scheme')
  })
})

describe('resolveDeloadPolicy', () => {
  const LEGACY_SCHEDULED = {
    mode: 'scheduled',
    shape: { loadFactor: DELOAD_LOAD_FACTOR, setFactor: DELOAD_SET_FACTOR, rpeCap: null },
  }

  it('passes a valid stored policy through untouched', () => {
    expect(resolveDeloadPolicy({ mode: 'none' }, 4)).toEqual({ mode: 'none' })
    expect(resolveDeloadPolicy({ mode: 'reactive' }, 4)).toEqual({ mode: 'reactive' })
    const scheduled = {
      mode: 'scheduled',
      shape: { loadFactor: 0.7, setFactor: 0.6, rpeCap: 7 },
    }
    expect(resolveDeloadPolicy(scheduled, null)).toEqual(scheduled)
  })

  it('resolves null to the legacy regime (deloadWeek set → historical scheduled)', () => {
    expect(resolveDeloadPolicy(null, 4)).toEqual(LEGACY_SCHEDULED)
    expect(resolveDeloadPolicy(null, null)).toEqual({ mode: 'none' })
  })

  it('degrades an INVALID blob to legacy — silence over corruption, never a throw', () => {
    const garbage = [
      { mode: 'weird' },
      { mode: 'scheduled' }, // shape missing
      { mode: 'none', extra: 1 }, // strict
      'scheduled',
      42,
      undefined,
    ]
    for (const blob of garbage) {
      expect(resolveDeloadPolicy(blob, 4), JSON.stringify(blob)).toEqual(LEGACY_SCHEDULED)
      expect(resolveDeloadPolicy(blob, null), JSON.stringify(blob)).toEqual({ mode: 'none' })
    }
  })

  it('applies the scheduled shape defaults when the stored shape is partial', () => {
    expect(resolveDeloadPolicy({ mode: 'scheduled', shape: { loadFactor: 0.9 } }, 4)).toEqual({
      mode: 'scheduled',
      shape: { loadFactor: 0.9, setFactor: DELOAD_SET_FACTOR, rpeCap: null },
    })
  })
})

describe('deriveWeekSets under a deload policy', () => {
  const geometry = { mesocycleWeeks: 4, deloadWeek: 4 }
  const linear = { scheme: 'linear', incrementKg: 2.5 } as const

  it("mode 'none' derives the deload week as a NORMAL week (no modifier, no stamp)", () => {
    const derived = deriveWeekSets({
      sets: workingSets(4, 100),
      progression: linear,
      week: 4,
      history: NO_HISTORY,
      ...geometry,
      deloadPolicy: { mode: 'none' },
    })
    // Geometry unchanged: weeks 1-3 are the axis, so week 4 sits at 3 steps —
    // but NO deload factor, NO set halving, NO 'deload' stamp.
    expect(derived).toHaveLength(4)
    derived.forEach((s) => {
      expect(s.loadKg).toBeCloseTo(107.5, 9)
      expect(s.derivedFrom).toBe('scheme')
    })
  })

  it("mode 'reactive' derives the deload week identically to 'none'", () => {
    const args = {
      sets: workingSets(4, 100),
      progression: linear,
      week: 4,
      history: NO_HISTORY,
      ...geometry,
    } as const
    expect(deriveWeekSets({ ...args, deloadPolicy: { mode: 'reactive' } })).toEqual(
      deriveWeekSets({ ...args, deloadPolicy: { mode: 'none' } }),
    )
  })

  it("the omitted policy IS the legacy resolution — byte-identical either way", () => {
    const args = {
      sets: workingSets(4, 100),
      progression: linear,
      week: 4,
      history: NO_HISTORY,
      ...geometry,
    } as const
    expect(deriveWeekSets({ ...args, deloadPolicy: resolveDeloadPolicy(null, 4) })).toEqual(
      deriveWeekSets(args),
    )
  })

  it('a scheduled shape parameterizes the factors (loadFactor 0.7, setFactor 1)', () => {
    const derived = deriveWeekSets({
      sets: workingSets(4, 100),
      progression: linear,
      week: 4,
      history: NO_HISTORY,
      ...geometry,
      deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.7, setFactor: 1, rpeCap: null } },
    })
    expect(derived).toHaveLength(4) // setFactor 1 keeps every working set
    derived.forEach((s) => {
      expect(s.loadKg).toBeCloseTo(107.5 * 0.7, 9)
      expect(s.derivedFrom).toBe('deload')
    })
  })

  it('rpeCap clamps derived RPE stamps on the deload week — null stays null', () => {
    const sets = [
      workingSet({ setNumber: 1, suggestedLoadKg: 100, rpe: 9 }),
      workingSet({ setNumber: 2, suggestedLoadKg: 100, rpe: 6 }),
      workingSet({ setNumber: 3, suggestedLoadKg: 100, rpe: null }),
    ]
    const derived = deriveWeekSets({
      sets,
      progression: linear,
      week: 4,
      history: NO_HISTORY,
      ...geometry,
      deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.85, setFactor: 1, rpeCap: 7 } },
    })
    expect(derived.map((s) => s.rpe)).toEqual([7, 6, null]) // clamp, keep, never invent
  })

  describe('amrap-cycle tmBumpTiming + deloadRow', () => {
    const bench = {
      scheme: 'amrap-cycle',
      trainingMaxKg: 100,
      incrementKg: 2.5,
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
    } as const
    const scheduled = {
      mode: 'scheduled',
      shape: { loadFactor: DELOAD_LOAD_FACTOR, setFactor: DELOAD_SET_FACTOR, rpeCap: null },
    } as const
    const derive = (week: number, progression: typeof linear | Record<string, unknown>) =>
      deriveWeekSets({
        sets: workingSets(3, null),
        progression: progression as never,
        week,
        history: NO_HISTORY,
        ...geometry,
        deloadPolicy: scheduled,
      })

    it("'after-deload' + deloadRow emits the row off the OLD (unbumped) TM", () => {
      const derived = derive(4, {
        ...bench,
        tmBumpTiming: 'after-deload',
        deloadRow: { percents: [0.4, 0.5, 0.6], reps: 5 },
      })
      expect(derived.map((s) => s.loadKg)).toEqual([40, 50, 60]) // TM 100, not 102.5
      expect(derived.map((s) => s.repMin)).toEqual([5, 5, 5])
      derived.forEach((s) => expect(s.derivedFrom).toBe('deload'))
    })

    it("'before-deload' + deloadRow emits the row off the BUMPED TM (legacy timing)", () => {
      const derived = derive(4, {
        ...bench,
        tmBumpTiming: 'before-deload',
        deloadRow: { percents: [0.4, 0.5, 0.6], reps: 5 },
      })
      expect(derived.map((s) => s.loadKg)).toEqual([41, 51.25, 61.5]) // TM 102.5
    })

    it("'after-deload' WITHOUT a deloadRow scale-shapes off the OLD TM", () => {
      const derived = derive(4, { ...bench, tmBumpTiming: 'after-deload' })
      expect(derived).toHaveLength(2) // set halving still applies
      expect(derived[0].loadKg).toBeCloseTo(100 * 0.65 * DELOAD_LOAD_FACTOR, 9)
      expect(derived[1].loadKg).toBeCloseTo(100 * 0.75 * DELOAD_LOAD_FACTOR, 9)
    })

    it("the withheld bump lands on the first post-deload week ('after-deload')", () => {
      const derived = deriveWeekSets({
        sets: workingSets(3, null),
        progression: { ...bench, tmBumpTiming: 'after-deload' } as never,
        week: 5,
        mesocycleWeeks: 8,
        deloadWeek: 4,
        history: NO_HISTORY,
        deloadPolicy: scheduled,
      })
      expect(derived[0].loadKg).toBeCloseTo(102.5 * 0.65, 9) // cycle 2 off the NEW TM
    })

    it("an ABSENT timing on a stored row means 'before-deload' (migration semantics)", () => {
      const stamped = derive(4, { ...bench, tmBumpTiming: 'before-deload' })
      const absent = derive(4, bench)
      expect(absent).toEqual(stamped)
    })

    it("mode 'none' derives the amrap deload week as a normal wave week", () => {
      const derived = deriveWeekSets({
        sets: workingSets(3, null),
        progression: { ...bench, tmBumpTiming: 'after-deload' } as never,
        week: 4,
        history: NO_HISTORY,
        ...geometry,
        deloadPolicy: { mode: 'none' },
      })
      // 3 steps → wave row 1 again, bumped TM (a normal week owns its bump),
      // full set count, no deload stamp.
      expect(derived).toHaveLength(3)
      expect(derived[0].loadKg).toBeCloseTo(102.5 * 0.65, 9)
      derived.forEach((s) => expect(s.derivedFrom).toBe('scheme'))
    })
  })

  describe('amrapBankableWaves (the wave-boundary persist gate)', () => {
    it("withholds the bank when starting an 'after-deload' scheduled deload week", () => {
      expect(
        amrapBankableWaves(4, 8, 4, 3, { tmBumpTiming: 'after-deload', isScheduledDeload: true }),
      ).toBe(0)
      // The first post-deload week banks it.
      expect(
        amrapBankableWaves(5, 8, 4, 3, { tmBumpTiming: 'after-deload', isScheduledDeload: false }),
      ).toBe(1)
    })

    it("banks on the deload week under 'before-deload' (current behavior exactly)", () => {
      expect(
        amrapBankableWaves(4, 8, 4, 3, { tmBumpTiming: 'before-deload', isScheduledDeload: true }),
      ).toBe(amrapCompletedWaves(4, 8, 4, 3))
      // Absent timing on a stored row = the migration-stamped legacy meaning.
      expect(
        amrapBankableWaves(4, 8, 4, 3, { tmBumpTiming: undefined, isScheduledDeload: true }),
      ).toBe(amrapCompletedWaves(4, 8, 4, 3))
    })

    it("a non-scheduled deload week (policy 'none'/'reactive') banks on schedule", () => {
      expect(
        amrapBankableWaves(4, 8, 4, 3, { tmBumpTiming: 'after-deload', isScheduledDeload: false }),
      ).toBe(1)
    })
  })
})
