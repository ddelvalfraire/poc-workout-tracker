'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * Re-fetches the /ops server component in place. No polling infra — the
 * operator pulls fresh vendor data on demand; router.refresh() re-runs the
 * page's server render (which re-hits every source) without a full reload.
 */
export function OpsRefreshButton() {
  const t = useTranslations('OpsRefreshButton')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      aria-label={t('ariaLabel')}
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:opacity-50"
    >
      <RotateCw aria-hidden="true" className={cn('size-5', isPending && 'animate-spin')} />
    </button>
  )
}
