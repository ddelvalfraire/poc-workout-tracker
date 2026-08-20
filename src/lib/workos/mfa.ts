import 'server-only'
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import { getRedis } from '@/lib/redis'

/**
 * TOTP enrolment against the WorkOS AuthKit Multi-Factor API — the documented
 * path for building your own authentication UI ("If you'd prefer to build and
 * manage your own authentication UI, you can do so via the AuthKit
 * Multi-Factor API").
 *
 * Two things about this flow drive every decision below.
 *
 * ONE — these are SECRET-KEY endpoints. `deleteFactor(id)` and
 * `verifyChallenge({ authenticationChallengeId })` take bare ids and check no
 * ownership whatsoever, so a client-supplied id would be an IDOR. Every id
 * used here is either derived from the session or read back from this
 * module's own server-side record; none crosses the network from a browser.
 *
 * TWO — on mobile the authenticator app is on the SAME device, so the user
 * must leave the app mid-enrolment, and a standalone PWA can have its JS
 * context discarded while backgrounded. If returning re-ran enrolment, WorkOS
 * would mint a NEW secret while the user had already saved the old one, and
 * verification would fail with nothing on screen explaining why. So the
 * issued factor is persisted and replayed verbatim — never regenerated.
 *
 * There are no backup codes anywhere in WorkOS. Recovery means an operator
 * deleting the factor, which the UI must say plainly rather than implying a
 * printable escape hatch exists.
 */

/** Ten minutes: long enough to install an authenticator app mid-flow. */
const PENDING_TTL_SECONDS = 600

const pendingKey = (userId: string) => `mfa:enroll:${userId}`

/** The factor WorkOS issued, held so a returning user sees the same secret. */
export interface PendingEnrollment {
  factorId: string
  challengeId: string
  /** Manual-entry key — the accessible path, and the mobile fallback. */
  secret: string
  /** otpauth:// URI: one tap hands the secret to the authenticator app. */
  uri: string
  /** Base64 data URI. Only useful when scanning from a SECOND device. */
  qrCode: string
}

/**
 * Thrown when enrolment state cannot be held. Enrolment is refused outright
 * rather than run against memory that may vanish — a half-enrolled factor the
 * user has already saved is worse than never starting.
 */
export class MfaStateUnavailableError extends Error {
  constructor() {
    super('Enrolment state store is unavailable.')
    this.name = 'MfaStateUnavailableError'
  }
}

export async function savePendingEnrollment(
  userId: string,
  pending: PendingEnrollment,
): Promise<void> {
  const redis = getRedis()
  if (!redis) throw new MfaStateUnavailableError()
  await redis.set(pendingKey(userId), JSON.stringify(pending), { ex: PENDING_TTL_SECONDS })
}

export async function readPendingEnrollment(userId: string): Promise<PendingEnrollment | null> {
  const redis = getRedis()
  if (!redis) throw new MfaStateUnavailableError()
  const raw = await redis.get<string | PendingEnrollment>(pendingKey(userId))
  if (!raw) return null
  // Upstash may hand back an already-parsed object or the raw string.
  return typeof raw === 'string' ? (JSON.parse(raw) as PendingEnrollment) : raw
}

export async function clearPendingEnrollment(userId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(pendingKey(userId))
}

/** What the user's authenticator app will show this factor as. */
const TOTP_ISSUER = 'Workout Tracker'

/**
 * Mints a TOTP factor for the user and returns everything needed to add it:
 * the otpauth:// uri (one tap on mobile), the secret (manual entry), and a
 * QR data URI (scanning from another device).
 *
 * Enrolment also opens the first challenge, so the code the user types next
 * has something to verify against without a second round-trip.
 */
export async function enrollTotpFactor(
  userId: string,
  accountEmail: string,
): Promise<PendingEnrollment> {
  const workos = getWorkOS()
  const { authenticationFactor, authenticationChallenge } =
    await workos.multiFactorAuth.createUserAuthFactor({
      userId,
      type: 'totp',
      totpIssuer: TOTP_ISSUER,
      totpUser: accountEmail,
    })

  return {
    factorId: authenticationFactor.id,
    challengeId: authenticationChallenge.id,
    secret: authenticationFactor.totp.secret,
    uri: authenticationFactor.totp.uri,
    qrCode: authenticationFactor.totp.qrCode,
  }
}

/** Outcome of confirming the six digits from the authenticator app. */
export type VerifyTotpResult =
  | { kind: 'verified' }
  | { kind: 'invalid-code' }
  | { kind: 'challenge-expired' }

/**
 * Verifies a code against a challenge.
 *
 * A wrong code is a RESULT, not an exception: it is the single most common
 * thing that happens on this screen, and surfacing it as a thrown error would
 * put an error page in front of a typo. WorkOS answers a stale challenge with
 * a 4xx, which is distinguished so the UI can say "start again" rather than
 * "wrong code" for something the user did not get wrong.
 */
export async function verifyTotpChallenge(
  challengeId: string,
  code: string,
): Promise<VerifyTotpResult> {
  const workos = getWorkOS()
  try {
    const { valid } = await workos.multiFactorAuth.verifyChallenge({
      authenticationChallengeId: challengeId,
      code,
    })
    return valid ? { kind: 'verified' } : { kind: 'invalid-code' }
  } catch {
    // An unusable challenge (expired, already consumed) rather than a wrong
    // code — the remedy is a fresh factor, not another guess.
    return { kind: 'challenge-expired' }
  }
}

/** Opens a fresh challenge against an existing factor. */
export async function challengeFactor(factorId: string): Promise<string> {
  const workos = getWorkOS()
  const challenge = await workos.multiFactorAuth.challengeFactor({
    authenticationFactorId: factorId,
  })
  return challenge.id
}

/**
 * Removes every TOTP factor the user has.
 *
 * Ids are listed server-side from the session's user rather than accepted
 * from the caller: `deleteFactor` performs no ownership check, so a
 * client-supplied id would delete another user's factor.
 */
export async function removeAllFactors(userId: string): Promise<void> {
  const workos = getWorkOS()
  const factors = await workos.multiFactorAuth.listUserAuthFactors({ userId })
  await Promise.all(factors.data.map((factor) => workos.multiFactorAuth.deleteFactor(factor.id)))
}
