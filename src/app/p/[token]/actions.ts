'use server'

import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth/auth'
import { adoptShared } from '@/db/program-shares'
import { OwnSharedProgramError } from '@/db/program-errors'

/**
 * "Add to my programs" on the public share page: clones the shared program
 * into the SIGNED-IN visitor's account as a 'proposed' row and lands on its
 * program page, where the existing Adopt/Decline banner is the forced
 * confirm. adoptShared re-validates the share at clone time (revoked or
 * re-privated mid-visit → constant-shape null → notFound, matching what the
 * share page itself now shows). An owner who somehow submits against their
 * own link (the page never offers it) just returns to the share page.
 */
export async function adoptSharedProgramAction(token: unknown): Promise<void> {
  const userId = await requireUserId()
  if (typeof token !== 'string' || token.length === 0) notFound()
  let result: { id: string } | null
  try {
    result = await adoptShared(userId, token)
  } catch (error: unknown) {
    if (error instanceof OwnSharedProgramError) redirect(`/p/${token}`)
    throw error
  }
  if (!result) notFound()
  revalidatePath('/programs')
  redirect(`/programs/${result.id}`)
}
