import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db/programs', () => ({ getNextProgramDay: vi.fn() }))
vi.mock('@/db/push-subscriptions', () => ({ listPushSubscribedUserIds: vi.fn() }))
vi.mock('@/lib/check-in', () => ({ getCheckInStatus: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn() }))
vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }))

import { GET, checkInMarkerKey, reminderMarkerKey } from './route'
import { getNextProgramDay } from '@/db/programs'
import { listPushSubscribedUserIds } from '@/db/push-subscriptions'
import { getCheckInStatus } from '@/lib/check-in'
import { sendPushToUser } from '@/lib/push'
import { getRedis } from '@/lib/redis'
import type { Redis } from '@upstash/redis'

const mockedNext = vi.mocked(getNextProgramDay)
const mockedUsers = vi.mocked(listPushSubscribedUserIds)
const mockedCheckIn = vi.mocked(getCheckInStatus)
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

function checkInStatus(
  overrides: Partial<NonNullable<Awaited<ReturnType<typeof getCheckInStatus>>>> = {},
) {
  return {
    due: true,
    programName: 'PPL',
    cadenceDays: 14,
    lastCheckInAt: new Date(Date.UTC(2026, 6, 14, 8, 0)),
    daysSinceLast: 16,
    ...overrides,
  }
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
  // Default: no active-program cadence — the rider is silent and the
  // pre-existing workout-reminder assertions run unchanged.
  mockedCheckIn.mockResolvedValue(null)
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
    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 0,
      window: false,
    })
    expect(mockedUsers).not.toHaveBeenCalled()
  })

  it('skips all sends when Redis is unconfigured (no idempotency, no risk)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedRedis.mockReturnValue(null)

    const res = await GET(request())

    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 0,
      window: true,
    })
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
    expect(await res.json()).toEqual({
      sent: 1,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
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

    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 1,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it("skips when today's UTC weekday is not scheduled", async () => {
    const set = makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay({ weekdays: [1, 3] })) // Mon/Wed, today is Thu

    const res = await GET(request())

    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 1,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
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

    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 3,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 3,
      window: true,
    })
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('aggregates pruned counts from the send results', async () => {
    makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay())
    mockedSend.mockResolvedValue({ configured: true, sent: 1, pruned: 1, failed: 0 })

    const res = await GET(request())

    expect(await res.json()).toEqual({
      sent: 1,
      skipped: 0,
      pruned: 1,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
  })
})

describe('GET /api/cron/reminders check-in rider', () => {
  it('sends a due check-in under its OWN marker, alongside the workout reminder', async () => {
    // Arrange — both nudges fire today: independent claims, one user
    const set = makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay())
    mockedCheckIn.mockResolvedValue(checkInStatus())

    // Act
    const res = await GET(request())

    // Assert — both counters advance; each send claimed its own key first
    expect(await res.json()).toEqual({
      sent: 1,
      skipped: 0,
      pruned: 0,
      checkinSent: 1,
      checkinSkipped: 0,
      window: true,
    })
    expect(set).toHaveBeenCalledWith('checkin:user_123:2026-07-30', '1', {
      nx: true,
      ex: 26 * 60 * 60,
    })
    expect(mockedSend).toHaveBeenCalledWith('user_123', {
      title: 'Body check-in',
      body: 'PPL suggests one every 14 days',
      url: '/body',
    })
  })

  it('sends the check-in even when there is no workout to remind about', async () => {
    // Arrange — no next day (skipped), but the check-in is due
    makeRedisSet('OK')
    mockedNext.mockResolvedValue(null)
    mockedCheckIn.mockResolvedValue(checkInStatus())

    // Act
    const res = await GET(request())

    // Assert — the old `continue` would have starved the rider
    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 1,
      pruned: 0,
      checkinSent: 1,
      checkinSkipped: 0,
      window: true,
    })
    expect(mockedSend).toHaveBeenCalledTimes(1)
    expect(mockedSend).toHaveBeenCalledWith('user_123', {
      title: 'Body check-in',
      body: 'PPL suggests one every 14 days',
      url: '/body',
    })
  })

  it('skips a not-yet-due check-in without touching Redis or push', async () => {
    // Arrange
    const set = makeRedisSet('OK')
    mockedNext.mockResolvedValue(null)
    mockedCheckIn.mockResolvedValue(checkInStatus({ due: false }))

    // Act
    const res = await GET(request())

    // Assert
    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 1,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
    expect(set).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('skips when the check-in marker is already claimed, leaving the workout send intact', async () => {
    // Arrange — per-key behavior: workout claim wins, check-in claim loses
    const set = vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(key.startsWith('checkin:') ? null : 'OK'))
    mockedRedis.mockReturnValue({ set } as unknown as Redis)
    mockedNext.mockResolvedValue(nextDay())
    mockedCheckIn.mockResolvedValue(checkInStatus())

    // Act
    const res = await GET(request())

    // Assert — the workout reminder went out; the check-in did not double-send
    expect(await res.json()).toEqual({
      sent: 1,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
    expect(mockedSend).toHaveBeenCalledTimes(1)
    expect(mockedSend).toHaveBeenCalledWith('user_123', expect.objectContaining({ url: '/' }))
  })

  it('leaves the workout path fully untouched when no program suggests a cadence', async () => {
    // Arrange — the pre-cadence world: getCheckInStatus null (default mock)
    makeRedisSet('OK')
    mockedNext.mockResolvedValue(nextDay())

    // Act
    const res = await GET(request())

    // Assert — identical workout behavior; the rider only counts a skip
    expect(await res.json()).toEqual({
      sent: 1,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 1,
      window: true,
    })
    expect(mockedSend).toHaveBeenCalledTimes(1)
    expect(mockedSend).toHaveBeenCalledWith('user_123', expect.objectContaining({ url: '/' }))
  })
})

describe('reminderMarkerKey', () => {
  it('keys by user and UTC day', () => {
    expect(reminderMarkerKey('user_9', IN_WINDOW)).toBe('reminder:user_9:2026-07-30')
  })
})

describe('checkInMarkerKey', () => {
  it('keys by user and UTC day, distinct from the workout marker', () => {
    expect(checkInMarkerKey('user_9', IN_WINDOW)).toBe('checkin:user_9:2026-07-30')
    expect(checkInMarkerKey('user_9', IN_WINDOW)).not.toBe(reminderMarkerKey('user_9', IN_WINDOW))
  })
})
