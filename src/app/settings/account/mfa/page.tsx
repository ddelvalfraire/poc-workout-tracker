import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { MfaFlow } from '@/components/account/mfa-flow'
import { requireUserId } from '@/lib/auth'
import { getAccountOverview } from '@/lib/workos/account'
import { readPendingEnrollment, MfaStateUnavailableError } from '@/lib/workos/mfa'

/** Cold-entry destination for the back chevron — a route, not copy. */
const ACCOUNT_PATH = '/settings/account'

/**
 * Enrolling in, or turning off, two-step verification.
 *
 * The mode is derived from server state rather than a query parameter: a user
 * with a factor can only be here to remove it, and one without can only be
 * here to add one. That removes a whole class of "wrong screen for my actual
 * state" bugs, and means a stale bookmark still lands somewhere coherent.
 *
 * 404s where the environment has MFA off. There is no user action that could
 * make the page work there, so offering it — even disabled — would promise
 * something we cannot deliver and leak deployment state besides. This is the
 * same rule the account row follows by omitting itself.
 *
 * A pending factor is replayed into the flow rather than re-minted, so a user
 * who left for their authenticator app and came back to a cold PWA sees the
 * SAME secret they may already have saved.
 */
export default async function MfaPage() {
  const t = await getTranslations('Mfa')
  const userId = await requireUserId()
  const account = await getAccountOverview(userId)

  if (!account.mfaAvailable) notFound()

  const mode = account.hasMfaFactor ? 'disable' : 'enroll'

  // Only meaningful mid-enrolment; a user removing a factor has none pending.
  //
  // Caught rather than thrown because the account error boundary would blame
  // the wrong subsystem — "Couldn't load your account" for what is actually
  // the enrolment-state store being down, with a retry that fails forever.
  // Enrolment is refused instead: without somewhere to hold the issued factor
  // we would hand out a secret we cannot verify afterwards.
  let pending = null
  let stateUnavailable = false
  if (mode === 'enroll') {
    try {
      pending = await readPendingEnrollment(userId)
    } catch (error) {
      if (!(error instanceof MfaStateUnavailableError)) throw error
      stateUnavailable = true
    }
  }

  if (stateUnavailable) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <AppHeader title={t('titleEnroll')} leading={<BackLink fallback={ACCOUNT_PATH} />} />
        <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
          <p className="mt-8 text-sm text-muted-foreground">{t('setupUnavailable')}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={mode === 'enroll' ? t('titleEnroll') : t('titleDisable')}
        leading={<BackLink fallback={ACCOUNT_PATH} />}
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <MfaFlow
          mode={mode}
          pending={
            pending ? { secret: pending.secret, uri: pending.uri, qrCode: pending.qrCode } : null
          }
        />
      </main>
    </div>
  )
}
