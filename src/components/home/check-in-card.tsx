'use client'

import { useState } from 'react'
import Link from 'next/link'
import { checkInCardDetail, checkInDismissKey, shouldShowCheckInCard } from '@/lib/check-in-card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMounted } from '@/lib/use-mounted'
import { useTranslations } from 'next-intl'

interface CheckInCardProps {
  /** Whole days since the last check-in; null = never checked in. */
  daysSinceLast: number | null
}

/**
 * The quiet "body check-in due" nudge — the
 * server renders it only when the active program's cadence says a check-in is
 * due, so non-push users see the suggestion too. Dismissal is
 * dismiss-for-today via sessionStorage (client state only, no persistence):
 * tomorrow is a fresh ask, and "not today" must never require a server write.
 * Mount-gated visibility (hidden until the storage check runs) keeps SSR and
 * client HTML identical.
 */
export function CheckInCard({ daysSinceLast }: CheckInCardProps) {
  const t = useTranslations('CheckInCard')
  // Two separate facts, deliberately: what STORAGE says (dismissed on an
  // earlier visit today) and what THIS session's tap said. Storage is read at
  // render behind the mounted gate rather than copied into state by an
  // effect — the copy is what cascaded a second render on every mount — while
  // the tap is real local state, because writing to sessionStorage cannot
  // re-render anything on its own.
  const mounted = useMounted()
  const [isDismissedNow, setIsDismissedNow] = useState(false)

  function dismiss() {
    setIsDismissedNow(true)
    try {
      sessionStorage.setItem(checkInDismissKey(new Date()), '1')
    } catch {
      // Best-effort: without storage the dismissal still holds for this render.
    }
  }

  let dismissedToday = isDismissedNow
  if (mounted && !dismissedToday) {
    try {
      dismissedToday = sessionStorage.getItem(checkInDismissKey(new Date())) !== null
    } catch {
      // Storage denied (private mode) → treat as not dismissed; the card is
      // quiet enough that showing it is the safe fallback.
    }
  }

  if (!mounted || !shouldShowCheckInCard(true, dismissedToday)) return null

  return (
    <div className="mt-6 border-b border-b-border/60 pb-4 motion-safe:animate-rise-in">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t('title')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('lede', { detail: checkInCardDetail(daysSinceLast) })}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <Link
          href="/body"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'text-xs font-semibold uppercase',
          )}
        >
          {t('action')}
        </Link>
        {/* A quiet text control, not a button variant: dismissal
            must read as an afterthought, never a competing action. */}
        <button
          type="button"
          onClick={dismiss}
          className="relative text-xs text-muted-foreground outline-none underline-offset-2 transition-colors before:absolute before:-inset-2 hover:underline focus-visible:underline"
        >
          {t('dismiss')}
        </button>
      </div>
    </div>
  )
}
