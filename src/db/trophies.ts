import { and, desc, eq, gte, ne, sql } from 'drizzle-orm'
import type { TrophyContext, TrophyKind } from '@/lib/goals/trophy-kinds'
import { db } from './index'
import { programs, sets, trophies, workoutExercises, workouts } from './schema'

/**
 * Data access for trophies, always scoped to a WorkOS userId — the
 * authorization boundary, like every module here. Thin on purpose: rows in
 * and out plus the evidence aggregates the detector needs; all RULE policy
 * (thresholds, canonical lifts, attribution) lives in lib/trophies.ts.
 *
 * `stampTrophies` is the one nuanced write: a trophy is stamped ONCE — the
 * UNIQUE(user_id, kind) + ON CONFLICT DO NOTHING makes the seam idempotent in
 * SQL, and RETURNING yields exactly the rows THIS call created, so the caller
 * pushes once per trophy ever (goals' markGoalAchieved pattern, set-shaped).
 */

/** One trophy row as every surface consumes it. */
export interface TrophyRow {
  id: string
  kind: TrophyKind
  achievedAt: Date
  context: TrophyContext
}

const trophyColumns = {
  id: trophies.id,
  kind: trophies.kind,
  achievedAt: trophies.achievedAt,
  context: trophies.context,
}

/** Everything earned, newest first — the /trophies page's earned grid. */
export async function listTrophies(userId: string): Promise<TrophyRow[]> {
  return db
    .select(trophyColumns)
    .from(trophies)
    .where(eq(trophies.userId, userId))
    .orderBy(desc(trophies.achievedAt))
}

/**
 * Stamps candidate kinds, returning ONLY the rows newly created — already-
 * earned kinds hit the (user_id, kind) unique and vanish from RETURNING.
 * That return IS the push gate: one stamp, one notification, ever.
 */
export async function stampTrophies(
  userId: string,
  candidates: readonly { kind: TrophyKind; context: TrophyContext }[],
): Promise<TrophyRow[]> {
  if (candidates.length === 0) return []
  return db
    .insert(trophies)
    .values(candidates.map((c) => ({ userId, kind: c.kind, context: c.context })))
    .onConflictDoNothing({ target: [trophies.userId, trophies.kind] })
    .returning(trophyColumns)
}

/** Trophies whose achievedAt landed at/after `since` — the workout-complete
 *  page's session window, mirroring goalsAchievedSince. */
export async function trophiesAchievedSince(userId: string, since: Date): Promise<TrophyRow[]> {
  return db
    .select(trophyColumns)
    .from(trophies)
    .where(and(eq(trophies.userId, userId), gte(trophies.achievedAt, since)))
    .orderBy(desc(trophies.achievedAt))
}

// ── Evidence reads ───────────────────────────────────────────────────────────

/** The ONE tonnage predicate (raw stored weight over completed working
 *  reps_weight sets in completed workouts), matching exercise-stats' session
 *  volume rule so the trophy axis and the stats page can't disagree. */
const tonnagePredicate = (userId: string) =>
  and(
    eq(workouts.userId, userId),
    sql`${workouts.completedAt} is not null`,
    eq(sets.completed, true),
    ne(sets.setType, 'warmup'),
    eq(sets.metricMode, 'reps_weight'),
  )

const tonnageSum = sql<string>`coalesce(sum(${sets.reps} * ${sets.weight}), 0)`

/**
 * Lifetime tonnage in kg. NOT a cheap read: it aggregates every completed set
 * the user owns (index-assisted only on the workouts.user_id side). The
 * detector skips it entirely once both tonnage trophies are earned, which
 * caps how long the cost is paid.
 */
export async function lifetimeTonnageKg(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: tonnageSum })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(tonnagePredicate(userId))
  return Number(row?.total ?? 0)
}

/** COMPLETED workouts owned by the user — the workout-count trophy axis.
 *  Cheap: one indexed count over workouts. */
export async function countCompletedWorkouts(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), sql`${workouts.completedAt} is not null`))
  return row?.value ?? 0
}

/** What live-finish attribution needs about the triggering workout: its
 *  completion instant, program provenance, and OWN tonnage contribution. */
export interface WorkoutFinishFacts {
  completedAt: Date | null
  programDayId: string | null
  tonnageKg: number
}

/** The facts above for one owned workout, or null when unowned/gone. */
export async function workoutFinishFacts(
  userId: string,
  workoutId: string,
): Promise<WorkoutFinishFacts | null> {
  const [row] = await db
    .select({ completedAt: workouts.completedAt, programDayId: workouts.programDayId })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
  if (!row) return null
  const [tonnage] = await db
    .select({ total: tonnageSum })
    .from(sets)
    .innerJoin(workoutExercises, eq(workoutExercises.id, sets.workoutExerciseId))
    .innerJoin(workouts, eq(workouts.id, workoutExercises.workoutId))
    .where(and(tonnagePredicate(userId), eq(workouts.id, workoutId)))
  return {
    completedAt: row.completedAt,
    programDayId: row.programDayId,
    tonnageKg: Number(tonnage?.total ?? 0),
  }
}

/** The active program the block trophy is judged against — most recently
 *  updated 'active' row, the same "active" rule as activeScheduledWeekdays. */
export async function activeProgramRef(
  userId: string,
): Promise<{ id: string; mesocycleWeeks: number } | null> {
  const [program] = await db
    .select({ id: programs.id, mesocycleWeeks: programs.mesocycleWeeks })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  return program ?? null
}
