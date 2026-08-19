import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real ImageResponse spins up satori — the guard tests only care about
// status/headers, so a Response-shaped stand-in keeps the suite fast.
vi.mock('next/og', () => ({
  ImageResponse: class MockImageResponse extends Response {
    constructor(_element: unknown, opts?: { headers?: Record<string, string> }) {
      super('png', { status: 200, headers: { 'content-type': 'image/png', ...opts?.headers } })
    }
  },
}))
vi.mock('@/lib/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(async () => 'lb') }))
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
  sendPushToUser: vi.fn(async () => ({ configured: true, sent: 0, pruned: 0, failed: 0 })),
}))

import { getUserId } from '@/lib/auth'
import { listTrophies, type TrophyRow } from '@/db/trophies'
import { GET } from './route'

const mockedGetUserId = vi.mocked(getUserId)
const mockedList = vi.mocked(listTrophies)

function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

function get(kind: string): Promise<Response> {
  return GET(new Request('http://localhost/api/cards/trophy/x'), {
    params: Promise.resolve({ kind }),
  })
}

const earnedRow: TrophyRow = {
  id: 't1',
  kind: 'club_squat_315',
  achievedAt: new Date('2026-08-15T12:00:00Z'),
  context: { e1rmKg: 143.79 },
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_1')
  mockedList.mockResolvedValue([earnedRow])
})

describe('GET /api/cards/trophy/[kind]', () => {
  it('401s unauthenticated without touching the db', async () => {
    signedIn(null)
    const res = await get('club_squat_315')
    expect(res.status).toBe(401)
    expect(mockedList).not.toHaveBeenCalled()
  })

  it('404s an unknown kind and an unearned kind with the same shape', async () => {
    const unknown = await get('not_a_kind')
    const unearned = await get('club_bench_225')
    expect(unknown.status).toBe(404)
    expect(unearned.status).toBe(404)
    expect(await unknown.json()).toEqual(await unearned.json())
  })

  it('renders the earned trophy as a private, uncacheable image', async () => {
    const res = await get('club_squat_315')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })
})
