import { describe, it, expect, vi, beforeEach } from 'vitest'

const hasFeature = vi.fn()
vi.mock('@/db/entitlements', () => ({ hasFeature: (...a: unknown[]) => hasFeature(...a) }))

import { coachAccess } from './access'

describe('coachAccess — entitlement is the only gate', () => {
  beforeEach(() => hasFeature.mockReset())

  it('is available for a user holding the coach entitlement', async () => {
    hasFeature.mockResolvedValue(true)
    await expect(coachAccess('user_a')).resolves.toBe('available')
    expect(hasFeature).toHaveBeenCalledWith('user_a', 'coach')
  })

  it('is the paywall (unentitled) for a user without it', async () => {
    hasFeature.mockResolvedValue(false)
    await expect(coachAccess('user_a')).resolves.toBe('unentitled')
  })
})
