'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { DividerList } from '@/components/ui/divider-list'
import { syncMyRcEntitlementsAction } from '@/app/settings/plan/actions'

/**
 * Checkout on the plan page, through RevenueCat Web Billing.
 *
 * The client's ONLY job is checkout: entitlements never come from this SDK.
 * The purchase lands in our store via the webhook (durable path) and the
 * post-purchase self-sync action (fast path); this component then just
 * refreshes the server-rendered page. See docs/SPIKE-REVENUECAT.md.
 *
 * The SDK is always configured with the signed-in WorkOS user id — an
 * anonymous purchase can never be healed into an account (edge-case pass),
 * so this component must only ever render for an authenticated member.
 */

/** What the panel needs to know about one buyable package — a deliberate
 *  reduction of the SDK's Package so stories can fake checkout without RC. */
export interface UpgradeOption {
  identifier: string
  title: string
  formattedPrice: string
  /** ISO 8601 duration (e.g. P1M, P1Y) or null for lifetime. */
  periodDuration: string | null
}

export interface UpgradeClient {
  loadOptions(): Promise<UpgradeOption[]>
  purchase(identifier: string): Promise<'purchased' | 'cancelled'>
}

/** The real client. `Purchases.configure` must run once per page load, so a
 *  re-render (or strict-mode double effect) reuses the shared instance. */
async function realClient(apiKey: string, appUserId: string): Promise<UpgradeClient> {
  const { Purchases, ErrorCode, PurchasesError } = await import('@revenuecat/purchases-js')

  const purchases = Purchases.isConfigured()
    ? Purchases.getSharedInstance()
    : Purchases.configure({ apiKey, appUserId })

  return {
    async loadOptions() {
      const offerings = await purchases.getOfferings()
      return (offerings.current?.availablePackages ?? []).map((pkg) => ({
        identifier: pkg.identifier,
        title: pkg.webBillingProduct.title,
        formattedPrice: pkg.webBillingProduct.price.formattedPrice,
        periodDuration: pkg.webBillingProduct.normalPeriodDuration,
      }))
    },
    async purchase(identifier: string) {
      const offerings = await purchases.getOfferings()
      const pkg = offerings.current?.availablePackages.find((p) => p.identifier === identifier)
      if (!pkg) throw new Error(`package ${identifier} is no longer offered`)
      try {
        await purchases.purchase({ rcPackage: pkg })
        return 'purchased'
      } catch (error: unknown) {
        if (error instanceof PurchasesError && error.errorCode === ErrorCode.UserCancelledError) {
          return 'cancelled'
        }
        throw error
      }
    },
  }
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'ready'; options: UpgradeOption[] }
  | { phase: 'error' }
  | { phase: 'purchased'; syncing: boolean }

export function UpgradePanel({
  apiKey,
  userId,
  client,
}: {
  apiKey: string
  userId: string
  /** Test/story seam; defaults to the real RC Web Billing client. */
  client?: UpgradeClient
}) {
  const t = useTranslations('UpgradePanel')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [purchaseError, setPurchaseError] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  const clientPromise = useMemo(
    () => (client ? Promise.resolve(client) : realClient(apiKey, userId)),
    [client, apiKey, userId],
  )

  // Only async callbacks set state here; the loading reset for a retry
  // happens in the retry button's handler, where the interaction is.
  useEffect(() => {
    let cancelled = false
    clientPromise
      .then((c) => c.loadOptions())
      .then((options) => {
        if (!cancelled) setState({ phase: 'ready', options })
      })
      .catch((error: unknown) => {
        console.error('[plan] loading purchase options failed', error)
        if (!cancelled) setState({ phase: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [clientPromise, reloadNonce])

  function buy(option: UpgradeOption) {
    setPurchaseError(false)
    startTransition(async () => {
      try {
        const c = await clientPromise
        const outcome = await c.purchase(option.identifier)
        if (outcome === 'cancelled') return
        // Paid. The webhook will land it regardless; the sync action makes
        // it visible NOW. Either way the refresh re-reads OUR store.
        setState({ phase: 'purchased', syncing: true })
        await syncMyRcEntitlementsAction()
        setState({ phase: 'purchased', syncing: false })
        router.refresh()
      } catch (error: unknown) {
        console.error('[plan] purchase failed', error)
        setPurchaseError(true)
      }
    })
  }

  if (state.phase === 'purchased') {
    return (
      <Section title={t('title')}>
        <p aria-live="polite" className="pt-1 text-sm text-muted-foreground">
          {state.syncing ? t('activating') : t('purchased')}
        </p>
      </Section>
    )
  }

  return (
    <Section title={t('title')}>
      {state.phase === 'loading' && (
        <p className="pt-1 text-sm text-muted-foreground">{t('loading')}</p>
      )}

      {state.phase === 'error' && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <p className="text-sm text-muted-foreground">{t('loadError')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setState({ phase: 'loading' })
              setReloadNonce((n) => n + 1)
            }}
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {state.phase === 'ready' && state.options.length === 0 && (
        <p className="pt-1 text-sm text-muted-foreground">{t('empty')}</p>
      )}

      {state.phase === 'ready' && state.options.length > 0 && (
        <DividerList>
          {state.options.map((option) => (
            <li key={option.identifier} className="flex items-center justify-between gap-3 py-3">
              <div className="flex flex-col">
                <p className="text-base">{option.title}</p>
                <p className="text-sm text-muted-foreground">
                  {option.periodDuration === null
                    ? t('period.lifetime')
                    : option.periodDuration === 'P1Y'
                      ? t('period.yearly')
                      : t('period.monthly')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => buy(option)}
              >
                {t('buy', { price: option.formattedPrice })}
              </Button>
            </li>
          ))}
        </DividerList>
      )}

      {purchaseError && (
        <p role="alert" className="pt-2 text-sm text-destructive">
          {t('purchaseError')}
        </p>
      )}
    </Section>
  )
}
