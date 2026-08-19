import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/og', () => ({
  ImageResponse: class MockImageResponse extends Response {
    constructor(_element: unknown, opts?: { headers?: Record<string, string> }) {
      super('png', { status: 200, headers: { 'content-type': 'image/png', ...opts?.headers } })
    }
  },
}))
vi.mock('@/lib/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(async () => 'lb') }))
vi.mock('@/db/exercise-stats', () => ({
  getExerciseStats: vi.fn(async () => null),
  listLoggedExercises: vi.fn(async () => []),
}))
// lib/cards/card-data reaches lib/trophies' module graph — same mock boundary
// as lib/trophies.test.ts.
vi.mock('@/db/trophies', () => ({
  listTrophies: vi.fn(async () => []),
  stampTrophies: vi.fn(async () => []),
  workoutFinishFacts: vi.fn(async () => null),
  countCompletedWorkouts: vi.fn(async () => 0),
  lifetimeTonnageKg: vi.fn(async () => 0),
  activeProgramRef: vi.fn(async () => null),
}))
vi.mock('@/db/goals', () => ({
  activeScheduledWeekdays: vi.fn(async () => []),
  completedWorkoutTimes: vi.fn(async () => []),
}))
vi.mock('@/db/programs', () => ({
  programWeekState: vi.fn(async () => ({ currentWeek: 1, blockComplete: false })),
}))
vi.mock('@/lib/push', () => ({
  sendPushToUser: vi.fn(async () => ({ configured: true, sent: 0, pruned: 0, failed: 0 })),
}))

import { getUserId } from '@/lib/auth'
import { getExerciseStats, type ExerciseAllTimeStats } from '@/db/exercise-stats'
import { GET } from './route'

const mockedGetUserId = vi.mocked(getUserId)
const mockedStats = vi.mocked(getExerciseStats)

function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

function get(source: string, id: string): Promise<Response> {
  return GET(new Request('http://localhost/api/cards/pr/x/y'), {
    params: Promise.resolve({ source, id }),
  })
}

function statsWithRecord(
  bestE1rm: ExerciseAllTimeStats['records']['bestE1rm'],
): ExerciseAllTimeStats {
  return {
    exercise: { wgerExerciseId: 615, source: 'wger', name: 'Squats', loggingType: 'weight_reps' },
    totalSessions: 1,
    totalCompletedSets: 3,
    records: { bestE1rm, heaviestLoadKg: null, mostReps: null, bestSessionVolumeKg: null },
    trend: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_1')
  mockedStats.mockResolvedValue(null)
})

describe('GET /api/cards/pr/[source]/[id]', () => {
  it('401s unauthenticated without touching the db', async () => {
    signedIn(null)
    const res = await get('wger', '615')
    expect(res.status).toBe(401)
    expect(mockedStats).not.toHaveBeenCalled()
  })

  it('404s a bad ref, missing history, and a record-less history with one shape', async () => {
    const badRef = await get('bogus', '615')
    const noHistory = await get('wger', '615')
    mockedStats.mockResolvedValue(statsWithRecord(null))
    const noRecord = await get('wger', '615')
    expect(badRef.status).toBe(404)
    expect(noHistory.status).toBe(404)
    expect(noRecord.status).toBe(404)
    expect(await badRef.json()).toEqual(await noHistory.json())
    expect(await noRecord.clone().json()).toEqual({ error: 'Not found' })
    // The bad ref never reaches the db — parse rejects it first.
    expect(mockedStats).toHaveBeenCalledTimes(2)
  })

  it('renders the PR as a private, uncacheable image', async () => {
    mockedStats.mockResolvedValue(
      statsWithRecord({
        workoutId: 'w1',
        performedAt: new Date('2026-07-04T10:00:00Z'),
        reps: 3,
        weightKg: 137.44,
        e1rm: 143.79,
      }),
    )
    const res = await get('wger', '615')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(mockedStats).toHaveBeenCalledWith('user_1', 'wger', 615)
  })
})
