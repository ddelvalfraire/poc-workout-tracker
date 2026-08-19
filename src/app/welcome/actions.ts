'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireUserId } from '@/lib/auth'
import { getActiveConsentDocument, recordConsent } from '@/db/consent'

/**
 * Records the signup consent set — the server half of the /welcome screen.
 *
 * MHMDA shape enforced here, not just in the UI: the two health consents and
 * the ToS acceptance are three SEPARATE ledger events born of three separate
 * affirmative acts (the action validates all three booleans are true rather
 * than trusting one combined flag), and the optional analytics-identity
 * consent writes an event ONLY when granted — absent row = never granted is
 * the ledger's default state, so a decline needs no record.
 *
 * Presentation context (exact control labels as rendered) is stored per
 * event — the reproducibility half of clickwrap proof. IP arrives truncated
 * via the consent module; user agent as-is.
 */
export async function recordSignupConsentsAction(input: {
  healthCollect: boolean
  healthShare: boolean
  tos: boolean
  analyticsIdentity: boolean
}): Promise<void> {
  const userId = await requireUserId()
  if (!input.healthCollect || !input.healthShare || !input.tos) {
    // The UI disables Continue until these are checked; reaching here means
    // a forged POST. Refuse — required consents cannot be implied.
    throw new Error('required consents missing')
  }

  const [tosDoc, healthDoc, analyticsDoc] = await Promise.all([
    getActiveConsentDocument('tos'),
    getActiveConsentDocument('health_notice'),
    getActiveConsentDocument('analytics_notice'),
  ])
  if (!tosDoc || !healthDoc || !analyticsDoc) {
    // Documents are seeded by npm run db:seed-consent-docs; an unseeded
    // environment must fail loudly rather than record unanchored consent.
    throw new Error('consent documents not seeded')
  }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = h.get('user-agent')
  const base = { userId, ip, userAgent }
  const presentation = (controlLabel: string) => ({
    route: '/welcome',
    surface: 'signup' as const,
    controlLabel,
  })

  await recordConsent({
    ...base,
    purpose: 'health_collect',
    action: 'granted',
    documentId: healthDoc.id,
    presentation: presentation('Store your health data'),
  })
  await recordConsent({
    ...base,
    purpose: 'health_share',
    action: 'granted',
    documentId: healthDoc.id,
    presentation: presentation('Share with our service providers'),
  })
  await recordConsent({
    ...base,
    purpose: 'tos',
    action: 'granted',
    documentId: tosDoc.id,
    presentation: presentation('I agree to the Terms of Service and have read the Privacy Notice'),
  })
  if (input.analyticsIdentity) {
    await recordConsent({
      ...base,
      purpose: 'analytics_identity',
      action: 'granted',
      documentId: analyticsDoc.id,
      presentation: presentation('Analytics identity'),
    })
  }

  redirect('/')
}
