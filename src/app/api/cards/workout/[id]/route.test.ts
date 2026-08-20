import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/og', () => ({
  ImageResponse: class MockImageResponse extends Response {
    constructor(_element: unknown, opts?: { headers?: Record<string, string> }) {
      super('png', { status: 200, headers: { 'content-type': 'image/png', ...opts?.headers } })
    }
  },
}))
vi.mock('@/lib/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn(async () => 'kg') }))
vi.mock('@/db/workouts', () => ({ getWorkoutDetail: vi.fn(async () => null) }))
// lib/cards/card-data reaches lib/trophies' module graph — same mock boundary
// as the sibling card route tests.
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
import { getWorkoutDetail } from '@/db/workouts'
import { GET } from './route'

const mockedGetUserId = vi.mocked(getUserId)
const mockedDetail = vi.mocked(getWorkoutDetail)

function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

function get(id: string): Promise<Response> {
  return GET(new Request('http://localhost/api/cards/workout/x'), {
    params: Promise.resolve({ id }),
  })
}

/** The minimal nested detail shape the card mapper reads. */
function detail(completedAt: Date | null): Awaited<ReturnType<typeof getWorkoutDetail>> {
  return {
    name: 'Push Day',
    startedAt: new Date('2026-08-01T18:00:00Z'),
    completedAt,
    exercises: [{ sets: [{ reps: 5, weight: 100 }] }],
  } as unknown as Awaited<ReturnType<typeof getWorkoutDetail>>
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_1')
  mockedDetail.mockResolvedValue(undefined)
})

describe('GET /api/cards/workout/[id]', () => {
  it('401s unauthenticated without touching the db', async () => {
    signedIn(null)
    const res = await get('w1')
    expect(res.status).toBe(401)
    expect(mockedDetail).not.toHaveBeenCalled()
  })

  it('404s a missing workout and an unfinished one with one shape', async () => {
    const missing = await get('w1')
    mockedDetail.mockResolvedValue(detail(null))
    const unfinished = await get('w1')
    expect(missing.status).toBe(404)
    expect(unfinished.status).toBe(404)
    expect(await missing.json()).toEqual(await unfinished.json())
  })

  it('renders a completed session as a private, uncacheable image', async () => {
    mockedDetail.mockResolvedValue(detail(new Date('2026-08-01T18:48:00Z')))
    const res = await get('w1')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(mockedDetail).toHaveBeenCalledWith('user_1', 'w1')
  })
})
