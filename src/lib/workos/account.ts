import 'server-only'
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import {
  readMfaMode,
  type AccountOverview,
  type ConnectedAccountProvider,
} from './account-model'

// Re-exported so server callers have one import site for the whole seam.
export { countSignInMethods, providerLabel, readMfaMode } from './account-model'
export type { AccountOverview, ConnectedAccountProvider, MfaMode } from './account-model'

/**
 * Reads the signed-in user's account state from the WorkOS User Management
 * and Multi-Factor APIs.
 *
 * These are SECRET-KEY APIs: every call takes a userId and performs no
 * ownership check of its own, so passing a client-supplied id would be a
 * straight IDOR. The rule this module exists to enforce is that the id comes
 * from the session — callers pass the value `requireUserId()` returned and
 * nothing else.
 *
 * (The user-scoped Widgets API would have carried that guarantee for us, but
 * it is unusable here: its tokens are minted per organization MEMBERSHIP and
 * only carry admin widget scopes. A consumer app whose users belong to no
 * organization cannot obtain one — verified against the live API, which
 * answers `Forbidden resource` to a session token and 404s the mint.)
 *
 * The environment's MFA posture is configuration rather than an API read,
 * because WorkOS reports it only in the dashboard.
 */
export async function getAccountOverview(userId: string): Promise<AccountOverview> {
  const workos = getWorkOS()
  const mode = readMfaMode(process.env)

  // Factors are only worth fetching where MFA is actually offered; where it
  // is off the answer is a foregone `false` and the call is a wasted
  // round-trip on every settings render.
  const [user, identities, factors] = await Promise.all([
    workos.userManagement.getUser(userId),
    // Falls back to no linked identities rather than hard-failing the
    // settings page: some WorkOS-compatible backends (the local emulator,
    // notably) don't implement this endpoint and return a non-array body,
    // which the SDK's own deserializer then throws trying to `.map()`.
    workos.userManagement.getUserIdentities(userId).catch(() => []),
    mode === 'off'
      ? Promise.resolve([])
      : workos.multiFactorAuth
          .listUserAuthFactors({ userId })
          .then((page) => page.data),
  ])

  return {
    email: user.email,
    emailVerified: user.emailVerified,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    profilePictureUrl: user.profilePictureUrl ?? null,
    connectedAccounts: (Array.isArray(identities) ? identities : []).map(
      (identity) => identity.provider as ConnectedAccountProvider,
    ),
    mfaAvailable: mode !== 'off',
    mfaRequired: mode === 'required',
    hasMfaFactor: factors.length > 0,
  }
}
