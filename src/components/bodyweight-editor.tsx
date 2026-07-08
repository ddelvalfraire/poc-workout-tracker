'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { setBodyweightAction } from '@/app/actions'
import type { WeightUnit } from '@/lib/units'

interface BodyweightEditorProps {
  /** The user's current bodyweight in the DISPLAY unit, or null when unset. */
  bodyweightDisplay: number | null
  /** The active display unit — entry happens in this unit; kg is stored. */
  unit: WeightUnit
}

/**
 * Inline bodyweight editor for the home header, next to the unit toggle. The
 * value is the load basis for bodyweight-type exercises (pull-ups, dips…) —
 * without it those exercises score by reps instead of estimated 1RM. Follows
 * UnitToggle's pattern: persist via the server action, `router.refresh()` so
 * every server-rendered readout picks the change up, quiet visible error cue.
 */
export function BodyweightEditor({ bodyweightDisplay, unit }: BodyweightEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState('')
  const [isPending, startTransition] = useTransition()
  const [hasError, setHasError] = useState(false)
  const router = useRouter()

  function save() {
    const parsed = parseFloat(value.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setHasError(true)
      return
    }
    setHasError(false)
    startTransition(async () => {
      try {
        await setBodyweightAction(parsed)
        setIsEditing(false)
        setValue('')
        router.refresh()
      } catch {
        // Non-critical control: keep the input open with the typed value so
        // the user can just tap save again — mirrors UnitToggle's recovery.
        setHasError(true)
      }
    })
  }

  if (!isEditing) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => {
          setValue(bodyweightDisplay !== null ? String(bodyweightDisplay) : '')
          setHasError(false)
          setIsEditing(true)
        }}
        aria-label={
          bodyweightDisplay !== null
            ? `Bodyweight ${bodyweightDisplay} ${unit} — tap to edit`
            : 'Set bodyweight'
        }
      >
        {bodyweightDisplay !== null ? `BW ${bodyweightDisplay} ${unit}` : 'Set bodyweight'}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setIsEditing(false)
        }}
        aria-label={`Bodyweight in ${unit}`}
        aria-invalid={hasError || undefined}
        // Compact inline field, matched to the header's small controls.
        className="h-8 w-20 rounded-lg border border-border bg-muted px-2 text-center text-sm tnum outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      <Button size="sm" variant="default" disabled={isPending} onClick={save}>
        {isPending ? '…' : 'Save'}
      </Button>
      {hasError && (
        // Visible words, not a bare glyph — same rationale as UnitToggle.
        <span role="alert" className="text-xs font-medium text-destructive">
          Didn&rsquo;t save
        </span>
      )}
    </div>
  )
}
