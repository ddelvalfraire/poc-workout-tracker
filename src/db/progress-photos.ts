import { and, count, desc, eq } from 'drizzle-orm'
import { db } from './index'
import { progressPhotos } from './schema'
import {
  isPhotoPose,
  isValidThumbHash,
  PHOTO_CAP,
  PHOTO_NOTE_MAX_LENGTH,
  type PhotoPose,
} from '@/lib/photo-input'

/**
 * Data access for progress-photo rows, always scoped to a WorkOS userId — the
 * same authorization-boundary contract as db/body-measurements.ts. This layer
 * owns METADATA only; the blobs live in Supabase Storage and are written/
 * removed by the route (lib/supabase-storage.ts), which is why insert takes
 * the pre-generated id: object keys embed it, and the row lands only after
 * both uploads succeed.
 */

/** One photo row — blob keys included so callers can mint signed URLs. */
export interface ProgressPhoto {
  id: string
  takenAt: Date
  blobKeyDisplay: string
  blobKeyThumb: string
  thumbHash: string
  pose: PhotoPose | null
  note: string | null
}

export interface InsertProgressPhotoInput {
  /** Pre-generated uuid — already baked into the uploaded object keys. */
  id: string
  blobKeyDisplay: string
  blobKeyThumb: string
  thumbHash: string
  pose?: PhotoPose
  note?: string
  /** Omit for the column default (now); pass to backdate. */
  takenAt?: Date
}

/**
 * Inserts one photo row. Validates here (not only at the route boundary)
 * because `pose`, `note`, and `thumb_hash` are loose text columns — the
 * whitelist and caps are the schema this table actually promises.
 */
export async function insertProgressPhoto(
  userId: string,
  input: InsertProgressPhotoInput,
): Promise<{ id: string }> {
  const { id, blobKeyDisplay, blobKeyThumb, thumbHash, pose, note, takenAt } = input
  if (!blobKeyDisplay || !blobKeyThumb) throw new Error('missing blob keys')
  if (!isValidThumbHash(thumbHash)) throw new Error('invalid thumb hash')
  if (pose !== undefined && !isPhotoPose(pose)) throw new Error('invalid pose')
  if (note !== undefined && note.length > PHOTO_NOTE_MAX_LENGTH) {
    throw new Error(`note must be at most ${PHOTO_NOTE_MAX_LENGTH} characters`)
  }
  const [inserted] = await db
    .insert(progressPhotos)
    .values({
      id,
      userId,
      blobKeyDisplay,
      blobKeyThumb,
      thumbHash,
      ...(pose !== undefined ? { pose } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(takenAt !== undefined ? { takenAt } : {}),
    })
    .returning({ id: progressPhotos.id })
  return inserted
}

/** How many photos a user has stored — the input to the PHOTO_CAP guard. */
export async function countProgressPhotos(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count(progressPhotos.id) })
    .from(progressPhotos)
    .where(eq(progressPhotos.userId, userId))
  return row?.value ?? 0
}

/**
 * Lists a user's photos, freshest first. The default limit is the storage cap
 * itself — the timeline always shows everything a user can possibly have.
 */
export async function listProgressPhotos(
  userId: string,
  limit: number = PHOTO_CAP,
): Promise<ProgressPhoto[]> {
  return db
    .select({
      id: progressPhotos.id,
      takenAt: progressPhotos.takenAt,
      blobKeyDisplay: progressPhotos.blobKeyDisplay,
      blobKeyThumb: progressPhotos.blobKeyThumb,
      thumbHash: progressPhotos.thumbHash,
      pose: progressPhotos.pose,
      note: progressPhotos.note,
    })
    .from(progressPhotos)
    .where(eq(progressPhotos.userId, userId))
    .orderBy(desc(progressPhotos.takenAt))
    .limit(limit)
}

/**
 * Deletes one photo row, gated on ownership (the `delete ... returning`
 * proves it). Returns the blob keys so the caller can remove the objects —
 * row first, objects second: an orphaned blob is invisible; an orphaned row
 * would render a broken timeline cell forever.
 */
export async function deleteProgressPhoto(
  userId: string,
  id: string,
): Promise<{ id: string; blobKeyDisplay: string; blobKeyThumb: string } | null> {
  const [deleted] = await db
    .delete(progressPhotos)
    .where(and(eq(progressPhotos.id, id), eq(progressPhotos.userId, userId)))
    .returning({
      id: progressPhotos.id,
      blobKeyDisplay: progressPhotos.blobKeyDisplay,
      blobKeyThumb: progressPhotos.blobKeyThumb,
    })
  return deleted ?? null
}
