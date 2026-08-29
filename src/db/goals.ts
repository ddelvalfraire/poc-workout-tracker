import { and, asc, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm'
import type { ExerciseSource } from '@/lib/exercises/custom-exercise-input'
import type { GoalKind, GoalTarget, ParsedGoalInput } from '@/lib/goals/goal-input'
import { db } from './index'
import { goals, programDays, programs, workouts } from './schema'

/**
 * Data access for goals, always scoped to a WorkOS userId — the authorization
 * boundary, like every module here. Thin on purpose: rows in and out plus the
 * evidence reads the streak needs; all progress/achievement POLICY lives in
 * lib/goal-progress.ts (pure) composed by lib/goals.ts.
 *
 * `markGoalAchieved` is the one nuanced write: achievedAt is a recorded fact
 * set ONCE — the `achieved_at IS NULL` predicate makes the seam's check
 * idempotent in SQL, not in racy application reads.
 */

/** One goal row as every surface consumes it. */
export interface GoalRow {
  id: string
  kind: GoalKind
  target: GoalTarget
  wgerExerciseId: number | null
  source: ExerciseSource | null
  exerciseName: string | null
  /** YYYY-MM-DD or null. */
  deadline: string | null
  createdAt: Date
  achievedAt: Date | null
  archivedAt: Date | null
}

/** Active-goal ceiling per user — an abuse guard, not a product limit. */
export const MAX_ACTIVE_GOALS = 20

const goalColumns = {
  id: goals.id,
  kind: goals.kind,
  target: goals.target,
  wgerExerciseId: goals.wgerExerciseId,
  source: goals.source,
  exerciseName: goals.exerciseName,
  deadline: goals.deadline,
  createdAt: goals.createdAt,
  achievedAt: goals.achievedAt,
  archivedAt: goals.archivedAt,
}

/**
 * Inserts a validated goal (see lib/goal-input.ts — nothing unparsed reaches
 * this signature). Enforces the active-goal ceiling with a pre-count; the
 * check-then-insert race is accepted at POC scale (worst case: a few rows
 * over an abuse guard).
 */
export async function createGoal(userId: string, input: ParsedGoalInput): Promise<{ id: string }> {
  const active = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.userId, userId), isNull(goals.archivedAt)))
  if (active.length >= MAX_ACTIVE_GOALS) {
    throw new Error(`goal limit reached (${MAX_ACTIVE_GOALS} active)`)
  }
  const [inserted] = await db
    .insert(goals)
    .values({
      userId,
      kind: input.kind,
      target: input.target,
      deadline: input.deadline,
      ...(input.kind === 'strength'
        ? {
            wgerExerciseId: input.exercise.wgerExerciseId,
            source: input.exercise.source,
            exerciseName: input.exercise.name,
          }
        : {}),
    })
    .returning({ id: goals.id })
  return inserted
}

/** Active (non-archived) goals, newest first. Achieved-but-unarchived rows
 *  stay in this list — achievement doesn't hide a goal, archiving does. */
export async function listActiveGoals(userId: string): Promise<GoalRow[]> {
  return db
    .select(goalColumns)
    .from(goals)
    .where(and(eq(goals.userId, userId), isNull(goals.archivedAt)))
    .orderBy(desc(goals.createdAt))
    .limit(MAX_ACTIVE_GOALS)
}

/** Archived goals, newest-archived first, capped for the quiet history list. */
export async function listArchivedGoals(userId: string, limit = 50): Promise<GoalRow[]> {
  return db
    .select(goalColumns)
    .from(goals)
    .where(and(eq(goals.userId, userId), isNotNull(goals.archivedAt)))
    .orderBy(desc(goals.archivedAt))
    .limit(limit)
}

/**
 * Stamps achievedAt ONCE (idempotent: the IS NULL predicate makes a repeat
 * call — or a racing double-fire of the seam — match nothing). Returns null
 * when the goal is missing, unowned, or already achieved; the caller sends
 * the push only on a non-null return, so one achievement = one notification.
 */
export async function markGoalAchieved(userId: string, id: string): Promise<{ id: string } | null> {
  const [updated] = await db
    .update(goals)
    .set({ achievedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.userId, userId), isNull(goals.achievedAt)))
    .returning({ id: goals.id })
  return updated ?? null
}

/** Soft-hides an active goal (returning proves ownership); null = not owned,
 *  gone, or already archived. */
export async function archiveGoal(userId: string, id: string): Promise<{ id: string } | null> {
  const [updated] = await db
    .update(goals)
    .set({ archivedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.userId, userId), isNull(goals.archivedAt)))
    .returning({ id: goals.id })
  return updated ?? null
}

/** Hard delete; null = not owned or already gone (mirrors deleteBodyweightLog). */
export async function deleteGoal(userId: string, id: string): Promise<{ id: string } | null> {
  const [deleted] = await db
    .delete(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning({ id: goals.id })
  return deleted ?? null
}

/** Goals whose achievedAt landed at/after `since` — the workout-complete
 *  page's honest "achieved by THIS session" window (session start → now). */
export async function goalsAchievedSince(userId: string, since: Date): Promise<GoalRow[]> {
  return db
    .select(goalColumns)
    .from(goals)
    .where(and(eq(goals.userId, userId), isNotNull(goals.achievedAt), gte(goals.achievedAt, since)))
    .orderBy(desc(goals.achievedAt))
    .limit(MAX_ACTIVE_GOALS)
}

/** The newest non-archived strength goal for one exercise (composite
 *  identity), or null — the stats page's trend target line. */
export async function activeStrengthGoalForExercise(
  userId: string,
  source: ExerciseSource,
  wgerExerciseId: number,
): Promise<GoalRow | null> {
  const [row] = await db
    .select(goalColumns)
    .from(goals)
    .where(
      and(
        eq(goals.userId, userId),
        eq(goals.kind, 'strength'),
        eq(goals.source, source),
        eq(goals.wgerExerciseId, wgerExerciseId),
        isNull(goals.archivedAt),
      ),
    )
    .orderBy(desc(goals.createdAt))
    .limit(1)
  return row ?? null
}

// ── Streak evidence reads ────────────────────────────────────────────────────

/**
 * Completion instants of the user's completed workouts since `since`,
 * ascending — the raw adherence evidence `weeklyStreak` buckets into weeks.
 * ANY completed workout counts (training on a scheduled day is training,
 * whatever plan it came from).
 */
export async function completedWorkoutTimes(userId: string, since: Date): Promise<Date[]> {
  const rows = await db
    .select({ completedAt: workouts.completedAt })
    .from(workouts)
    .where(
      and(
        eq(workouts.userId, userId),
        isNotNull(workouts.completedAt),
        gte(workouts.completedAt, since),
      ),
    )
    .orderBy(asc(workouts.completedAt))
  return rows.flatMap((r) => (r.completedAt !== null ? [r.completedAt] : []))
}

/**
 * The distinct scheduled weekdays (0–6, Sunday-first) across the ACTIVE
 * program's days — the week's training obligations. "Active" mirrors
 * getNextProgramDay: most recently updated 'active' row wins. Empty when no
 * active program or nothing is scheduled (the streak is then 0 by rule).
 */
export async function activeScheduledWeekdays(userId: string): Promise<number[]> {
  const [program] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.userId, userId), eq(programs.status, 'active')))
    .orderBy(desc(programs.updatedAt))
    .limit(1)
  if (!program) return []
  const days = await db
    .select({ weekdays: programDays.weekdays })
    .from(programDays)
    .where(eq(programDays.programId, program.id))
  const union = new Set<number>()
  for (const day of days) {
    for (const weekday of day.weekdays) union.add(weekday)
  }
  return [...union].sort((a, b) => a - b)
}
