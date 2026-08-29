import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth/auth'
import { deleteProgressPhoto } from '@/db/progress-photos'
import { deleteObjects } from '@/lib/supabase-storage'

// Guarding the uuid shape here keeps a garbage id as a clean 404 instead of
// a postgres cast error surfacing as a 500.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DELETE /api/photos/[id] — hard delete: the ownership-scoped row delete is
 * the authorization proof AND yields the blob keys; both objects are then
 * removed best-effort (an orphaned blob is invisible and costs pennies; the
 * user-facing promise — the photo is gone from their timeline — is already
 * kept by the row delete, so an object-store hiccup logs instead of failing
 * the request).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let deleted: Awaited<ReturnType<typeof deleteProgressPhoto>>
  try {
    deleted = await deleteProgressPhoto(userId, id)
  } catch (error: unknown) {
    console.error('DELETE /api/photos/[id] failed', error)
    return NextResponse.json({ error: 'Failed to delete photo' }, { status: 500 })
  }
  if (deleted === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    await deleteObjects([deleted.blobKeyDisplay, deleted.blobKeyThumb])
  } catch (error: unknown) {
    console.error('DELETE /api/photos/[id] blob removal failed', { id }, error)
  }

  return NextResponse.json({ id: deleted.id })
}
