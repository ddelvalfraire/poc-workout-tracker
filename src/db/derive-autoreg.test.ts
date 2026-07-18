import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Derive-path wiring tests for Layer 1 auto-regulation: deriveDayPrescription
 * consulting getRecentTrainedSessions (module-mocked, like the history reads
 * in instantiate-program.test.ts) and applying the verdict below overrides.
 * Prescribed targets for past sessions come from the per-set SNAPSHOTS on the
 * fixture rows (prescribedLoadKg/prescribedRepMin) — never re-derived — so
 * the fixtures supply actuals + snapshots.
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

/** A one-exercise day: 3×(8-12) working sets, base 100 kg, 4-week block.
 *  `duplicateSlot` lists the same exercise a second time (repeat-slot day). */
function day(options: {
  progression?: unknown
  autoregulation?: boolean
  deloadWeek?: number | null
  overrides?: { week: number; [key: string]: unknown }[]
  duplicateSlot?: boolean
}): DayForDerivation {
  const exercise = {
    wgerExerciseId: 1,
    source: 'wger' as const,
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
  }
  return {
    program: {
      id: 'p1',
      mesocycleWeeks: 4,
      deloadWeek: options.deloadWeek ?? null,
      autoregulation: options.autoregulation ?? true,
    },
    exercises: options.duplicateSlot ? [exercise, { ...exercise }] : [exercise],
  }
}

/** A trained session whose 3 working sets hit `reps`, each row carrying its
 *  prescribed-at-instantiation snapshot (`prescribedKg` per set). */
function trained(
  workoutId: string,
  programWeek: number,
  reps: number[],
  weightKg = 100,
  prescribedKg = weightKg,
) {
  return {
    workoutId,
    programWeek,
    sets: reps.map((r, i) => ({
      setNumber: i + 1,
      reps: r,
      weightKg,
      completed: true,
      setType: 'working' as const,
      prescribedLoadKg: prescribedKg,
      prescribedRepMin: 8,
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
  it('a stalled last session repeats its snapshot load, stamped autoreg with the scheme value kept', async () => {
    // Arrange — week-1 snapshots say 100 was prescribed; 2 of 3 sets under
    // the 8-rep floor. Week 2's scheme load would be 102.5.
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 6, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    // Assert
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([100, 100, 100])
    expect(exercise.sets.every((s) => s.derivedFrom === 'autoreg')).toBe(true)
    expect(exercise.sets[0].schemeLoadKg).toBe(102.5)
    expect(exercise.autoreg).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('two consecutive stalls still only repeat (three-stall rule)', async () => {
    // Arrange — stalls at week-2 (snapshot 102.5) and week-1 (100)
    trainedSessions.mockResolvedValue([
      trained('w2', 2, [6, 6, 5], 102.5),
      trained('w1', 1, [6, 6, 7], 100),
    ])

    // Act — week 3 scheme would prescribe 105
    const [exercise] = await deriveDayPrescription(USER, day({}), 3)

    // Assert — repeat of the stalled 102.5, no decrement yet
    expect(exercise.sets[0].loadKg).toBe(102.5)
    expect(exercise.autoreg).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
  })

  it('three consecutive stalls back off ~10% and suggest the early deload', async () => {
    // Arrange — stalls at weeks 3/2/1 (snapshots 105 / 102.5 / 100)
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [6, 6, 5], 105),
      trained('w2', 2, [6, 6, 5], 102.5),
      trained('w1', 1, [6, 6, 7], 100),
    ])

    // Act — week 4 scheme would prescribe 107.5
    const [exercise] = await deriveDayPrescription(USER, day({}), 4)

    // Assert — 10% of the 105 stall = 10.5 → snapped to 10 → 95
    expect(exercise.sets[0].loadKg).toBe(95)
    expect(exercise.sets[0].derivedFrom).toBe('autoreg')
    expect(exercise.autoreg).toMatchObject({ action: 'decrement', suggestEarlyDeload: true })
  })

  it("scores against the SNAPSHOT, not today's edited plan", async () => {
    // Arrange — the plan says 100 today, but the week-1 snapshot proves 90
    // was prescribed and the lifter hit it clean: no stall, whatever the
    // current template claims.
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 8, 8], 90, 90)])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    // Assert
    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
  })

  it('stays silent on snapshot-less history (cold start by design)', async () => {
    // Arrange — pre-migration rows: no prescribed_* snapshot, low reps.
    trainedSessions.mockResolvedValue([
      {
        workoutId: 'w1',
        programWeek: 1,
        sets: [1, 2, 3].map((setNumber) => ({
          setNumber,
          reps: 3,
          weightKg: 100,
          completed: true,
          setType: 'working' as const,
          prescribedLoadKg: null,
          prescribedRepMin: null,
        })),
      },
    ])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    // Assert — unscorable, so the scheme proceeds untouched.
    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
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

  it('never adjusts the deload week itself (no history read at all)', async () => {
    // Arrange — deload at week 4
    trainedSessions.mockResolvedValue([trained('w3', 3, [5, 5, 5])])

    // Act — deriving the deload week itself skips the rules entirely
    const [onDeload] = await deriveDayPrescription(USER, day({ deloadWeek: 4 }), 4)

    // Assert
    expect(onDeload.autoreg).toBeNull()
    expect(onDeload.sets.every((s) => s.derivedFrom === 'deload')).toBe(true)
    expect(trainedSessions).not.toHaveBeenCalled()
  })

  it('threads the deload week into the history read (boundary truncation lives there)', async () => {
    // Arrange
    trainedSessions.mockResolvedValue([])

    // Act
    await deriveDayPrescription(USER, day({ deloadWeek: 2 }), 3)

    // Assert — the history module owns the deload-reset semantics.
    expect(trainedSessions).toHaveBeenCalledWith(USER, 'p1', 'wger', 1, {
      excludeWorkoutId: undefined,
      deloadWeek: 2,
    })
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

  it('leaves double-progression exercises alone — linear only in v1', async () => {
    // Arrange — DP already holds its base until repMax; a stall there is the
    // scheme working, not failing.
    trainedSessions.mockResolvedValue([trained('w1', 1, [5, 5, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({
        progression: { scheme: 'double-progression', repMin: 8, repMax: 12, incrementKg: 2.5 },
      }),
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

  it('derives the verdict ONCE for a day that repeats the exercise (no re-query, shared verdict)', async () => {
    // Arrange — a repeat-slot day with a stalled last session
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 6, 5])])

    // Act
    const prescriptions = await deriveDayPrescription(USER, day({ duplicateSlot: true }), 2)

    // Assert — one query, both slots carry the same verdict
    expect(trainedSessions).toHaveBeenCalledTimes(1)
    expect(prescriptions).toHaveLength(2)
    expect(prescriptions[0].autoreg).toMatchObject({ action: 'repeat' })
    expect(prescriptions[1].autoreg).toEqual(prescriptions[0].autoreg)
    expect(prescriptions[1].sets.map((s) => s.loadKg)).toEqual([100, 100, 100])
  })

  it('threads excludeWorkoutId so a session never testifies to its own stall', async () => {
    // Arrange
    trainedSessions.mockResolvedValue([])

    // Act
    await deriveDayPrescription(USER, day({}), 2, { excludeWorkoutId: 'w-current' })

    // Assert
    expect(trainedSessions).toHaveBeenCalledWith(USER, 'p1', 'wger', 1, {
      excludeWorkoutId: 'w-current',
      deloadWeek: null,
    })
  })
})
