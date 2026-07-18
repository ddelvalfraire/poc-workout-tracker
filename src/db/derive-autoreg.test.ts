import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Derive-path wiring tests for Layer 1 auto-regulation: deriveDayPrescription
 * consulting getRecentTrainedSessions (module-mocked, like the history reads
 * in instantiate-program.test.ts) and applying the verdict below overrides.
 * Prescribed targets for past sessions are RE-derived from the stamped week,
 * so the fixtures only supply actuals + weeks.
 */
const { lastPerformance, historyBefore, trainedSessions } = vi.hoisted(() => ({
  lastPerformance: vi.fn(),
  historyBefore: vi.fn(),
  trainedSessions: vi.fn(),
}))

vi.mock('./index', () => ({ db: {} }))
vi.mock('./workouts', () => ({
  getLastPerformance: lastPerformance,
  getExerciseHistoryBefore: historyBefore,
}))
vi.mock('./autoreg-history', () => ({
  getRecentTrainedSessions: trainedSessions,
}))

import { deriveDayPrescription, type DayForDerivation } from './programs'

const USER = 'user_123'

/** A one-exercise day: 3×(8-12) working sets, base 100 kg, 4-week block. */
function day(options: {
  progression?: unknown
  autoregulation?: boolean
  deloadWeek?: number | null
  overrides?: { week: number; [key: string]: unknown }[]
}): DayForDerivation {
  return {
    program: {
      id: 'p1',
      mesocycleWeeks: 4,
      deloadWeek: options.deloadWeek ?? null,
      autoregulation: options.autoregulation ?? true,
    },
    exercises: [
      {
        wgerExerciseId: 1,
        source: 'wger',
        progression: (options.progression ?? {
          scheme: 'linear',
          incrementKg: 2.5,
        }) as DayForDerivation['exercises'][number]['progression'],
        sets: [1, 2, 3].map((setNumber) => ({
          setNumber,
          setType: 'working' as const,
          metricMode: 'reps_weight' as const,
          repMin: 8,
          repMax: 12,
          rir: null,
          rpe: null,
          suggestedLoadKg: 100,
          tempo: null,
          durationSec: null,
          distanceM: null,
          restSec: null,
          technique: null,
          overrides: (options.overrides ?? []) as never,
        })),
      },
    ],
  }
}

/** A trained session at the stamped week whose 3 working sets hit `reps`. */
function trained(workoutId: string, programWeek: number, reps: number[], weightKg = 100) {
  return {
    workoutId,
    programWeek,
    sets: reps.map((r) => ({
      reps: r,
      weightKg,
      completed: true,
      setType: 'working' as const,
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  historyBefore.mockResolvedValue([])
  lastPerformance.mockResolvedValue(null)
  trainedSessions.mockResolvedValue([])
})

describe('deriveDayPrescription auto-regulation', () => {
  it('a stalled last session repeats its load, stamped autoreg with the scheme value kept', async () => {
    // Arrange — week 1 prescribed 100; 2 of 3 sets under the 8-rep floor.
    // Week 2's scheme load would be 102.5.
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 6, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    // Assert
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([100, 100, 100])
    expect(exercise.sets.every((s) => s.derivedFrom === 'autoreg')).toBe(true)
    expect(exercise.sets[0].schemeLoadKg).toBe(102.5)
    expect(exercise.autoreg).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('two consecutive stalls back off ~10% and suggest the early deload', async () => {
    // Arrange — stalls at week-2 (prescribed 102.5) and week-1 (100) loads
    trainedSessions.mockResolvedValue([
      trained('w2', 2, [6, 6, 5], 102.5),
      trained('w1', 1, [6, 6, 7], 100),
    ])

    // Act — week 3 scheme would prescribe 105
    const [exercise] = await deriveDayPrescription(USER, day({}), 3)

    // Assert — 10% of the 102.5 stall = 10.25 → snapped to 10 → 92.5
    expect(exercise.sets[0].loadKg).toBe(92.5)
    expect(exercise.sets[0].derivedFrom).toBe('autoreg')
    expect(exercise.autoreg).toMatchObject({ action: 'decrement', suggestEarlyDeload: true })
  })

  it('an explicit per-week override beats the autoreg delta (override supremacy)', async () => {
    // Arrange — same stall as the repeat case, plus a week-2 override pinning 110
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 6, 5])])
    const override = {
      week: 2,
      repMin: null,
      repMax: null,
      rir: null,
      rpe: null,
      suggestedLoadKg: 110,
      tempo: null,
      durationSec: null,
      distanceM: null,
      restSec: null,
      technique: null,
    }

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({ overrides: [override] }), 2)

    // Assert — the override wins the load AND the stamp; the reason still
    // rides the exercise for surfaces that want to mention it.
    expect(exercise.sets[0]).toMatchObject({ loadKg: 110, derivedFrom: 'override' })
    expect(exercise.autoreg).not.toBeNull()
  })

  it('a clean last session leaves the scheme untouched (no adjustment, no stamp)', async () => {
    // Arrange
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 9, 8])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    // Assert
    expect(exercise.sets[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
    expect(exercise.autoreg).toBeNull()
  })

  it('never adjusts the deload week and ignores deload-week history', async () => {
    // Arrange — deload at week 4; a stalled week-4 session must not testify
    trainedSessions.mockResolvedValue([trained('w4', 4, [5, 5, 5], 85)])

    // Act — deriving the deload week itself skips the rules entirely
    const [onDeload] = await deriveDayPrescription(USER, day({ deloadWeek: 4 }), 4)

    // Assert
    expect(onDeload.autoreg).toBeNull()
    expect(onDeload.sets.every((s) => s.derivedFrom === 'deload')).toBe(true)
    expect(trainedSessions).not.toHaveBeenCalled()
  })

  it('filters deload-week sessions out of the evidence on ordinary weeks', async () => {
    // Arrange — the only history is the week-2 deload itself
    trainedSessions.mockResolvedValue([trained('w2', 2, [5, 5, 5], 85)])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({ deloadWeek: 2 }), 3)

    // Assert — no admissible evidence → scheme proceeds
    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets[0].derivedFrom).toBe('scheme')
  })

  it('leaves rpe-target exercises alone (no history fetch, no adjustment)', async () => {
    // Arrange
    trainedSessions.mockResolvedValue([trained('w1', 1, [5, 5, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({ progression: { scheme: 'rpe-target', targetRpe: 8 } }),
      2,
    )

    // Assert
    expect(exercise.autoreg).toBeNull()
    expect(trainedSessions).not.toHaveBeenCalled()
    expect(exercise.sets.every((s) => s.derivedFrom !== 'autoreg')).toBe(true)
  })

  it('the program-level switch off skips the rules (and their history reads) entirely', async () => {
    // Arrange
    trainedSessions.mockResolvedValue([trained('w1', 1, [5, 5, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({ autoregulation: false }), 2)

    // Assert
    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
    expect(trainedSessions).not.toHaveBeenCalled()
  })

  it('threads excludeWorkoutId so a session never testifies to its own stall', async () => {
    // Arrange
    trainedSessions.mockResolvedValue([])

    // Act
    await deriveDayPrescription(USER, day({}), 2, { excludeWorkoutId: 'w-current' })

    // Assert
    expect(trainedSessions).toHaveBeenCalledWith(USER, 'p1', 'wger', 1, 'w-current')
  })
})
