import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/db/push-subscriptions', () => ({ deletePushSubscription: vi.fn() }))

import { POST } from './route'
import { auth } from '@clerk/nextjs/server'
import { deletePushSubscription } from '@/db/push-subscriptions'

const mockedAuth = vi.mocked(auth)
const mockedDelete = vi.mocked(deletePushSubscription)

/** Sets the Clerk auth result for the next request. */
function signedIn(userId: string | null): void {
  mockedAuth.mockResolvedValue({ userId } as unknown as Awaited<ReturnType<typeof auth>>)
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const ENDPOINT = 'https://push.example.com/sub/1'

beforeEach(() => {
  vi.clearAllMocks()
  signedIn('user_123')
  mockedDelete.mockResolvedValue()
})

describe('POST /api/push/unsubscribe', () => {
  it('deletes the user-scoped subscription for the endpoint', async () => {
    // Act
    const res = await post({ endpoint: ENDPOINT })

    // Assert
    expect(res.status).toBe(200)
    expect(mockedDelete).toHaveBeenCalledWith('user_123', ENDPOINT)
  })

  it('returns 401 and deletes nothing when unauthenticated', async () => {
    signedIn(null)
    const res = await post({ endpoint: ENDPOINT })
    expect(res.status).toBe(401)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-https endpoint', async () => {
    const res = await post({ endpoint: 'http://push.example.com/sub/1' })
    expect(res.status).toBe(400)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing endpoint', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
  })
})
