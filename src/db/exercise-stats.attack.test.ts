import { describe, it, expect } from 'vitest'
import {
  aggregateExerciseStats,
  aggregateLoggedExercises,
  type ExerciseStatsRow,
  type LoggedExerciseRow,
} from './exercise-stats'
import { sessionBestSet } from '@/lib/session-best-set'

/**
 * ADVERSARIAL VERIFICATION of cardio v1 slice 3 (#219 / PR #242) — the stats
 * layer. Spec claims under attack:
 *  - the cardio trio (longest duration / longest distance / best pace) is
 *    claimed ONLY by non-reps_weight rows, warmups and uncompleted excluded;
 *  - best pace exists only when BOTH duration and distance are positive
 *    (no division blowups, sec/km units, no m/s leak);
 *  - lifting volume / e1RM / rep records EXCLUDE duration sets even when a
 *    timed row carries stray weight+reps;
 *  - session-best-set keeps skipping timed rows.
 * Pure-aggregate fixtures only; evidence, never fixes.
 */

const S1 = new Date('2026-08-01T10:00:00Z')
const S2 = new Date('2026-08-03T10:00:00Z')
const S3 = new Date('2026-08-05T10:00:00Z')

function row(overrides: Partial<ExerciseStatsRow> = {}): ExerciseStatsRow {
  return {
    workoutId: 'w1',
    startedAt: S1,
    reps: null,
    weight: null,
    completed: true,
    metricMode: 'reps_weight',
    setType: 'working',
    durationSec: null,
    distanceM: null,
    ...overrides,
  }
}

const cardio = (overrides: Partial<ExerciseStatsRow> = {}): ExerciseStatsRow =>
  row({ metricMode: 'duration_distance', ...overrides })

describe('ATTACK: best pace division edges', () => {
  it('durationSec = 0 claims nothing — no pace, no zero-duration record', () => {
    const stats = aggregateExerciseStats(
      [cardio({ durationSec: 0, distanceM: 5000 })],
      'weight_reps',
    )
    expect(stats.records.bestPace).toBeNull()
    expect(stats.records.longestDuration).toBeNull()
    expect(stats.records.longestDistance).toMatchObject({ distanceM: 5000 })
  })

  it('distanceM = 0 produces no pace and no Infinity/NaN anywhere', () => {
    const stats = aggregateExerciseStats(
      [cardio({ durationSec: 1800, distanceM: 0 })],
      'weight_reps',
    )
    expect(stats.records.bestPace).toBeNull()
    expect(stats.records.longestDistance).toBeNull()
    expect(stats.records.longestDuration).toMatchObject({ durationSec: 1800 })
  })

  it('distance with NO duration claims only the distance record — never a pace', () => {
    const stats = aggregateExerciseStats(
      [cardio({ durationSec: null, distanceM: 3000 })],
      'weight_reps',
    )
    expect(stats.records.longestDistance).toMatchObject({ distanceM: 3000 })
    expect(stats.records.longestDuration).toBeNull()
    expect(stats.records.bestPace).toBeNull()
  })

  it('pace is seconds-per-km (not m/s): 1500 s over 5000 m = 300 s/km', () => {
    const stats = aggregateExerciseStats(
      [cardio({ durationSec: 1500, distanceM: 5000 })],
      'weight_reps',
    )
    expect(stats.records.bestPace?.secPerKm).toBe(300)
    // An m/s leak would read 5000/1500 ≈ 3.33; a sec/m leak 0.3.
    expect(stats.records.bestPace?.secPerKm).not.toBeCloseTo(3.33, 1)
  })

  it('best pace is the LOWEST sec/km, strictly-lower keeps ties on the earliest session', () => {
    const stats = aggregateExerciseStats(
      [
        cardio({ workoutId: 'w1', startedAt: S1, durationSec: 1500, distanceM: 5000 }), // 300
        cardio({ workoutId: 'w2', startedAt: S2, durationSec: 300, distanceM: 1000 }), // 300 tie
        cardio({ workoutId: 'w3', startedAt: S3, durationSec: 1600, distanceM: 5000 }), // 320 worse
      ],
      'weight_reps',
    )
    expect(stats.records.bestPace?.workoutId).toBe('w1')
    expect(stats.records.bestPace?.secPerKm).toBe(300)
  })

  it('a sub-metre distance stays finite (no overflow-style blowup)', () => {
    const stats = aggregateExerciseStats(
      [cardio({ durationSec: 60, distanceM: 0.5 })],
      'weight_reps',
    )
    expect(Number.isFinite(stats.records.bestPace?.secPerKm)).toBe(true)
    expect(stats.records.bestPace?.secPerKm).toBe(120000)
  })
})

describe('ATTACK: cardio records scoring truth (warmup / uncompleted)', () => {
  it('a WARMUP timed set never claims any of the trio', () => {
    const stats = aggregateExerciseStats(
      [
        cardio({ setType: 'warmup', durationSec: 9999, distanceM: 99999 }),
        cardio({ durationSec: 600, distanceM: 2000 }),
      ],
      'weight_reps',
    )
    expect(stats.records.longestDuration?.durationSec).toBe(600)
    expect(stats.records.longestDistance?.distanceM).toBe(2000)
    expect(stats.records.bestPace?.durationSec).toBe(600)
  })

  it('an uncompleted timed set never claims any of the trio', () => {
    const stats = aggregateExerciseStats(
      [cardio({ completed: false, durationSec: 9999, distanceM: 99999 })],
      'weight_reps',
    )
    expect(stats.records.longestDuration).toBeNull()
    expect(stats.records.longestDistance).toBeNull()
    expect(stats.records.bestPace).toBeNull()
    expect(stats.totalSessions).toBe(0)
  })
})

describe('ATTACK: duration sets must not leak into lifting scoring', () => {
  it('a timed row carrying stray weight AND reps claims no e1RM/heaviest/mostReps/volume', () => {
    // weight 200 kg × 30 reps on a duration row — if any lifting gate is
    // porous this poisons every record on the board.
    const stats = aggregateExerciseStats(
      [
        cardio({ workoutId: 'w1', startedAt: S1, reps: 30, weight: 200, durationSec: 600 }),
        row({ workoutId: 'w2', startedAt: S2, reps: 5, weight: 100 }),
      ],
      'weight_reps',
    )
    expect(stats.records.bestE1rm?.workoutId).toBe('w2')
    expect(stats.records.bestE1rm?.weightKg).toBe(100)
    expect(stats.records.heaviestLoadKg?.weightKg).toBe(100)
    expect(stats.records.mostReps?.reps).toBe(5)
    expect(stats.records.bestSessionVolumeKg?.volumeKg).toBe(500) // never 6000
    expect(stats.trend).toHaveLength(1)
    expect(stats.trend[0].workoutId).toBe('w2')
    // ...while the SAME stray row still claims its cardio duration record.
    expect(stats.records.longestDuration?.workoutId).toBe('w1')
  })

  it('a reps_weight row carrying a stray durationSec never claims the cardio trio', () => {
    const stats = aggregateExerciseStats(
      [row({ reps: 5, weight: 100, durationSec: 3600, distanceM: 10000 })],
      'weight_reps',
    )
    expect(stats.records.longestDuration).toBeNull()
    expect(stats.records.longestDistance).toBeNull()
    expect(stats.records.bestPace).toBeNull()
  })

  it('a pure-cardio history yields NO lifting records but full session counts', () => {
    const stats = aggregateExerciseStats(
      [
        cardio({ workoutId: 'w1', startedAt: S1, durationSec: 1200 }),
        cardio({ workoutId: 'w2', startedAt: S2, durationSec: 1500 }),
      ],
      'weight_reps',
    )
    expect(stats.records.bestE1rm).toBeNull()
    expect(stats.records.heaviestLoadKg).toBeNull()
    expect(stats.records.mostReps).toBeNull()
    expect(stats.records.bestSessionVolumeKg).toBeNull()
    expect(stats.trend).toHaveLength(0)
    expect(stats.totalSessions).toBe(2)
    expect(stats.totalCompletedSets).toBe(2)
  })
})

describe('ATTACK: /exercises library aggregation keeps the metric gate', () => {
  function occ(overrides: Partial<LoggedExerciseRow> = {}): LoggedExerciseRow {
    return {
      wgerExerciseId: 1,
      source: 'wger',
      name: 'Rowing Machine',
      workoutId: 'w1',
      startedAt: S1,
      loggingType: 'weight_reps',
      reps: null,
      weight: null,
      completed: true,
      metricMode: 'reps_weight',
      setType: 'working',
      ...overrides,
    }
  }

  it('a timed row with stray weight+reps never scores an e1RM on the library list', () => {
    const list = aggregateLoggedExercises(
      [occ({ metricMode: 'duration', reps: 20, weight: 150 })],
      null,
      S3,
    )
    expect(list).toHaveLength(1)
    expect(list[0].bestE1rmKg).toBeNull()
    expect(list[0].lastPrAt).toBeNull()
    expect(list[0].sessionCount).toBe(1) // still listed — navigation truth
  })
})

describe('ATTACK: session-best-set keeps skipping timed rows', () => {
  it('a completed timed set with stray weight+reps cannot win the mark', () => {
    const best = sessionBestSet(
      [
        { reps: 30, weight: 200, completed: true, metricMode: 'duration', setType: 'working' },
        { reps: 5, weight: 100, completed: true, metricMode: 'reps_weight', setType: 'working' },
      ],
      'weight_reps',
    )
    expect(best?.index).toBe(1)
  })

  it('an all-cardio session marks nothing', () => {
    const best = sessionBestSet(
      [
        { reps: null, weight: null, completed: true, metricMode: 'duration', setType: 'working' },
        { reps: null, weight: null, completed: true, metricMode: 'duration_distance', setType: 'working' },
      ],
      'weight_reps',
    )
    expect(best).toBeNull()
  })
})
