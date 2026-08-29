import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/trophies', () => ({
  listTrophies: vi.fn(async () => []),
  stampTrophies: vi.fn(async () => []),
  workoutFinishFacts: vi.fn(async () => null),
  countCompletedWorkouts: vi.fn(async () => 0),
  lifetimeTonnageKg: vi.fn(async () => 0),
  activeProgramRef: vi.fn(async () => null),
}))
vi.mock('@/db/exercise-stats', () => ({
  getExerciseStats: vi.fn(async () => null),
  listLoggedExercises: vi.fn(async () => []),
}))
vi.mock('@/db/goals', () => ({
  activeScheduledWeekdays: vi.fn(async () => []),
  completedWorkoutTimes: vi.fn(async () => []),
}))
vi.mock('@/db/programs', () => ({
  programWeekState: vi.fn(async () => ({ currentWeek: 1, blockComplete: false })),
}))
vi.mock('@/lib/push', () => ({
  sendPushToUser: vi.fn(async () => ({ configured: true, sent: 1, pruned: 0, failed: 0 })),
}))

import {
  activeProgramRef,
  countCompletedWorkouts,
  lifetimeTonnageKg,
  listTrophies,
  stampTrophies,
  workoutFinishFacts,
  type TrophyRow,
} from '@/db/trophies'
import { getExerciseStats, listLoggedExercises } from '@/db/exercise-stats'
import { activeScheduledWeekdays, completedWorkoutTimes } from '@/db/goals'
import { programWeekState } from '@/db/programs'
import { sendPushToUser } from '@/lib/push'
import { TROPHY_KINDS, thresholdKg, type TrophyKind } from '@/lib/goals/trophy-kinds'
import { displayToKg } from '@/lib/units'
import {
  canonicalLiftFor,
  checkTrophies,
  closestTrophies,
  emptyEvidence,
  evaluateTrophies,
  groupTrophiesByFamily,
  isAttributedToFinish,
  trophyCandidates,
  trophyContextLine,
  trophyFraction,
  trophyHeroGlyph,
  trophyHint,
  trophyLabel,
  type TrophyEvidence,
} from './trophies'

const mockedListTrophies = vi.mocked(listTrophies)
const mockedStamp = vi.mocked(stampTrophies)
const mockedFinishFacts = vi.mocked(workoutFinishFacts)
const mockedCount = vi.mocked(countCompletedWorkouts)
const mockedTonnage = vi.mocked(lifetimeTonnageKg)
const mockedProgram = vi.mocked(activeProgramRef)
const mockedStats = vi.mocked(getExerciseStats)
const mockedLogged = vi.mocked(listLoggedExercises)
const mockedWeekdays = vi.mocked(activeScheduledWeekdays)
const mockedTimes = vi.mocked(completedWorkoutTimes)
const mockedWeekState = vi.mocked(programWeekState)
const mockedPush = vi.mocked(sendPushToUser)

const USER = 'user_123'

function evidence(overrides: Partial<TrophyEvidence>): TrophyEvidence {
  return { ...emptyEvidence(), ...overrides }
}

const NO_EARNED = new Set<TrophyKind>()

beforeEach(() => {
  vi.clearAllMocks()
  mockedListTrophies.mockResolvedValue([])
  mockedStamp.mockResolvedValue([])
  mockedFinishFacts.mockResolvedValue(null)
  mockedCount.mockResolvedValue(0)
  mockedTonnage.mockResolvedValue(0)
  mockedProgram.mockResolvedValue(null)
  mockedStats.mockResolvedValue(null)
  mockedLogged.mockResolvedValue([])
  mockedWeekdays.mockResolvedValue([])
  mockedTimes.mockResolvedValue([])
  mockedWeekState.mockResolvedValue({ currentWeek: 1, blockComplete: false })
})

describe('canonicalLiftFor', () => {
  it('matches curated wger ids to their lifts', () => {
    expect(canonicalLiftFor('wger', 615, 'Squats')).toBe('squat')
    expect(canonicalLiftFor('wger', 1801, 'Barbell Full Squat')).toBe('squat')
    expect(canonicalLiftFor('wger', 73, 'Bench Press')).toBe('bench')
    expect(canonicalLiftFor('wger', 184, 'Deadlifts')).toBe('deadlift')
    expect(canonicalLiftFor('wger', 630, 'Sumo Deadlift')).toBe('deadlift')
    expect(canonicalLiftFor('wger', 687, 'Overhead Press')).toBe('ohp')
    expect(canonicalLiftFor('wger', 566, 'Shoulder Press, Barbell')).toBe('ohp')
  })

  it('rejects lookalike variants: RDL, front squat, incline bench are NOT canonical', () => {
    expect(canonicalLiftFor('wger', 507, 'Romanian Deadlift')).toBe(null)
    expect(canonicalLiftFor('wger', 257, 'Front Squats')).toBe(null)
    expect(canonicalLiftFor('wger', 538, 'Incline Bench Press - Barbell')).toBe(null)
  })

  it('matches customs by normalized name (the import-matcher normalizer)', () => {
    expect(canonicalLiftFor('custom', 3, 'Back Squat')).toBe('squat')
    expect(canonicalLiftFor('custom', 3, 'BACK  SQUAT!')).toBe('squat')
    expect(canonicalLiftFor('custom', 4, 'Competition Bench Press')).toBe('bench')
    expect(canonicalLiftFor('custom', 5, 'Strict Press')).toBe('ohp')
    expect(canonicalLiftFor('custom', 6, 'Romanian Deadlift')).toBe(null)
  })

  it('never name-matches a wger identity outside the curated id set', () => {
    // A wger id NOT in the set does not sneak in via its name.
    expect(canonicalLiftFor('wger', 9999, 'Back Squat')).toBe(null)
  })
})

describe('trophyCandidates', () => {
  it('awards a plate club exactly at the entry-precision boundary', () => {
    // 315 lb typed at entry is stored as 142.88 kg (2dp) — it must qualify.
    const at = evidence({ bestByLift: { squat: { e1rmKg: 142.88, workoutId: 'w1' } } })
    expect(trophyCandidates(at, NO_EARNED).map((c) => c.kind)).toEqual([
      'club_squat_225',
      'club_squat_315',
    ])
    const under = evidence({ bestByLift: { squat: { e1rmKg: 142.87, workoutId: 'w1' } } })
    expect(trophyCandidates(under, NO_EARNED).map((c) => c.kind)).toEqual(['club_squat_225'])
  })

  it('records the qualifying e1RM as context, rounded to column precision', () => {
    const [c] = trophyCandidates(
      evidence({ bestByLift: { bench: { e1rmKg: 61.23456, workoutId: 'w1' } } }),
      NO_EARNED,
    )
    expect(c).toEqual({ kind: 'club_bench_135', context: { e1rmKg: 61.23 } })
  })

  it('awards the 1000 lb club only when all three lifts sum over the line', () => {
    const bests = {
      squat: { e1rmKg: 160, workoutId: 'w1' },
      bench: { e1rmKg: 100, workoutId: 'w2' },
      deadlift: { e1rmKg: 193.59, workoutId: 'w3' },
    }
    // 453.59 kg IS 1000 lb at entry precision.
    const kinds = trophyCandidates(evidence({ bestByLift: bests }), NO_EARNED).map((c) => c.kind)
    expect(kinds).toContain('club_1000')
    // A missing deadlift e1RM can never sum-qualify, whatever the other two.
    const partial = evidence({
      bestByLift: {
        squat: { e1rmKg: 400, workoutId: 'w1' },
        bench: { e1rmKg: 400, workoutId: 'w2' },
      },
    })
    expect(trophyCandidates(partial, NO_EARNED).map((c) => c.kind)).not.toContain('club_1000')
  })

  it('awards every crossed workout-count milestone with the count as context', () => {
    const kinds = trophyCandidates(evidence({ completedCount: 100 }), NO_EARNED)
    expect(kinds.filter((c) => c.kind.startsWith('workouts_'))).toEqual([
      { kind: 'workouts_1', context: { count: 100 } },
      { kind: 'workouts_50', context: { count: 100 } },
      { kind: 'workouts_100', context: { count: 100 } },
    ])
  })

  it('awards streak milestones from the streak engine result', () => {
    const kinds = trophyCandidates(
      evidence({ streakWeeks: 12, scheduledWeekdays: [1, 3] }),
      NO_EARNED,
    ).map((c) => c.kind)
    expect(kinds).toEqual(['streak_4', 'streak_12'])
  })

  it('awards tonnage at the lb-defined threshold in kg', () => {
    const oneMillionLbKg = displayToKg(1_000_000, 'lb')
    expect(
      trophyCandidates(evidence({ tonnageKg: oneMillionLbKg }), NO_EARNED).map((c) => c.kind),
    ).toEqual(['tonnage_1m'])
    expect(trophyCandidates(evidence({ tonnageKg: oneMillionLbKg - 0.01 }), NO_EARNED)).toEqual([])
  })

  it('awards block_complete only when the block is complete', () => {
    expect(
      trophyCandidates(evidence({ blockComplete: true }), NO_EARNED).map((c) => c.kind),
    ).toEqual(['block_complete'])
    expect(trophyCandidates(evidence({}), NO_EARNED)).toEqual([])
  })

  it('never re-candidates an earned kind', () => {
    const earned = new Set<TrophyKind>(['workouts_1', 'workouts_50'])
    expect(trophyCandidates(evidence({ completedCount: 60 }), earned).map((c) => c.kind)).toEqual(
      [],
    )
  })
})

describe('isAttributedToFinish', () => {
  const finish = {
    workoutId: 'w9',
    completed: true,
    workoutTonnageKg: 1000,
    streakWeeksWithout: 3,
    hasProgramProvenance: true,
  }

  it('disqualifies everything for an uncompleted workout', () => {
    expect(
      isAttributedToFinish('workouts_1', evidence({ completedCount: 1 }), {
        ...finish,
        completed: false,
      }),
    ).toBe(false)
  })

  it('attributes a club only when its record was set in this workout', () => {
    const withRecord = evidence({ bestByLift: { squat: { e1rmKg: 150, workoutId: 'w9' } } })
    const oldRecord = evidence({ bestByLift: { squat: { e1rmKg: 150, workoutId: 'w1' } } })
    expect(isAttributedToFinish('club_squat_315', withRecord, finish)).toBe(true)
    expect(isAttributedToFinish('club_squat_315', oldRecord, finish)).toBe(false)
  })

  it('attributes the sum club when any contributing record is from this workout', () => {
    const mixed = evidence({
      bestByLift: {
        squat: { e1rmKg: 160, workoutId: 'w1' },
        bench: { e1rmKg: 100, workoutId: 'w9' },
        deadlift: { e1rmKg: 200, workoutId: 'w2' },
      },
    })
    expect(isAttributedToFinish('club_1000', mixed, finish)).toBe(true)
    const allOld = evidence({
      bestByLift: {
        squat: { e1rmKg: 160, workoutId: 'w1' },
        bench: { e1rmKg: 100, workoutId: 'w2' },
        deadlift: { e1rmKg: 200, workoutId: 'w3' },
      },
    })
    expect(isAttributedToFinish('club_1000', allOld, finish)).toBe(false)
  })

  it('attributes a count only when THIS workout crossed the line (backfill stays quiet)', () => {
    expect(isAttributedToFinish('workouts_50', evidence({ completedCount: 50 }), finish)).toBe(true)
    // 200 completed at feature ship: 50/100 were crossed long ago — quiet.
    expect(isAttributedToFinish('workouts_50', evidence({ completedCount: 200 }), finish)).toBe(
      false,
    )
  })

  it('attributes a streak only when the milestone needs this workout', () => {
    expect(isAttributedToFinish('streak_4', evidence({ streakWeeks: 4 }), finish)).toBe(true)
    expect(
      isAttributedToFinish('streak_4', evidence({ streakWeeks: 30 }), {
        ...finish,
        streakWeeksWithout: 30,
      }),
    ).toBe(false)
  })

  it('attributes tonnage only when this workout carried the total over', () => {
    const threshold = thresholdKg(1_000_000)
    expect(
      isAttributedToFinish('tonnage_1m', evidence({ tonnageKg: threshold + 500 }), finish),
    ).toBe(true) // 500 over, workout moved 1000 → below without it
    expect(
      isAttributedToFinish('tonnage_1m', evidence({ tonnageKg: threshold + 5000 }), finish),
    ).toBe(false)
  })

  it('attributes block completion to program sessions only', () => {
    expect(isAttributedToFinish('block_complete', evidence({ blockComplete: true }), finish)).toBe(
      true,
    )
    expect(
      isAttributedToFinish('block_complete', evidence({ blockComplete: true }), {
        ...finish,
        hasProgramProvenance: false,
      }),
    ).toBe(false)
  })
})

/**
 * The words live in `messages/en.json` under `Trophies` and are proved
 * rendered through the real catalog in app/trophies/page.test.tsx. What is
 * pinned here is the DECISION: which message a kind earns, and which numbers
 * travel with it — as NUMBERS, so the reader's locale rather than this
 * module picks the grouping separator.
 */
describe('label, context and hint descriptors', () => {
  it('keeps clubs in lb lifting culture and lift names out of the catalog', () => {
    expect(trophyLabel('club_squat_315')).toEqual({
      key: 'label.club',
      values: { lb: 315, lift: 'Squat' },
    })
    expect(trophyLabel('club_ohp_135')).toEqual({
      key: 'label.club',
      values: { lb: 135, lift: 'OHP' },
    })
    expect(trophyLabel('club_1000')).toEqual({ key: 'label.sumClub', values: { lb: 1000 } })
    expect(trophyLabel('block_complete')).toEqual({ key: 'label.block' })
    expect(trophyLabel('tonnage_2m')).toEqual({ key: 'label.tonnage', values: { millions: 2 } })
  })

  it('carries the count and the week span so the plural resolves at render', () => {
    expect(trophyLabel('workouts_1')).toEqual({ key: 'label.count', values: { count: 1 } })
    expect(trophyLabel('workouts_250')).toEqual({ key: 'label.count', values: { count: 250 } })
    expect(trophyLabel('streak_26')).toEqual({ key: 'label.streak', values: { weeks: 26 } })
  })

  it('names the recorded fact in the user unit on earned cards', () => {
    const row = (kind: TrophyKind, context: TrophyRow['context']): TrophyRow => ({
      id: 't1',
      kind,
      achievedAt: new Date('2026-08-01T00:00:00Z'),
      context,
    })
    expect(trophyContextLine(row('club_squat_315', { e1rmKg: 143.79 }), 'lb')).toEqual({
      key: 'context.clubE1rm',
      values: { value: 317, unit: 'lb' },
    })
    expect(trophyContextLine(row('club_1000', { e1rmKg: 455 }), 'lb')).toEqual({
      key: 'context.sumTotal',
      values: { value: 1003.1, unit: 'lb' },
    })
    expect(trophyContextLine(row('workouts_1', { count: 1 }), 'lb')).toEqual({
      key: 'context.count',
      values: { count: 1 },
    })
    expect(trophyContextLine(row('workouts_50', { count: 50 }), 'lb')).toEqual({
      key: 'context.count',
      values: { count: 50 },
    })
    expect(trophyContextLine(row('streak_4', { weeks: 4 }), 'kg')).toEqual({
      key: 'context.streak',
      values: { weeks: 4 },
    })
    expect(trophyContextLine(row('block_complete', {}), 'kg')).toBe(null)
  })

  it('shows honest club progress from the same evidence detection reads', () => {
    const at285 = evidence({
      bestByLift: { squat: { e1rmKg: displayToKg(285, 'lb'), workoutId: 'w1' } },
    })
    expect(trophyHint('club_squat_315', at285, 'lb')).toEqual({
      key: 'hint.weightProgress',
      values: { current: 285, target: 315, remaining: 30, unit: 'lb' },
    })
    expect(trophyHint('club_deadlift_495', evidence({}), 'lb')).toEqual({
      key: 'hint.clubNoLift',
      values: { lift: 'Deadlift' },
    })
  })

  it('lists the missing lifts for the sum club as one content argument', () => {
    const partial = evidence({ bestByLift: { squat: { e1rmKg: 160, workoutId: 'w1' } } })
    expect(trophyHint('club_1000', partial, 'lb')).toEqual({
      key: 'hint.sumMissing',
      values: { lifts: 'Bench, Deadlift' },
    })
  })

  it('shows count, streak and tonnage fractions as raw numbers', () => {
    expect(trophyHint('workouts_50', evidence({ completedCount: 37 }), 'lb')).toEqual({
      key: 'hint.count',
      values: { current: 37, target: 50 },
    })
    expect(
      trophyHint('streak_4', evidence({ streakWeeks: 2, scheduledWeekdays: [1, 3] }), 'lb'),
    ).toEqual({ key: 'hint.streak', values: { current: 2, target: 4 } })
    expect(trophyHint('streak_4', evidence({}), 'lb')).toEqual({ key: 'hint.streakUnscheduled' })
    // Unformatted on purpose: 612340 renders "612,340" or "612.340" per locale.
    expect(
      trophyHint('tonnage_1m', evidence({ tonnageKg: displayToKg(612_340, 'lb') }), 'lb'),
    ).toEqual({
      key: 'hint.tonnage',
      values: { current: 612_340, target: 1_000_000, unit: 'lb' },
    })
  })

  it('hints block completion against the active-program state', () => {
    expect(trophyHint('block_complete', evidence({}), 'lb')).toEqual({
      key: 'hint.blockNoProgram',
    })
    expect(trophyHint('block_complete', evidence({ hasActiveProgram: true }), 'lb')).toEqual({
      key: 'hint.blockActive',
    })
  })
})

describe('checkTrophies', () => {
  const stampedRow = (kind: TrophyKind, context: TrophyRow['context']): TrophyRow => ({
    id: `row-${kind}`,
    kind,
    achievedAt: new Date('2026-08-02T10:00:00Z'),
    context,
  })

  it('stamps, pushes once and returns the trophy for an attributed live finish', async () => {
    mockedCount.mockResolvedValue(1)
    mockedFinishFacts.mockResolvedValue({
      completedAt: new Date('2026-08-02T10:00:00Z'),
      programDayId: null,
      tonnageKg: 1200,
    })
    mockedStamp.mockImplementation(async (_userId, candidates) =>
      candidates.map((c) => stampedRow(c.kind, c.context)),
    )

    const result = await checkTrophies(USER, { kind: 'finish', workoutId: 'w1' })

    expect(mockedStamp).toHaveBeenCalledWith(USER, [
      { kind: 'workouts_1', context: { count: 1, workoutId: 'w1' } },
    ])
    expect(result.map((r) => r.kind)).toEqual(['workouts_1'])
    expect(mockedPush).toHaveBeenCalledTimes(1)
    expect(mockedPush).toHaveBeenCalledWith(USER, {
      title: 'Trophy: First Workout',
      body: 'Earned — see your trophies.',
      url: '/trophies',
    })
  })

  it('import trigger stamps quietly: no workoutId context, no push, returns []', async () => {
    mockedCount.mockResolvedValue(50)
    mockedStamp.mockImplementation(async (_userId, candidates) =>
      candidates.map((c) => stampedRow(c.kind, c.context)),
    )

    const result = await checkTrophies(USER, { kind: 'import' })

    expect(mockedStamp).toHaveBeenCalledWith(USER, [
      { kind: 'workouts_1', context: { count: 50 } },
      { kind: 'workouts_50', context: { count: 50 } },
    ])
    expect(mockedFinishFacts).not.toHaveBeenCalled()
    expect(mockedPush).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('backfill at a live finish stamps quietly when the fact predates the workout', async () => {
    // 200 completed workouts at feature ship: this finish crossed nothing.
    mockedCount.mockResolvedValue(200)
    mockedFinishFacts.mockResolvedValue({
      completedAt: new Date('2026-08-02T10:00:00Z'),
      programDayId: null,
      tonnageKg: 1200,
    })
    mockedStamp.mockImplementation(async (_userId, candidates) =>
      candidates.map((c) => stampedRow(c.kind, c.context)),
    )

    const result = await checkTrophies(USER, { kind: 'finish', workoutId: 'w1' })

    const stamped = mockedStamp.mock.calls[0][1]
    expect(stamped.map((c) => c.kind)).toEqual(['workouts_1', 'workouts_50', 'workouts_100'])
    expect(stamped.every((c) => c.context.workoutId === undefined)).toBe(true)
    expect(mockedPush).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('the ON CONFLICT result is the send gate: an already-stamped kind never re-pushes', async () => {
    mockedCount.mockResolvedValue(1)
    mockedFinishFacts.mockResolvedValue({
      completedAt: new Date('2026-08-02T10:00:00Z'),
      programDayId: null,
      tonnageKg: 0,
    })
    // Raced double-fire: the insert conflicted away — RETURNING was empty.
    mockedStamp.mockResolvedValue([])

    const result = await checkTrophies(USER, { kind: 'finish', workoutId: 'w1' })

    expect(mockedPush).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('skips all evidence reads once every kind is earned', async () => {
    mockedListTrophies.mockResolvedValue(TROPHY_KINDS.map((kind) => stampedRow(kind, {})))
    const result = await checkTrophies(USER, { kind: 'finish', workoutId: 'w1' })
    expect(result).toEqual([])
    expect(mockedCount).not.toHaveBeenCalled()
    expect(mockedTonnage).not.toHaveBeenCalled()
    expect(mockedLogged).not.toHaveBeenCalled()
  })

  it('fails soft: a throwing read logs and returns [] without rethrowing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedListTrophies.mockRejectedValue(new Error('db down'))
    await expect(checkTrophies(USER, { kind: 'other' })).resolves.toEqual([])
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('derives club evidence through canonical matching and stamps the record workout', async () => {
    mockedLogged.mockResolvedValue([
      {
        wgerExerciseId: 615,
        source: 'wger',
        name: 'Squats',
        sessionCount: 10,
        lastPerformedAt: new Date('2026-08-01T00:00:00Z'),
        bestE1rmKg: null,
        trendDeltaKg: null,
        lastPrAt: null,
      },
      {
        wgerExerciseId: 507,
        source: 'wger',
        name: 'Romanian Deadlift',
        sessionCount: 10,
        lastPerformedAt: new Date('2026-08-01T00:00:00Z'),
        bestE1rmKg: null,
        trendDeltaKg: null,
        lastPrAt: null,
      },
    ])
    mockedStats.mockResolvedValue({
      exercise: { wgerExerciseId: 615, source: 'wger', name: 'Squats', loggingType: 'weight_reps' },
      totalSessions: 10,
      totalCompletedSets: 30,
      records: {
        bestE1rm: {
          workoutId: 'w1',
          performedAt: new Date('2026-08-01T00:00:00Z'),
          reps: 1,
          weightKg: 142.88,
          e1rm: 142.88,
        },
        heaviestLoadKg: null,
        mostReps: null,
        bestSessionVolumeKg: null,
      },
      trend: [],
    })
    mockedFinishFacts.mockResolvedValue({
      completedAt: new Date('2026-08-01T00:00:00Z'),
      programDayId: null,
      tonnageKg: 0,
    })
    mockedStamp.mockImplementation(async (_userId, candidates) =>
      candidates.map((c) => stampedRow(c.kind, c.context)),
    )

    const result = await checkTrophies(USER, { kind: 'finish', workoutId: 'w1' })

    // Only the canonical squat was scored (the RDL never reached stats).
    expect(mockedStats).toHaveBeenCalledTimes(1)
    expect(mockedStats).toHaveBeenCalledWith(USER, 'wger', 615)
    expect(result.map((r) => r.kind).sort()).toEqual(['club_squat_225', 'club_squat_315'])
    expect(mockedPush).toHaveBeenCalledTimes(2)
  })
})

describe('trophyFraction', () => {
  it('exposes the club numerator/denominator behind the hint', () => {
    const ev = evidence({
      bestByLift: { squat: { e1rmKg: displayToKg(285, 'lb'), workoutId: 'w1' } },
    })
    const fraction = trophyFraction('club_squat_315', ev)
    expect(fraction).not.toBe(null)
    expect(fraction?.current).toBeCloseTo(displayToKg(285, 'lb'), 2)
    expect(fraction?.target).toBeCloseTo(thresholdKg(315), 2)
    expect(fraction?.percent).toBe(90) // floor(285/315 · 100)
  })

  it('is null when the club has no e1RM yet (no honest fraction)', () => {
    expect(trophyFraction('club_bench_135', evidence({}))).toBe(null)
  })

  it('sum club needs all three lifts before claiming a fraction', () => {
    const partial = evidence({
      bestByLift: {
        squat: { e1rmKg: 100, workoutId: 'w1' },
        bench: { e1rmKg: 80, workoutId: 'w1' },
      },
    })
    expect(trophyFraction('club_1000', partial)).toBe(null)
    const full = evidence({
      bestByLift: {
        squat: { e1rmKg: 100, workoutId: 'w1' },
        bench: { e1rmKg: 80, workoutId: 'w1' },
        deadlift: { e1rmKg: 120, workoutId: 'w1' },
      },
    })
    const fraction = trophyFraction('club_1000', full)
    expect(fraction?.current).toBe(300)
    expect(fraction?.percent).toBe(Math.floor((300 / thresholdKg(1000)) * 100))
  })

  it('counts and tonnage are honest at zero; streak needs a schedule', () => {
    expect(trophyFraction('workouts_50', evidence({ completedCount: 37 }))).toEqual({
      current: 37,
      target: 50,
      percent: 74,
    })
    expect(trophyFraction('tonnage_1m', evidence({}))?.percent).toBe(0)
    expect(trophyFraction('streak_12', evidence({ streakWeeks: 6 }))).toBe(null) // no schedule
    expect(
      trophyFraction('streak_12', evidence({ scheduledWeekdays: [1, 3], streakWeeks: 6 })),
    ).toEqual({ current: 6, target: 12, percent: 50 })
  })

  it('block is binary — never a fraction', () => {
    expect(trophyFraction('block_complete', evidence({ hasActiveProgram: true }))).toBe(null)
  })

  it('clamps an over-threshold (not yet stamped) fraction to 100', () => {
    expect(trophyFraction('workouts_50', evidence({ completedCount: 60 }))?.percent).toBe(100)
  })
})

describe('closestTrophies', () => {
  it('ranks locked kinds by completion percent, capped at 3', () => {
    const ev = evidence({
      completedCount: 45, // workouts_50 → 90%
      scheduledWeekdays: [1, 3, 5],
      streakWeeks: 3, // streak_4 → 75%
      bestByLift: { squat: { e1rmKg: displayToKg(200, 'lb'), workoutId: 'w1' } }, // 225 → 88%
    })
    const closest = closestTrophies(TROPHY_KINDS, ev)
    expect(closest).toHaveLength(3)
    expect(closest[0]).toBe('workouts_1') // 45/1 → clamped 100
    expect(closest.slice(1)).toEqual(['workouts_50', 'club_squat_225'])
  })

  it('never lists zero-percent or fraction-less kinds', () => {
    expect(closestTrophies(TROPHY_KINDS, evidence({}))).toEqual([])
  })

  it('only considers the kinds it was given (locked)', () => {
    const ev = evidence({ completedCount: 45 })
    expect(closestTrophies(['club_bench_135', 'streak_4'], ev)).toEqual([])
  })
})

describe('groupTrophiesByFamily + hero glyphs', () => {
  const row = (kind: TrophyKind, achievedAt: Date): TrophyRow => ({
    id: `t_${kind}`,
    kind,
    achievedAt,
    context: {},
  })

  it('zones families in display order, earned newest-first, locked after', () => {
    const earned = [
      row('club_bench_135', new Date('2026-06-01T00:00:00Z')),
      row('club_squat_225', new Date('2026-07-01T00:00:00Z')),
      row('workouts_1', new Date('2026-05-01T00:00:00Z')),
    ]
    const locked: TrophyKind[] = ['club_squat_315', 'workouts_50', 'streak_4']
    const zones = groupTrophiesByFamily(earned, locked)

    // The family IS the header key (`family.<family>`), so no English zone
    // label travels out of this module any more.
    expect(zones.map((z) => z.family)).toEqual(['club', 'count', 'streak'])
    // Newest achievement first within the zone.
    expect(zones[0].earned.map((r) => r.kind)).toEqual(['club_squat_225', 'club_bench_135'])
    expect(zones[0].locked).toEqual(['club_squat_315'])
    expect(zones[2].locked).toEqual(['streak_4'])
  })

  it('covers every kind exactly once across zones', () => {
    const zones = groupTrophiesByFamily([], [...TROPHY_KINDS])
    const all = zones.flatMap((z) => z.locked)
    expect(all.sort()).toEqual([...TROPHY_KINDS].sort())
  })

  it('the threshold number IS the trophy glyph; block has none', () => {
    // A number plus a notation, never a formatted string — "1,000" and "1M"
    // are Intl output, and which separator or suffix appears is the reader's
    // locale, not this module's.
    expect(trophyHeroGlyph('club_squat_315')).toEqual({ value: 315, notation: 'standard' })
    expect(trophyHeroGlyph('club_1000')).toEqual({ value: 1000, notation: 'grouped' })
    expect(trophyHeroGlyph('workouts_50')).toEqual({ value: 50, notation: 'standard' })
    expect(trophyHeroGlyph('streak_12')).toEqual({ value: 12, notation: 'standard' })
    expect(trophyHeroGlyph('tonnage_1m')).toEqual({ value: 1_000_000, notation: 'compact' })
    expect(trophyHeroGlyph('block_complete')).toBe(null)
  })
})

describe('evaluateTrophies', () => {
  it('splits earned from locked and returns evidence for the locked hints', async () => {
    mockedListTrophies.mockResolvedValue([
      { id: 't1', kind: 'workouts_1', achievedAt: new Date(), context: { count: 1 } },
    ])
    mockedCount.mockResolvedValue(37)
    const { earned, locked, evidence: got } = await evaluateTrophies(USER)
    expect(earned.map((t) => t.kind)).toEqual(['workouts_1'])
    expect(locked).not.toContain('workouts_1')
    expect(locked).toContain('workouts_50')
    expect(got.completedCount).toBe(37)
  })
})
