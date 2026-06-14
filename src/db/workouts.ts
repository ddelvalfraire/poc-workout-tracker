import { and, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { workouts } from './schema'

/**
 * Data access for workouts, always scoped to a Clerk userId.
 *
 * The app has no Postgres row-level security (Clerk issues the identity, not
 * Supabase), so this module is the authorization boundary: every query filters
 * by user_id. Route handlers must go through these helpers rather than querying
 * `workouts` directly, so a caller can never read or mutate another user's data.
 */

/** Lists a user's workouts, most recent first. */
export function listWorkouts(userId: string) {
  return db
    .select()
    .from(workouts)
    .where(eq(workouts.userId, userId))
    .orderBy(desc(workouts.startedAt))
}

/** Fetches a single workout, but only if it belongs to the given user. */
export function getWorkout(userId: string, id: string) {
  return db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .limit(1)
}

/** Creates a workout owned by the given user. */
export function createWorkout(userId: string, name?: string) {
  return db.insert(workouts).values({ userId, name }).returning()
}
