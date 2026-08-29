import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/auth', () => ({ getUserId: vi.fn() }))
vi.mock('@/db/push-subscriptions', () => ({ upsertPushSubscription: vi.fn() }))

import { POST } from './route'
import { getUserId } from '@/lib/auth/auth'
import { upsertPushSubscription } from '@/db/push-subscriptions'

const mockedGetUserId = vi.mocked(getUserId)
const mockedUpsert = vi.mocked(upsertPushSubscription)

/** Sets the session result for the next request. */
function signedIn(userId: string | null): void {
  mockedGetUserId.mockResolvedValue(userId)
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID = {
  endpoint: 'https://push.example.com/sub/1',
  keys: { p256dh: 'BKey_-', auth: 'Auth_-' },
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedUpsert.mockResolvedValue()
})

describe('POST /api/push/subscribe', () => {
  it('stores a valid subscription for the signed-in user', async () => {
    // Act
    const res = await post(VALID)

    // Assert
    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith('user_123', {
      endpoint: VALID.endpoint,
      p256dh: VALID.keys.p256dh,
      auth: VALID.keys.auth,
    })
  })

  it('returns 401 and stores nothing when unauthenticated', async () => {
    signedIn(null)
    const res = await post(VALID)
    expect(res.status).toBe(401)
    expect(mockedUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid subscription shape', async () => {
    const res = await post({ endpoint: 'http://insecure.example.com', keys: VALID.keys })
    expect(res.status).toBe(400)
    expect(mockedUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-JSON body', async () => {
    const res = await POST(
      new Request('http://localhost/api/push/subscribe', { method: 'POST', body: 'not json' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 500 when the store fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedUpsert.mockRejectedValue(new Error('db down'))
    const res = await post(VALID)
    expect(res.status).toBe(500)
    errorSpy.mockRestore()
  })
})
