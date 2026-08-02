'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Re-fetches the /ops server component in place. No polling infra — the
 * operator pulls fresh vendor data on demand; router.refresh() re-runs the
 * page's server render (which re-hits every source) without a full reload.
 */
export function OpsRefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      aria-label="Refresh"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 disabled:opacity-50"
    >
      <RotateCw aria-hidden="true" className={cn('size-5', isPending && 'animate-spin')} />
    </button>
  )
}
