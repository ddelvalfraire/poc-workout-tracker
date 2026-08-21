'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { setWeightStepAction } from '@/app/actions'
import { WEIGHT_STEP_CHOICES, resolveWeightStep } from '@/lib/format'
import type { WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * Settings row control for the ± step: a segmented cluster of the sizes this
 * unit offers (control clusters are keep-list vocabulary — chips mean
 * pressable, hairline frame, no card shell).
 *
 * A fixed list per unit rather than a free numeric field, on purpose: the
 * step has to be a jump the lifter's plates can actually make, so the list is
 * the product's opinion instead of a validation problem. `setWeightStepAction`
 * re-checks the same list server-side, so a stale client cannot store a value
 * the picker would never offer back.
 *
 * Optimistic: the pressed segment wins immediately and `router.refresh()`
 * catches the server up. A failed write rolls back to what the server last
 * confirmed — the row must never claim a step the logger is not using.
 */
export function WeightStepSetting({
  weightStep,
  unit,
}: {
  weightStep: number | null
  unit: WeightUnit
}) {
  const t = useTranslations('WeightStepSetting')
  const router = useRouter()
  // Resolved, not raw: an unset (or other-unit) preference shows the unit
  // default as selected, which is what the logger is actually stepping by.
  const [current, setCurrent] = useState(() => resolveWeightStep(weightStep, unit))

  return (
    <ButtonGroup>
      {WEIGHT_STEP_CHOICES[unit].map((choice) => {
        const isCurrent = choice === current
        return (
          <Button
            key={choice}
            size="sm"
            variant="ghost"
            aria-pressed={isCurrent}
            aria-label={t('ariaLabel', { step: choice, unit })}
            // Selected reads as a filled segment, never volt: settings is not
            // where the app spends its one accent (DESIGN.md, one volt).
            className={cn('hit-44-y tnum', isCurrent && 'bg-muted font-semibold text-foreground')}
            onClick={async () => {
              if (isCurrent) return
              const previous = current
              setCurrent(choice)
              try {
                await setWeightStepAction(choice)
                router.refresh()
              } catch {
                setCurrent(previous)
              }
            }}
          >
            {choice}
          </Button>
        )
      })}
    </ButtonGroup>
  )
}
