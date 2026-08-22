import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Request authentication for the RevenueCat webhook — two independent layers,
 * both fail closed. See docs/SPIKE-REVENUECAT.md (Security).
 *
 * 1. The configurable Authorization header (all RC plans): a shared secret RC
 *    sends verbatim. Cheap constant-time first reject — same idiom as the
 *    cron route's bearer check.
 * 2. The HMAC signature (RC Pro plans): `X-RevenueCat-Webhook-Signature:
 *    t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">`. The raw body
 *    MUST be the bytes as received — re-serialized JSON will not verify.
 *
 * Pure given their inputs (clock injected) so the test vectors are plain.
 */

/** Reject signatures whose timestamp is further than this from our clock —
 *  bounds how long a captured request stays replayable. (The event-id dedupe
 *  makes replays harmless anyway; this is defense in depth.) */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

/** Constant-time equality over strings of possibly different lengths.
 *  timingSafeEqual throws on length mismatch, so lengths gate first — that
 *  leaks only the expected length, which is not secret-dependent per byte. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * Layer 1: the Authorization header RC sends verbatim (configured in the RC
 * dashboard to the same value as our env var). No scheme prefix is assumed —
 * RC sends exactly what was configured.
 */
export function verifyAuthorization(header: string | null, expected: string): boolean {
  if (!expected) return false // unset config must never mean "open"
  return constantTimeEquals(header ?? '', expected)
}

/**
 * Layer 2: the HMAC signature. `secrets` carries [current, previous?] so a
 * rotation has no gap — RC invalidates the old secret immediately on
 * rotation, so during a deploy window deliveries may still be signed either
 * way. Unknown schemes (anything but v1) are ignored per RC's guidance.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  secrets: readonly string[],
  now: Date,
): boolean {
  const usable = secrets.filter((s) => s.length > 0)
  if (usable.length === 0) return false // configured to verify, nothing to verify with
  if (!header) return false

  const parts = new Map<string, string>()
  for (const piece of header.split(',')) {
    const idx = piece.indexOf('=')
    if (idx <= 0) return false
    parts.set(piece.slice(0, idx).trim(), piece.slice(idx + 1).trim())
  }

  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (!timestamp || !signature) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  const ageSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds)
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false

  const signedPayload = `${timestamp}.${rawBody}`
  return usable.some((secret) => {
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex')
    return constantTimeEquals(signature, expected)
  })
}
