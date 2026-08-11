'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { setDietPhaseAction } from '@/app/programs/actions'

/**
 * The "still cutting?" staleness ask (lib/diet-phase-staleness.ts decides
 * WHEN; this card only renders the question). Both answers are the owner's
 * explicit statement through the same event-logged op everything else uses:
 * "Still cutting" re-affirms the phase — re-stamping diet_phase_set_at IS
 * the point, it resets the clock — and "End cut" moves to maintaining (the
 * phase a finished cut lands in; settings still offer the full picker).
 * Hairline framing, no shell, no volt — a quiet question, not an alarm.
 */
export function DietPhaseCard({ programId, weeks }: { programId: string; weeks: number }) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function answer(phase: 'cutting' | 'maintaining') {
    setIsPending(true)
    try {
      setError(null)
      await setDietPhaseAction(programId, phase)
      router.refresh() // the card gates on set_at — the refresh clears it
    } catch {
      setError('Could not update the diet phase. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section aria-label="Diet phase check" className="mt-6 border-b border-b-border/60 pb-4">
      <p className="text-sm font-medium">Still cutting?</p>
      <p className="mt-1 text-sm text-muted-foreground tnum">
        This cut was set {weeks} weeks ago — stall verdicts are still being read through it.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => answer('cutting')}
        >
          Still cutting
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => answer('maintaining')}
        >
          End cut
        </Button>
      </div>
      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
