import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

/** Returns the Clerk userId or redirects to sign-in. Use in Server Components/Actions. */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  return userId
}
