'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { resyncFromRevenueCatAction } from '@/app/ops/billing/actions'

/**
 * The support runbook button: re-project this member from RevenueCat's
 * current truth. Read-repair, not a grant — it can only converge the ledger
 * on what RC attests, so unlike GrantForm it needs no armed confirm. The
 * result line names what happened; 'unconfigured' is a real state (the RC
 * adapter is env-gated) rather than an error.
 */
export function RcResyncButton({ userId }: { userId: string }) {
  const t = useTranslations('RcResync')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function submit() {
    setMessage(null)
    startTransition(async () => {
      const result = await resyncFromRevenueCatAction({ userId })
      if (result.status === 'synced') {
        setMessage(t('synced', { tier: result.tier }))
        router.refresh()
        return
      }
      setMessage(
        result.status === 'unconfigured'
          ? t('unconfigured')
          : result.status === 'denied'
            ? t('denied')
            : t('failed'),
      )
    })
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" onClick={submit} disabled={isPending}>
        {isPending ? t('pending') : t('action')}
      </Button>
      {message && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  )
}
