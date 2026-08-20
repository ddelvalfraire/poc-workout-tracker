import { useTranslations } from 'next-intl'
import type { BillingSnapshot } from '@/lib/ops/entitlements'
import { TierBadge, formatDate } from './tier-badge'

/**
 * Who this person is and what they currently hold — the answer support wants
 * before doing anything else.
 *
 * The tier is stated with its CAUSE beside it (source and expiry), because
 * "they have Max" is not actionable on its own: whether that came from a card
 * or from a comp somebody granted last month changes what you do next.
 *
 * Server component. Nothing here is interactive; the controls live below it.
 */

export function EntitlementSummary({ snapshot }: { snapshot: BillingSnapshot }) {
  const t = useTranslations('OpsBilling')
  const { user, effective } = snapshot
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-lg font-medium">{name || user.email}</p>
        {name && <p className="text-sm text-muted-foreground">{user.email}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TierBadge tier={effective.tier} />
        <p className="text-sm text-muted-foreground">
          {effective.source
            ? t('effective.viaSource', { source: effective.source })
            : t('effective.default')}
        </p>
        {/* Perpetual is called out rather than left blank: an empty expiry
            column reads as missing data, and "never expires" is the single
            most consequential thing on this screen. */}
        <p className="text-sm text-muted-foreground">
          {effective.tier === 'free'
            ? null
            : effective.expiresAt
              ? t('expiry.on', { date: formatDate(effective.expiresAt) })
              : t('expiry.never')}
        </p>
      </div>

      {/* The id, selectable, because the next step is often pasting it into
          Stripe or a log query. */}
      <p className="select-all font-mono text-xs text-muted-foreground">{user.id}</p>
    </div>
  )
}
