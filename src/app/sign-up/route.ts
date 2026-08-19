import { getSignUpUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'

/**
 * Sign-up counterpart to /sign-in: hands off to the hosted AuthKit page with
 * the sign-up screen preselected. Kept as its own path so existing links and
 * the marketing surface don't have to know AuthKit's URL shape.
 */
export async function GET() {
  redirect(await getSignUpUrl())
}
