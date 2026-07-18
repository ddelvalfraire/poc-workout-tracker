import { describe, it, expect, vi, beforeEach } from 'vitest'
import { coachRateLimitKey, checkCoachRateLimit, COACH_DAILY_MESSAGE_LIMIT } from './rate-limit'
import { getRedis } from '@/lib/redis'

vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }))

const mockedGetRedis = vi.mocked(getRedis)

describe('coachRateLimitKey', () => {
  it('derives a per-user, per-UTC-day key', () => {
    // Arrange — 23:30 in UTC-5 is already the next day in UTC.
    const now = new Date('2026-01-05T23:30:00-05:00')

    // Act
    const key = coachRateLimitKey('user_abc', now)

    // Assert
    expect(key).toBe('coach:msgs:user_abc:2026-01-06')
  })
})

describe('checkCoachRateLimit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('allows when Redis is not configured (fail-open)', async () => {
    mockedGetRedis.mockReturnValue(null)

    const result = await checkCoachRateLimit('user_abc')

    expect(result).toEqual({ allowed: true })
  })

  it('allows under the cap and sets the TTL on the first message of the day', async () => {
    const incr = vi.fn().mockResolvedValue(1)
    const expire = vi.fn().mockResolvedValue(1)
    mockedGetRedis.mockReturnValue({ incr, expire } as never)

    const result = await checkCoachRateLimit('user_abc')

    expect(result).toEqual({ allowed: true })
    expect(incr).toHaveBeenCalledWith(
      expect.stringMatching(/^coach:msgs:user_abc:\d{4}-\d{2}-\d{2}$/),
    )
    expect(expire).toHaveBeenCalledOnce()
  })

  it('denies once the daily cap is exceeded', async () => {
    const incr = vi.fn().mockResolvedValue(COACH_DAILY_MESSAGE_LIMIT + 1)
    mockedGetRedis.mockReturnValue({ incr, expire: vi.fn() } as never)

    const result = await checkCoachRateLimit('user_abc')

    expect(result).toEqual({ allowed: false, limit: COACH_DAILY_MESSAGE_LIMIT })
  })

  it('allows exactly at the cap', async () => {
    const incr = vi.fn().mockResolvedValue(COACH_DAILY_MESSAGE_LIMIT)
    mockedGetRedis.mockReturnValue({ incr, expire: vi.fn() } as never)

    const result = await checkCoachRateLimit('user_abc')

    expect(result).toEqual({ allowed: true })
  })

  it('fails open when Redis errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const incr = vi.fn().mockRejectedValue(new Error('redis down'))
    mockedGetRedis.mockReturnValue({ incr, expire: vi.fn() } as never)

    const result = await checkCoachRateLimit('user_abc')

    expect(result).toEqual({ allowed: true })
    expect(errorSpy).toHaveBeenCalled()
  })
})
