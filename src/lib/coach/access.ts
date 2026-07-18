/**
 * Coach access gate. The feature is in development: only allowlisted Clerk
 * user ids may reach /coach or /api/chat, and everyone else never sees the
 * entry points. COACH_ALLOWED_USER_IDS (comma-separated) is the explicit
 * list; absent, it falls back to MCP_DEV_USER_ID — the developer's own id,
 * already configured in every environment — so the gate works with zero new
 * setup. No ids configured at all means NOBODY: fail closed, never open.
 */

type Env = Record<string, string | undefined>

export function coachAllowedUserIds(env: Env = process.env): Set<string> {
  const csv = env.COACH_ALLOWED_USER_IDS?.trim()
  if (csv) {
    return new Set(
      csv
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
  }
  const dev = env.MCP_DEV_USER_ID?.trim()
  return dev ? new Set([dev]) : new Set()
}

export function isCoachUser(userId: string, env: Env = process.env): boolean {
  return coachAllowedUserIds(env).has(userId)
}
