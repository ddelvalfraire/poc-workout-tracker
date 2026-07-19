'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { setProgramReminderDismissedAction } from '@/app/actions'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The fresh-user "train with a plan" nudge — deliberately muted (no volt):
 * it's a suggestion, not a state, and must not compete with the Start Workout
 * CTA below it. Dismissal is optimistic with rollback (the RestTimerToggle
 * error pattern) and permanent — the write path is the same preference the
 * settings "Program reminder" toggle re-enables, so the escape hatch is real.
 */
export function ProgramReminderCard() {
  const [isDismissed, setIsDismissed] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [hasError, setHasError] = useState(false)
  const router = useRouter()

  function dismiss() {
    setIsDismissed(true) // optimistic — the card should vanish on tap
    setHasError(false)
    startTransition(async () => {
      try {
        await setProgramReminderDismissedAction(true)
        router.refresh()
      } catch {
        setIsDismissed(false) // roll back; the card shows the stored truth
        setHasError(true)
      }
    })
  }

  if (isDismissed) return null

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4 motion-safe:animate-rise-in">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Train with a plan
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        A program gives every session a target — progression handled for you.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <Link
          href="/programs"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'text-xs font-semibold uppercase',
          )}
        >
          Browse programs
        </Link>
        {/* A quiet text control, not a button variant: dismissal must read as
            an afterthought next to the link, never a competing action. */}
        <button
          type="button"
          disabled={isPending}
          onClick={dismiss}
          className="relative text-xs text-muted-foreground outline-none underline-offset-2 transition-colors before:absolute before:-inset-2 hover:underline focus-visible:underline"
        >
          Don&rsquo;t show again
        </button>
      </div>
      {hasError && (
        <p className="mt-2 text-xs text-destructive" role="status">
          Couldn&rsquo;t save. Try again.
        </p>
      )}
    </div>
  )
}
