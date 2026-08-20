'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { setDietPhaseAction } from '@/app/programs/actions'
import { useTranslations } from 'next-intl'

/** The two answers the card offers, as VALUES — each button's copy is a
 *  catalog lookup (`affirmAction` / `endAction`). */
const AFFIRM_PHASE = 'cutting'
const END_PHASE = 'maintaining'

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
  const t = useTranslations('DietPhaseCard')
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
      setError(t('updateError'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section aria-label={t('ariaLabel')} className="mt-6 border-b border-b-border/60 pb-4">
      <p className="text-sm font-medium">{t('title')}</p>
      <p className="mt-1 text-sm text-muted-foreground tnum">
        {t('stalenessNote', { weeks })}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => answer(AFFIRM_PHASE)}
        >
          {t('affirmAction')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => answer(END_PHASE)}
        >
          {t('endAction')}
        </Button>
      </div>
      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
