'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OpsPanel } from '@/components/ops/panel'
import { resolveRcEventAction } from '@/app/ops/billing/actions'
import { MIN_GRANT_REASON_LENGTH } from '@/lib/entitlements/duration'

export interface DeadLetterRow {
  id: string
  type: string
  appUserId: string | null
  status: 'failed' | 'orphaned'
  attempts: number
  lastError: string | null
  /** Epoch ms — serializable across the server/client boundary. */
  receivedAtMs: number
}

/**
 * The dead-letter view: webhook events nobody is coming back for (failed
 * with retries exhausted, or orphaned to an unresolvable user). Each row
 * resolves with a required reason — resolution is how a row leaves the
 * alerting tally, so it must say why a human decided it was done, in the
 * same append-only spirit as the grant ledger.
 *
 * One reason input serves the row being resolved (selectedId): resolving is
 * rare and one-at-a-time; per-row inputs would just multiply empty fields.
 */
export function RcDeadLetters({ rows, className }: { rows: DeadLetterRow[]; className?: string }) {
  const t = useTranslations('RcDeadLetters')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function resolve(eventId: string) {
    if (selectedId !== eventId) {
      setSelectedId(eventId)
      setReason('')
      setError(null)
      return
    }
    if (reason.trim().length < MIN_GRANT_REASON_LENGTH) {
      setError(t('reasonValidation'))
      return
    }
    startTransition(async () => {
      const result = await resolveRcEventAction({ eventId, reason })
      if (result.status === 'resolved') {
        setSelectedId(null)
        setReason('')
        setError(null)
        router.refresh()
        return
      }
      setError(result.status === 'denied' ? t('errorDenied') : t('errorFailed'))
    })
  }

  return (
    <OpsPanel
      id="rc-dead-letters"
      title={t('title')}
      status={rows.length > 0 ? 'degraded' : 'ok'}
      className={className}
    >
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{row.type}</span>
                <span className="text-muted-foreground">
                  {t(row.status === 'failed' ? 'statusFailed' : 'statusOrphaned', {
                    attempts: row.attempts,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {new Date(row.receivedAtMs).toLocaleString()}
                </span>
              </div>
              {row.appUserId && (
                <p className="break-all font-mono text-xs text-muted-foreground">{row.appUserId}</p>
              )}
              {row.lastError && (
                <p className="break-all text-xs text-muted-foreground">{row.lastError}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {selectedId === row.id && (
                  <Input
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      setError(null)
                    }}
                    placeholder={t('reasonPlaceholder')}
                    className="h-8 max-w-72 text-sm"
                    autoFocus
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => resolve(row.id)}
                >
                  {selectedId === row.id ? t('confirmResolve') : t('resolve')}
                </Button>
              </div>
              {selectedId === row.id && error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </OpsPanel>
  )
}
