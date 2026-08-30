import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
import { AccountSurface } from '@/components/account/account-surface'
import { getAccountOverview } from '@/lib/workos/account'
import { requireUserId } from '@/lib/auth/auth'
import { getTranslations } from 'next-intl/server'

/** Cold-entry destination for the back chevron — a route, not copy. */
const SETTINGS_PATH = '/settings'

/**
 * The account surface: who you are, how you sign in, and the way out.
 *
 * Split from /settings deliberately. Preferences there are visited weekly;
 * identity is visited monthly at most, so it earns one tap rather than a
 * permanent scroll tax above "Weight unit" — and it keeps "Delete account"
 * from sitting next to "Import history" as though the two were peers.
 *
 * The route is only the read and the chrome; AccountSurface holds the rows,
 * so every environment-driven state (MFA on, MFA required, password set) can
 * be reviewed in Storybook without flipping settings on a live auth
 * environment to see them.
 *
 * The read throws rather than defaulting its fields — reporting "Two-step
 * verification: Off" because we could not ASK would be a security-relevant
 * lie. error.tsx in this segment catches that and keeps deletion reachable.
 */
export default async function AccountPage() {
  const t = await getTranslations('Account')
  const userId = await requireUserId()
  const account = await getAccountOverview(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('title')} leading={<BackLink fallback={SETTINGS_PATH} />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <AccountSurface account={account} />
      </main>
    </div>
  )
}
