import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/api/mcp(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return
  // Redirect signed-out users explicitly rather than via `auth.protect()`:
  // protect() auto-detects middleware-vs-page context to choose redirect-vs-404,
  // and that detection misfires on Vercel's Next 16 `proxy` runtime (it takes the
  // page branch and returns a 404 instead of redirecting). `redirectToSignIn()`
  // always redirects, so the signed-out flow works in every runtime.
  const { userId, redirectToSignIn } = await auth()
  if (!userId) return redirectToSignIn()
})

export const config = {
  matcher: [
    // Skip Next internals + static files; always run for everything else
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
