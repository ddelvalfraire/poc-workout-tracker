/**
 * Coach access gate. The feature is in development: only allowlisted Clerk
 * user ids may reach /coach or /api/chat, and everyone else never sees the
 * entry points. COACH_ALLOWED_USER_IDS (comma-separated) is the explicit
 * list; absent, it falls back to MCP_DEV_USER_ID — the developer's own id,
 * already configured in every environment — so the gate works with zero new
 * setup. No ids configured at all means NOBODY: fail closed, never open.
 */

import { isServerFeatureEnabled } from '@/lib/analytics'

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

/**
 * The coach gate, flag-aware: env allowlist FIRST (zero-latency, and access
 * for the ids already granted never depends on PostHog uptime), then the
 * 'coach-access' PostHog flag for gradual rollout beyond the allowlist. The
 * flag path fails closed (isServerFeatureEnabled returns false on any
 * failure), so the gate's never-open-by-accident property is preserved.
 *
 * The ops gate deliberately does NOT get this treatment: /ops is an internal
 * admin surface, and making admin access remotely toggleable from a
 * third-party dashboard widens the attack surface instead of enabling a
 * rollout. Product gates go through flags; admin authz stays in env.
 */
export async function isCoachEnabled(userId: string): Promise<boolean> {
  if (isCoachUser(userId)) return true
  return isServerFeatureEnabled('coach-access', userId)
}
