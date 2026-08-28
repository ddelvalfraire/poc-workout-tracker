import { describe, it, expect } from 'vitest'
import {
  aggregateBigThree,
  aggregateCardioRecords,
  aggregateDistanceWeek,
  type RecordSetRow,
} from './records'

const AT = new Date('2026-03-04T10:00:00Z')

function row(over: Partial<RecordSetRow> = {}): RecordSetRow {
  return {
    workoutId: 'w1',
    performedAt: AT,
    source: 'wger',
    wgerExerciseId: 615, // canonical squat
    exerciseName: 'Squats',
    loggingType: 'weight_reps',
    reps: 5,
    weight: 100,
    durationSec: null,
    distanceM: null,
    ...over,
  }
}

describe('aggregateBigThree', () => {
  it('keeps the best e1RM per lift', () => {
    const { bests } = aggregateBigThree(
      [row({ reps: 5, weight: 100 }), row({ workoutId: 'w2', reps: 3, weight: 120 })],
      null,
    )
    // 120x3 estimates higher than 100x5.
    expect(bests.squat?.workoutId).toBe('w2')
  })

  it('keeps a tie on the earliest set', () => {
    const { bests } = aggregateBigThree(
      [row({ workoutId: 'first' }), row({ workoutId: 'second' })],
      null,
    )
    expect(bests.squat?.workoutId).toBe('first')
  })

  it('ignores exercises that are not a canonical lift', () => {
    const { bests, totalKg } = aggregateBigThree(
      [row({ wgerExerciseId: 999999, exerciseName: 'Leg Extension' })],
      null,
    )
    expect(bests).toEqual({})
    expect(totalKg).toBeNull()
  })

  it('withholds the total until all three lifts have a best', () => {
    // A total missing a lift is not a smaller total, it is not a total.
    const squatOnly = aggregateBigThree([row()], null)
    expect(squatOnly.bests.squat).toBeDefined()
    expect(squatOnly.totalKg).toBeNull()

    const all = aggregateBigThree(
      [
        row({ wgerExerciseId: 615, exerciseName: 'Squats' }),
        row({ wgerExerciseId: 73, exerciseName: 'Bench Press' }),
        row({ wgerExerciseId: 184, exerciseName: 'Deadlift' }),
      ],
      null,
    )
    // Unguarded on purpose: wrapping this in `if (totalKg !== null)` let the
    // assertion pass vacuously when a wger id stopped matching a lift, which
    // is exactly the regression it exists to catch.
    expect(all.bests.squat).toBeDefined()
    expect(all.bests.bench).toBeDefined()
    expect(all.bests.deadlift).toBeDefined()
    expect(all.totalKg).toBeCloseTo(
      all.bests.squat!.e1rmKg + all.bests.bench!.e1rmKg + all.bests.deadlift!.e1rmKg,
      6,
    )
  })

  it('skips sets that cannot be scored at all', () => {
    const { bests } = aggregateBigThree([row({ reps: null }), row({ weight: null })], null)
    expect(bests.squat).toBeUndefined()
  })

  it('scores a bodyweight lift only when a bodyweight is known', () => {
    const bw = row({ loggingType: 'bodyweight_reps', weight: null, reps: 5 })
    expect(aggregateBigThree([bw], null).bests.squat).toBeUndefined()
    expect(aggregateBigThree([bw], 80).bests.squat).toBeDefined()
  })

  it('is pure', () => {
    const rows = [row()]
    const snapshot = JSON.parse(JSON.stringify(rows))
    aggregateBigThree(rows, null)
    expect(JSON.parse(JSON.stringify(rows))).toEqual(snapshot)
  })
})

describe('aggregateCardioRecords', () => {
  const cardio = (over: Partial<RecordSetRow>) =>
    row({ reps: null, weight: null, loggingType: 'weight_reps', ...over })

  it('finds the longest duration and distance independently', () => {
    const out = aggregateCardioRecords([
      cardio({ workoutId: 'a', durationSec: 1800, distanceM: null }),
      cardio({ workoutId: 'b', durationSec: null, distanceM: 14200 }),
    ])
    expect(out.longestDurationSec?.workoutId).toBe('a')
    expect(out.longestDistanceM?.workoutId).toBe('b')
    // Neither row carries both, so there is no pace to compute.
    expect(out.bestPace).toBeNull()
  })

  it('computes pace only from sets carrying both duration and distance', () => {
    const out = aggregateCardioRecords([cardio({ durationSec: 1500, distanceM: 5000 })])
    expect(out.bestPace?.secPerKm).toBe(300)
  })

  it('treats a LOWER pace as the better record', () => {
    const out = aggregateCardioRecords([
      cardio({ workoutId: 'slow', durationSec: 1800, distanceM: 5000 }),
      cardio({ workoutId: 'fast', durationSec: 1400, distanceM: 5000 }),
    ])
    expect(out.bestPace?.workoutId).toBe('fast')
  })

  it('ignores zero and negative measurements', () => {
    const out = aggregateCardioRecords([cardio({ durationSec: 0, distanceM: 0 })])
    expect(out).toEqual({
      bestPace: null,
      longestDistanceM: null,
      longestDurationSec: null,
    })
  })

  it('returns three nulls for a history with no cardio at all', () => {
    expect(aggregateCardioRecords([row()])).toEqual({
      bestPace: null,
      longestDistanceM: null,
      longestDurationSec: null,
    })
  })
})

describe('aggregateDistanceWeek', () => {
  it('reports the current total and the delta', () => {
    expect(aggregateDistanceWeek(18400, 15300)).toEqual({
      currentM: 18400,
      deltaM: 3100,
    })
  })

  it('refuses a hollow comparison against an empty previous window', () => {
    expect(aggregateDistanceWeek(18400, 0)).toEqual({
      currentM: 18400,
      deltaM: null,
    })
  })

  it('renders nothing when the week holds no distance', () => {
    expect(aggregateDistanceWeek(0, 9000)).toBeNull()
  })
})
