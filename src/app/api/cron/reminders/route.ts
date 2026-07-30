import { NextResponse } from 'next/server'
import { getNextProgramDay } from '@/db/programs'
import { listPushSubscribedUserIds } from '@/db/push-subscriptions'
import { sendPushToUser } from '@/lib/push'
import { getRedis } from '@/lib/redis'

// The cron must always execute — never a cached response.
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/reminders — the hourly Vercel cron behind workout reminders
 * (vercel.json). Bearer-gated by CRON_SECRET (Vercel attaches it when the env
 * var exists); public in the Clerk middleware because the caller is a robot.
 *
 * The schedule fires once daily at 13:30 UTC (Hobby plan allows daily crons only); the route still self-gates to the window
 * (13:00–14:59 UTC ≈ 8–10am ET — v1 fixed window, per-user timezones are the
 * noted follow-up). Within the window, each subscribed user whose active
 * program's next day is scheduled TODAY (UTC weekday) gets at most ONE
 * reminder per day: a Redis SET NX marker claims the day BEFORE the send, so
 * the two in-window runs can never double-send. No Redis → no sends at all
 * (skipping is recoverable tomorrow; a double-send is not recallable).
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

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  // Fail closed: no configured secret means nobody is authorized.
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const hour = now.getUTCHours()
  if (hour < WINDOW_START_UTC_HOUR || hour >= WINDOW_END_UTC_HOUR) {
    return NextResponse.json({ sent: 0, skipped: 0, pruned: 0, window: false })
  }

  const redis = getRedis()
  if (!redis) {
    // Without the idempotency marker a retry could double-send; silence is
    // the safer failure.
    console.error('[reminders] Redis not configured; skipping all sends')
    return NextResponse.json({ sent: 0, skipped: 0, pruned: 0, window: true })
  }

  const todayUtcWeekday = now.getUTCDay()
  let sent = 0
  let skipped = 0
  let pruned = 0

  try {
    const userIds = await listPushSubscribedUserIds()
    for (const userId of userIds) {
      const next = await getNextProgramDay(userId)
      if (!next || next.blockComplete || !next.weekdays.includes(todayUtcWeekday)) {
        skipped += 1
        continue
      }

      // Claim the day BEFORE sending: if this run crashes after the claim the
      // user misses one reminder (recoverable); the reverse order could send
      // twice (not recallable).
      const claimed = await redis.set(reminderMarkerKey(userId, now), '1', {
        nx: true,
        ex: MARKER_TTL_SECONDS,
      })
      if (claimed === null) {
        skipped += 1 // an earlier in-window run already reminded today
        continue
      }

      const result = await sendPushToUser(userId, {
        title: `${next.dayName} — Week ${next.week}`,
        body: `${next.exerciseNames.length} exercises · tap to start`,
        url: '/',
      })
      sent += result.sent
      pruned += result.pruned
    }
  } catch (error: unknown) {
    console.error('GET /api/cron/reminders failed', error)
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 })
  }

  return NextResponse.json({ sent, skipped, pruned, window: true })
}
