import { getTranslations } from 'next-intl/server'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { NameEditor } from '@/components/account/name-editor'
import { requireUserId } from '@/lib/auth'
import { getAccountOverview } from '@/lib/workos/account'

/** Cold-entry destination for the back chevron — a route, not copy. */
const ACCOUNT_PATH = '/settings/account'

/**
 * Editing the display name.
 *
 * Its own route rather than a sheet: a sheet's state lives in React memory,
 * and a standalone PWA can discard that on backgrounding — which is exactly
 * what happens when someone switches away mid-edit. A route survives it and
 * can be linked to.
 */
export default async function NamePage() {
  const t = await getTranslations('Account')
  const userId = await requireUserId()
  const account = await getAccountOverview(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('nameLabel')} leading={<BackLink fallback={ACCOUNT_PATH} />} />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <NameEditor
          initialFirstName={account.firstName ?? ''}
          initialLastName={account.lastName ?? ''}
        />
      </main>
    </div>
  )
}
