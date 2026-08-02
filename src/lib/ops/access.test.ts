import { describe, it, expect } from 'vitest'
import { opsAllowedUserIds, isOpsUser } from './access'

describe('ops access gate', () => {
  it('uses the explicit allowlist when set, trimming and dropping blanks', () => {
    const env = { OPS_ALLOWED_USER_IDS: ' user_a , user_b ,, ', MCP_DEV_USER_ID: 'user_dev' }
    expect(opsAllowedUserIds(env)).toEqual(new Set(['user_a', 'user_b']))
    expect(isOpsUser('user_a', env)).toBe(true)
    // The explicit list REPLACES the dev fallback, not extends it.
    expect(isOpsUser('user_dev', env)).toBe(false)
  })

  it('falls back to MCP_DEV_USER_ID when no allowlist is set', () => {
    const env = { MCP_DEV_USER_ID: 'user_dev' }
    expect(isOpsUser('user_dev', env)).toBe(true)
    expect(isOpsUser('user_other', env)).toBe(false)
  })

  it('fails closed when nothing is configured', () => {
    expect(opsAllowedUserIds({})).toEqual(new Set())
    expect(isOpsUser('user_anyone', {})).toBe(false)
  })
})
