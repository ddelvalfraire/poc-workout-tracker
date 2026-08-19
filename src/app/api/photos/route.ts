import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { countProgressPhotos, insertProgressPhoto } from '@/db/progress-photos'
import { deleteObjects, uploadObject } from '@/lib/supabase-storage'
import {
  isPhotoPose,
  isValidThumbHash,
  MAX_DISPLAY_BYTES,
  MAX_THUMB_BYTES,
  PHOTO_CAP,
  PHOTO_NOTE_MAX_LENGTH,
  sniffImageContentType,
  type PhotoPose,
} from '@/lib/photo-input'

// Backdating is allowed (a photo from last month is real data); a future
// takenAt is not. The slack absorbs client-clock skew, nothing more.
const TAKEN_AT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000

/**
 * POST /api/photos — stores one progress photo: two client-prepared
 * derivatives (multipart fields `display` + `thumb`) plus meta (`thumbHash`,
 * optional `pose`/`note`/`takenAt`). The server stores blobs verbatim — all
 * image work happened in the browser (lib/photo-pipeline.ts, the E2EE escape
 * hatch). Guards, in order: auth → parse/validate → PHOTO_CAP → size caps →
 * magic-byte MIME sniff. Write order is transactional-ish: both objects
 * first, row only after both succeed; on any failure past the first upload,
 * best-effort delete of whatever landed so the bucket doesn't accrete
 * orphans (an orphaned blob is invisible; an orphaned row would be a broken
 * timeline cell).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const display = form.get('display')
  const thumb = form.get('thumb')
  if (!(display instanceof Blob) || !(thumb instanceof Blob)) {
    return NextResponse.json({ error: 'Missing display or thumb image' }, { status: 400 })
  }

  const thumbHash = form.get('thumbHash')
  if (typeof thumbHash !== 'string' || !isValidThumbHash(thumbHash)) {
    return NextResponse.json({ error: 'Missing or invalid thumbHash' }, { status: 400 })
  }

  const poseRaw = form.get('pose')
  let pose: PhotoPose | undefined
  if (poseRaw !== null) {
    if (typeof poseRaw !== 'string' || !isPhotoPose(poseRaw)) {
      return NextResponse.json({ error: 'Invalid pose' }, { status: 400 })
    }
    pose = poseRaw
  }

  const noteRaw = form.get('note')
  if (noteRaw !== null && typeof noteRaw !== 'string') {
    return NextResponse.json({ error: 'Invalid note' }, { status: 400 })
  }
  const note = typeof noteRaw === 'string' && noteRaw.trim() !== '' ? noteRaw.trim() : undefined
  if (note !== undefined && note.length > PHOTO_NOTE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Note must be at most ${PHOTO_NOTE_MAX_LENGTH} characters` },
      { status: 400 },
    )
  }

  const takenAtRaw = form.get('takenAt')
  let takenAt: Date | undefined
  if (takenAtRaw !== null) {
    if (typeof takenAtRaw !== 'string') {
      return NextResponse.json({ error: 'Invalid takenAt' }, { status: 400 })
    }
    const parsed = new Date(takenAtRaw)
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getTime() > Date.now() + TAKEN_AT_FUTURE_SLACK_MS
    ) {
      return NextResponse.json({ error: 'Invalid takenAt' }, { status: 400 })
    }
    takenAt = parsed
  }

  try {
    if ((await countProgressPhotos(userId)) >= PHOTO_CAP) {
      // The blob-spend guard (spike question resolved at 200).
      return NextResponse.json(
        { error: `Photo limit reached (${PHOTO_CAP}). Delete old photos to add new ones.` },
        { status: 403 },
      )
    }
  } catch (error: unknown) {
    console.error('POST /api/photos cap check failed', error)
    return NextResponse.json({ error: 'Failed to save photo' }, { status: 500 })
  }

  if (display.size > MAX_DISPLAY_BYTES || thumb.size > MAX_THUMB_BYTES) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  const displayBytes = await display.arrayBuffer()
  const thumbBytes = await thumb.arrayBuffer()
  // Sniff magic bytes — the client's declared type and filename are ignored.
  const displayType = sniffImageContentType(new Uint8Array(displayBytes))
  const thumbType = sniffImageContentType(new Uint8Array(thumbBytes))
  if (displayType === null || thumbType === null) {
    return NextResponse.json({ error: 'Unsupported image format' }, { status: 415 })
  }

  // Key extension is fixed (.webp) regardless of sniffed type — the stored
  // Content-Type governs rendering; keys must stay predictable for delete.
  const photoId = crypto.randomUUID()
  const blobKeyDisplay = `${userId}/${photoId}/display.webp`
  const blobKeyThumb = `${userId}/${photoId}/thumb.webp`

  try {
    await uploadObject(blobKeyDisplay, displayBytes, displayType)
    await uploadObject(blobKeyThumb, thumbBytes, thumbType)
  } catch (error: unknown) {
    console.error('POST /api/photos upload failed', error)
    await cleanupObjects([blobKeyDisplay, blobKeyThumb])
    return NextResponse.json({ error: 'Failed to store photo' }, { status: 502 })
  }

  try {
    await insertProgressPhoto(userId, {
      id: photoId,
      blobKeyDisplay,
      blobKeyThumb,
      thumbHash,
      ...(pose !== undefined ? { pose } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(takenAt !== undefined ? { takenAt } : {}),
    })
  } catch (error: unknown) {
    console.error('POST /api/photos insert failed', error)
    await cleanupObjects([blobKeyDisplay, blobKeyThumb])
    return NextResponse.json({ error: 'Failed to save photo' }, { status: 500 })
  }

  return NextResponse.json({ id: photoId }, { status: 201 })
}

/** Best-effort rollback of uploaded objects — log and move on, never rethrow. */
async function cleanupObjects(keys: string[]): Promise<void> {
  try {
    await deleteObjects(keys)
  } catch (error: unknown) {
    console.error('POST /api/photos cleanup failed', { keys }, error)
  }
}
