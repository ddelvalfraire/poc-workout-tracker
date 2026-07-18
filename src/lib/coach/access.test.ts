import { describe, it, expect } from 'vitest'
import { coachAllowedUserIds, isCoachUser } from './access'

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
