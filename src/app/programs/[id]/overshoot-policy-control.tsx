'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setOvershootPolicyAction } from '@/app/programs/actions'
import type { OvershootPolicy } from '@/lib/overshoot-policy'
import { useTranslations } from 'next-intl'

/**
 * The program-level overshoot / goal-met policy control (#227) — how a set
 * that beat its target on a different axis (more reps at a lighter load) is
 * credited. Quiet settings row, hairline framing like the diet-phase card:
 * a labeled select, no volt, no shell. '' encodes null (per-scheme
 * defaults). Per-exercise overrides are data-ready but have no UI in v1.
 */
// Values only. Labels and hints built here would be frozen at module
// load, before any request, so they could never be translated; the copy
// lives in the catalog under `option.<key>` / `hint.<key>`. Keys are
// camelCase rather than the hyphenated enum values because a catalog leaf
// has to survive an Android strings.xml export, where a hyphen is not a
// legal resource name.
const OPTION_KEYS = {
  '': 'default',
  'strict-load': 'strictLoad',
  'e1rm-equivalent': 'e1rmEquivalent',
  'any-metric': 'anyMetric',
} as const

const OPTIONS = Object.keys(OPTION_KEYS) as ('' | OvershootPolicy)[]

export function OvershootPolicyControl({
  programId,
  policy,
}: {
  programId: string
  policy: OvershootPolicy | null
}) {
  const t = useTranslations('OvershootPolicyControl')
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
      setError(t('updateError'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section aria-label={t('ariaLabel')} className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="overshoot-policy" className="text-sm font-medium">
          {t('label')}
        </label>
        <select
          id="overshoot-policy"
          value={selected}
          disabled={isPending}
          onChange={(e) => apply(e.target.value as '' | OvershootPolicy)}
          className="h-9 rounded-lg border border-border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`option.${OPTION_KEYS[option]}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(`hint.${OPTION_KEYS[selected]}`)}
      </p>
      {error !== null && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
