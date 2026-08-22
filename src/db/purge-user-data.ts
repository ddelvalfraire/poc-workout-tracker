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
  entitlementGrants,
  entitlementsCurrent,
  rcWebhookEvents,
  usageCounters,
} from './schema'

/**
 * Account deletion's Postgres sweep: every ownership-root table keyed by the
 * WorkOS user id, in ONE transaction. Child tables (workout_exercises, sets,
 * program_days/exercises/sets/overrides/muscles, template exercises, shares)
 * all reference their roots with onDelete:'cascade' (verified in schema.ts)
 * — deleting the roots deletes everything. program_patch_proposals and
 * program_events cascade from programs but also carry their own user_id;
 * they get an explicit delete so rows that ever pointed at an
 * already-deleted program cannot linger.
 *
 * Entitlement rows ARE swept (docs/ENTITLEMENTS.md explains why they are not
 * treated as retained financial records). The consent tables are deliberately
 * ABSENT: consent_events must survive
 * deletion (pseudonymized — see consent.ts) and the fan-out rows are the
 * propagation evidence.
 *
 * Photo blob keys are collected BEFORE the rows go — the storage objects
 * outlive this transaction and the caller removes them from the bucket after
 * commit (object deletion cannot join a db transaction).
 */
/**
 * The photo blob keys as a standalone read — the orchestrator deletes the
 * storage objects BEFORE purging rows (review finding: keys are only
 * knowable while the rows exist, so storage-after-purge orphaned blobs
 * forever if the bucket call failed after commit). Object deletion is
 * idempotent; a retry after storage succeeded simply finds fewer keys.
 */
export async function listPhotoBlobKeys(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      blobKeyDisplay: progressPhotos.blobKeyDisplay,
      blobKeyThumb: progressPhotos.blobKeyThumb,
    })
    .from(progressPhotos)
    .where(eq(progressPhotos.userId, userId))
  return rows.flatMap((row) => [row.blobKeyDisplay, row.blobKeyThumb])
}

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
    // Entitlements go with the account. Unlike consent_events — retained as
    // legal evidence — a support comp for a deleted account has no continuing
    // business purpose, and Stripe independently retains the record of any
    // real payment. Projection first: it points at the grants.
    await tx.delete(entitlementsCurrent).where(eq(entitlementsCurrent.userId, userId))
    await tx.delete(entitlementGrants).where(eq(entitlementGrants.userId, userId))
    // The RevenueCat webhook inbox: raw payloads can carry subscriber
    // attributes (PII). Keyed by app_user_id, which is our user id whenever
    // it is resolvable at all — orphan rows for other ids are not ours to
    // key on and age out via the payload trim instead.
    await tx.delete(rcWebhookEvents).where(eq(rcWebhookEvents.appUserId, userId))
    // Usage meters (the free coach-message counter). Deleting these resets a
    // user's free taste on re-registration — an accepted pre-launch trade
    // (see metering decisions); the counter carries no legal weight.
    await tx.delete(usageCounters).where(eq(usageCounters.userId, userId))

    return { photoBlobKeys }
  })
}
