import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { undoImport } from '@/db/import'

// Guarding the uuid shape keeps a garbage id as a clean 404 instead of a
// postgres cast error surfacing as a 500 (same idiom as /api/photos/[id]).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DELETE /api/import/[batchId] — "Remove this import": deletes exactly the
 * batch's workouts (sets cascade) and the batch row, ownership-gated in
 * db/import.ts. Custom exercises the import created stay — history may have
 * been re-logged against them since.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<NextResponse> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { batchId } = await params
  if (!UUID_PATTERN.test(batchId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const result = await undoImport(userId, batchId)
    if (result === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(result)
  } catch (error: unknown) {
    console.error('DELETE /api/import/[batchId] failed', error)
    return NextResponse.json({ error: 'Failed to remove import' }, { status: 500 })
  }
}
