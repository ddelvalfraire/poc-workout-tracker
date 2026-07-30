import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db/programs', () => ({ getNextProgramDay: vi.fn() }))
vi.mock('@/db/push-subscriptions', () => ({ listPushSubscribedUserIds: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn() }))
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }))

import { GET, reminderMarkerKey } from './route'
import { getNextProgramDay } from '@/db/programs'
import { listPushSubscribedUserIds } from '@/db/push-subscriptions'
import { sendPushToUser } from '@/lib/push'
import { getRedis } from '@/lib/redis'
import type { Redis } from '@upstash/redis'

const mockedNext = vi.mocked(getNextProgramDay)
const mockedUsers = vi.mocked(listPushSubscribedUserIds)
const mockedSend = vi.mocked(sendPushToUser)
const mockedRedis = vi.mocked(getRedis)

const SECRET = 'cron_secret_test'
// 2026-07-30 is a Thursday: UTC weekday 4. 13:30 UTC is inside the window.
const IN_WINDOW = new Date(Date.UTC(2026, 6, 30, 13, 30))
const OUT_OF_WINDOW = new Date(Date.UTC(2026, 6, 30, 9, 0))

function makeRedisSet(result: 'OK' | null) {
  const set = vi.fn().mockResolvedValue(result)
  mockedRedis.mockReturnValue({ set } as unknown as Redis)
  return set
}

function request(secret: string | null = SECRET): Request {
  return new Request('http://localhost/api/cron/reminders', {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  })
}

function nextDay(overrides: Partial<NonNullable<Awaited<ReturnType<typeof getNextProgramDay>>>> = {}) {
  return {
    programId: 'prog-1',
    programName: 'PPL',
    dayId: 'day-1',
    dayName: 'Legs',
    week: 3,
    exerciseNames: ['Squat', 'RDL', 'Leg Press', 'Leg Curl', 'Calf Raise'],
    weekdays: [4], // Thursday — matches IN_WINDOW's UTC weekday
    blockComplete: false,
    mesocycleWeeks: 6,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.useFakeTimers()
  vi.setSystemTime(IN_WINDOW)
  mockedUsers.mockResolvedValue(['user_123'])
  mockedSend.mockResolvedValue({ configured: true, sent: 1, pruned: 0, failed: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('GET /api/cron/reminders auth', () => {
  it('rejects a missing bearer token', async () => {
    const res = await GET(request(null))
    expect(res.status).toBe(401)
    expect(mockedUsers).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer token', async () => {
    const res = await GET(request('wrong'))
    expect(res.status).toBe(401)
  })

  it('rejects everything when CRON_SECRET is unset (fail closed)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await GET(request(''))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/cron/reminders window', () => {
  it('does nothing outside 13:00-14:59 UTC', async () => {
    // Arrange
    vi.setSystemTime(OUT_OF_WINDOW)

    // Act
    const res = await GET(request())

    // Assert
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 0, skipped: 0, pruned: 0, window: false })
    expect(mockedUsers).not.toHaveBeenCalled()
  })

  it('skips all sends when Redis is unconfigured (no idempotency, no risk)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedRedis.mockReturnValue(null)

    const res = await GET(request())

    expect(await res.json()).toEqual({ sent: 0, skipped: 0, pruned: 0, window: true })
    expect(mockedSend).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('GET /api/cron/reminders sends', () => {
  it('sends one reminder for a day scheduled today, marker claimed first', async () => {
    // Arrange
    const set = makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay())

    // Act
    const res = await GET(request())

    // Assert
    expect(await res.json()).toEqual({ sent: 1, skipped: 0, pruned: 0, window: true })
    expect(set).toHaveBeenCalledWith('reminder:user_123:2026-07-30', '1', {
      nx: true,
      ex: 26 * 60 * 60,
    })
    expect(mockedSend).toHaveBeenCalledWith('user_123', {
      title: 'Legs — Week 3',
      body: '5 exercises · tap to start',
      url: '/',
    })
  })

  it('skips when the NX marker is already claimed (idempotent within the window)', async () => {
    makeRedisSet(null)
    mockedNext.mockResolvedValue(nextDay())

    const res = await GET(request())

    expect(await res.json()).toEqual({ sent: 0, skipped: 1, pruned: 0, window: true })
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it("skips when today's UTC weekday is not scheduled", async () => {
    const set = makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay({ weekdays: [1, 3] })) // Mon/Wed, today is Thu

    const res = await GET(request())

    expect(await res.json()).toEqual({ sent: 0, skipped: 1, pruned: 0, window: true })
    expect(set).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('skips unscheduled days, completed blocks, and users with no next day', async () => {
    makeRedisSet('OK')
    mockedUsers.mockResolvedValue(['user_a', 'user_b', 'user_c'])
    mockedNext
      .mockResolvedValueOnce(nextDay({ weekdays: [] }))
      .mockResolvedValueOnce(nextDay({ blockComplete: true }))
      .mockResolvedValueOnce(null)

    const res = await GET(request())

    expect(await res.json()).toEqual({ sent: 0, skipped: 3, pruned: 0, window: true })
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('aggregates pruned counts from the send results', async () => {
    makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay())
    mockedSend.mockResolvedValue({ configured: true, sent: 1, pruned: 1, failed: 0 })

    const res = await GET(request())

    expect(await res.json()).toEqual({ sent: 1, skipped: 0, pruned: 1, window: true })
  })
})

describe('reminderMarkerKey', () => {
  it('keys by user and UTC day', () => {
    expect(reminderMarkerKey('user_9', IN_WINDOW)).toBe('reminder:user_9:2026-07-30')
  })
})
