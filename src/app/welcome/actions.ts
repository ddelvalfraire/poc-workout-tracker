'use server'

import { headers } from 'next/headers'
import { requireUserId } from '@/lib/auth/auth'
import { getActiveConsentDocument, recordConsent } from '@/db/consent'
import { getTranslations } from 'next-intl/server'

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

  const h = await headers()
  // GPC is enforced HERE, not just in the browser toggle: the client control
  // is UX, the Sec-GPC request header is the signal the law recognizes — a
  // forged analyticsIdentity:true cannot out-vote it.
  const gpcSignal = h.get('sec-gpc') === '1'
  const grantAnalytics = input.analyticsIdentity && !gpcSignal

  const [tosDoc, healthDoc, analyticsDoc] = await Promise.all([
    getActiveConsentDocument('tos'),
    getActiveConsentDocument('health_notice'),
    getActiveConsentDocument('analytics_notice'),
  ])
  if (!tosDoc || !healthDoc || (grantAnalytics && !analyticsDoc)) {
    // Documents are seeded by npm run db:seed-consent-docs; an unseeded
    // environment must fail loudly rather than record unanchored consent.
    // The optional analytics doc only blocks when it is actually needed.
    throw new Error('consent documents not seeded')
  }

  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = h.get('user-agent')
  const base = { userId, ip, userAgent }
  const t = await getTranslations('ConsentForm')
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
    presentation: presentation(t('healthCollectLabel')),
  })
  await recordConsent({
    ...base,
    purpose: 'health_share',
    action: 'granted',
    documentId: healthDoc.id,
    presentation: presentation(t('healthShareLabel')),
  })
  await recordConsent({
    ...base,
    purpose: 'tos',
    action: 'granted',
    documentId: tosDoc.id,
    // Read from the SAME catalog key the row renders, so the recorded proof
    // and the control the user actually saw cannot drift — they were two
    // copies of one sentence, kept in step by a comment and one test. Once a
    // second locale ships this also records the wording in the language the
    // user consented in, which is what presentation proof has to mean.
    presentation: presentation(t('tosLabel')),
  })
  if (grantAnalytics && analyticsDoc) {
    await recordConsent({
      ...base,
      purpose: 'analytics_identity',
      action: 'granted',
      documentId: analyticsDoc.id,
      presentation: presentation(t('analyticsControlLabel')),
    })
  }
  // No redirect() here on purpose: a server action invoked as a plain
  // function call rejects its promise on redirect (Next routes it to the
  // RedirectBoundary), which a client try/catch would misread as failure.
  // The client navigates on successful resolution instead.
}
