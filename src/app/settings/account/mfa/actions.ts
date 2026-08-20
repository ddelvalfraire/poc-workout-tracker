'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { checkRecentAuth } from '@workos-inc/authkit-nextjs'
import { getAccountOverview } from '@/lib/workos/account'
import {
  enrollTotpFactor,
  verifyTotpChallenge,
  removeAllFactors,
  savePendingEnrollment,
  readPendingEnrollment,
  clearPendingEnrollment,
} from '@/lib/workos/mfa'

/**
 * Server actions for TOTP enrolment.
 *
 * Every action derives the user from the session via requireUserId() and
 * NEVER accepts a userId, factorId or challengeId from the client. That rule
 * is the whole authorization story here: the underlying WorkOS endpoints take
 * bare ids and check no ownership, so an id crossing the wire from a browser
 * would let one account delete or verify another's factor.
 *
 * Actions return discriminated results instead of throwing for expected
 * outcomes — a mistyped code is UI state beside the input, not an error page.
 * Genuine faults (WorkOS unreachable, no state store) still throw, and land
 * in the segment's error boundary.
 */

/** What the client is told after asking to begin enrolment. */
export type StartResult =
  | { status: 'enrolled'; secret: string; uri: string; qrCode: string }
  | { status: 'already-enrolled' }
  | { status: 'unavailable' }

/**
 * Begins enrolment: mints the factor and stores it.
 *
 * The issued factor is written to the pending record BEFORE returning, so a
 * backgrounded PWA that loses its JS context comes back to the same secret
 * rather than a freshly minted one the user's authenticator never saw.
 */
export async function startMfaSetupAction(): Promise<StartResult> {
  const userId = await requireUserId()
  const account = await getAccountOverview(userId)

  if (!account.mfaAvailable) return { status: 'unavailable' }
  if (account.hasMfaFactor) return { status: 'already-enrolled' }

  // Replay an in-flight enrolment rather than minting a second factor: the
  // user may already have saved this secret before switching apps.
  const existing = await readPendingEnrollment(userId)
  const pending = existing ?? (await enrollTotpFactor(userId, account.email))
  if (!existing) await savePendingEnrollment(userId, pending)

  return {
    status: 'enrolled',
    secret: pending.secret,
    uri: pending.uri,
    qrCode: pending.qrCode,
  }
}

/** What the client is told after submitting the authenticator's code. */
export type ConfirmResult =
  | { status: 'verified' }
  | { status: 'invalid-code' }
  | { status: 'expired' }

/**
 * Confirms the six digits from the authenticator app.
 *
 * The challenge id comes from the SERVER-side pending record, not from the
 * request, which is what makes a replayed or forged client payload useless.
 */
export async function confirmMfaSetupAction(code: string): Promise<ConfirmResult> {
  const userId = await requireUserId()

  const pending = await readPendingEnrollment(userId)
  // Nothing pending means the ten-minute window lapsed; the honest answer is
  // "start again", never a silent re-enrolment behind the user's back.
  if (!pending) return { status: 'expired' }

  const result = await verifyTotpChallenge(pending.challengeId, code)
  if (result.kind === 'invalid-code') return { status: 'invalid-code' }
  if (result.kind === 'challenge-expired') {
    // The factor is unusable now; drop it so the next attempt starts clean
    // rather than replaying a secret that can no longer be verified.
    await clearPendingEnrollment(userId)
    await removeAllFactors(userId)
    return { status: 'expired' }
  }

  await clearPendingEnrollment(userId)
  // The account surface reads MFA state server-side; without this it would
  // keep showing "Off" after a successful enrolment.
  revalidatePath('/settings/account')
  return { status: 'verified' }
}

/**
 * Abandons a half-finished enrolment.
 *
 * Deletes the WorkOS factor too, not just our record: an unverified factor
 * left behind would make the account read as MFA-enrolled while the user
 * holds no working authenticator entry.
 */
export async function cancelMfaSetupAction(): Promise<void> {
  const userId = await requireUserId()
  const pending = await readPendingEnrollment(userId)
  await clearPendingEnrollment(userId)
  if (pending) await removeAllFactors(userId)
}

/** What the client is told after asking to turn MFA off. */
export type DisableResult =
  | { status: 'removed' }
  | { status: 'blocked-required' }
  | { status: 'reauth-required' }

/**
 * Turns MFA off, gated by a RECENT sign-in.
 *
 * Re-authentication is the real protection — wording alone would not stop
 * someone holding a borrowed unlocked phone. It deliberately does NOT use the
 * type-to-confirm gate: that friction belongs to account deletion, which is
 * irreversible, and spending it on a reversible toggle is what trains people
 * to type past warnings.
 */
export async function disableMfaAction(): Promise<DisableResult> {
  const userId = await requireUserId()

  // An environment that mandates MFA would re-challenge on the next sign-in
  // anyway; removing the factor there strands the user mid-loop.
  const account = await getAccountOverview(userId)
  if (account.mfaRequired) return { status: 'blocked-required' }

  const { isStale } = await checkRecentAuth({ maxAge: RECENT_AUTH_SECONDS })
  if (isStale) return { status: 'reauth-required' }

  await removeAllFactors(userId)
  revalidatePath('/settings/account')
  return { status: 'removed' }
}

/** How fresh a sign-in must be to count as proof for a security change. */
const RECENT_AUTH_SECONDS = 300
