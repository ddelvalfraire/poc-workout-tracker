import { describe, it, expect } from 'vitest'
import { collectTmRestartFlags, collectTmIncrements } from './tm-restart'
import type { Progression } from '@/lib/programs/program-input'
import type { AutoregAdjustment } from '@/lib/programs/autoregulate'

const amrap = (trainingMaxKg: number, incrementKg: number): Progression =>
  ({
    scheme: 'amrap-cycle',
    trainingMaxKg,
    incrementKg,
    wave: [[0.85]],
  }) as Progression

const percent = (trainingMaxKg: number): Progression =>
  ({ scheme: 'percent-1rm', trainingMaxKg, weekPercents: [0.85] }) as Progression

const linear: Progression = { scheme: 'linear', incrementKg: 2.5 } as Progression

const FLAG = { action: 'flag' } as AutoregAdjustment
const STEP = { action: 'step' } as AutoregAdjustment

describe('collectTmRestartFlags', () => {
  it('collects every flagged TM-bearing address, both schemes, no dedupe', () => {
    // Arrange — Squat appears on two days, flagged on both
    const days = [
      {
        exercises: [
          { name: 'Squat', progression: amrap(140, 2.5) },
          { name: 'Row', progression: linear },
        ],
      },
      {
        exercises: [
          { name: 'Squat', progression: amrap(140, 2.5) },
          { name: 'Bench', progression: percent(100) },
        ],
      },
    ]
    const prescriptions = [
      [{ autoreg: FLAG }, { autoreg: FLAG }], // Row's flag must NOT collect (no TM scheme)
      [{ autoreg: FLAG }, { autoreg: FLAG }],
    ]

    // Act
    const flags = collectTmRestartFlags(days, prescriptions)

    // Assert — both Squat addresses AND the percent-1rm Bench
    expect(flags).toEqual([
      { exerciseName: 'Squat', dayPosition: 0, exercisePosition: 0, currentTmKg: 140 },
      { exerciseName: 'Squat', dayPosition: 1, exercisePosition: 0, currentTmKg: 140 },
      { exerciseName: 'Bench', dayPosition: 1, exercisePosition: 1, currentTmKg: 100 },
    ])
  })

  it('ignores non-flag verdicts and missing prescriptions (collapsed days)', () => {
    const days = [
      { exercises: [{ name: 'Squat', progression: amrap(140, 2.5) }] },
      { exercises: [{ name: 'Press', progression: amrap(60, 2.5) }] },
    ]
    // Day 1 stepped, day 2 never derived — neither flags.
    expect(collectTmRestartFlags(days, [[{ autoreg: STEP }], []])).toEqual([])
  })
})

describe('collectTmIncrements', () => {
  const days = [
    {
      exercises: [
        { name: 'Squat', progression: amrap(140, 2.5) },
        { name: 'Bench', progression: amrap(100, 2.5) },
        { name: 'Row', progression: linear },
        { name: 'OHP', progression: percent(60) },
      ],
    },
    {
      exercises: [
        { name: 'Deadlift', progression: amrap(180, 5) },
        { name: 'Static wave', progression: amrap(80, 0) }, // 0 increment = never bumps
      ],
    },
  ]

  it('bumps every clean amrap-cycle exercise by exactly one increment', () => {
    // Act — no flags: a clean block
    const increments = collectTmIncrements(days, [])

    // Assert — linear/percent-1rm/static-wave all excluded
    expect(increments).toEqual([
      { exerciseName: 'Squat', dayPosition: 0, exercisePosition: 0, fromKg: 140, toKg: 142.5 },
      { exerciseName: 'Bench', dayPosition: 0, exercisePosition: 1, fromKg: 100, toKg: 102.5 },
      { exerciseName: 'Deadlift', dayPosition: 1, exercisePosition: 0, fromKg: 180, toKg: 185 },
    ])
  })

  it('skips exactly the flagged addresses (M4 → no auto-increment)', () => {
    // Act — Bench flagged; Squat/Deadlift stay clean
    const increments = collectTmIncrements(days, [{ dayPosition: 0, exercisePosition: 1 }])

    // Assert
    expect(increments.map((i) => i.exerciseName)).toEqual(['Squat', 'Deadlift'])
  })
})
