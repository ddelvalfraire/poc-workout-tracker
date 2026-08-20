import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { getTranslations } from 'next-intl/server'
import { requireUserId } from '@/lib/auth'
import { getEntitlement } from '@/db/entitlements'
import { PlanSurface } from '@/components/plan/plan-surface'

/** Cold-entry destination for the back chevron — a route, not copy. */
const SETTINGS_PATH = '/settings'

/**
 * The member's own view of what they hold.
 *
 * `getEntitlement` never throws — it degrades to Free — so this page has no
 * error boundary of its own. That is the right trade here: a member seeing
 * "Free" during a database blip is a recoverable inconvenience, while an error
 * screen on a page whose entire job is reassurance is not.
 */
export default async function PlanPage() {
  const t = await getTranslations('Plan')
  const userId = await requireUserId()
  const entitlement = await getEntitlement(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('title')} leading={<BackLink fallback={SETTINGS_PATH} />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <PlanSurface entitlement={entitlement} />
      </main>
    </div>
  )
}
