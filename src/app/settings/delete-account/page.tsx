import { requireUserId } from '@/lib/auth'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { DeleteAccountForm } from './delete-account-form'
import { getTranslations } from 'next-intl/server'

/**
 * The account-deletion surface — in-app (App Store / Google Play both require
 * it) AND web-reachable at this URL from any browser (Google Play
 * additionally requires a deletion path outside the app; this route is it —
 * signing in is permitted by the policy, creating identity friction is not).
 * The copy states exactly what dies and what is retained, in the privacy
 * policy's own terms: consent records survive pseudonymized (CA ARL keeps us
 * to >= 3 years), everything else is erased.
 */
export default async function DeleteAccountPage() {
  const t = await getTranslations('DeleteAccount')
  await requireUserId()

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title="Delete account" leading={<BackLink fallback="/settings" />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <section aria-label="What deletion does" className="mt-6">
          <p className="text-sm text-muted-foreground">
            {t('deletingYourAccountIsPermanent')}
          </p>
          <ul className="mt-4 space-y-2 border-b border-b-border/60 pb-4 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">{t('erasedImmediately')}</span> {t('yourWorkoutsProgramsTemplatesNotes')}
            </li>
            <li>
              <span className="font-medium text-foreground">{t('toldToErase')}</span> {t('ourAnalyticsProcessorDeletesYour')}
            </li>
            <li>
              <span className="font-medium text-foreground">{t('retained')}</span> {t('consentRecordsWeAreLegally')}
            </li>
          </ul>
        </section>

        <DeleteAccountForm />
      </main>
    </div>
  )
}
