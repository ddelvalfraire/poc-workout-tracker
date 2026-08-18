'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setExerciseOvershootPolicyAction } from '@/app/programs/actions'
import type { OvershootPolicy } from '@/lib/overshoot-policy'

/**
 * The per-exercise overshoot / goal-met override (#239's data + resolver,
 * this is the missing UI): the same quiet native-select idiom as the
 * program-level OvershootPolicyControl, shrunk to ride an expanded exercise
 * row — a worded label + quiet select, no shell, no volt. '' encodes null
 * (fall back to the program policy, then the per-scheme default —
 * resolveOvershootPolicy's precedence). Owner-only by placement: the detail
 * page is owner-scoped and the control renders only off proposals.
 */
const OPTIONS: { value: '' | OvershootPolicy; label: string }[] = [
  { value: '', label: 'default' },
  { value: 'strict-load', label: 'strict' },
  { value: 'e1rm-equivalent', label: 'e1RM-equivalent' },
  { value: 'any-metric', label: 'any metric' },
]

export function ExerciseOvershootControl({
  programId,
  dayPosition,
  exercisePosition,
  exerciseName,
  policy,
}: {
  programId: string
  dayPosition: number
  exercisePosition: number
  exerciseName: string
  policy: OvershootPolicy | null
}) {
  const [selected, setSelected] = useState<'' | OvershootPolicy>(policy ?? '')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function apply(next: '' | OvershootPolicy) {
    const previous = selected
    setSelected(next)
    setIsPending(true)
    try {
      setError(null)
      await setExerciseOvershootPolicyAction(
        programId,
        dayPosition,
        exercisePosition,
        next === '' ? null : next,
      )
      router.refresh()
    } catch {
      setSelected(previous)
      setError('Could not update the overshoot override. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="mt-1">
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        Overshoot:
        <select
          value={selected}
          disabled={isPending}
          onChange={(e) => apply(e.target.value as '' | OvershootPolicy)}
          aria-label={`Overshoot policy for ${exerciseName}`}
          className="h-9 rounded-lg border border-border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {error !== null && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  )
}
