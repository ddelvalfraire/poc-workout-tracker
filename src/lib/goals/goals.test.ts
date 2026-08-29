import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/goals', () => ({
  listActiveGoals: vi.fn(),
  markGoalAchieved: vi.fn(),
  completedWorkoutTimes: vi.fn(async () => []),
  activeScheduledWeekdays: vi.fn(async () => []),
}))
vi.mock('@/db/exercise-stats', () => ({ getExerciseStats: vi.fn(async () => null) }))
vi.mock('@/db/preferences', () => ({
  getBodyweightKg: vi.fn(async () => null),
  getWeightUnit: vi.fn(async () => 'kg'),
}))
vi.mock('@/lib/push', () => ({
  sendPushToUser: vi.fn(async () => ({ configured: true, sent: 1, pruned: 0, failed: 0 })),
}))

import {
  listActiveGoals,
  markGoalAchieved,
  completedWorkoutTimes,
  activeScheduledWeekdays,
  type GoalRow,
} from '@/db/goals'
import { getExerciseStats } from '@/db/exercise-stats'
import { getBodyweightKg } from '@/db/preferences'
import { sendPushToUser } from '@/lib/push'
import { checkGoalAchievements, evaluateGoalProgress } from './goals'

const mockedList = vi.mocked(listActiveGoals)
const mockedMark = vi.mocked(markGoalAchieved)
const mockedStats = vi.mocked(getExerciseStats)
const mockedBodyweight = vi.mocked(getBodyweightKg)
const mockedPush = vi.mocked(sendPushToUser)
const mockedTimes = vi.mocked(completedWorkoutTimes)
const mockedWeekdays = vi.mocked(activeScheduledWeekdays)

const USER = 'user_123'

function goalRow(overrides: Partial<GoalRow>): GoalRow {
  return {
    id: 'g1',
    kind: 'bodyweight',
    target: { weightKg: 80, direction: 'down' },
    wgerExerciseId: null,
    source: null,
    exerciseName: null,
    deadline: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    achievedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

const strengthGoal = goalRow({
  id: 'gs',
  kind: 'strength',
  target: { e1rmKg: 140 },
  wgerExerciseId: 73,
  source: 'wger',
  exerciseName: 'Squat',
})

beforeEach(() => {
  vi.clearAllMocks()
  mockedList.mockResolvedValue([])
  mockedStats.mockResolvedValue(null)
  mockedBodyweight.mockResolvedValue(null)
  mockedTimes.mockResolvedValue([])
  mockedWeekdays.mockResolvedValue([])
  mockedMark.mockResolvedValue({ id: 'x' })
})

describe('evaluateGoalProgress', () => {
  it('returns [] without touching evidence reads when there are no goals', async () => {
    const result = await evaluateGoalProgress(USER)
    expect(result).toEqual([])
    expect(mockedStats).not.toHaveBeenCalled()
    expect(mockedBodyweight).not.toHaveBeenCalled()
  })

  it('scores a strength goal off the exercise-stats records and trend', async () => {
    mockedList.mockResolvedValue([strengthGoal])
    mockedStats.mockResolvedValue({
      exercise: { wgerExerciseId: 73, source: 'wger', name: 'Squat', loggingType: 'weight_reps' },
      totalSessions: 2,
      totalCompletedSets: 6,
      records: {
        bestE1rm: {
          workoutId: 'w2',
          performedAt: new Date('2026-07-20T10:00:00Z'),
          reps: 5,
          weightKg: 120,
          e1rm: 126,
        },
        heaviestLoadKg: null,
        mostReps: null,
        bestSessionVolumeKg: null,
      },
      trend: [
        { workoutId: 'w1', performedAt: new Date('2026-07-10T10:00:00Z'), e1rm: 120 },
        { workoutId: 'w2', performedAt: new Date('2026-07-20T10:00:00Z'), e1rm: 126 },
      ],
    })

    const [entry] = await evaluateGoalProgress(USER, new Date('2026-07-21T10:00:00Z'))
    expect(entry.progress).toMatchObject({ kind: 'strength', bestE1rmKg: 126, percent: 90 })
    if (entry.progress.kind !== 'strength') throw new Error('wrong kind')
    // 0.6/day slope from 126 toward 140 → a real future date, not silence.
    expect(entry.progress.projectedAt).not.toBe(null)
    expect(entry.achieved).toBe(false)
  })

  it('scores bodyweight off the denormalized current value', async () => {
    mockedList.mockResolvedValue([goalRow({})])
    mockedBodyweight.mockResolvedValue(80)
    const [entry] = await evaluateGoalProgress(USER)
    expect(entry.progress).toEqual({ kind: 'bodyweight', currentKg: 80, remainingKg: 0 })
    expect(entry.achieved).toBe(true)
  })

  it('scores consistency off schedule + completions with the goal-own grace', async () => {
    mockedList.mockResolvedValue([
      goalRow({
        id: 'gc',
        kind: 'consistency',
        target: { targetWeeks: 2, allowedMissesPerWeek: 2 },
      }),
    ])
    mockedWeekdays.mockResolvedValue([1, 3, 5])
    // Mon + Wed of the current fixture week (see goal-progress.test.ts).
    mockedTimes.mockResolvedValue([
      new Date('2026-07-27T18:00:00'),
      new Date('2026-07-29T18:00:00'),
    ])
    const [entry] = await evaluateGoalProgress(USER, new Date('2026-07-30T18:00:00'))
    expect(entry.progress).toMatchObject({
      kind: 'consistency',
      streakWeeks: 1,
      targetWeeks: 2,
      allowedMissesPerWeek: 2,
    })
    expect(entry.achieved).toBe(false)
  })
})

describe('checkGoalAchievements (the fails-soft seam)', () => {
  it('marks a newly-achieved goal once and pushes on the first stamp only', async () => {
    mockedList.mockResolvedValue([goalRow({})])
    mockedBodyweight.mockResolvedValue(79.5) // under an 80 kg cut target
    mockedMark.mockResolvedValue({ id: 'g1' })

    await checkGoalAchievements(USER, ['bodyweight'])

    expect(mockedMark).toHaveBeenCalledTimes(1)
    expect(mockedMark).toHaveBeenCalledWith(USER, 'g1')
    expect(mockedPush).toHaveBeenCalledTimes(1)
    expect(mockedPush).toHaveBeenCalledWith(USER, {
      title: 'Goal reached: Bodyweight 80 kg',
      body: 'Target hit — see your goals.',
      url: '/goals',
    })
  })

  it('is idempotent: an already-achieved goal is never re-marked or re-pushed', async () => {
    mockedList.mockResolvedValue([
      goalRow({ achievedAt: new Date('2026-07-15T00:00:00Z') }),
    ])
    mockedBodyweight.mockResolvedValue(79)

    await checkGoalAchievements(USER, ['bodyweight'])

    expect(mockedMark).not.toHaveBeenCalled()
    expect(mockedPush).not.toHaveBeenCalled()
  })

  it('suppresses the push when the SQL stamp lost the race (marked returns null)', async () => {
    mockedList.mockResolvedValue([goalRow({})])
    mockedBodyweight.mockResolvedValue(79)
    mockedMark.mockResolvedValue(null)

    await checkGoalAchievements(USER, ['bodyweight'])

    expect(mockedPush).not.toHaveBeenCalled()
  })

  it('only considers the requested kinds', async () => {
    mockedList.mockResolvedValue([goalRow({}), strengthGoal])
    mockedBodyweight.mockResolvedValue(79)

    await checkGoalAchievements(USER, ['strength', 'consistency'])

    // The bodyweight goal IS achieved, but this seam wasn't asked about it.
    expect(mockedMark).not.toHaveBeenCalled()
  })

  it('fails soft: an evidence-read failure never throws out of the seam', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedList.mockRejectedValue(new Error('db down'))

    await expect(checkGoalAchievements(USER, ['bodyweight'])).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('fails soft on a mark failure too', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedList.mockResolvedValue([goalRow({})])
    mockedBodyweight.mockResolvedValue(79)
    mockedMark.mockRejectedValue(new Error('write failed'))

    await expect(checkGoalAchievements(USER, ['bodyweight'])).resolves.toBeUndefined()
    expect(mockedPush).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
