'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setExerciseOvershootPolicyAction } from '@/app/programs/actions'
import type { OvershootPolicy } from '@/lib/overshoot-policy'
import { useTranslations } from 'next-intl'

/**
 * The per-exercise overshoot / goal-met override (#239's data + resolver,
 * this is the missing UI): the same quiet native-select idiom as the
 * program-level OvershootPolicyControl, shrunk to ride an expanded exercise
 * row — a worded label + quiet select, no shell, no volt. '' encodes null
 * (fall back to the program policy, then the per-scheme default —
 * resolveOvershootPolicy's precedence). Owner-only by placement: the detail
 * page is owner-scoped and the control renders only off proposals.
 */
// Values only. A label built here would be frozen at module load, before
// any request, so it could never be translated; the copy lives in the
// catalog under `option.<key>`. Keys are camelCase rather than the
// hyphenated enum values because a catalog leaf has to survive an Android
// strings.xml export, where a hyphen is not a legal resource name.
const OPTION_KEYS = {
  '': 'default',
  'strict-load': 'strictLoad',
  'e1rm-equivalent': 'e1rmEquivalent',
  'any-metric': 'anyMetric',
} as const

const OPTIONS = Object.keys(OPTION_KEYS) as ('' | OvershootPolicy)[]

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
  const t = useTranslations('ExerciseOvershootControl')
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
      setError(t('updateError'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="mt-1">
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {t('label')}
        <select
          value={selected}
          disabled={isPending}
          onChange={(e) => apply(e.target.value as '' | OvershootPolicy)}
          aria-label={t('selectAriaLabel', { exerciseName })}
          className="h-9 rounded-lg border border-border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`option.${OPTION_KEYS[option]}`)}
            </option>
          ))}
        </select>
      </label>
      {error !== null && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  )
}
