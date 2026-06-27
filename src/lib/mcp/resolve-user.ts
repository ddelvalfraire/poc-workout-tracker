/**
 * Resolves the target userId for an MCP tool call (POC, unauthenticated endpoint).
 *
 * This is the *only* place the agent's target user is decided, so it is the de-facto
 * authorization boundary for the whole MCP surface: every tool that touches user data
 * funnels its `userId` through here. Prefers an explicit `userId` tool argument and
 * falls back to `process.env.MCP_DEV_USER_ID` so "add my workout" needs no id during
 * dogfooding. Not production-safe — there is no auth; see the MCP PRD's "What We're NOT
 * Building".
 */
export function resolveUserId(argUserId?: string): string {
  const fromArg = argUserId?.trim()
  if (fromArg) return fromArg
  const fromEnv = process.env.MCP_DEV_USER_ID?.trim()
  if (fromEnv) return fromEnv
  throw new Error(
    'No userId: pass a `userId` argument or set MCP_DEV_USER_ID in the environment.',
  )
}
