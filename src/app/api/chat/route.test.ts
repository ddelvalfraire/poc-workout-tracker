import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The coach's access + free-quota boundary. The properties that must never
 * regress: an unauthenticated caller is refused; entitled (Max) users bypass
 * the free meter entirely; an unentitled user who has exhausted the free
 * quota is walled with 402 BEFORE any tokens stream — no free inference past
 * the cap.
 */

const getUserId = vi.fn()
vi.mock('@/lib/auth', () => ({ getUserId: () => getUserId() }))

const coachAccess = vi.fn()
vi.mock('@/lib/coach/access', () => ({ coachAccess: () => coachAccess() }))

const consumeFreeCoachMessage = vi.fn()
vi.mock('@/lib/coach/quota', () => ({
  consumeFreeCoachMessage: () => consumeFreeCoachMessage(),
}))

const resolveCoachModel = vi.fn()
vi.mock('@/lib/coach/model', () => ({
  resolveCoachModel: () => resolveCoachModel(),
  COACH_MODEL_SETUP_HINT: 'coach model not configured',
}))

const checkCoachRateLimit = vi.fn()
vi.mock('@/lib/coach/rate-limit', () => ({ checkCoachRateLimit: () => checkCoachRateLimit() }))

vi.mock('@/lib/coach/chat-store', () => ({ loadCoachChat: async () => [], saveCoachChat: vi.fn() }))
vi.mock('@/lib/coach/chat-thread', () => ({
  reconcileThread: (_stored: unknown, tail: unknown) => ({ ok: true, messages: [tail] }),
}))
vi.mock('@/db/preferences', () => ({ getWeightUnit: async () => 'kg' }))
vi.mock('@/lib/analytics', () => ({ captureServerEvent: vi.fn() }))

const streamText = vi.fn()
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamText(...args),
  convertToModelMessages: vi.fn(),
  stepCountIs: vi.fn(),
}))

import { POST } from './route'

/** A well-formed single-message request body. */
function post(text = 'how should I progress my squat?') {
  return POST(
    new Request('https://app.test/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: { role: 'user', parts: [{ type: 'text', text }] } }),
    }),
  )
}

beforeEach(() => {
  getUserId.mockReset().mockResolvedValue('user_01MEMBER')
  coachAccess.mockReset().mockResolvedValue('available')
  consumeFreeCoachMessage.mockReset().mockResolvedValue({ allowed: true, used: 1, limit: 3 })
  resolveCoachModel.mockReset().mockReturnValue(null) // stop after the guards
  checkCoachRateLimit.mockReset().mockResolvedValue({ allowed: true, limit: 20 })
  streamText.mockReset()
})

describe('POST /api/chat — access & free quota', () => {
  it('401s an unauthenticated caller before anything else', async () => {
    getUserId.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(coachAccess).not.toHaveBeenCalled()
  })

  it('entitled users bypass the free meter entirely', async () => {
    coachAccess.mockResolvedValue('available')
    // resolveCoachModel null → 503 after the gate; the point is the meter was
    // never consulted for a paying user.
    await post()
    expect(consumeFreeCoachMessage).not.toHaveBeenCalled()
  })

  it('walls an unentitled user whose free quota is exhausted with 402 and no stream', async () => {
    coachAccess.mockResolvedValue('unentitled')
    resolveCoachModel.mockReturnValue({}) // pass the model-config guard
    consumeFreeCoachMessage.mockResolvedValue({ allowed: false, used: 3, limit: 3 })
    const res = await post()
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ quotaExhausted: true, upgrade: '/settings/plan' })
    expect(streamText).not.toHaveBeenCalled()
  })

  it('lets an unentitled user with free messages left spend one and proceed', async () => {
    coachAccess.mockResolvedValue('unentitled')
    resolveCoachModel.mockReturnValue({})
    consumeFreeCoachMessage.mockResolvedValue({ allowed: true, used: 1, limit: 3 })
    await post()
    // The meter was charged; the request was not walled.
    expect(consumeFreeCoachMessage).toHaveBeenCalledTimes(1)
  })

  it('rejects an over-long user message before charging a free coach message', async () => {
    coachAccess.mockResolvedValue('unentitled')
    resolveCoachModel.mockReturnValue({})
    const res = await post('x'.repeat(5000))
    expect(res.status).toBe(400)
    expect(consumeFreeCoachMessage).not.toHaveBeenCalled()
  })

  it('does not charge a free message when the daily rate limit rejects first', async () => {
    coachAccess.mockResolvedValue('unentitled')
    resolveCoachModel.mockReturnValue({})
    checkCoachRateLimit.mockResolvedValue({ allowed: false, limit: 20 })
    const res = await post()
    expect(res.status).toBe(429)
    expect(consumeFreeCoachMessage).not.toHaveBeenCalled()
  })
})
