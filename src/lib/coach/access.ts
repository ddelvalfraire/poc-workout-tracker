/**
 * Coach access gate. The feature is in development: only allowlisted WorkOS
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

/**
 * The full coach gate: rollout FIRST, then entitlement.
 *
 * Order matters for what the user is shown, not just for access. Flag off
 * means the feature does not exist for you yet, and the honest response is
 * silence — offering to sell something we have not released would be worse
 * than showing nothing. Flag on without the entitlement is the paywall.
 *
 * The dangerous combination — paid, but excluded by a rollout percentage — is
 * not handled here because it must never occur: `coach-access` has to be
 * retired before Max goes on sale. A flag is a temporary release gate and an
 * entitlement is a permanent contract; selling a flagged feature conflates
 * them, and the customer pays the difference. See docs/ENTITLEMENTS.md.
 */
export async function coachAccess(
  userId: string,
): Promise<'available' | 'unreleased' | 'unentitled'> {
  if (!(await isCoachEnabled(userId))) return 'unreleased'
  const { hasFeature } = await import('@/db/entitlements')
  return (await hasFeature(userId, 'coach')) ? 'available' : 'unentitled'
}
