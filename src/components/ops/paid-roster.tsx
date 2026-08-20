import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { OpsResult } from '@/lib/ops/types'
import type { PaidUserRow } from '@/lib/ops/entitlements'
import { OpsPanel, statusOf } from './panel'
import { TierBadge, formatDate } from './tier-badge'

/**
 * Everyone currently on a paid tier. Small on purpose: it exists so an
 * operator can see the whole paying population at a glance and click through
 * to one, not to be a revenue report — that question belongs to Stripe.
 *
 * Rows link into the lookup by USER ID rather than email: the id is stable
 * across an email change, and it is the identity the ledger is keyed on.
 */
export function PaidRoster({
  result,
  className,
}: {
  result: OpsResult<PaidUserRow[]>
  className?: string
}) {
  const t = useTranslations('OpsBilling')
  return (
    <OpsPanel id="roster" title={t('roster.title')} status={statusOf(result)} className={className}>
      {result.ok && result.data.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">{t('roster.empty')}</p>
      )}
      {result.ok && result.data.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left font-medium">{t('roster.colUser')}</th>
                <th className="py-1.5 text-left font-medium">{t('roster.colTier')}</th>
                <th className="py-1.5 text-left font-medium">{t('roster.colExpires')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.data.map((row) => (
                <tr key={row.userId}>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/ops/billing?q=${encodeURIComponent(row.userId)}`}
                      className="underline-offset-4 hover:underline focus-visible:underline"
                    >
                      {row.email ?? row.userId}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <TierBadge tier={row.tier} />
                  </td>
                  <td className="py-2 tnum text-muted-foreground">
                    {row.expiresAt ? formatDate(row.expiresAt) : t('expiry.never')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OpsPanel>
  )
}
