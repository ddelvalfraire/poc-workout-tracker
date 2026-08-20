/**
 * The account's SHAPE and the pure reasoning over it — deliberately free of
 * `server-only`, the WorkOS SDK, and anything else that exists only on a
 * server.
 *
 * The split is load-bearing, not tidiness. `account.ts` imports the WorkOS
 * node SDK, which pulls in Node built-ins; anything a client component or a
 * Storybook story touches must therefore come from HERE, or the bundler drags
 * server code into the browser and the render dies on `__dirname is not
 * defined`.
 */

/** OAuth provider key as WorkOS reports it, e.g. 'GoogleOAuth'. */
export type ConnectedAccountProvider = string

/**
 * Whether MFA is usable in this environment, and whether it is compulsory.
 *
 * This mirrors the WorkOS dashboard's own Off/Optional/Required setting. It
 * is configuration rather than an API read because WorkOS exposes the
 * environment's MFA posture only in the dashboard — no endpoint on the
 * User Management or Multi-Factor API reports it.
 */
export type MfaMode = 'off' | 'optional' | 'required'

export interface AccountOverview {
  email: string
  emailVerified: boolean
  firstName: string | null
  lastName: string | null
  /** Google-sourced and read-only — WorkOS exposes no avatar upload. */
  profilePictureUrl: string | null
  /** Providers this account can sign in with, e.g. ['GoogleOAuth']. */
  connectedAccounts: ConnectedAccountProvider[]
  /**
   * Whether MFA is offered at all here. False hides the section entirely
   * rather than disabling it: no user action could enable it, so a dead
   * control would promise something we cannot deliver.
   */
  mfaAvailable: boolean
  /** Whether MFA is compulsory for everyone in this environment. */
  mfaRequired: boolean
  /** Whether THIS user has a verified TOTP factor. */
  hasMfaFactor: boolean
}

/**
 * How many distinct ways this account can be signed into.
 *
 * The guard behind "you cannot unlink your only sign-in method". It counts
 * usable METHODS — today that is linked OAuth identities, since WorkOS's
 * REST user object does not report whether a password is set. Counting
 * identities alone is the documented way products lock out users, so this
 * stays a named function: when a password signal becomes available it is
 * added here, not at each call site.
 */
export function countSignInMethods(account: AccountOverview): number {
  return account.connectedAccounts.length
}

/** A human label for a provider key: 'GoogleOAuth' → 'Google'. */
export function providerLabel(provider: ConnectedAccountProvider): string {
  return provider.replace(/OAuth$/, '')
}

/**
 * Reads the environment's MFA posture, failing CLOSED.
 *
 * An unset or unrecognised value means 'off': offering enrolment we cannot
 * honour would hand users a factor that never challenges at sign-in, which
 * is worse than not offering it. Staging leaves this unset; production sets
 * it to match the WorkOS dashboard.
 */
export function readMfaMode(env: Record<string, string | undefined>): MfaMode {
  const raw = env.WORKOS_MFA_MODE?.trim().toLowerCase()
  return raw === 'optional' || raw === 'required' ? raw : 'off'
}
