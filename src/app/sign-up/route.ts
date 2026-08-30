import { getSignUpUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { safeReturnPath } from '@/lib/auth/safe-return-path'

/**
 * Sign-up counterpart to /sign-in: hands off to the hosted AuthKit page with
 * the sign-up screen preselected. Kept as its own path so existing links and
 * the marketing surface don't have to know AuthKit's URL shape.
 *
 * Honors (and validates) `redirect_url` for the same reason /sign-in does.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get('redirect_url'))
  redirect(await getSignUpUrl({ returnTo }))
}
