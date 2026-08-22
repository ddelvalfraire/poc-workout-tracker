/**
 * Coach access gate.
 *
 * The coach is a RELEASED feature; the `max` entitlement is the only gate.
 * There is no rollout allowlist and no `coach-access` flag anymore — a flag is
 * a temporary release gate and an entitlement is a permanent contract, and the
 * two must never both guard a feature that is on sale (selling a flagged
 * feature makes the customer pay the difference — see docs/ENTITLEMENTS.md).
 * Now that the coach is for sale, the flag is retired and only the entitlement
 * remains.
 *
 * Entry points (nav drawer, program pages) are shown to everyone: discovery is
 * how the Max upsell works. Access to actually USE the coach is checked here
 * and enforced server-side in /coach and /api/chat — hiding the UI is
 * cosmetics, the entitlement is the boundary.
 */

/**
 * Whether the user may use the coach. `available` = holds the `max`
 * entitlement; `unentitled` = the paywall. No `unreleased` state — the coach
 * exists for everyone; only paying for it differs.
 */
export async function coachAccess(userId: string): Promise<'available' | 'unentitled'> {
  const { hasFeature } = await import('@/db/entitlements')
  return (await hasFeature(userId, 'coach')) ? 'available' : 'unentitled'
}
