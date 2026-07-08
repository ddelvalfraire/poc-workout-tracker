'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { setWeightUnitAction } from '@/app/actions'
import { WEIGHT_UNITS, type WeightUnit } from '@/lib/units'

interface UnitToggleProps {
  /** The user's current weight unit (server-read), highlighted as active. */
  unit: WeightUnit
}

/**
 * Segmented kg | lb toggle for the home header. Persists the choice via the
 * server action, then `router.refresh()` re-runs the server components so every
 * weight re-renders in the new unit. Selecting the active unit is a no-op.
 */
export function UnitToggle({ unit }: UnitToggleProps) {
  const [isPending, startTransition] = useTransition()
  const [hasError, setHasError] = useState(false)
  const router = useRouter()

  function select(next: WeightUnit) {
    if (next === unit) return
    setHasError(false)
    startTransition(async () => {
      try {
        await setWeightUnitAction(next)
        router.refresh()
      } catch {
        // Non-critical control: surface a quiet, accessible cue and let the user
        // retry. The active unit stays on `unit` (never optimistically changed),
        // so the UI remains consistent with what's stored.
        setHasError(true)
      }
    })
  }

  return (
    <div role="group" aria-label="Weight unit" className="flex items-center gap-1">
      {WEIGHT_UNITS.map((u) => (
        <Button
          key={u}
          size="sm"
          variant={u === unit ? 'default' : 'ghost'}
          aria-pressed={u === unit}
          disabled={isPending}
          onClick={() => select(u)}
        >
          {u}
        </Button>
      ))}
      {hasError && (
        // Visible words, not a "!" with a title tooltip: title is unreachable
        // on touch and a bare glyph is meaningless to a screen reader.
        <span role="alert" className="text-xs font-medium text-destructive">
          Didn&rsquo;t save — tap again
        </span>
      )}
    </div>
  )
}
