import { cn } from '@/lib/utils'
import type { Tier } from '@/lib/entitlements/tiers'

/**
 * The tier pill, and the date format the billing surface uses everywhere.
 *
 * Its own module with no `useTranslations` in it, deliberately: the ledger is
 * a Client Component and imports this, so anything translated living here
 * would drag a whole server-only namespace into the browser bundle. Tier names
 * are proper nouns — "Pro" is "Pro" in every locale — so there is nothing to
 * translate anyway.
 */

const TIER_STYLE: Record<Tier, string> = {
  free: 'border-border text-muted-foreground',
  pro: 'border-primary/40 bg-primary/10 text-foreground',
  max: 'border-primary bg-primary/20 font-semibold text-foreground',
}

export function TierBadge({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs uppercase tracking-wider',
        TIER_STYLE[tier],
        className,
      )}
    >
      {tier}
    </span>
  )
}

/**
 * ISO-ordered, month spelled out: unambiguous to an operator reading a table
 * where a mistaken 03/04 costs a customer a month of access.
 */
export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(value)
}
