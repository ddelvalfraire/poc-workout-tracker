import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireUserId = vi.fn(async () => 'user_1')
vi.mock('@/lib/auth', () => ({ requireUserId: () => requireUserId() }))

const deleteAccount = vi.fn(async () => ({
  pseudonym: 'deleted:abc',
  eventsPseudonymized: 1,
  posthog: 'deleted' as const,
}))
const checkAccountDeletionRateLimit = vi.fn(async () => ({ allowed: true }) as const)
vi.mock('@/lib/account-deletion', () => ({
  deleteAccount: (...a: unknown[]) => deleteAccount(...(a as [])),
  checkAccountDeletionRateLimit: (...a: unknown[]) =>
    checkAccountDeletionRateLimit(...(a as [])),
}))

import { deleteAccountAction } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  checkAccountDeletionRateLimit.mockResolvedValue({ allowed: true })
})

describe('deleteAccountAction', () => {
  it('refuses without the exact confirm phrase — the server re-checks, not just the button', async () => {
    for (const bad of ['', 'delete', 'DELET', 'DELETE ', undefined, null, 42]) {
      const result = await deleteAccountAction(bad)
      expect(result.ok).toBe(false)
    }
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes with the consent-evidence presentation of THIS surface', async () => {
    const result = await deleteAccountAction('DELETE')

    expect(result).toEqual({ ok: true })
    expect(deleteAccount).toHaveBeenCalledWith('user_1', {
      route: '/settings/delete-account',
      surface: 'settings',
      controlLabel: 'Delete my account',
    })
  })

  it('refuses when the daily attempt cap is hit, without touching the orchestrator', async () => {
    checkAccountDeletionRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 5,
    } as unknown as { allowed: true })

    const result = await deleteAccountAction('DELETE')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/too many/i)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('maps an orchestration failure to a retryable error message, never a throw', async () => {
    deleteAccount.mockRejectedValueOnce(new Error('workos down'))

    const result = await deleteAccountAction('DELETE')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/try again/i)
  })
})
