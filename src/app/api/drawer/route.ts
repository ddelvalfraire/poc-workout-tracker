import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { listWorkoutDrafts } from '@/db/workout-drafts'
import { listWorkoutSummaries } from '@/db/workouts'
import { getNextProgramDay } from '@/db/programs'
import { getVolumeTotals } from '@/db/muscle-volume'
import { volumeWindows } from '@/lib/volume-window'
import { getWeightUnit } from '@/db/preferences'
import { listBodyweightLogs } from '@/db/bodyweight'
import { listTrophies } from '@/db/trophies'
import { getExerciseStats, listLoggedExercises } from '@/db/exercise-stats'
import { resolveActiveSession } from '@/lib/active-session'
import { bodyweightDeltaKg } from '@/lib/bodyweight-trend'
import { getCheckInStatus } from '@/lib/check-in'
import { isCoachUser } from '@/lib/coach/access'
import { getGoalsHomeSummary } from '@/lib/goals'
import { goalLabel, strengthPercent } from '@/lib/goal-progress'
import { trophyLabel } from '@/lib/trophies'
import { TROPHY_DEFS } from '@/lib/trophy-kinds'
import { DEFAULT_WEIGHT_UNIT } from '@/lib/units'
import { bucketDaySets, SPARKBAR_DAYS, type DrawerData } from '@/lib/drawer-status'

const RECENTS_LIMIT = 3
// Fresh enough for a nav surface, cheap enough to reopen: the drawer also
// caches in client state per mount, so this only shields rapid remounts.
const DRAWER_CACHE_CONTROL = 'private, max-age=30'

/** The degrade seam: any single read failing nulls ONLY its slice — the nav
 *  must never break because a teaser read did (the ops degrade contract). */
async function orNull<T>(read: Promise<T>, slice: string): Promise<T | null> {
  try {
    return await read
  } catch (error: unknown) {
    console.error(`GET /api/drawer: ${slice} read failed (row degrades)`, error)
    return null
  }
}

/**
 * GET /api/drawer — the nav drawer's one status fetch: every zone's live
 * facts in a single authed round-trip (spike §7: the drawer TELLS YOU YOUR
 * STATUS before you tap anything). One Promise.all over the same cheap reads
 * the home page already runs, each individually degradable to null. The Clerk
 * middleware (src/proxy.ts) already gates this route; the explicit auth()
 * check is defense-in-depth.
 */
export async function GET(): Promise<NextResponse> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const [drafts, summaries, nextDay, unitRead, weekTotals, goalsSummary, trophyRows, logged, bodyLogs, checkIn] =
    await Promise.all([
      orNull(listWorkoutDrafts(userId), 'drafts'),
      orNull(listWorkoutSummaries(userId), 'workouts'),
      orNull(getNextProgramDay(userId), 'program'),
      orNull(getWeightUnit(userId), 'unit'),
      orNull(getVolumeTotals(userId, volumeWindows('rolling', now)), 'volume'),
      orNull(getGoalsHomeSummary(userId, now), 'goals'),
      orNull(listTrophies(userId), 'trophies'),
      orNull(listLoggedExercises(userId), 'exercises'),
      orNull(listBodyweightLogs(userId), 'bodyweight'),
      orNull(getCheckInStatus(userId, now), 'check-in'),
    ])

  const unit = unitRead ?? DEFAULT_WEIGHT_UNIT
  const activeSession =
    drafts !== null && summaries !== null ? resolveActiveSession(drafts, summaries, now) : null

  // Strength top goals earn a % bar — one extra aggregate read, only when the
  // top goal actually is one (bodyweight/consistency have no single percent).
  const topGoal = goalsSummary?.topGoal ?? null
  let goalPercent: number | null = null
  if (
    topGoal !== null &&
    topGoal.kind === 'strength' &&
    'e1rmKg' in topGoal.target &&
    topGoal.source !== null &&
    topGoal.wgerExerciseId !== null
  ) {
    const stats = await orNull(
      getExerciseStats(userId, topGoal.source, topGoal.wgerExerciseId),
      'goal-stats',
    )
    if (stats !== null) {
      goalPercent = strengthPercent(stats.records.bestE1rm?.e1rm ?? null, topGoal.target.e1rmKg)
    }
  }

  // The cheap honest "last PR" fact: the newest club-family trophy (already
  // fetched). A true latest-PR scan would aggregate every exercise's history —
  // not a drawer-open cost. No club trophy → the movement count stands in.
  const newestClub =
    trophyRows?.find((row) => {
      const family = TROPHY_DEFS[row.kind].family
      return family === 'club' || family === 'sum_club'
    }) ?? null

  const data: DrawerData = {
    resume: activeSession !== null ? { key: activeSession.key, name: activeSession.name } : null,
    // Hero start context: suppressed while a session is live (RESUME owns the
    // hero — the single-active-session guard) and when the block finished
    // (the completion payoff lives on home/program, not a nav CTA).
    upNext:
      nextDay !== null && activeSession === null && !nextDay.blockComplete
        ? {
            dayId: nextDay.dayId,
            dayName: nextDay.dayName,
            week: nextDay.week,
            weekdays: nextDay.weekdays,
          }
        : null,
    program:
      nextDay !== null
        ? { name: nextDay.programName, week: nextDay.week, mesocycleWeeks: nextDay.mesocycleWeeks }
        : null,
    stats:
      weekTotals !== null
        ? {
            weekSets: weekTotals.currentSets,
            daySets: summaries !== null ? bucketDaySets(summaries, now) : [],
          }
        : null,
    goals:
      goalsSummary !== null && topGoal !== null
        ? {
            activeCount: goalsSummary.activeCount,
            topGoalLabel: goalLabel(topGoal, unit),
            percent: goalPercent,
            streak: goalsSummary.streak,
          }
        : null,
    trophies:
      trophyRows !== null
        ? {
            earned: trophyRows.length,
            newestLabel: trophyRows.length > 0 ? trophyLabel(trophyRows[0].kind) : null,
          }
        : null,
    body:
      bodyLogs !== null || checkIn !== null
        ? {
            weightKg: bodyLogs?.[0]?.weightKg ?? null,
            deltaKg: bodyLogs !== null ? bodyweightDeltaKg(bodyLogs, SPARKBAR_DAYS, now) : null,
            checkInDue: checkIn?.due ?? false,
            daysSinceLast: checkIn?.daysSinceLast ?? null,
          }
        : null,
    exercises:
      logged !== null || newestClub !== null
        ? {
            lastPrLabel: newestClub !== null ? trophyLabel(newestClub.kind) : null,
            loggedCount: logged?.length ?? 0,
          }
        : null,
    coach: isCoachUser(userId),
    recents:
      summaries
        ?.filter((workout) => workout.completedAt !== null)
        .slice(0, RECENTS_LIMIT)
        .map((workout) => ({
          id: workout.id,
          name: workout.name,
          startedAtMs: workout.startedAt.getTime(),
          volumeKg: workout.volumeKg,
        })) ?? [],
    unit,
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': DRAWER_CACHE_CONTROL } })
}
