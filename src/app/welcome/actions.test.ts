import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn(async () => 'user_1') }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'ua' })),
}))
vi.mock('@/db/consent', () => ({
  getActiveConsentDocument: vi.fn(async (docType: string) => ({ id: `doc-${docType}` })),
  recordConsent: vi.fn(async () => ({ eventId: 'ev-1' })),
}))

import { recordSignupConsentsAction } from './actions'
import { recordConsent, getActiveConsentDocument } from '@/db/consent'

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
    // Resolves normally — the action deliberately does not redirect (the
    // client navigates on success; a server-action redirect would reject
    // the promise and be indistinguishable from failure in the caller).
    await expect(recordSignupConsentsAction(ALL_GRANTED)).resolves.toBeUndefined()

    const purposes = vi.mocked(recordConsent).mock.calls.map(([input]) => input.purpose)
    expect(purposes).toEqual(['health_collect', 'health_share', 'tos', 'analytics_identity'])
    // Each event anchors to its document and carries the presentation proof.
    for (const [input] of vi.mocked(recordConsent).mock.calls) {
      expect(input.action).toBe('granted')
      expect(input.documentId).toBeTruthy()
      expect(input.presentation).toMatchObject({ route: '/welcome', surface: 'signup' })
      expect(input.ip).toBe('203.0.113.9')
    }
  })

  it('Sec-GPC header suppresses the analytics grant even when the client says yes', async () => {
    const { headers } = await import('next/headers')
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'ua', 'sec-gpc': '1' }),
    )

    await expect(recordSignupConsentsAction(ALL_GRANTED)).resolves.toBeUndefined()

    // Required consents recorded; the forged/inconsistent analytics grant is
    // vetoed by the browser's own privacy signal.
    const purposes = vi.mocked(recordConsent).mock.calls.map(([input]) => input.purpose)
    expect(purposes).toEqual(['health_collect', 'health_share', 'tos'])
  })

  it('stores the exact rendered ToS control label as presentation proof', async () => {
    await expect(recordSignupConsentsAction(ALL_GRANTED)).resolves.toBeUndefined()

    const tosCall = vi.mocked(recordConsent).mock.calls.find(([i]) => i.purpose === 'tos')
    expect(tosCall?.[0].presentation.controlLabel).toBe(
      'I agree to the Terms of Service and have read the Privacy Notice and Health Data Privacy Policy.',
    )
  })

  it('declined analytics writes NO event — absent row is the ledger default', async () => {
    await expect(
      recordSignupConsentsAction({ ...ALL_GRANTED, analyticsIdentity: false }),
    ).resolves.toBeUndefined()

    const purposes = vi.mocked(recordConsent).mock.calls.map(([input]) => input.purpose)
    expect(purposes).toEqual(['health_collect', 'health_share', 'tos'])
  })
})
