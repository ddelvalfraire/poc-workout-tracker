'use client'

import { Button } from '@/components/ui/button'
import { REST_ADJUST_STEP_SEC } from '@/lib/rest-alert'

/**
 * Mid-rest quick adjust for the sticky bar: −15 · Skip rest · +15 while a
 * rest period is running.
 *
 * Scope contract (settled default-vs-plan separation): a tap adjusts the
 * CURRENT period's offset only — the logger owns that offset state and must
 * never write it into sessionRestSec (the sheet-edited session default) or
 * any plan restSec. Next rest starts clean at its own target. Skip ends the
 * period outright (the logger clears restStartedAt, same end state as a
 * finished countdown that's been acted on).
 */
interface RestAdjustStripProps {
  /** ±15 only makes sense against a countdown; a bare count-up gets Skip alone. */
  hasTarget: boolean
  /** Called with ±REST_ADJUST_STEP_SEC — the logger accumulates the offset. */
  onAdjust: (deltaSec: number) => void
  onSkip: () => void
}

export function RestAdjustStrip({ hasTarget, onAdjust, onSkip }: RestAdjustStripProps) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {hasTarget && (
        <Button
          size="sm"
          variant="outline"
          className="flex-1 tnum"
          onClick={() => onAdjust(-REST_ADJUST_STEP_SEC)}
          aria-label={`Shorten this rest by ${REST_ADJUST_STEP_SEC} seconds`}
        >
          −{REST_ADJUST_STEP_SEC}s
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="flex-1 text-muted-foreground"
        onClick={onSkip}
      >
        Skip rest
      </Button>
      {hasTarget && (
        <Button
          size="sm"
          variant="outline"
          className="flex-1 tnum"
          onClick={() => onAdjust(REST_ADJUST_STEP_SEC)}
          aria-label={`Extend this rest by ${REST_ADJUST_STEP_SEC} seconds`}
        >
          +{REST_ADJUST_STEP_SEC}s
        </Button>
      )}
    </div>
  )
}
