import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UIMessage } from 'ai'
import { coachChatKey, loadCoachChat, saveCoachChat, clearCoachChat } from './chat-store'
import { MAX_MESSAGES } from './chat-request'
import { getRedis } from '@/lib/redis'

vi.mock('@/lib/redis', () => ({ getRedis: vi.fn() }))

const mockedGetRedis = vi.mocked(getRedis)

const message = (text: string): UIMessage =>
  ({ id: `m-${text}`, role: 'user', parts: [{ type: 'text', text }] }) as UIMessage

function mockRedis(overrides: Record<string, unknown> = {}) {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  }
  mockedGetRedis.mockReturnValue(redis as unknown as ReturnType<typeof getRedis>)
  return redis
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('coachChatKey', () => {
  it('is per-user', () => {
    expect(coachChatKey('user_a')).toBe('coach:chat:user_a')
  })
})

describe('loadCoachChat', () => {
  it('returns the stored, validated thread', async () => {
    mockRedis({ get: vi.fn().mockResolvedValue([message('hi')]) })
    const loaded = await loadCoachChat('user_a')
    expect(loaded).toHaveLength(1)
  })

  it('tolerates a stored thread longer than the request-path cap', async () => {
    const long = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => message(String(i)))
    mockRedis({ get: vi.fn().mockResolvedValue(long) })
    expect(await loadCoachChat('user_a')).toHaveLength(MAX_MESSAGES + 5)
  })

  it('resets to empty on a corrupt blob instead of crashing chat', async () => {
    mockRedis({ get: vi.fn().mockResolvedValue([{ nope: true }]) })
    expect(await loadCoachChat('user_a')).toEqual([])
  })

  it('fails soft to empty with no Redis or a Redis error', async () => {
    mockedGetRedis.mockReturnValue(null)
    expect(await loadCoachChat('user_a')).toEqual([])

    mockRedis({ get: vi.fn().mockRejectedValue(new Error('down')) })
    expect(await loadCoachChat('user_a')).toEqual([])
  })
})

describe('saveCoachChat', () => {
  it('stores the thread under the user key with a TTL', async () => {
    const redis = mockRedis()
    await saveCoachChat('user_a', [message('hi')])
    expect(redis.set).toHaveBeenCalledWith(
      'coach:chat:user_a',
      expect.any(String),
      expect.objectContaining({ ex: expect.any(Number) }),
    )
  })

  it('trims to the request-path message cap', async () => {
    const redis = mockRedis()
    const long = Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => message(String(i)))
    await saveCoachChat('user_a', long)
    const stored = JSON.parse(redis.set.mock.calls[0][1] as string) as unknown[]
    expect(stored).toHaveLength(MAX_MESSAGES)
  })

  it('fails soft on Redis errors', async () => {
    mockRedis({ set: vi.fn().mockRejectedValue(new Error('down')) })
    await expect(saveCoachChat('user_a', [message('hi')])).resolves.toBeUndefined()
  })
})

describe('clearCoachChat', () => {
  it('deletes the user key and fails soft', async () => {
    const redis = mockRedis()
    await clearCoachChat('user_a')
    expect(redis.del).toHaveBeenCalledWith('coach:chat:user_a')

    mockRedis({ del: vi.fn().mockRejectedValue(new Error('down')) })
    await expect(clearCoachChat('user_a')).resolves.toBeUndefined()
  })
})
