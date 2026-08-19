import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn(async () => 'user_1') }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'ua' })),
}))
vi.mock('@/db/consent', () => ({
  getActiveConsentDocument: vi.fn(async () => ({ id: 'doc-analytics' })),
  recordConsent: vi.fn(async () => ({ eventId: 'ev-1' })),
  markDownstreamAction: vi.fn(async () => {}),
}))
vi.mock('@/lib/posthog-person-deletion', () => ({
  deletePosthogPerson: vi.fn(async () => 'deleted'),
}))

import { setAnalyticsConsentAction } from './consent-actions'
import { recordConsent, markDownstreamAction } from '@/db/consent'
import { deletePosthogPerson } from '@/lib/posthog-person-deletion'
import { headers } from 'next/headers'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setAnalyticsConsentAction', () => {
  it('grant writes a settings-surface granted event anchored to the notice', async () => {
    await setAnalyticsConsentAction(true)

    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'analytics_identity',
        action: 'granted',
        documentId: 'doc-analytics',
        presentation: expect.objectContaining({ surface: 'settings', route: '/settings' }),
      }),
    )
    expect(deletePosthogPerson).not.toHaveBeenCalled()
  })

  it('Sec-GPC vetoes a grant server-side', async () => {
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ 'sec-gpc': '1' }))

    await expect(setAnalyticsConsentAction(true)).rejects.toThrow(/Global Privacy Control/)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it('withdrawal enqueues the fan-out, deletes the PostHog person, marks completed', async () => {
    await setAnalyticsConsentAction(false)

    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'withdrawn',
        downstream: [{ processor: 'posthog', action: 'person_delete' }],
      }),
    )
    expect(deletePosthogPerson).toHaveBeenCalledWith('user_1')
    expect(markDownstreamAction).toHaveBeenCalledWith('ev-1', 'posthog', 'completed')
  })

  it('a failed deletion is recorded as still-owed but never blocks the withdrawal', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deletePosthogPerson).mockRejectedValueOnce(new Error('posthog down'))

    await expect(setAnalyticsConsentAction(false)).resolves.toBeUndefined()

    expect(markDownstreamAction).toHaveBeenCalledWith('ev-1', 'posthog', 'failed')
    consoleError.mockRestore()
  })
})
