import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireUserId = vi.fn(async () => 'user_1')
vi.mock('@/lib/auth', () => ({ requireUserId: () => requireUserId() }))

const deleteAccount = vi.fn(async () => ({
  pseudonym: 'deleted:abc',
  eventsPseudonymized: 1,
  posthog: 'deleted' as const,
}))
vi.mock('@/lib/account-deletion', () => ({
  deleteAccount: (...a: unknown[]) => deleteAccount(...(a as [])),
}))

import { deleteAccountAction } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
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

  it('maps an orchestration failure to a retryable error message, never a throw', async () => {
    deleteAccount.mockRejectedValueOnce(new Error('clerk down'))

    const result = await deleteAccountAction('DELETE')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/try again/i)
  })
})
