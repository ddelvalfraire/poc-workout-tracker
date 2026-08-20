import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUserId } from '@/lib/auth'
import { isOpsUser } from '@/lib/ops/access'
import { getBillingSnapshot, getPaidRoster } from '@/lib/ops/entitlements'
import { OpsHeader } from '@/components/ops/ops-header'
import { OpsPanel, statusOf } from '@/components/ops/panel'
import { EntitlementSummary } from '@/components/ops/entitlement-summary'
import { GrantForm } from '@/components/ops/grant-form'
import { GrantLedger } from '@/components/ops/grant-ledger'
import { PaidRoster } from '@/components/ops/paid-roster'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

/**
 * /ops/billing — the support tab: "what does this member hold, why, and can I
 * change it".
 *
 * The lookup lives in the URL (?q=) rather than in client state, so a finding
 * is shareable and the browser's back button works — the same reason the rest
 * of the app keeps filters in search params. It is a plain GET form: no
 * JavaScript is involved in searching, only in granting.
 *
 * Gate: identical to /ops (allowlist → notFound), re-asserted here rather than
 * hoisted into a layout, because layouts do not re-run on every navigation.
 * The two server actions re-assert it AGAIN — they are separately reachable
 * HTTP endpoints and this page's gate does not protect them.
 */
export const dynamic = 'force-dynamic'

export default async function OpsBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const userId = await requireUserId()
  // Internal surface: 404 for everyone off the allowlist (never a 403).
  if (!isOpsUser(userId)) notFound()

  const query = (await searchParams).q?.trim() ?? ''
  const t = await getTranslations('OpsBilling')

  // The roster is worth loading either way — it is how an operator finds
  // somebody when they do not have an email to hand.
  const [snapshot, roster] = await Promise.all([
    query ? getBillingSnapshot(query) : Promise.resolve(null),
    getPaidRoster(),
  ])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OpsHeader active="billing" />

      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-5 pb-safe pt-5">
        <div className="grid grid-cols-1 gap-4 pb-8 xl:grid-cols-12">
          <OpsPanel
            id="lookup"
            title={t('title')}
            status={snapshot ? statusOf(snapshot) : 'ok'}
            className="xl:col-span-7"
          >
            <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex min-w-56 flex-1 flex-col gap-1.5">
                <label htmlFor="q" className="text-sm font-medium">
                  {t('lookup.label')}
                </label>
                <Input
                  id="q"
                  name="q"
                  defaultValue={query}
                  placeholder={t('lookup.placeholder')}
                  autoComplete="off"
                  enterKeyHint="search"
                />
              </div>
              <Button type="submit" variant="outline">
                {t('lookup.action')}
              </Button>
            </form>

            {!query && <p className="mt-4 text-sm text-muted-foreground">{t('prompt')}</p>}

            {snapshot?.ok && snapshot.data === null && (
              <p className="mt-4 text-sm text-muted-foreground">{t('empty')}</p>
            )}

            {snapshot?.ok && snapshot.data && (
              <div className="mt-4 flex flex-col">
                <EntitlementSummary snapshot={snapshot.data} />
                {/* Keyed by member: the form holds an armed confirm in client state, and
                    searching a different member is a same-route navigation that
                    would otherwise preserve it. One press could then grant to
                    somebody the confirm was never about. */}
                <GrantForm key={snapshot.data.user.id} userId={snapshot.data.user.id} />
                <GrantLedger grants={snapshot.data.grants} now={Date.now()} />
              </div>
            )}
          </OpsPanel>

          <PaidRoster result={roster} className="xl:col-span-5" />
        </div>
      </main>
    </div>
  )
}
