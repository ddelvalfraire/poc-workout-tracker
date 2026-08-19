'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { setAnalyticsConsentAction } from './consent-actions'

/**
 * The analytics-identity consent switch — same track+thumb vocabulary as the
 * other settings switches (rest-timer pattern) but NOT optimistic: consent
 * is a ledger fact, and the switch must show the recorded truth, not a
 * hopeful preview. Pending state disables the control; the flip renders
 * only after the server confirms (router.refresh re-reads the projection).
 */
export function AnalyticsConsentToggle({ granted }: { granted: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function toggle() {
    setError(null)
    startTransition(async () => {
      try {
        await setAnalyticsConsentAction(!granted)
        router.refresh()
      } catch (e) {
        setError(
          e instanceof Error && e.message.includes('Global Privacy Control')
            ? 'Your browser sends a Global Privacy Control signal — this stays off.'
            : 'Could not save your choice. Please try again.',
        )
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={granted}
        aria-label="Analytics identity"
        disabled={isPending}
        onClick={toggle}
        className={cn(
          'relative h-7 w-12 rounded-full border transition-colors before:absolute before:-inset-2',
          'outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
          granted ? 'border-primary bg-primary' : 'border-border bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform',
            granted ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
          )}
        />
      </button>
      {error && (
        <p className="max-w-56 text-right text-xs text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  )
}
