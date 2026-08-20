import { getSignInUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { safeReturnPath } from '@/lib/safe-return-path'

/**
 * Hands sign-in to the hosted AuthKit page. Keeps /sign-in as the app's
 * stable sign-in URL (requireUserId and the proxy both redirect here), so
 * nothing else needs to know where AuthKit lives.
 *
 * `redirect_url` is honored because the share pages depend on it: a visitor
 * who opens a shared program signs in and must land back on that program,
 * not on the home page. It is validated first — the value comes off the URL,
 * so forwarding it unchecked would be an open redirect.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get('redirect_url'))
  redirect(await getSignInUrl({ returnTo }))
}
