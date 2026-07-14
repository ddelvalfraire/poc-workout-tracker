import { NextResponse } from 'next/server'

// Always answered by the CURRENT deployment — the whole point is comparing
// against the client's baked-in id, so this must never be statically cached.
export const dynamic = 'force-dynamic'

/**
 * The running deployment's build id, for the update-on-resume probe
 * (src/components/pwa/update-on-resume.tsx). Public route (middleware): it
 * carries no user data, and the probe must work regardless of auth state.
 */
export function GET() {
  // Explicit no-store: the reload logic trusts this endpoint to never be
  // cache-stale — force-dynamic covers Next's cache, this covers any proxy.
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
