'use server'

import { revalidatePath } from 'next/cache'
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import { requireUserId } from '@/lib/auth'

/**
 * Profile edits the user makes about themselves.
 *
 * `updateUser` is a SECRET-KEY call that takes a userId and checks no
 * ownership, so the id comes from requireUserId() and never from the request.
 * It also accepts `email`, `emailVerified`, `password` and `externalId` —
 * none of which are passed here, deliberately:
 *
 *  - `emailVerified: true` combined with an email change is a one-call
 *    account takeover, so this module never sets it.
 *  - `password` is an admin override with no current-password check; a
 *    hijacked session could silently reset credentials. Password changes
 *    belong to AuthKit's own reset flow.
 *  - `externalId` is identity plumbing, not user data.
 */

/** Longest name WorkOS will store without complaint, and past any real name. */
const MAX_NAME_LENGTH = 100

export type UpdateNameResult = { status: 'saved' } | { status: 'invalid' }

/**
 * Updates the display name.
 *
 * Empty strings are sent through rather than rejected: clearing a name is a
 * legitimate thing to want, and WorkOS treats "" as a clear. What is rejected
 * is input longer than the field accepts, which would otherwise fail at the
 * API with an opaque message after the user had typed it all.
 */
export async function updateNameAction(
  firstName: string,
  lastName: string,
): Promise<UpdateNameResult> {
  const userId = await requireUserId()

  const first = firstName.trim()
  const last = lastName.trim()
  if (first.length > MAX_NAME_LENGTH || last.length > MAX_NAME_LENGTH) {
    return { status: 'invalid' }
  }

  await getWorkOS().userManagement.updateUser({
    userId,
    firstName: first,
    lastName: last,
  })

  // Both surfaces render the name server-side; without this the row keeps
  // showing the old value until something else happens to revalidate.
  revalidatePath('/settings/account')
  revalidatePath('/settings')
  return { status: 'saved' }
}
