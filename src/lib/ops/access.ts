/**
 * Ops-dashboard access gate — a clone of the coach gate (src/lib/coach/access.ts).
 * /ops is an internal surface: only allowlisted Clerk user ids may reach it,
 * and everyone else gets a 404 (the route never acknowledges it exists).
 * OPS_ALLOWED_USER_IDS (comma-separated) is the explicit list; absent, it
 * falls back to MCP_DEV_USER_ID — the developer's own id, already configured
 * in every environment — so the gate works with zero new setup. No ids
 * configured at all means NOBODY: fail closed, never open.
 */

type Env = Record<string, string | undefined>

export function opsAllowedUserIds(env: Env = process.env): Set<string> {
  const csv = env.OPS_ALLOWED_USER_IDS?.trim()
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

export function isOpsUser(userId: string, env: Env = process.env): boolean {
  return opsAllowedUserIds(env).has(userId)
}
