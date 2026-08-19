'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/auth'
import {
  getActiveConsentDocument,
  markDownstreamAction,
  recordConsent,
} from '@/db/consent'
import { deletePosthogPerson } from '@/lib/posthog-person-deletion'

/**
 * The Settings withdrawal/grant path for analytics identity — the MHMDA
 * requirement that consent be revocable as easily as it was given.
 *
 * Withdrawal is TWO ledger facts, not one: the withdrawn event (with the
 * posthog person_delete fan-out row enqueued in the same transaction), then
 * the outcome of actually calling PostHog recorded on that row. The deletion
 * attempt runs inline — small API, user is waiting, and a failed attempt is
 * recorded honestly as 'failed' (still owed) without blocking the
 * withdrawal itself: the consent state must flip regardless of a
 * processor's availability.
 */
export async function setAnalyticsConsentAction(granted: boolean): Promise<void> {
  const userId = await requireUserId()
  const h = await headers()
  // Server-side GPC, same as signup: the header out-votes a client grant.
  if (granted && h.get('sec-gpc') === '1') {
    throw new Error('Global Privacy Control is active — analytics identity stays off.')
  }
  const base = {
    userId,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
    presentation: {
      route: '/settings',
      surface: 'settings' as const,
      controlLabel: 'Analytics identity',
    },
  }

  if (granted) {
    const doc = await getActiveConsentDocument('analytics_notice')
    if (!doc) throw new Error('consent documents not seeded')
    await recordConsent({
      ...base,
      purpose: 'analytics_identity',
      action: 'granted',
      documentId: doc.id,
    })
  } else {
    const { eventId } = await recordConsent({
      ...base,
      purpose: 'analytics_identity',
      action: 'withdrawn',
      downstream: [{ processor: 'posthog', action: 'person_delete' }],
    })
    try {
      await deletePosthogPerson(userId)
      await markDownstreamAction(eventId, 'posthog', 'completed')
    } catch (error) {
      // Recorded as still-owed; the withdrawal itself stands. (Account
      // deletion and any future retry worker drain failed rows.)
      console.error('[consent] posthog person deletion failed', error)
      await markDownstreamAction(eventId, 'posthog', 'failed')
    }
  }

  // The identity island reads consent from the root layout — refresh it so
  // identify()/reset() reconciliation happens without a manual reload.
  revalidatePath('/', 'layout')
  revalidatePath('/settings')
}
