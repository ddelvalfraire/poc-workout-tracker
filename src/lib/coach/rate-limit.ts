import { getRedis } from '@/lib/redis'

/**
 * Per-user daily message cap for the AI coach. Counted per POST /api/chat (one
 * user message per request), stored as a Redis counter keyed by UTC day.
 *
 * Fail-open by design: the limiter protects the gateway bill, it is not a
 * security boundary — if Redis is down or unconfigured the chat keeps working.
 */
export const COACH_DAILY_MESSAGE_LIMIT = 40

// Key lives a bit past its day so a request straddling midnight still counts,
// then expires on its own.
const KEY_TTL_SECONDS = 26 * 60 * 60

/** `coach:msgs:{userId}:{YYYY-MM-DD}` — day is UTC so the window is unambiguous. */
export function coachRateLimitKey(userId: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return `coach:msgs:${userId}:${day}`
}

export type CoachRateLimitResult = { allowed: true } | { allowed: false; limit: number }

/**
 * Increments today's counter and reports whether this message is within the
 * cap. The increment-then-check order means a denied request still bumped the
 * counter — acceptable for a daily cap, and it keeps this a single round trip.
 */
export async function checkCoachRateLimit(userId: string): Promise<CoachRateLimitResult> {
  const redis = getRedis()
  if (!redis) return { allowed: true }

  try {
    const key = coachRateLimitKey(userId)
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, KEY_TTL_SECONDS)
    }
    if (count > COACH_DAILY_MESSAGE_LIMIT) {
      return { allowed: false, limit: COACH_DAILY_MESSAGE_LIMIT }
    }
    return { allowed: true }
  } catch (error: unknown) {
    // Fail open: a Redis outage must not take the coach down with it.
    console.error('[coach] rate limit check failed; allowing request', error)
    return { allowed: true }
  }
}
