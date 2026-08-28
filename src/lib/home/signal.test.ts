import { describe, it, expect } from 'vitest'
import {
  classifyTrainingSignal,
  defaultLayoutFor,
  medianReps,
  aggregateTrainingFacts,
  SIGNAL_WINDOW_WEEKS,
  type TrainingFacts,
  type SignalSetRow,
  type StatedFacts,
} from './signal'
import { applyPreset, GENERAL_PRESET_ID, HOME_PRESETS } from './presets'

/** A blank slate with enough volume to be readable, so each test states only
 *  the fact it is actually about. */
function facts(overrides: Partial<TrainingFacts> = {}): TrainingFacts {
  return {
    dietPhase: null,
    bodyweightGoalDirection: null,
    hasStrengthGoal: false,
    medianWorkingReps: 10,
    muscleGroupCount: 6,
    hasBigThree: false,
    workingSetCount: 120,
    conditioningSetCount: 0,
    ...overrides,
  }
}

describe('the firewall', () => {
  it('accepts only training facts — no field a home interaction could fill', () => {
    // Structural, deliberately. The loop this prevents forms by feeding
    // home-screen behaviour back into the read, so adding such a field IS the
    // bug — pinned here rather than described in a comment nobody runs.
    expect(Object.keys(facts()).sort()).toEqual([
      'bodyweightGoalDirection',
      'conditioningSetCount',
      'dietPhase',
      'hasBigThree',
      'hasStrengthGoal',
      'medianWorkingReps',
      'muscleGroupCount',
      'workingSetCount',
    ])
  })

  it('is a pure function of its facts — same input, same verdict, every time', () => {
    const input = facts({ dietPhase: 'cutting' })
    expect(classifyTrainingSignal(input)).toEqual(classifyTrainingSignal(input))
  })

  it('never mutates the facts it is handed', () => {
    const input = facts({ dietPhase: 'bulking' })
    const snapshot = JSON.stringify(input)
    classifyTrainingSignal(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('classifyTrainingSignal', () => {
  it('reads nothing from too little training — a fresh account is not a verdict', () => {
    expect(classifyTrainingSignal(facts({ workingSetCount: 0 }))).toBeNull()
    expect(classifyTrainingSignal(facts({ workingSetCount: 19 }))).toBeNull()
    expect(classifyTrainingSignal(facts({ workingSetCount: 20 }))).not.toBeNull()
  })

  it('lets a STATED phase outrank anything inferred from rep ranges', () => {
    // Training like a powerlifter while cutting is the common case, and
    // calling it powerlifting would be the more annoying error.
    const powerliftingShaped = {
      medianWorkingReps: 4,
      hasBigThree: true,
      hasStrengthGoal: true,
    } as const
    expect(
      classifyTrainingSignal(facts({ ...powerliftingShaped, dietPhase: 'cutting' }))?.preset,
    ).toBe('cut')
    expect(
      classifyTrainingSignal(facts({ ...powerliftingShaped, dietPhase: 'bulking' }))?.preset,
    ).toBe('bulk')
  })

  it('falls back to a bodyweight goal direction when no phase is set', () => {
    expect(classifyTrainingSignal(facts({ bodyweightGoalDirection: 'down' }))?.preset).toBe('cut')
    expect(classifyTrainingSignal(facts({ bodyweightGoalDirection: 'up' }))?.preset).toBe('bulk')
  })

  it('prefers the phase over the goal direction when the two disagree', () => {
    expect(
      classifyTrainingSignal(facts({ dietPhase: 'bulking', bodyweightGoalDirection: 'down' }))
        ?.preset,
    ).toBe('bulk')
  })

  it('reads conditioning off the share of the week, not the rep range', () => {
    expect(
      classifyTrainingSignal(facts({ workingSetCount: 100, conditioningSetCount: 30 }))?.preset,
    ).toBe('conditioning')
    // Just under the bar is a warm-up habit, not a training style.
    expect(
      classifyTrainingSignal(facts({ workingSetCount: 100, conditioningSetCount: 29 }))?.preset,
    ).not.toBe('conditioning')
  })

  it('wants the rep range AND the movements AND a target before saying powerlifting', () => {
    const full = { medianWorkingReps: 5, hasBigThree: true, hasStrengthGoal: true } as const
    expect(classifyTrainingSignal(facts(full))?.preset).toBe('powerlifting')
    // Drop any one leg; the verdict must not survive on the other two.
    expect(classifyTrainingSignal(facts({ ...full, hasBigThree: false }))?.preset).not.toBe(
      'powerlifting',
    )
    expect(classifyTrainingSignal(facts({ ...full, hasStrengthGoal: false }))?.preset).not.toBe(
      'powerlifting',
    )
    expect(classifyTrainingSignal(facts({ ...full, medianWorkingReps: 7 }))?.preset).not.toBe(
      'powerlifting',
    )
  })

  it('reads hypertrophy from a moderate rep range across enough of the body', () => {
    expect(
      classifyTrainingSignal(facts({ medianWorkingReps: 11, muscleGroupCount: 7 }))?.preset,
    ).toBe('hypertrophy')
    expect(classifyTrainingSignal(facts({ medianWorkingReps: 11, muscleGroupCount: 4 }))).toBeNull()
    expect(classifyTrainingSignal(facts({ medianWorkingReps: 21, muscleGroupCount: 7 }))).toBeNull()
  })

  it('stays silent when nothing carries reps and nothing else applies', () => {
    expect(classifyTrainingSignal(facts({ medianWorkingReps: null }))).toBeNull()
  })

  it('reports the evidence behind whatever it decided', () => {
    const signal = classifyTrainingSignal(facts({ medianWorkingReps: 11, muscleGroupCount: 7 }))
    expect(signal).not.toBeNull()
    expect(signal!.medianWorkingReps).toBe(11)
    expect(signal!.muscleGroupCount).toBe(7)
    expect(signal!.windowWeeks).toBe(SIGNAL_WINDOW_WEEKS)
  })

  it('only ever names a preset that exists', () => {
    const ids = new Set(HOME_PRESETS.map((p) => p.id))
    const cases: Partial<TrainingFacts>[] = [
      { dietPhase: 'cutting' },
      { dietPhase: 'bulking' },
      { bodyweightGoalDirection: 'down' },
      { bodyweightGoalDirection: 'up' },
      { workingSetCount: 100, conditioningSetCount: 60 },
      { medianWorkingReps: 4, hasBigThree: true, hasStrengthGoal: true },
      { medianWorkingReps: 11, muscleGroupCount: 7 },
    ]
    for (const override of cases) {
      const signal = classifyTrainingSignal(facts(override))
      expect(signal).not.toBeNull()
      expect(ids).toContain(signal!.preset)
    }
  })
})

describe('defaultLayoutFor', () => {
  it('seeds a home from the signal when there is one', () => {
    expect(defaultLayoutFor(classifyTrainingSignal(facts({ dietPhase: 'cutting' })))).toEqual(
      applyPreset('cut'),
    )
  })

  it('lands on the general preset when the signal reads nothing', () => {
    expect(defaultLayoutFor(null)).toEqual(applyPreset(GENERAL_PRESET_ID))
  })

  it('produces a complete, storable layout for every archetype it can name', () => {
    for (const preset of HOME_PRESETS) {
      const seeded = defaultLayoutFor({
        preset: preset.id,
        medianWorkingReps: 8,
        muscleGroupCount: 6,
        windowWeeks: SIGNAL_WINDOW_WEEKS,
      })
      expect(seeded.some((s) => !s.hidden)).toBe(true)
      expect(new Set(seeded.map((s) => s.id)).size).toBe(seeded.length)
    }
  })
})

describe('aggregateTrainingFacts', () => {
  const STATED: StatedFacts = {
    dietPhase: null,
    bodyweightGoalDirection: null,
    hasStrengthGoal: false,
  }

  function row(overrides: Partial<SignalSetRow> = {}): SignalSetRow {
    return {
      reps: 8,
      metricMode: 'reps_weight',
      source: 'wger',
      wgerExerciseId: 73,
      exerciseName: 'Bench Press',
      muscles: ['Chest'],
      ...overrides,
    }
  }

  it('passes the stated facts through untouched — rows cannot overrule them', () => {
    const stated: StatedFacts = {
      dietPhase: 'cutting',
      bodyweightGoalDirection: 'down',
      hasStrengthGoal: true,
    }
    const facts = aggregateTrainingFacts([row()], stated)
    expect(facts.dietPhase).toBe('cutting')
    expect(facts.bodyweightGoalDirection).toBe('down')
    expect(facts.hasStrengthGoal).toBe(true)
  })

  it('counts every set, and sorts each into reps or conditioning', () => {
    const rows = [
      row(),
      row(),
      row({ metricMode: 'duration', reps: null }),
      row({ metricMode: 'duration_distance', reps: null }),
    ]
    const facts = aggregateTrainingFacts(rows, STATED)
    expect(facts.workingSetCount).toBe(4)
    expect(facts.conditioningSetCount).toBe(2)
  })

  it('ignores reps on a non-reps_weight row — they describe nothing', () => {
    // Nothing in the write path forces reps null on a duration row, and a
    // stray 30 there would drag the median out of every meaningful band.
    const rows = [row({ reps: 5 }), row({ reps: 5 }), row({ metricMode: 'duration', reps: 30 })]
    expect(aggregateTrainingFacts(rows, STATED).medianWorkingReps).toBe(5)
  })

  it('has no median when nothing in the window carries reps', () => {
    const rows = [row({ metricMode: 'duration', reps: null })]
    expect(aggregateTrainingFacts(rows, STATED).medianWorkingReps).toBeNull()
  })

  it('counts distinct muscle groups, not muscles or sets', () => {
    const rows = [
      row({ muscles: ['Chest'] }),
      row({ muscles: ['Chest'] }),
      row({ muscles: ['Quads', 'Glutes'] }),
    ]
    const facts = aggregateTrainingFacts(rows, STATED)
    expect(facts.muscleGroupCount).toBeGreaterThanOrEqual(2)
    expect(facts.muscleGroupCount).toBeLessThan(rows.length + 1)
  })

  it('credits no group for an untagged or unrecognized exercise', () => {
    // A gap in the catalog must not inflate the breadth being measured.
    const rows = [row({ muscles: null }), row({ muscles: [] }), row({ muscles: ['Not A Muscle'] })]
    expect(aggregateTrainingFacts(rows, STATED).muscleGroupCount).toBe(0)
  })

  it('needs all three lifts before it reports the big three', () => {
    const squat = row({ wgerExerciseId: 615, exerciseName: 'Barbell Squat' })
    const bench = row({ wgerExerciseId: 73, exerciseName: 'Bench Press' })
    const deadlift = row({ wgerExerciseId: 184, exerciseName: 'Deadlift' })
    expect(aggregateTrainingFacts([squat, bench], STATED).hasBigThree).toBe(false)
    expect(aggregateTrainingFacts([squat, bench, deadlift], STATED).hasBigThree).toBe(true)
  })

  it('reads nothing at all from an empty window', () => {
    const facts = aggregateTrainingFacts([], STATED)
    expect(facts.workingSetCount).toBe(0)
    expect(facts.medianWorkingReps).toBeNull()
    expect(facts.muscleGroupCount).toBe(0)
    expect(facts.hasBigThree).toBe(false)
    // And that is below the readable floor, so no verdict comes out of it.
    expect(classifyTrainingSignal(facts)).toBeNull()
  })

  it('never mutates the rows it is handed', () => {
    const rows = [row(), row({ metricMode: 'duration', reps: null })]
    const snapshot = JSON.stringify(rows)
    aggregateTrainingFacts(rows, STATED)
    expect(JSON.stringify(rows)).toBe(snapshot)
  })
})

describe('medianReps', () => {
  it('has no median without readings', () => {
    expect(medianReps([])).toBeNull()
  })

  it('takes the middle of an odd count, in any order', () => {
    expect(medianReps([5, 12, 8])).toBe(8)
    expect(medianReps([8, 5, 12])).toBe(8)
  })

  it('averages the two middles of an even count rather than picking a side', () => {
    // 5s and 8s are a 6.5 median, which lands outside the strength band —
    // picking either middle would silently move the verdict.
    expect(medianReps([5, 5, 8, 8])).toBe(6.5)
  })

  it('never mutates its input', () => {
    const reps = [12, 3, 7]
    medianReps(reps)
    expect(reps).toEqual([12, 3, 7])
  })
})
