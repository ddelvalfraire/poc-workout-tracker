'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setProgramReminderDismissedAction } from '@/app/actions'
import { cn } from '@/lib/utils'

/**
 * Re-enable hatch for the home page's program nudge — same switch idiom as
 * RestTimerToggle (optimistic flip, rollback on failure, router.refresh).
 * The switch speaks "show reminder" while the stored flag is DISMISSED, so
 * the action payload is the INVERSE of the switch state: on ⇒ dismissed=false.
 */
export function ProgramReminderToggle({ enabled }: { enabled: boolean }) {
  const [isOn, setIsOn] = useState(enabled)
  const [isPending, startTransition] = useTransition()
  const [hasError, setHasError] = useState(false)
  const router = useRouter()

  function toggle() {
    const next = !isOn
    setIsOn(next) // optimistic — a settings switch must feel instant
    setHasError(false)
    startTransition(async () => {
      try {
        await setProgramReminderDismissedAction(!next)
        router.refresh()
      } catch {
        setIsOn(!next) // roll back; the switch shows the stored truth
        setHasError(true)
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label="Program reminder"
        disabled={isPending}
        onClick={toggle}
        // 44px effective target via the invisible inset on a compact track.
        className={cn(
          'relative h-7 w-12 rounded-full border transition-colors before:absolute before:-inset-2',
          'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          isOn ? 'border-primary bg-primary' : 'border-border bg-muted',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform',
            isOn ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
          )}
        />
      </button>
      {hasError && (
        <p className="text-xs text-destructive" role="status">
          Couldn&rsquo;t save. Try again.
        </p>
      )}
    </div>
  )
}
