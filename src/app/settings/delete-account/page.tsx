import { requireUserId } from '@/lib/auth/auth'
import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
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
      <AppHeader title={t('title')} leading={<BackLink fallback="/settings" />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <section aria-label={t('consequencesGroupLabel')} className="mt-6">
          <p className="text-sm text-muted-foreground">
            {t('permanenceWarning')}
          </p>
          <ul className="mt-4 space-y-2 border-b border-b-border/60 pb-4 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">{t('erased.title')}</span> {t('erased.description')}
            </li>
            <li>
              <span className="font-medium text-foreground">{t('propagated.title')}</span> {t('propagated.description')}
            </li>
            <li>
              <span className="font-medium text-foreground">{t('retained.title')}</span> {t('retained.description')}
            </li>
          </ul>
        </section>

        <DeleteAccountForm />
      </main>
    </div>
  )
}
