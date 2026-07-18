'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import { clearCoachChat } from '@/lib/coach/chat-store'

/** "New chat": drops the persisted thread. The client resets its own message
 *  state; revalidation keeps a subsequent server render honest too. */
export async function clearCoachChatAction(): Promise<void> {
  const userId = await requireUserId()
  await clearCoachChat(userId)
  revalidatePath('/coach')
}
