'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setOvershootPolicyAction } from '@/app/programs/actions'
import type { OvershootPolicy } from '@/lib/overshoot-policy'

/**
 * The program-level overshoot / goal-met policy control (#227) — how a set
 * that beat its target on a different axis (more reps at a lighter load) is
 * credited. Quiet settings row, hairline framing like the diet-phase card:
 * a labeled select, no volt, no shell. '' encodes null (per-scheme
 * defaults). Per-exercise overrides are data-ready but have no UI in v1.
 */
const OPTIONS: { value: '' | OvershootPolicy; label: string; hint: string }[] = [
  {
    value: '',
    label: 'Scheme default',
    hint: 'Strict for load-anchored schemes; e1RM-equivalent for RPE targets.',
  },
  {
    value: 'strict-load',
    label: 'Strict load',
    hint: 'A goal counts only at the prescribed weight — master it before it moves.',
  },
  {
    value: 'e1rm-equivalent',
    label: 'e1RM equivalent',
    hint: 'More reps at a lighter load count when the estimated 1RM matches the target.',
  },
  {
    value: 'any-metric',
    label: 'Any metric',
    hint: 'Reps, load, or e1RM — beating any one of them counts.',
  },
]

export function OvershootPolicyControl({
  programId,
  policy,
}: {
  programId: string
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
      await setOvershootPolicyAction(programId, next === '' ? null : next)
      router.refresh()
    } catch {
      setSelected(previous)
      setError('Could not update the overshoot policy. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  const hint = OPTIONS.find((o) => o.value === selected)?.hint
  return (
    <section aria-label="Overshoot policy" className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="overshoot-policy" className="text-sm font-medium">
          Beating a target counts when…
        </label>
        <select
          id="overshoot-policy"
          value={selected}
          disabled={isPending}
          onChange={(e) => apply(e.target.value as '' | OvershootPolicy)}
          className="h-9 rounded-lg border border-border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {hint !== undefined && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
