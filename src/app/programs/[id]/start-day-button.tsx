'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { startProgramDayAction } from '@/app/programs/actions'

/**
 * Per-day client island: instantiates the day into a real workout (week
 * auto-derived, targets engine-seeded) and navigates to it. Navigation happens
 * client-side AFTER the action resolves — the action must not redirect.
 */
interface StartDayButtonProps {
  programDayId: string
  size?: 'sm' | 'default' | 'lg'
  label?: string
  /** Demotes the button when another CTA owns the screen (e.g. a resume banner). */
  variant?: 'default' | 'outline'
}

export function StartDayButton({
  programDayId,
  size = 'sm',
  label = 'Start this day',
  variant = 'default',
}: StartDayButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleStart() {
    startTransition(async () => {
      try {
        setError(null)
        const { workoutId } = await startProgramDayAction(programDayId)
        // Straight into the logger: the intent behind "Start" is to log, not
        // to review — the read-only detail page is the post-session view.
        router.push(`/workout/${workoutId}/edit`)
      } catch {
        setError('Could not start this day. Please try again.')
      }
    })
  }

  return (
    <div className="space-y-2">
      <Button size={size} variant={variant} className="w-full" disabled={isPending} onClick={handleStart}>
        {isPending ? 'Starting…' : label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
