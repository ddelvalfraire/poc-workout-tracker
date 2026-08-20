import { authkit, handleAuthkitProxy } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'

// `/.well-known/*` carries the OAuth discovery metadata MCP clients fetch before
// they have a token, so it must be reachable without sign-in alongside /api/mcp.
const PUBLIC_ROUTES = [
  '/sign-in(.*)',
  '/sign-up(.*)',
  // AuthKit's OAuth callback: reached mid-handshake, before a session exists.
  '/callback(.*)',
  '/api/mcp(.*)',
  '/.well-known/(.*)',
  // Build-id probe for update-on-resume: no user data, and the stale-client
  // check must work regardless of auth state (a redirect would blind it).
  '/api/version',
  // Vercel cron caller — a robot with no session; the route gates itself with
  // the CRON_SECRET bearer token instead.
  '/api/cron/reminders',
  // Public program share pages: self-gating (resolveShare 404s anything but a
  // live token on a link|public, non-proposed program), and signed-out
  // visitors are the point — this is the acquisition surface.
  '/p/(.*)',
  // Public workout share pages: same self-gating idiom (resolveWorkoutShare
  // 404s anything but a live token on a completed workout) and the same
  // signed-out acquisition purpose.
  '/w/(.*)',
  // PostHog ingest proxy (rewritten in next.config.ts): anonymous visitors
  // are the point — a sign-in redirect here would blind the acquisition
  // funnel. Carries no user data beyond what the client SDK sends.
  '/_i/(.*)',
  // Public legal documents: signed-out readability is a legal requirement
  // (MHMDA wants the health-data policy reachable from the homepage, and
  // store reviews fetch these unauthenticated).
  '/terms',
  '/privacy',
  '/health-privacy',
]

const publicRoutePatterns = PUBLIC_ROUTES.map((route) => new RegExp(`^${route}$`))

export function isPublicRoute(pathname: string): boolean {
  return publicRoutePatterns.some((pattern) => pattern.test(pathname))
}

export default async function proxy(request: NextRequest) {
  // next.config.ts sets skipTrailingSlashRedirect so PostHog's slash-
  // terminated ingest paths (/_i/e/, /_i/flags/) survive to the rewrite —
  // but that flag is GLOBAL, and share links (/p/…/, /w/…/) are exactly the
  // URLs chat apps append slashes to. Restore Next's original 308 here for
  // everything except /_i so the app-wide behavior is unchanged.
  const url = new URL(request.url)
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !url.pathname.startsWith('/_i/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
    return NextResponse.redirect(url, 308)
  }

  // `authkit` refreshes the session and returns the headers that carry it to
  // Server Components; `handleAuthkitProxy` is what attaches them (and strips
  // the internal ones from the browser response).
  const { session, headers, authorizationUrl } = await authkit(request)

  if (isPublicRoute(url.pathname)) return handleAuthkitProxy(request, headers)

  // Signed-out users go to AuthKit's hosted page. `authorizationUrl` already
  // encodes the return path, so the user lands back where they were headed.
  if (!session.user) {
    return handleAuthkitProxy(request, headers, { redirect: authorizationUrl })
  }

  return handleAuthkitProxy(request, headers)
}

export const config = {
  matcher: [
    // Skip Next internals + static files; always run for everything else
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
