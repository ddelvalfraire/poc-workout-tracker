import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

interface DividerListProps {
  /** Dashed hairlines — the quarantined/"present, not product" voice. */
  dashed?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * The grouped divider list: rows separated by muted hairlines with a closing
 * hairline instead of a shell — the iOS-grouped-list shape in the de-card
 * vocabulary, class recipe verbatim from the shipped /settings zones.
 */
function DividerList({ dashed = false, className, children }: DividerListProps) {
  return (
    <ul
      className={cn(
        'divide-y divide-border/60 border-b border-b-border/60',
        dashed && 'divide-dashed border-dashed',
        className,
      )}
    >
      {children}
    </ul>
  )
}

interface DividerRowProps {
  href: string
  /** Trailing slot rendered before the chevron (a current value, a delta). */
  trailing?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * A navigation row inside a DividerList: the whole row is the control —
 * content left, optional trailing value + chevron right. Class recipe
 * verbatim from the shipped /settings link rows.
 */
function DividerRow({ href, trailing, className, children }: DividerRowProps) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex items-center justify-between gap-4 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50',
          className,
        )}
      >
        {children}
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {trailing}
          <ChevronRight aria-hidden="true" className="size-4" />
        </div>
      </Link>
    </li>
  )
}

export { DividerList, DividerRow }
