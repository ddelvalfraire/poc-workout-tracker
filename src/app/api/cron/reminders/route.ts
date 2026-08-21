import { NextResponse } from 'next/server'
import { getNextProgramDay } from '@/db/programs'
import { listPushSubscribedUserIds } from '@/db/push-subscriptions'
import { getCheckInStatus } from '@/lib/check-in'
import { sendPushToUser } from '@/lib/push'
import { getRedis } from '@/lib/redis'

// The cron must always execute — never a cached response.
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/reminders — the hourly Vercel cron behind workout reminders
 * (vercel.json). Bearer-gated by CRON_SECRET (Vercel attaches it when the env
 * var exists); public in the AuthKit middleware (src/proxy.ts) because the
 * caller is a robot.
 *
 * The schedule fires once daily at 13:30 UTC (Hobby plan allows daily crons only); the route still self-gates to the window
 * (13:00–14:59 UTC ≈ 8–10am ET — v1 fixed window, per-user timezones are the
 * noted follow-up). Within the window, each subscribed user whose active
 * program's next day is scheduled TODAY (UTC weekday) gets at most ONE
 * reminder per day: a Redis SET NX marker claims the day BEFORE the send, so
 * the two in-window runs can never double-send. No Redis → no sends at all
 * (skipping is recoverable tomorrow; a double-send is not recallable).
 *
 * The body check-in nudge RIDES this same run (Hobby = one daily cron, no
 * second schedule): after the workout-reminder decision, each subscribed user
 * whose active program suggests a cadence and is due gets its own push under
 * its own marker (`checkin:{userId}:{date}`) — independent claims, so a
 * workout reminder and a check-in can both land on the same day, and either
 * can fire without the other.
 */

// UTC morning window: [start, end) hours.
const WINDOW_START_UTC_HOUR = 13
const WINDOW_END_UTC_HOUR = 15

// A hair over 24h so the marker always outlives its day, then self-expires —
// same idiom as the coach rate-limit key.
const MARKER_TTL_SECONDS = 26 * 60 * 60

/** `reminder:{userId}:{YYYY-MM-DD}` — UTC day, matching the UTC window. */
export function reminderMarkerKey(userId: string, now: Date): string {
  return `reminder:${userId}:${now.toISOString().slice(0, 10)}`
}

/** `checkin:{userId}:{YYYY-MM-DD}` — the check-in rider's own daily claim. */
export function checkInMarkerKey(userId: string, now: Date): string {
  return `checkin:${userId}:${now.toISOString().slice(0, 10)}`
}

/**
 * Dead-man heartbeat: GET the pinger URL (healthchecks.io or any vendor) after
 * a fully-successful run so a silently-dead cron raises an alert. Unset env →
 * skip; ping failure → console.error only, never a cron failure. Early-return
 * paths (out-of-window, no Redis, thrown error) deliberately do NOT ping —
 * a degraded run should look dead to the pinger.
 */
async function pingHeartbeat(): Promise<void> {
  const url = process.env.HEALTHCHECK_PING_URL
  if (!url) return
  try {
    await fetch(url, { cache: 'no-store' })
  } catch (error: unknown) {
    console.error('[reminders] heartbeat ping failed', error)
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  // Fail closed: no configured secret means nobody is authorized.
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const hour = now.getUTCHours()
  if (hour < WINDOW_START_UTC_HOUR || hour >= WINDOW_END_UTC_HOUR) {
    return NextResponse.json({
      sent: 0,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 0,
      window: false,
    })
  }

  const redis = getRedis()
  if (!redis) {
    // Without the idempotency marker a retry could double-send; silence is
    // the safer failure.
    console.error('[reminders] Redis not configured; skipping all sends')
    return NextResponse.json({
      sent: 0,
      skipped: 0,
      pruned: 0,
      checkinSent: 0,
      checkinSkipped: 0,
      window: true,
    })
  }

  const todayUtcWeekday = now.getUTCDay()
  let sent = 0
  let skipped = 0
  let pruned = 0
  let checkinSent = 0
  let checkinSkipped = 0

  try {
    const userIds = await listPushSubscribedUserIds()
    for (const userId of userIds) {
      // Workout reminder — a non-continue block so the check-in rider below
      // still runs for users with nothing to train today.
      const next = await getNextProgramDay(userId)
      if (!next || next.blockComplete || !next.weekdays.includes(todayUtcWeekday)) {
        skipped += 1
      } else {
        // Claim the day BEFORE sending: if this run crashes after the claim
        // the user misses one reminder (recoverable); the reverse order could
        // send twice (not recallable).
        const claimed = await redis.set(reminderMarkerKey(userId, now), '1', {
          nx: true,
          ex: MARKER_TTL_SECONDS,
        })
        if (claimed === null) {
          skipped += 1 // an earlier in-window run already reminded today
        } else {
          const result = await sendPushToUser(userId, {
            title: `${next.dayName} — Week ${next.week}`,
            body: `${next.exerciseNames.length} exercises · tap to start`,
            url: '/',
          })
          sent += result.sent
          pruned += result.pruned
        }
      }

      // Check-in rider: null status (no active program suggesting a cadence)
      // or not-yet-due both count as skips; the workout path above is never
      // affected either way. Same claim-before-send idiom, own marker.
      // Epoch ms: the memoized reader keys on primitives, not Date objects.
      const checkIn = await getCheckInStatus(userId, now.getTime())
      if (!checkIn?.due) {
        checkinSkipped += 1
        continue
      }
      const checkInClaimed = await redis.set(checkInMarkerKey(userId, now), '1', {
        nx: true,
        ex: MARKER_TTL_SECONDS,
      })
      if (checkInClaimed === null) {
        checkinSkipped += 1
        continue
      }
      const checkInResult = await sendPushToUser(userId, {
        title: 'Body check-in',
        body: `${checkIn.programName} suggests one every ${checkIn.cadenceDays} days`,
        url: '/body',
      })
      checkinSent += checkInResult.sent
      pruned += checkInResult.pruned
    }
  } catch (error: unknown) {
    console.error('GET /api/cron/reminders failed', error)
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 })
  }

  await pingHeartbeat()
  return NextResponse.json({ sent, skipped, pruned, checkinSent, checkinSkipped, window: true })
}
