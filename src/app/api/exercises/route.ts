import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { searchExercises, getAllExercises } from '@/lib/wger'
import { listCustomExercises } from '@/db/custom-exercises'

// Exercise data is public reference data that changes rarely, so the browser
// may cache the full catalog for the session (instant repeat opens).
const CATALOG_CACHE_CONTROL = 'private, max-age=3600, stale-while-revalidate=86400'

/**
 * GET /api/exercises?search=&category=&limit=  — filtered, capped list.
 * GET /api/exercises?all=1                      — the full catalog, for clients
 *   that filter in-process (the exercise picker does this so search is instant).
 *
 * Proxies wger's exercise catalog (cached). The Clerk middleware (src/proxy.ts)
 * already gates this route; the explicit auth() check here is defense-in-depth.
 * No user scoping — exercise data is public reference data, not user data.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  // The user's custom exercises, source-labeled, as a SEPARATE uncached
  // fetch: the shared wger catalog stays browser-cacheable while customs —
  // per-user and changed by the create flow — are always fresh.
  if (searchParams.get('custom') === '1') {
    try {
      const customs = await listCustomExercises(userId)
      return NextResponse.json(
        customs.map((c) => ({
          id: c.id,
          source: 'custom' as const,
          name: c.name,
          category: c.category,
          ...(c.equipment && c.equipment.length > 0 ? { equipment: c.equipment } : {}),
          ...(c.muscles && c.muscles.length > 0 ? { muscles: c.muscles } : {}),
          ...(c.musclesSecondary && c.musclesSecondary.length > 0
            ? { musclesSecondary: c.musclesSecondary }
            : {}),
        })),
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch (error: unknown) {
      console.error('GET /api/exercises?custom=1 failed', error)
      return NextResponse.json({ error: 'Failed to fetch custom exercises' }, { status: 502 })
    }
  }

  try {
    if (searchParams.get('all') === '1') {
      const exercises = await getAllExercises()
      return NextResponse.json(exercises, { headers: { 'Cache-Control': CATALOG_CACHE_CONTROL } })
    }
  } catch (error: unknown) {
    console.error('GET /api/exercises?all=1 failed', error)
    return NextResponse.json({ error: 'Failed to fetch exercises' }, { status: 502 })
  }

  const search = searchParams.get('search') ?? undefined
  const category = searchParams.get('category') ?? undefined
  // Strict parse: only accept an all-digit limit; "abc" or "10abc" are ignored.
  const limitParam = searchParams.get('limit')
  const limit = limitParam && /^\d+$/.test(limitParam) ? Number.parseInt(limitParam, 10) : undefined

  try {
    const exercises = await searchExercises({ search, category, limit })
    return NextResponse.json(exercises)
  } catch (error: unknown) {
    console.error('GET /api/exercises failed', error)
    return NextResponse.json({ error: 'Failed to fetch exercises' }, { status: 502 })
  }
}
