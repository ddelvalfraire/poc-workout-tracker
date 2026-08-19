import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/db/workout-drafts', () => ({ listWorkoutDrafts: vi.fn(async () => []) }))
vi.mock('@/db/workouts', () => ({ listWorkoutSummaries: vi.fn(async () => []) }))
vi.mock('@/db/programs', () => ({ getNextProgramDay: vi.fn(async () => null) }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(async () => 'lb') }))
vi.mock('@/db/muscle-volume', () => ({
  getVolumeTotals: vi.fn(async () => ({ currentSets: 0, previousSets: 0, currentSessions: 0 })),
}))
vi.mock('@/db/bodyweight', () => ({ listBodyweightLogs: vi.fn(async () => []) }))
vi.mock('@/db/trophies', () => ({ listTrophies: vi.fn(async () => []) }))
vi.mock('@/db/exercise-stats', () => ({
  getExerciseStats: vi.fn(async () => null),
  listLoggedExercises: vi.fn(async () => []),
}))
// Composition modules whose graphs reach the db — mocked at the same seams
// the route imports (their pure siblings, e.g. bodyweight-trend, stay real).
vi.mock('@/lib/goals', () => ({ getGoalsHomeSummary: vi.fn(async () => null) }))
vi.mock('@/lib/check-in', () => ({ getCheckInStatus: vi.fn(async () => null) }))
vi.mock('@/lib/trophies', () => ({ trophyLabel: vi.fn(() => '315 Squat Club') }))
vi.mock('@/lib/active-session', () => ({ resolveActiveSession: vi.fn(() => null) }))
vi.mock('@/lib/coach/access', () => ({ isCoachEnabled: vi.fn(async () => false) }))

import { auth } from '@clerk/nextjs/server'
import { listWorkoutSummaries, type WorkoutSummary } from '@/db/workouts'
import { getNextProgramDay, type NextProgramDay } from '@/db/programs'
import { listBodyweightLogs } from '@/db/bodyweight'
import { listTrophies, type TrophyRow } from '@/db/trophies'
import { getExerciseStats, type ExerciseAllTimeStats } from '@/db/exercise-stats'
import { getGoalsHomeSummary } from '@/lib/goals'
import { getCheckInStatus } from '@/lib/check-in'
import { resolveActiveSession } from '@/lib/active-session'
import { isCoachEnabled } from '@/lib/coach/access'
import type { GoalRow } from '@/db/goals'
import type { DrawerData } from '@/lib/drawer-status'
import { GET } from './route'

const mockedAuth = vi.mocked(auth)

function signedIn(userId: string | null): void {
  mockedAuth.mockResolvedValue({ userId } as unknown as Awaited<ReturnType<typeof auth>>)
}

const now = Date.now()
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function summary(overrides: Partial<WorkoutSummary>): WorkoutSummary {
  return {
    id: 'w1',
    name: 'Push',
    startedAt: new Date(now - HOUR_MS),
    completedAt: new Date(now - HOUR_MS / 2),
    exerciseCount: 3,
    setCount: 9,
    completedSetCount: 9,
    volumeKg: 3663,
    ...overrides,
  }
}

const nextDay: NextProgramDay = {
  programId: 'p1',
  programName: 'Upper/Lower Hybrid',
  dayId: 'd1',
  dayName: 'Legs',
  week: 3,
  exerciseNames: ['Squats'],
  weekdays: [1, 4],
  blockComplete: false,
  mesocycleWeeks: 7,
}

const strengthGoal: GoalRow = {
  id: 'g1',
  kind: 'strength',
  target: { e1rmKg: 142.88 },
  wgerExerciseId: 615,
  source: 'wger',
  exerciseName: 'Squats',
  deadline: null,
  createdAt: new Date(now - DAY_MS),
  achievedAt: null,
  archivedAt: null,
}

const trophyRow: TrophyRow = {
  id: 't1',
  kind: 'club_squat_315',
  achievedAt: new Date(now - DAY_MS),
  context: { e1rmKg: 143 },
}

function statsWithBest(e1rm: number): ExerciseAllTimeStats {
  return {
    exercise: { wgerExerciseId: 615, source: 'wger', name: 'Squats', loggingType: 'weight_reps' },
    totalSessions: 4,
    totalCompletedSets: 12,
    records: {
      bestE1rm: { e1rm, reps: 5, weightKg: 100, performedAt: new Date(now - DAY_MS), workoutId: 'w1' },
      heaviestLoadKg: null,
      mostReps: null,
      bestSessionVolumeKg: null,
    },
    trend: [],
  }
}

async function getData(): Promise<{ res: Response; data: DrawerData }> {
  const res = await GET()
  return { res, data: (await res.json()) as DrawerData }
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_1')
  vi.mocked(listWorkoutSummaries).mockResolvedValue([])
  vi.mocked(getNextProgramDay).mockResolvedValue(null)
  vi.mocked(getGoalsHomeSummary).mockResolvedValue(null)
  vi.mocked(getCheckInStatus).mockResolvedValue(null)
  vi.mocked(listTrophies).mockResolvedValue([])
  vi.mocked(listBodyweightLogs).mockResolvedValue([])
  vi.mocked(getExerciseStats).mockResolvedValue(null)
  vi.mocked(resolveActiveSession).mockReturnValue(null)
  vi.mocked(isCoachEnabled).mockResolvedValue(false)
})

describe('GET /api/drawer', () => {
  it('401s unauthenticated without touching the db', async () => {
    signedIn(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(vi.mocked(listWorkoutSummaries)).not.toHaveBeenCalled()
  })

  it('assembles every zone from the composed reads', async () => {
    vi.mocked(getNextProgramDay).mockResolvedValue(nextDay)
    vi.mocked(listWorkoutSummaries).mockResolvedValue([
      summary({}),
      summary({ id: 'w2', name: 'Legs', startedAt: new Date(now - DAY_MS) }),
    ])
    vi.mocked(listTrophies).mockResolvedValue([trophyRow])
    vi.mocked(getCheckInStatus).mockResolvedValue({
      due: true,
      programName: 'Upper/Lower Hybrid',
      cadenceDays: 7,
      lastCheckInAt: new Date(now - 8 * DAY_MS),
      daysSinceLast: 8,
    })
    vi.mocked(listBodyweightLogs).mockResolvedValue([
      { id: 'b1', weighedAt: new Date(now - HOUR_MS), weightKg: 84 },
      { id: 'b2', weighedAt: new Date(now - 10 * DAY_MS), weightKg: 85 },
    ])
    vi.mocked(isCoachEnabled).mockResolvedValue(true)

    const { res, data } = await getData()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=30')
    expect(data.resume).toBeNull()
    expect(data.upNext).toEqual({ dayId: 'd1', dayName: 'Legs', week: 3, weekdays: [1, 4] })
    expect(data.program).toEqual({ name: 'Upper/Lower Hybrid', week: 3, mesocycleWeeks: 7 })
    // Both completed workouts land in the rolling sparkbar buckets.
    expect(data.stats?.daySets).toHaveLength(7)
    expect(data.stats?.daySets[6]).toBe(9) // the 1h-old session
    expect(data.trophies).toEqual({ earned: 1, newestLabel: '315 Squat Club' })
    expect(data.body).toEqual({ weightKg: 84, deltaKg: -1, checkInDue: true, daysSinceLast: 8 })
    expect(data.exercises?.lastPrLabel).toBe('315 Squat Club')
    expect(data.coach).toBe(true)
    expect(data.recents.map((r) => r.id)).toEqual(['w1', 'w2'])
    expect(data.unit).toBe('lb')
  })

  it('degrades a single failed read to its slice only', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listTrophies).mockRejectedValue(new Error('db down'))
    vi.mocked(getNextProgramDay).mockResolvedValue(nextDay)

    const { res, data } = await getData()

    expect(res.status).toBe(200)
    expect(data.trophies).toBeNull()
    expect(data.program).not.toBeNull()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('suppresses the start hero while a session is live (RESUME wins)', async () => {
    vi.mocked(getNextProgramDay).mockResolvedValue(nextDay)
    vi.mocked(resolveActiveSession).mockReturnValue({
      key: 'new',
      name: 'Push',
      exerciseCount: 1,
      setCount: 3,
      completedSetCount: 2,
      openedAt: new Date(now - HOUR_MS),
    })

    const { data } = await getData()

    expect(data.resume).toEqual({ key: 'new', name: 'Push' })
    expect(data.upNext).toBeNull()
    expect(data.program).not.toBeNull() // the Programs row keeps its status
  })

  it('suppresses the start hero after block completion but keeps the program row', async () => {
    vi.mocked(getNextProgramDay).mockResolvedValue({ ...nextDay, blockComplete: true })

    const { data } = await getData()

    expect(data.upNext).toBeNull()
    expect(data.program).toEqual({ name: 'Upper/Lower Hybrid', week: 3, mesocycleWeeks: 7 })
  })

  it('computes a strength top goal percent via one stats read', async () => {
    vi.mocked(getGoalsHomeSummary).mockResolvedValue({
      activeCount: 2,
      topGoal: strengthGoal,
      streak: null,
    })
    vi.mocked(getExerciseStats).mockResolvedValue(statsWithBest(124.3))

    const { data } = await getData()

    expect(vi.mocked(getExerciseStats)).toHaveBeenCalledWith('user_1', 'wger', 615)
    expect(data.goals?.percent).toBe(87)
    expect(data.goals?.topGoalLabel).toContain('Squats')
  })

  it('skips the stats read for non-strength top goals', async () => {
    vi.mocked(getGoalsHomeSummary).mockResolvedValue({
      activeCount: 1,
      topGoal: {
        ...strengthGoal,
        id: 'g2',
        kind: 'consistency',
        target: { targetWeeks: 8, allowedMissesPerWeek: 0 },
        wgerExerciseId: null,
        source: null,
        exerciseName: null,
      },
      streak: { completedAtTimes: [now - DAY_MS], scheduledWeekdays: [1, 4], allowedMissesPerWeek: 0 },
    })

    const { data } = await getData()

    expect(vi.mocked(getExerciseStats)).not.toHaveBeenCalled()
    expect(data.goals?.percent).toBeNull()
    expect(data.goals?.streak?.scheduledWeekdays).toEqual([1, 4])
  })
})
