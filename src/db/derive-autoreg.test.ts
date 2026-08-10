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
import type { AutoregStallPolicy } from '@/lib/autoregulate'

const USER = 'user_123'

/** A one-exercise day: 3 working sets at a fixed 8-rep floor (v1 shape) or,
 *  with `repRange`, an 8–12 range (v2 double-progression shape); base 100 kg,
 *  4-week block. `mixedShape` leaves set 2 fixed among ranged sets (ambiguous
 *  → v1 rules). `duplicateSlot` lists the same exercise twice. */
function day(options: {
  progression?: unknown
  autoregulation?: boolean
  stallPolicy?: AutoregStallPolicy
  deloadWeek?: number | null
  deloadPolicy?: DayForDerivation['program']['deloadPolicy']
  dietPhase?: DayForDerivation['program']['dietPhase']
  overrides?: { week: number; [key: string]: unknown }[]
  duplicateSlot?: boolean
  repRange?: boolean
  mixedShape?: boolean
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
      repMax:
        (options.repRange || options.mixedShape) && !(options.mixedShape && setNumber === 2)
          ? 12
          : null,
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
      autoregStallPolicy: options.stallPolicy ?? 'all-sets',
      deloadPolicy: options.deloadPolicy ?? null,
      dietPhase: options.dietPhase ?? null,
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
    startedAt: new Date(Date.UTC(2026, 6, programWeek)),
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

  it("the program row's 'first-set' policy lets 8,8,6 progress — the top set hit its floor", async () => {
    // Arrange — same 8,8,6 history that stalls under 'all-sets': the policy
    // on the program row is what flips the verdict.
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 8, 6])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({ stallPolicy: 'first-set' }), 2)

    // Assert — no verdict; the scheme's week-2 increment applies untouched.
    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
  })

  it("the same 8,8,6 session stalls under the default 'all-sets' policy on the row", async () => {
    // Arrange
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 8, 6])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    // Assert — C1: any scorable set under its floor repeats the load.
    expect(exercise.autoreg).toMatchObject({ action: 'repeat' })
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([100, 100, 100])
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

  it('three consecutive stalls at the SAME held load back off ~10% and suggest the early deload', async () => {
    // Arrange — the repeat verdicts held 100 across weeks 1–3, and the
    // lifter stalled at 100 every time (H2: the streak only counts at one
    // prescribed top load).
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [6, 6, 5], 100),
      trained('w2', 2, [6, 6, 5], 100),
      trained('w1', 1, [6, 6, 7], 100),
    ])

    // Act — week 4 scheme would prescribe 107.5
    const [exercise] = await deriveDayPrescription(USER, day({}), 4)

    // Assert — 10% of the 100 stall → the 100 bucket caps at 90
    expect(exercise.sets[0].loadKg).toBe(90)
    expect(exercise.sets[0].derivedFrom).toBe('autoreg')
    expect(exercise.autoreg).toMatchObject({ action: 'decrement', suggestEarlyDeload: true })
  })

  it("diet phase 'cutting' HOLDS the three-stall backoff (repeat at the stalled load, cut carried)", async () => {
    // Arrange — the exact decrement fixture above, on a cutting program
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [6, 6, 5], 100),
      trained('w2', 2, [6, 6, 5], 100),
      trained('w1', 1, [6, 6, 7], 100),
    ])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({ dietPhase: 'cutting' }), 4)

    // Assert — the load HOLDS at the stalled 100 (never 90): the backoff is
    // held behind the reactive-proposal confirm, and the verdict says so.
    expect(exercise.sets[0].loadKg).toBe(100)
    expect(exercise.autoreg).toMatchObject({
      action: 'repeat',
      deltaKg: 0,
      suggestEarlyDeload: true,
      phaseContext: 'cutting',
      heldBackoffKg: 10,
    })
  })

  it("diet phase 'cutting' annotates the M4 flag without suppressing it", async () => {
    // Arrange — the percent-1rm three-stall history that flags
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [5, 5, 5], 80),
      trained('w2', 2, [5, 5, 5], 75),
      trained('w1', 1, [5, 5, 5], 70),
    ])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({
        progression: {
          scheme: 'percent-1rm',
          trainingMaxKg: 100,
          weekPercents: [0.7, 0.75, 0.8, 0.85],
        },
        dietPhase: 'cutting',
      }),
      4,
    )

    // Assert — still a flag (annotate, never suppress), loads untouched
    expect(exercise.autoreg).toMatchObject({
      action: 'flag',
      suggestEarlyDeload: true,
      phaseContext: 'cutting',
    })
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([85, 85, 85])
  })

  it("'bulking'/'maintaining' have ZERO engine effect (byte-identical to no phase)", async () => {
    // Arrange
    const history = [
      trained('w3', 3, [6, 6, 5], 100),
      trained('w2', 2, [6, 6, 5], 100),
      trained('w1', 1, [6, 6, 7], 100),
    ]
    trainedSessions.mockResolvedValue(history)

    // Act — the same derivation under no phase and under each stored-only phase
    const [bare] = await deriveDayPrescription(USER, day({}), 4)
    const [bulking] = await deriveDayPrescription(USER, day({ dietPhase: 'bulking' }), 4)
    const [maintaining] = await deriveDayPrescription(USER, day({ dietPhase: 'maintaining' }), 4)

    // Assert — deep-identical results: stored context only in v1
    expect(bulking).toEqual(bare)
    expect(maintaining).toEqual(bare)
  })

  it('H2: stalls at three DIFFERENT prescribed loads never escalate to a decrement', async () => {
    // Arrange — the load moved every week (edits/scheme), so no three
    // stalls share a prescribed top load.
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [6, 6, 5], 105),
      trained('w2', 2, [6, 6, 5], 102.5),
      trained('w1', 1, [6, 6, 7], 100),
    ])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 4)

    // Assert — repeat of the latest stalled 105, no back-off cascade.
    expect(exercise.autoreg).toMatchObject({ action: 'repeat', suggestEarlyDeload: false })
    expect(exercise.sets[0].loadKg).toBe(105)
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
        startedAt: new Date(Date.UTC(2026, 6, 1)),
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

  it('never stall-adjusts rpe-target (loaded snapshots are left to the self-correcting scheme)', async () => {
    // Arrange — low reps at loaded snapshots: a fixed-mode engine would call
    // this a stall; anchor mode must not.
    trainedSessions.mockResolvedValue([trained('w1', 1, [5, 5, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({ progression: { scheme: 'rpe-target', targetRpe: 8 } }),
      2,
    )

    // Assert
    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets.every((s) => s.derivedFrom !== 'autoreg')).toBe(true)
  })

  it('anchors rpe-target null-load snapshots at the performed load (the weight ghost)', async () => {
    // Arrange — no e1RM yet (empty history) so the scheme derives no load;
    // the last session's snapshots prescribed no load either, but the lifter
    // worked at 60.
    trainedSessions.mockResolvedValue([
      {
        workoutId: 'w1',
        programWeek: 1,
        startedAt: new Date(Date.UTC(2026, 6, 1)),
        sets: [1, 2, 3].map((setNumber) => ({
          setNumber,
          reps: 10,
          weightKg: 60,
          completed: true,
          setType: 'working' as const,
          prescribedLoadKg: null,
          prescribedRepMin: 8,
        })),
      },
    ])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({ progression: { scheme: 'rpe-target', targetRpe: 8 } }),
      2,
    )

    // Assert — every set anchored at 60, escape value (null plan load) kept.
    expect(exercise.autoreg).toMatchObject({ action: 'anchor', suggestEarlyDeload: false })
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([60, 60, 60])
    expect(exercise.sets.every((s) => s.derivedFrom === 'autoreg')).toBe(true)
    expect(exercise.sets.every((s) => s.schemeLoadKg === null)).toBe(true)
  })

  it('M2: a single outperformed session no longer anchors (one good day is not a trend)', async () => {
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 8, 8], 120, 100)])

    const [exercise] = await deriveDayPrescription(USER, day({}), 2)

    expect(exercise.autoreg).toBeNull()
    expect(exercise.sets[0]).toMatchObject({ loadKg: 102.5, derivedFrom: 'scheme' })
  })

  it('TWO consecutive outperformed sessions anchor the fixed-mode prescription (M2)', async () => {
    // Arrange — prescribed 100×8 floor, performed ≥5% over on every set two
    // sessions running: the program follows the lifter up.
    trainedSessions.mockResolvedValue([
      trained('w2', 2, [8, 8, 8], 120, 100),
      trained('w1', 1, [8, 8, 8], 110, 100),
    ])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({}), 3)

    // Assert
    expect(exercise.autoreg).toMatchObject({
      action: 'anchor',
      deltaKg: 20,
      anchor: { fromLoadKg: 100, toLoadKg: 120 },
    })
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([120, 120, 120])
    expect(exercise.sets.every((s) => s.derivedFrom === 'autoreg')).toBe(true)
    expect(exercise.sets[0].schemeLoadKg).toBe(105)
  })

  it('H3: mixed fixed/ranged working sets run the RANGE rules (no whole-exercise fallback)', async () => {
    // Arrange — set 2 has no repMax among 8–12 sets. The ranged rows score
    // fill/hold, the fixed row floor-scores; the shape no longer collapses
    // to v1 fixed rules.
    trainedSessions.mockResolvedValue([trained('w1', 1, [8, 6, 5])])

    // Act
    const [exercise] = await deriveDayPrescription(USER, day({ mixedShape: true }), 2)

    // Assert — a range-mode HOLD: the verdict carries range evidence and the
    // scheme's 102.5 is capped back to the held 100.
    expect(exercise.autoreg).toMatchObject({ action: 'repeat' })
    expect(exercise.autoreg?.range).toBeDefined()
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([100, 100, 100])
  })

  it('M4: percent-1rm gets the advisory early-deload flag after three stalls, loads untouched', async () => {
    // Arrange — three straight floor-missed sessions under a scheme that
    // owns its loads (static training max).
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [5, 5, 5], 80),
      trained('w2', 2, [5, 5, 5], 75),
      trained('w1', 1, [5, 5, 5], 70),
    ])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({
        progression: {
          scheme: 'percent-1rm',
          trainingMaxKg: 100,
          weekPercents: [0.7, 0.75, 0.8, 0.85],
        },
      }),
      4,
    )

    // Assert — the flag rides the verdict; the scheme's loads are untouched
    // (never a load adjustment — the scheme owns them).
    expect(exercise.autoreg).toMatchObject({ action: 'flag', suggestEarlyDeload: true })
    expect(exercise.sets.every((s) => s.derivedFrom === 'scheme')).toBe(true)
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([85, 85, 85])
  })

  it("M4 gating: an EXPLICIT deload policy of 'none' suppresses the flag (no history read)", async () => {
    // Arrange — the same three-stall history that flags above…
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [5, 5, 5], 80),
      trained('w2', 2, [5, 5, 5], 75),
      trained('w1', 1, [5, 5, 5], 70),
    ])
    const percent = {
      scheme: 'percent-1rm',
      trainingMaxKg: 100,
      weekPercents: [0.7, 0.75, 0.8, 0.85],
    }

    // Act — …under a program that explicitly declared "no deloads".
    const [exercise] = await deriveDayPrescription(
      USER,
      day({ progression: percent, deloadPolicy: { mode: 'none' } }),
      4,
    )

    // Assert — no verdict at all, and the plan short-circuits before any
    // history read (the flag was the only thing those reads could feed).
    expect(exercise.autoreg).toBeNull()
    expect(trainedSessions).not.toHaveBeenCalled()
    expect(exercise.sets.map((s) => s.loadKg)).toEqual([85, 85, 85])
  })

  it("M4 gating: 'reactive' keeps the flag — it IS the reactive deload's trigger", async () => {
    // Arrange
    trainedSessions.mockResolvedValue([
      trained('w3', 3, [5, 5, 5], 80),
      trained('w2', 2, [5, 5, 5], 75),
      trained('w1', 1, [5, 5, 5], 70),
    ])

    // Act
    const [exercise] = await deriveDayPrescription(
      USER,
      day({
        progression: {
          scheme: 'percent-1rm',
          trainingMaxKg: 100,
          weekPercents: [0.7, 0.75, 0.8, 0.85],
        },
        deloadPolicy: { mode: 'reactive' },
      }),
      4,
    )

    // Assert
    expect(exercise.autoreg).toMatchObject({ action: 'flag', suggestEarlyDeload: true })
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
