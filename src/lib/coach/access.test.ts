import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/analytics', () => ({ isServerFeatureEnabled: vi.fn(async () => false) }))

import { coachAllowedUserIds, isCoachUser, isCoachEnabled } from './access'
import { isServerFeatureEnabled } from '@/lib/analytics'

describe('coach access gate', () => {
  it('uses the explicit allowlist when set, trimming and dropping blanks', () => {
    const env = { COACH_ALLOWED_USER_IDS: ' user_a , user_b ,, ', MCP_DEV_USER_ID: 'user_dev' }
    expect(coachAllowedUserIds(env)).toEqual(new Set(['user_a', 'user_b']))
    expect(isCoachUser('user_a', env)).toBe(true)
    // The explicit list REPLACES the dev fallback, not extends it.
    expect(isCoachUser('user_dev', env)).toBe(false)
  })

  it('falls back to MCP_DEV_USER_ID when no allowlist is set', () => {
    const env = { MCP_DEV_USER_ID: 'user_dev' }
    expect(isCoachUser('user_dev', env)).toBe(true)
    expect(isCoachUser('user_other', env)).toBe(false)
  })

  it('fails closed when nothing is configured', () => {
    expect(coachAllowedUserIds({})).toEqual(new Set())
    expect(isCoachUser('user_anyone', {})).toBe(false)
  })
})

describe('isCoachEnabled (flag-aware gate)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(isServerFeatureEnabled).mockReset().mockResolvedValue(false)
  })

  it('short-circuits on the env allowlist without consulting the flag', async () => {
    vi.stubEnv('COACH_ALLOWED_USER_IDS', 'user_a')

    await expect(isCoachEnabled('user_a')).resolves.toBe(true)
    expect(isServerFeatureEnabled).not.toHaveBeenCalled()
  })

  it('admits a non-allowlisted user when the coach-access flag is on', async () => {
    vi.stubEnv('COACH_ALLOWED_USER_IDS', 'user_a')
    vi.mocked(isServerFeatureEnabled).mockResolvedValue(true)

    await expect(isCoachEnabled('user_b')).resolves.toBe(true)
    expect(isServerFeatureEnabled).toHaveBeenCalledWith('coach-access', 'user_b')
  })

  it('fails closed when the flag is off (or the flag service fails)', async () => {
    vi.stubEnv('COACH_ALLOWED_USER_IDS', 'user_a')

    await expect(isCoachEnabled('user_b')).resolves.toBe(false)
  })
})
