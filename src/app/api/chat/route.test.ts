import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The coach's paywall boundary. Now that the `max` entitlement is the ONLY
 * gate (the dev rollout gate was retired), this is the test that must never
 * regress: an unentitled request is refused with 402 BEFORE any model is
 * resolved or any tokens stream — no path to free inference.
 */

const getUserId = vi.fn()
vi.mock('@/lib/auth', () => ({ getUserId: () => getUserId() }))

const coachAccess = vi.fn()
vi.mock('@/lib/coach/access', () => ({ coachAccess: () => coachAccess() }))

const resolveCoachModel = vi.fn()
vi.mock('@/lib/coach/model', () => ({
  resolveCoachModel: () => resolveCoachModel(),
  COACH_MODEL_SETUP_HINT: 'coach model not configured',
}))

const streamText = vi.fn()
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamText(...args),
  convertToModelMessages: vi.fn(),
  stepCountIs: vi.fn(),
}))

import { POST } from './route'

function post() {
  return POST(new Request('https://app.test/api/chat', { method: 'POST', body: '{}' }))
}

beforeEach(() => {
  getUserId.mockReset().mockResolvedValue('user_01MEMBER')
  coachAccess.mockReset()
  resolveCoachModel.mockReset().mockReturnValue(null) // stop after the gate
  streamText.mockReset()
})

describe('POST /api/chat — entitlement gate', () => {
  it('401s an unauthenticated caller before checking anything else', async () => {
    getUserId.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(coachAccess).not.toHaveBeenCalled()
    expect(resolveCoachModel).not.toHaveBeenCalled()
  })

  it('402s an unentitled user with no model resolved and no tokens streamed', async () => {
    coachAccess.mockResolvedValue('unentitled')
    const res = await post()
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ upgrade: '/settings/plan' })
    // The crown jewel: the paywall short-circuits before any inference.
    expect(resolveCoachModel).not.toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
  })

  it('lets an entitled user past the gate (reaches model resolution)', async () => {
    coachAccess.mockResolvedValue('available')
    const res = await post()
    // Model is mocked to null → 503; the point is the gate did NOT block, so
    // resolveCoachModel was reached. Proves entitled users are not paywalled.
    expect(resolveCoachModel).toHaveBeenCalled()
    expect(res.status).toBe(503)
  })
})
