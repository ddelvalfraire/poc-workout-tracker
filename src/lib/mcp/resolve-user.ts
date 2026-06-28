import { ToolError } from './errors'

/**
 * The slice of an MCP tool/resource `extra` we read: the authenticated identity
 * the route's `verifyToken` stashed in `AuthInfo.extra.userId`. Kept minimal (not
 * the SDK's full `RequestHandlerExtra`) so tests can pass a plain object.
 */
export type AuthCtx = { authInfo?: { extra?: Record<string, unknown> } }

/**
 * Resolves the target userId for an MCP tool/resource call. This is the *only*
 * place the agent's target user is decided, so it is the de-facto authorization
 * boundary for the whole MCP surface.
 *
 * Precedence is security-critical:
 *   1. the authenticated id from the OAuth token (`extra.authInfo.extra.userId`)
 *      — when present it ALWAYS wins, so a client can never impersonate another
 *      user by passing a `userId` argument;
 *   2. an explicit `userId` argument — a dev convenience for the unauthenticated
 *      local path;
 *   3. `process.env.MCP_DEV_USER_ID` — the dogfooding fallback (unset in prod).
 *
 * When auth is required (prod), the token is always present, so 2 and 3 are dead
 * paths there; they keep local dev usable without signing in.
 */
export function resolveUserId(extra?: AuthCtx, argUserId?: string): string {
  const authed = extra?.authInfo?.extra?.userId
  if (typeof authed === 'string' && authed.trim()) return authed.trim()

  const fromArg = argUserId?.trim()
  if (fromArg) return fromArg

  const fromEnv = process.env.MCP_DEV_USER_ID?.trim()
  if (fromEnv) return fromEnv

  // ToolError (not a plain Error) so this actionable message survives
  // errorResult's genericization and reaches the agent.
  throw new ToolError(
    'No userId: authenticate via OAuth, pass a `userId` argument, or set MCP_DEV_USER_ID (dev only).',
  )
}
