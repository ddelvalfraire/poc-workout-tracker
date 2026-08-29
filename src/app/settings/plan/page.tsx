import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
import { getTranslations } from 'next-intl/server'
import { requireUserId } from '@/lib/auth'
import { getEntitlement } from '@/db/entitlements'
import { PlanSurface } from '@/components/plan/plan-surface'
import { UpgradePanel } from '@/components/plan/upgrade-panel'

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

  // Checkout is env-gated: without the Web Billing key the page keeps its
  // honest "nothing can be bought" notice instead of a broken panel. The
  // panel gets the SIGNED-IN user id — an anonymous RC purchase can never be
  // healed into an account, so checkout only exists behind auth.
  const rcKey = process.env.NEXT_PUBLIC_RC_WEB_BILLING_KEY

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('title')} leading={<BackLink fallback={SETTINGS_PATH} />} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <PlanSurface
          entitlement={entitlement}
          checkout={rcKey ? <UpgradePanel apiKey={rcKey} userId={userId} /> : undefined}
        />
      </main>
    </div>
  )
}
