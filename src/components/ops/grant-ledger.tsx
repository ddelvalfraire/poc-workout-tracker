'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EntitlementGrant } from '@/db/entitlements'
import { revokeGrantAction } from '@/app/ops/billing/actions'
import { TierBadge, formatDate } from './tier-badge'

/**
 * The full grant history for one user — including revoked rows, which are the
 * point. This surface exists to answer "why does this person have what they
 * have", and a table that only showed live grants could not answer "why did
 * they LOSE it", which is the question support actually gets.
 *
 * Nothing here edits a row. Revoking stamps a reason onto the grant and leaves
 * it in place, so the table only ever grows.
 *
 * `now` is passed in rather than read from the clock during render: the page
 * is force-dynamic, so the server already knows the request time, and reading
 * it here would make the render impure and the lapsed/live split untestable.
 */
export function GrantLedger({ grants, now }: { grants: EntitlementGrant[]; now: number }) {
  const t = useTranslations('GrantLedger')

  if (grants.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">{t('empty')}</p>
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{t('title')}</p>
      <table className="mt-2 w-full min-w-[44rem] text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-1.5 text-left font-medium">{t('col.granted')}</th>
            <th className="py-1.5 text-left font-medium">{t('col.tier')}</th>
            <th className="py-1.5 text-left font-medium">{t('col.source')}</th>
            <th className="py-1.5 text-left font-medium">{t('col.window')}</th>
            <th className="py-1.5 text-left font-medium">{t('col.reason')}</th>
            <th className="py-1.5 text-right font-medium">{t('col.state')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border align-top">
          {grants.map((grant) => (
            <GrantRow key={grant.id} grant={grant} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GrantRow({ grant, now }: { grant: EntitlementGrant; now: number }) {
  const t = useTranslations('GrantLedger')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const revoked = grant.status === 'revoked'
  const lapsed = !revoked && grant.endsAt !== null && grant.endsAt.getTime() <= now

  function revoke() {
    if (reason.trim().length < 3) {
      setError(t('reason.validation'))
      return
    }
    startTransition(async () => {
      const result = await revokeGrantAction({ grantId: grant.id, reason })
      if (result.status === 'revoked') {
        setOpen(false)
        setReason('')
        router.refresh()
        return
      }
      setError(t('error'))
    })
  }

  return (
    <tr className={revoked ? 'text-muted-foreground' : undefined}>
      <td className="py-2 pr-3 tnum whitespace-nowrap">{formatDate(grant.createdAt)}</td>
      <td className="py-2 pr-3">
        <TierBadge tier={grant.tier} />
      </td>
      <td className="py-2 pr-3">
        <span>{grant.source}</span>
        {/* The external id, when there is one: the thing you paste into the
            processor's dashboard to see the other half of the story. */}
        {grant.sourceRef && (
          <span className="block select-all font-mono text-xs text-muted-foreground">
            {grant.sourceRef}
          </span>
        )}
      </td>
      <td className="py-2 pr-3 tnum whitespace-nowrap">
        {grant.endsAt ? formatDate(grant.endsAt) : t('expiry.never')}
      </td>
      <td className="max-w-64 py-2 pr-3">
        <span>{grant.reason}</span>
        {grant.actorId && (
          <span className="block text-xs text-muted-foreground">
            {t('byActor', { actor: grant.actorId })}
          </span>
        )}
        {/* Revocations carry their own reason and actor. Showing them on the
            row they ended keeps both halves of the story in one place. */}
        {revoked && grant.revokedReason && (
          <span className="mt-1 block text-xs">
            {t('revokedBecause', { reason: grant.revokedReason })}
          </span>
        )}
      </td>
      <td className="py-2 text-right">
        {revoked ? (
          <span className="text-xs uppercase tracking-wider">{t('state.revoked')}</span>
        ) : lapsed ? (
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('state.lapsed')}
          </span>
        ) : open ? (
          <div className="flex flex-col items-end gap-2">
            <Input
              value={reason}
              onChange={(event) => {
                setError(null)
                setReason(event.target.value)
              }}
              disabled={isPending}
              placeholder={t('reason.placeholder')}
              aria-label={t('reason.label')}
              autoComplete="off"
              className="w-56"
            />
            {error && (
              <p role="alert" className="text-xs text-destructive-ink">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={revoke}
                disabled={isPending}
              >
                {isPending ? t('revoke.loading') : t('revoke.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            onClick={() => setOpen(true)}
          >
            {t('revoke.action')}
          </Button>
        )}
      </td>
    </tr>
  )
}
