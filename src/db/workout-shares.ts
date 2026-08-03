import { and, desc, eq, isNull } from 'drizzle-orm'
import { can } from '@/lib/authz'
import type { LoggingType } from '@/lib/workout-input'
import { bestScoredSet } from '@/lib/one-rep-max'
import { db } from './index'
import { workouts, workoutShares } from './schema'
import { UnfinishedWorkoutShareError } from './workout-errors'
import { mintShareToken } from './program-shares'
import { getWorkoutDetail, getExerciseHistoryBefore, type WorkoutDetail } from './workouts'

/**
 * Workout share-link data access — mirror of db/program-shares.ts for the
 * workout summary. Every gate DELEGATES its decision to `can()` (lib/authz.ts
 * — the one authorization seam); ownership-scoped SQL underneath is
 * defense-in-depth, not the decision. Workouts have no visibility column: a
 * live row in workout_shares IS the outbound grant, and only COMPLETED
 * workouts can hold one (a live session is never viewable).
 */

/** The authz-relevant slice of one owned workout, or null when the (userId,
 *  workoutId) pair doesn't match a row — the constant not-found shape. */
async function readOwnedWorkout(
  userId: string,
  workoutId: string,
): Promise<{ userId: string; completedAt: Date | null } | null> {
  const [row] = await db
    .select({ userId: workouts.userId, completedAt: workouts.completedAt })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
  return row ?? null
}

/**
 * Mints a share link for a COMPLETED owned workout — or returns the existing
 * live one (idempotent: "new token only on explicit re-create", i.e. revoke
 * first — the program-shares rotation semantics). Manage-gated via can(); an
 * unfinished session refuses with UnfinishedWorkoutShareError. Null = not
 * owned/missing.
 */
export async function createWorkoutShare(
  userId: string,
  workoutId: string,
): Promise<{ id: string; token: string } | null> {
  const row = await readOwnedWorkout(userId, workoutId)
  if (!row) return null
  if (!can({ userId }, 'manage', row)) throw new UnfinishedWorkoutShareError(workoutId)
  const [live] = await db
    .select({ id: workoutShares.id, token: workoutShares.token })
    .from(workoutShares)
    .where(and(eq(workoutShares.workoutId, workoutId), isNull(workoutShares.revokedAt)))
    .orderBy(desc(workoutShares.createdAt))
    .limit(1)
  if (live) return live
  const [created] = await db
    .insert(workoutShares)
    .values({ workoutId, token: mintShareToken() })
    .returning({ id: workoutShares.id, token: workoutShares.token })
  return created
}

/**
 * Revokes every live share for an owned workout (sets revokedAt — the row
 * stays as a fact; a replacement is a NEW row via createWorkoutShare). With
 * no visibility column, this IS the off-switch: zero live rows = private
 * again. Manage-gated via can(). Null = not owned/missing.
 */
export async function revokeWorkoutShare(
  userId: string,
  workoutId: string,
): Promise<{ revoked: number } | null> {
  const row = await readOwnedWorkout(userId, workoutId)
  if (!row) return null
  if (!can({ userId }, 'manage', row)) throw new UnfinishedWorkoutShareError(workoutId)
  const rows = await db
    .update(workoutShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(workoutShares.workoutId, workoutId), isNull(workoutShares.revokedAt)))
    .returning({ id: workoutShares.id })
  return { revoked: rows.length }
}

/** The owner's live share for the summary's sharing UI (copy-link needs the
 *  token); ownership-scoped through the workouts join. Null = none live /
 *  not owned. */
export async function getActiveWorkoutShare(
  userId: string,
  workoutId: string,
): Promise<{ token: string } | null> {
  const [row] = await db
    .select({ token: workoutShares.token })
    .from(workoutShares)
    .innerJoin(workouts, eq(workouts.id, workoutShares.workoutId))
    .where(
      and(
        eq(workoutShares.workoutId, workoutId),
        eq(workouts.userId, userId),
        isNull(workoutShares.revokedAt),
      ),
    )
    .orderBy(desc(workoutShares.createdAt))
    .limit(1)
  return row ?? null
}

/** One logged set as the public page renders it — display fields only. */
export interface SharedWorkoutSet {
  id: string
  setNumber: number
  reps: number | null
  weight: number | null
  metricMode: string
  durationSec: number | null
  distanceM: number | null
}

/** One exercise card of the shared summary. No notes (the hard rule), no
 *  exercise identity (wger id / source stay internal — they only key the PR
 *  computation below). */
export interface SharedWorkoutExercise {
  id: string
  name: string
  loggingType: LoggingType
  skipped: boolean
  sets: SharedWorkoutSet[]
}

/** What /w/[token] renders: the summary CONTENT plus the owner id (for the
 *  own-workout check) — nothing else crosses. Notes, program provenance, and
 *  import provenance are stripped by construction: the projection is built
 *  field-by-field and these interfaces have no slot for them. */
export interface SharedWorkoutView {
  ownerUserId: string
  workout: {
    id: string
    name: string | null
    startedAt: Date
    completedAt: Date
    exercises: SharedWorkoutExercise[]
  }
  /** workout_exercises row ids that earned a PR badge — first card per
   *  exercise, judged against the owner's prior history HERE so that history
   *  never reaches the page. */
  prExerciseIds: string[]
}

/** One share row joined to its workout's authz slice, by token. */
async function readWorkoutShareByToken(token: string) {
  const [row] = await db
    .select({
      workoutId: workoutShares.workoutId,
      revokedAt: workoutShares.revokedAt,
      ownerUserId: workouts.userId,
      completedAt: workouts.completedAt,
    })
    .from(workoutShares)
    .innerJoin(workouts, eq(workouts.id, workoutShares.workoutId))
    .where(eq(workoutShares.token, token))
  return row ?? null
}

/**
 * PR badges for the shared summary — the workout/[id] page's algorithm
 * (best-scored set per composite exercise identity, like-beats-like, badge on
 * the first card) with ONE deliberate difference: bodyweightKg is null,
 * always. The owner's bodyweight is body data and never crosses to the public
 * surface, so bodyweight-type exercises judge by reps here — an honest axis
 * that leaks nothing.
 */
function computePrExerciseIds(
  workout: WorkoutDetail,
  history: Awaited<ReturnType<typeof getExerciseHistoryBefore>>,
): string[] {
  const priorByExercise = new Map<string, { reps: number | null; weight: number | null }[]>()
  for (const row of history) {
    const key = `${row.source}:${row.wgerExerciseId}`
    const list = priorByExercise.get(key) ?? []
    list.push({ reps: row.reps, weight: row.weight })
    priorByExercise.set(key, list)
  }
  const currentByExercise = new Map<string, { reps: number | null; weight: number | null }[]>()
  for (const ex of workout.exercises) {
    const key = `${ex.source}:${ex.wgerExerciseId}`
    const list = currentByExercise.get(key) ?? []
    for (const s of ex.sets) list.push({ reps: s.reps, weight: s.weight })
    currentByExercise.set(key, list)
  }
  const prExerciseIds: string[] = []
  const decided = new Set<string>()
  for (const ex of workout.exercises) {
    const key = `${ex.source}:${ex.wgerExerciseId}`
    if (decided.has(key)) continue
    decided.add(key)
    const cur = bestScoredSet(currentByExercise.get(key) ?? [], ex.loggingType, null)
    const pri = bestScoredSet(priorByExercise.get(key) ?? [], ex.loggingType, null)
    if (cur === null || pri === null) continue
    if (
      (cur.kind === 'e1rm' && pri.kind === 'e1rm' && cur.e1rm > pri.e1rm) ||
      (cur.kind === 'reps' && pri.kind === 'reps' && cur.reps > pri.reps)
    ) {
      prExerciseIds.push(ex.id)
    }
  }
  return prExerciseIds
}

/**
 * The public read behind /w/[token]: live share → workout passing the
 * anonymous view gate → summary CONTENT only. Every failure — unknown token,
 * revoked, unfinished — collapses to the same null (the constant-shape 404
 * idiom: never acknowledge which gate refused).
 *
 * Content-only enforcement: the projection below is built field-by-field from
 * the detail read. workout.notes and each exercise's notes NEVER copy over
 * (they may carry private context — the PRD's hard rule), and neither do
 * programDayId/programWeek/importBatchId (provenance internals). The owner's
 * history feeds ONLY the boolean PR badges; body data is never read at all.
 */
export async function resolveWorkoutShare(token: string): Promise<SharedWorkoutView | null> {
  const row = await readWorkoutShareByToken(token)
  if (!row) return null
  const resource = {
    userId: row.ownerUserId,
    completedAt: row.completedAt,
    share: { revokedAt: row.revokedAt },
  }
  // The anonymous-viewer gate is the floor: anyone a token admits sees the
  // same page, so resolution never needs to know who is asking.
  if (!can({ userId: null }, 'view', resource)) return null
  const workout = await getWorkoutDetail(row.ownerUserId, row.workoutId)
  if (!workout || workout.completedAt === null) return null

  const exerciseIds = [...new Set(workout.exercises.map((e) => e.wgerExerciseId))]
  const history = await getExerciseHistoryBefore(row.ownerUserId, exerciseIds, workout.startedAt)

  return {
    ownerUserId: row.ownerUserId,
    workout: {
      id: workout.id,
      name: workout.name,
      startedAt: workout.startedAt,
      completedAt: workout.completedAt,
      exercises: workout.exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        loggingType: ex.loggingType,
        skipped: ex.skipped,
        sets: ex.sets.map((s) => ({
          id: s.id,
          setNumber: s.setNumber,
          reps: s.reps,
          weight: s.weight,
          metricMode: s.metricMode,
          durationSec: s.durationSec,
          distanceM: s.distanceM,
        })),
      })),
    },
    prExerciseIds: computePrExerciseIds(workout, history),
  }
}
