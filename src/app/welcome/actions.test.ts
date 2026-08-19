import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn(async () => 'user_1') }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'ua' })),
}))
vi.mock('@/db/consent', () => ({
  getActiveConsentDocument: vi.fn(async (docType: string) => ({ id: `doc-${docType}` })),
  recordConsent: vi.fn(async () => ({ eventId: 'ev-1' })),
}))

import { recordSignupConsentsAction } from './actions'
import { recordConsent, getActiveConsentDocument } from '@/db/consent'
import { redirect } from 'next/navigation'

const ALL_GRANTED = { healthCollect: true, healthShare: true, tos: true, analyticsIdentity: true }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordSignupConsentsAction', () => {
  it('refuses a forged POST with any required consent missing', async () => {
    await expect(
      recordSignupConsentsAction({ ...ALL_GRANTED, healthShare: false }),
    ).rejects.toThrow(/required consents missing/)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it('fails loudly when documents are not seeded — never unanchored consent', async () => {
    vi.mocked(getActiveConsentDocument).mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof getActiveConsentDocument>>,
    )
    await expect(recordSignupConsentsAction(ALL_GRANTED)).rejects.toThrow(/not seeded/)
    expect(recordConsent).not.toHaveBeenCalled()
  })

  it('writes the three required events as separate acts, plus analytics when granted', async () => {
    await expect(recordSignupConsentsAction(ALL_GRANTED)).rejects.toThrow('NEXT_REDIRECT')

    const purposes = vi.mocked(recordConsent).mock.calls.map(([input]) => input.purpose)
    expect(purposes).toEqual(['health_collect', 'health_share', 'tos', 'analytics_identity'])
    // Each event anchors to its document and carries the presentation proof.
    for (const [input] of vi.mocked(recordConsent).mock.calls) {
      expect(input.action).toBe('granted')
      expect(input.documentId).toBeTruthy()
      expect(input.presentation).toMatchObject({ route: '/welcome', surface: 'signup' })
      expect(input.ip).toBe('203.0.113.9')
    }
    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('declined analytics writes NO event — absent row is the ledger default', async () => {
    await expect(
      recordSignupConsentsAction({ ...ALL_GRANTED, analyticsIdentity: false }),
    ).rejects.toThrow('NEXT_REDIRECT')

    const purposes = vi.mocked(recordConsent).mock.calls.map(([input]) => input.purpose)
    expect(purposes).toEqual(['health_collect', 'health_share', 'tos'])
  })
})
