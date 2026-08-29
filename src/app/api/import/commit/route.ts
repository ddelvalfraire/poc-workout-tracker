import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth/auth'
import { commitImport, ImportPlanError, planImport } from '@/db/import'
import { deletePreview, loadPreview } from '@/lib/import/preview-cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/import/commit — the confirm half. Body: `{ token }` from a prior
 * preview. Reloads the stashed ParsedImport (userId-scoped key: someone
 * else's token is a miss here, never a cross-user write) and re-plans before
 * writing — the SAME planImport the preview rendered, so duplicate detection
 * is fresh at commit time and preview counts equal committed counts. The
 * token is single-use: deleted after a successful commit.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let token: unknown
  try {
    const body: unknown = await request.json()
    token = (body as Record<string, unknown> | null)?.token
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }
  if (typeof token !== 'string' || !UUID_PATTERN.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  let cached: Awaited<ReturnType<typeof loadPreview>>
  try {
    cached = await loadPreview(userId, token)
  } catch (error: unknown) {
    console.error('POST /api/import/commit cache read failed', error)
    return NextResponse.json({ error: 'Failed to import' }, { status: 500 })
  }
  if (cached === null) {
    // Expired/unknown token: the preview's 15-minute window closed (or the
    // token was already used). Re-upload is the honest recovery.
    return NextResponse.json(
      { error: 'Preview expired — upload the file again.' },
      { status: 410 },
    )
  }

  try {
    const plan = await planImport(userId, cached.parsed)
    const result = await commitImport(userId, plan, cached.fileName)
    await deletePreview(userId, token)
    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    if (error instanceof ImportPlanError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    console.error('POST /api/import/commit failed', error)
    return NextResponse.json({ error: 'Failed to import' }, { status: 500 })
  }
}
