import { getSignInUrl } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'

/**
 * Hands sign-in to the hosted AuthKit page. Keeps /sign-in as the app's
 * stable sign-in URL (requireUserId and the proxy both redirect here), so
 * nothing else needs to know where AuthKit lives.
 */
export async function GET() {
  redirect(await getSignInUrl())
}
