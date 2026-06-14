import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { searchExercises } from '@/lib/wger'

/**
 * GET /api/exercises?search=&category=&limit=
 *
 * Proxies wger's exercise catalog (cached) as a typed, filterable list.
 * The Clerk middleware (src/proxy.ts) already gates this route; the explicit
 * auth() check here is defense-in-depth in case the middleware matcher changes.
 * No user scoping — exercise data is public reference data, not user data.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
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
