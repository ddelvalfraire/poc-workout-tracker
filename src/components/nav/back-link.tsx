'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { navigateBack } from '@/lib/back-navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface BackLinkProps {
  /** Canonical parent (spike §3c) — where a COLD deep-link entry lands.
   *  In warm flows this almost never fires: a pop returns to the true
   *  origin with its scroll and state intact. */
  fallback: string
  'aria-label'?: string
  className?: string
  /** Optional text beside the chevron, for headers that label their back. */
  children?: ReactNode
}

/**
 * The app's ONE back affordance (spike §3a): replaces every hardcoded
 * `<Link href={parent}>` chevron. Pop when the app owns the previous
 * entry, replace(fallback) on cold entry — never a push, so the chevron
 * and the iOS edge-swipe walk the same stack and agree.
 *
 * Semantics: a <button>, not a link — "back" has no stable href to
 * long-press, prefetch, or open in a new tab; pretending it does is how
 * the old chevrons polluted the stack. Visuals match the chevron recipe
 * every header already used (ghost icon-sm, -ml-2, size-5 chevron).
 */
export function BackLink({
  fallback,
  'aria-label': ariaLabel,
  className,
  children,
}: BackLinkProps) {
  const t = useTranslations('BackLink')
  const router = useRouter()
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? t('ariaLabel')}
      onClick={() => navigateBack(router, fallback)}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2', className)}
    >
      <ChevronLeft aria-hidden="true" className="size-5" />
      {children}
    </button>
  )
}
