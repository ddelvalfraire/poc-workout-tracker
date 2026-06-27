import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveUserId } from './resolve-user'

describe('resolveUserId', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    delete process.env.MCP_DEV_USER_ID
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('prefers the explicit userId argument over the env default', () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert
    expect(resolveUserId('user_arg')).toBe('user_arg')
  })

  it('falls back to MCP_DEV_USER_ID when no argument is given', () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert
    expect(resolveUserId()).toBe('user_env')
  })

  it('throws a clear error when neither argument nor env is set', () => {
    // Act + Assert
    expect(() => resolveUserId()).toThrow(/userId/)
  })

  it('treats a whitespace-only argument as absent and falls back to env', () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert
    expect(resolveUserId('   ')).toBe('user_env')
  })
})
