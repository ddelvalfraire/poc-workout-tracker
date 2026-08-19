import { eq } from 'drizzle-orm'
import { db } from './index'
import {
  workouts,
  importBatches,
  userPreferences,
  bodyweightLogs,
  bodyMeasurements,
  progressPhotos,
  goals,
  trophies,
  workoutDrafts,
  customExercises,
  exerciseNotes,
  notes,
  workoutTemplates,
  pushSubscriptions,
  programs,
  programPatchProposals,
  programEvents,
} from './schema'

/**
 * Account deletion's Postgres sweep: every ownership-root table keyed by the
 * Clerk user id, in ONE transaction. Child tables (workout_exercises, sets,
 * program_days/exercises/sets/overrides/muscles, template exercises, shares)
 * all reference their roots with onDelete:'cascade' (verified in schema.ts)
 * — deleting the roots deletes everything. program_patch_proposals and
 * program_events cascade from programs but also carry their own user_id;
 * they get an explicit delete so rows that ever pointed at an
 * already-deleted program cannot linger.
 *
 * The consent tables are deliberately ABSENT: consent_events must survive
 * deletion (pseudonymized — see consent.ts) and the fan-out rows are the
 * propagation evidence.
 *
 * Photo blob keys are collected BEFORE the rows go — the storage objects
 * outlive this transaction and the caller removes them from the bucket after
 * commit (object deletion cannot join a db transaction).
 */
export async function purgeUserData(userId: string): Promise<{ photoBlobKeys: string[] }> {
  return db.transaction(async (tx) => {
    const photoRows = await tx
      .select({
        blobKeyDisplay: progressPhotos.blobKeyDisplay,
        blobKeyThumb: progressPhotos.blobKeyThumb,
      })
      .from(progressPhotos)
      .where(eq(progressPhotos.userId, userId))
    const photoBlobKeys = photoRows.flatMap((row) => [row.blobKeyDisplay, row.blobKeyThumb])

    await tx.delete(programPatchProposals).where(eq(programPatchProposals.userId, userId))
    await tx.delete(programEvents).where(eq(programEvents.userId, userId))
    await tx.delete(workouts).where(eq(workouts.userId, userId))
    await tx.delete(importBatches).where(eq(importBatches.userId, userId))
    await tx.delete(programs).where(eq(programs.userId, userId))
    await tx.delete(workoutTemplates).where(eq(workoutTemplates.userId, userId))
    await tx.delete(workoutDrafts).where(eq(workoutDrafts.userId, userId))
    await tx.delete(customExercises).where(eq(customExercises.userId, userId))
    await tx.delete(exerciseNotes).where(eq(exerciseNotes.userId, userId))
    await tx.delete(notes).where(eq(notes.userId, userId))
    await tx.delete(bodyweightLogs).where(eq(bodyweightLogs.userId, userId))
    await tx.delete(bodyMeasurements).where(eq(bodyMeasurements.userId, userId))
    await tx.delete(progressPhotos).where(eq(progressPhotos.userId, userId))
    await tx.delete(goals).where(eq(goals.userId, userId))
    await tx.delete(trophies).where(eq(trophies.userId, userId))
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
    await tx.delete(userPreferences).where(eq(userPreferences.userId, userId))

    return { photoBlobKeys }
  })
}
