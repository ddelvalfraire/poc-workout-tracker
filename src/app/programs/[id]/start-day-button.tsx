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
}

export function StartDayButton({
  programDayId,
  size = 'sm',
  label = 'Start this day',
}: StartDayButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleStart() {
    startTransition(async () => {
      try {
        setError(null)
        const { workoutId } = await startProgramDayAction(programDayId)
        router.push(`/workout/${workoutId}`)
      } catch {
        setError('Could not start this day. Please try again.')
      }
    })
  }

  return (
    <div className="space-y-2">
      <Button size={size} className="w-full" disabled={isPending} onClick={handleStart}>
        {isPending ? 'Starting…' : label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
