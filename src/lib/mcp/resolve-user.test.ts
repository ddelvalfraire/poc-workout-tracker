import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveUserId, resolveActor, type AuthCtx } from './resolve-user'
import { ToolError } from './errors'

/** Builds a tool `extra` carrying an authenticated userId, as verifyToken stashes it. */
function authed(userId: unknown): AuthCtx {
  return { authInfo: { extra: { userId } } }
}

describe('resolveUserId', () => {
  const original = process.env.MCP_DEV_USER_ID
  beforeEach(() => {
    delete process.env.MCP_DEV_USER_ID
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_DEV_USER_ID
    else process.env.MCP_DEV_USER_ID = original
  })

  it('prefers the authenticated id over both the arg and the env (no impersonation)', () => {
    // Arrange — a token user, plus a conflicting arg and env
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert — the token always wins
    expect(resolveUserId(authed('user_token'), 'user_arg')).toBe('user_token')
  })

  it('trims the authenticated id', () => {
    // Act + Assert
    expect(resolveUserId(authed('  user_token  '))).toBe('user_token')
  })

  it('ignores a whitespace-only authenticated id and falls back to the arg', () => {
    // Act + Assert
    expect(resolveUserId(authed('   '), 'user_arg')).toBe('user_arg')
  })

  it('ignores a non-string authenticated id and falls back to the arg', () => {
    // Act + Assert
    expect(resolveUserId(authed(123), 'user_arg')).toBe('user_arg')
  })

  it('prefers the explicit userId argument over the env default when unauthenticated', () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert
    expect(resolveUserId(undefined, 'user_arg')).toBe('user_arg')
  })

  it('falls back to MCP_DEV_USER_ID when neither auth nor arg is given', () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert
    expect(resolveUserId()).toBe('user_env')
  })

  it('throws a clear ToolError when nothing resolves a user', () => {
    // Act + Assert
    expect(() => resolveUserId()).toThrow(ToolError)
    expect(() => resolveUserId()).toThrow(/userId/)
  })

  it('treats a whitespace-only argument as absent and falls back to env', () => {
    // Arrange
    process.env.MCP_DEV_USER_ID = 'user_env'

    // Act + Assert
    expect(resolveUserId(undefined, '   ')).toBe('user_env')
  })
})

describe('resolveActor', () => {
  it("labels the coach bridge's stamped clientId as 'coach'", () => {
    // Arrange — exactly what mcp-bridge.ts stamps on every message
    const extra: AuthCtx = { authInfo: { clientId: 'coach-chat', extra: { userId: 'user_1' } } }

    // Act + Assert
    expect(resolveActor(extra)).toBe('coach')
  })

  it("labels any other clientId as 'mcp'", () => {
    // Arrange — the HTTP transport's OAuth client
    const extra: AuthCtx = { authInfo: { clientId: 'claude-desktop', extra: { userId: 'user_1' } } }

    // Act + Assert
    expect(resolveActor(extra)).toBe('mcp')
  })

  it("labels the unauthenticated dev path (no authInfo at all) as 'mcp'", () => {
    // Act + Assert
    expect(resolveActor(undefined)).toBe('mcp')
    expect(resolveActor({})).toBe('mcp')
  })
})
