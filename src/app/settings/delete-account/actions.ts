'use server'

import { requireUserId } from '@/lib/auth/auth'
import { deleteAccount, checkAccountDeletionRateLimit } from '@/lib/account/account-deletion'
import { DELETE_CONFIRM_PHRASE } from './confirm-phrase'

/**
 * Deletes the signed-in user's account. The confirm phrase is validated
 * server-side too — the action itself carries the confirmation, not just the
 * button's disabled state. Returns an error message instead of throwing:
 * after a partial failure the user must see "try again", not a digest page —
 * the flow is safely re-runnable (see lib/account-deletion).
 */
export async function deleteAccountAction(
  confirmPhrase: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await requireUserId()
  if (confirmPhrase !== DELETE_CONFIRM_PHRASE) {
    return { ok: false, error: `Type ${DELETE_CONFIRM_PHRASE} to confirm.` }
  }
  // Anti-abuse cap, checked before any ledger write: each attempt appends
  // append-only evidence rows, so a retry loop must hit a wall. NOTE: the
  // limiter fails OPEN on Redis outages (see account-deletion.ts) — deletion
  // is a legal right; the cap is a soft wall, never a hard one.
  const rateLimit = await checkAccountDeletionRateLimit(userId)
  if (!rateLimit.allowed) {
    return {
      ok: false,
      error: 'Too many deletion attempts today. Please try again tomorrow.',
    }
  }
  try {
    await deleteAccount(userId, {
      route: '/settings/delete-account',
      surface: 'settings',
      controlLabel: 'Delete my account',
    })
    return { ok: true }
  } catch (error: unknown) {
    console.error('[account-deletion] failed', { userId, error })
    return {
      ok: false,
      error: 'Something went wrong and your account was not fully deleted. Please try again.',
    }
  }
}
