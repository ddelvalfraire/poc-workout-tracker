import { withAuth } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'

/** Returns the WorkOS userId or redirects to sign-in. Use in Server Components/Actions. */
export async function requireUserId(): Promise<string> {
  const { user } = await withAuth()
  if (!user) redirect('/sign-in')
  return user.id
}

/**
 * Returns the WorkOS userId or null. Use in API route handlers, where the
 * caller turns a missing session into a 401 instead of a redirect.
 */
export async function getUserId(): Promise<string | null> {
  const { user } = await withAuth()
  return user?.id ?? null
}
