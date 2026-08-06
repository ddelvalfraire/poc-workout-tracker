'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatElapsed } from '@/lib/format'
import { createRestEdgeDetector, REST_ADJUST_STEP_SEC } from '@/lib/rest-alert'
import { cn } from '@/lib/utils'

/**
 * The unified rest pill — ONE bottom-anchored surface (Dynamic Island /
 * Live Activity direction) carrying the rest time, a depleting progress
 * fill, and the −15 · Skip · +15 controls together in the sticky bar. It
 * replaced the split rest UI: the header's rest readout (session-clock now
 * keeps only the elapsed clock) and the separate RestAdjustStrip.
 *
 * The pill renders only while a rest period is running (the logger gates on
 * restStartedAt); it owns the ONE 1 s tick that drives digits, fill, and the
 * rest-over edge detection — no second interval anywhere.
 *
 * Two modes, same as the old header readout:
 * - No target: volt count-up digits, no fill (nothing to deplete), Skip only.
 * - With a target: a volt countdown + a fill that drains with the remaining
 *   fraction; at zero the digits flip to "+overage" and the fill switches to
 *   the warning color — the "go" signal, styled like the offline hint
 *   because both mean "you're past where you should be", not "an error".
 *
 * Tapping the time area opens the rest-target sheet (the logger owns the
 * dialog; this component only reports the tap) — the same handler the header
 * readout used to wire.
 *
 * Adjust scope contract (settled default-vs-plan separation): a ±15 tap
 * adjusts the CURRENT period's offset only — the logger owns that offset and
 * must never write it into sessionRestSec or any plan restSec. Skip ends the
 * period outright (the logger clears restStartedAt).
 *
 * One-volt rule: while resting, this fill is the live volt element; the
 * sticky bar's session-pulse hairline stays (same semantic family as the
 * previous dual render).
 */

/**
 * Remaining fraction of the rest target, for the depleting fill: clamped to
 * 0..1 so an overage never scales negative and a +15 past the original
 * target never overflows the pill. Null target (count-up mode) → null — no
 * fill at all, digits only. A zero/negative target has nothing to deplete
 * and is treated the same.
 */
export function restProgressFraction(
  remainingSec: number,
  targetSec: number | null,
): number | null {
  if (targetSec === null || targetSec <= 0) return null
  return Math.min(1, Math.max(0, remainingSec / targetSec))
}

/** What the pill's time area shows for one observation, or null to hide. */
export interface RestReadout {
  text: string
  label: string
  isOver: boolean
}

/**
 * One readout, three shapes (count-up / countdown / overage) — the exact
 * logic the header rest readout carried, extracted pure so the mode
 * selection unit-tests without timers. Countdown/overage reuse formatElapsed
 * on the REMAINING span, so the digit format (and the 6 h plausibility
 * ceiling) stays identical to the count-up — a session left open overnight
 * goes quiet instead of counting an absurd overage.
 */
export function restReadout(restMs: number, targetSec: number | null): RestReadout | null {
  if (restMs < 0) return null
  if (targetSec === null) {
    const text = formatElapsed(restMs)
    if (!text) return null
    return { text, label: `Rest time ${text}. Set rest target`, isOver: false }
  }
  const remainingSec = targetSec - Math.floor(restMs / 1_000)
  if (remainingSec > 0) {
    const text = formatElapsed(remainingSec * 1_000)
    if (!text) return null
    return {
      text,
      label: `Rest ${text} remaining of ${targetSec} second target. Change rest target`,
      isOver: false,
    }
  }
  const text = formatElapsed(-remainingSec * 1_000)
  if (!text) return null
  return {
    text: `+${text}`,
    label: `Rest ${text} over the ${targetSec} second target — go. Change rest target`,
    isOver: true,
  }
}

interface RestPillProps {
  /** The running rest period's start — the logger renders the pill only while set. */
  restStartedAt: Date
  /** The countdown target for the CURRENT rest period; null = count up. */
  restTargetSec: number | null
  /** Tap on the time area — the logger opens the rest-target sheet. */
  onTimeClick: () => void
  /** Called with ±REST_ADJUST_STEP_SEC — the logger accumulates the offset. */
  onAdjust: (deltaSec: number) => void
  onSkip: () => void
  /** The countdown's >0 → ≤0 edge, at most once per rest period (the logger
   *  fires vibration/chirp/title flash). Pass a STABLE reference — the tick
   *  effect depends on it. */
  onRestOver?: () => void
}

export function RestPill({
  restStartedAt,
  restTargetSec,
  onTimeClick,
  onAdjust,
  onSkip,
  onRestOver,
}: RestPillProps) {
  const [now, setNow] = useState<Date | null>(null)
  // The once-per-period latch lives in lib/rest-alert (unit-tested there):
  // it needs to have SEEN the period counting down before it may fire, so a
  // re-mounted pill mid-overage — or StrictMode's double effect run — stays
  // silent instead of re-alerting.
  const restEdgeRef = useRef(createRestEdgeDetector())

  // Mounted/hydration-safety pattern (as the header clock): render nothing
  // until mounted — the server HTML can't know the rest time.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync; interval drives later updates
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])

  // Edge detection rides the SAME 1 s tick as the digits (`now` state), in
  // an effect — firing side effects from render would double under
  // StrictMode and re-run on unrelated parent renders.
  useEffect(() => {
    if (!now || restTargetSec === null) return
    const remainingSec =
      restTargetSec - Math.floor((now.getTime() - restStartedAt.getTime()) / 1_000)
    if (restEdgeRef.current.observe(restStartedAt.getTime(), remainingSec)) {
      onRestOver?.()
    }
  }, [now, restStartedAt, restTargetSec, onRestOver])

  if (!now) return null
  const restMs = now.getTime() - restStartedAt.getTime()
  const readout = restReadout(restMs, restTargetSec)
  if (!readout) return null
  const remainingSec =
    restTargetSec === null ? 0 : restTargetSec - Math.floor(restMs / 1_000)
  const fraction = restProgressFraction(remainingSec, restTargetSec)

  return (
    <div className="relative mb-2 flex items-center gap-1 overflow-hidden rounded-xl border border-border bg-card py-1 pl-1 pr-1.5">
      {/* Depleting fill: an absolutely-positioned layer scaled by the
          remaining fraction — scaleX from the left edge keeps the motion
          compositor-only (same pattern as the session-pulse hairline). The
          1 s linear transition smooths tick-to-tick under motion-safe;
          reduced motion gets stepped updates, no animated pulsing.
          Overage: full-width warning tint — the "go" state, not a drain. */}
      {fraction !== null && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div
            className={cn(
              'h-full origin-left motion-safe:transition-transform motion-safe:duration-1000 motion-safe:ease-linear',
              readout.isOver ? 'bg-warning/15' : 'bg-primary/15',
            )}
            style={{ transform: `scaleX(${readout.isOver ? 1 : fraction})` }}
          />
        </div>
      )}
      {/* The time area IS the rest-sheet entry point (as the header readout
          was). relative lifts the content row above the fill layer. */}
      <button
        type="button"
        onClick={onTimeClick}
        aria-label={readout.label}
        className="relative flex min-w-0 flex-1 items-baseline gap-1.5 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className={cn(
            'text-[10px] font-semibold uppercase tracking-widest',
            readout.isOver ? 'text-warning' : 'text-primary',
          )}
        >
          Rest
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'truncate font-display text-xl leading-none tnum',
            readout.isOver ? 'text-warning' : 'text-primary',
          )}
        >
          {readout.text}
        </span>
      </button>
      {/* ±15 only makes sense against a countdown; a bare count-up gets Skip
          alone. Ghost-quiet controls — the volt stays on the digits/fill. */}
      {restTargetSec !== null && (
        <Button
          size="sm"
          variant="ghost"
          className="relative shrink-0 tnum text-muted-foreground"
          onClick={() => onAdjust(-REST_ADJUST_STEP_SEC)}
          aria-label={`Shorten this rest by ${REST_ADJUST_STEP_SEC} seconds`}
        >
          −{REST_ADJUST_STEP_SEC}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="relative shrink-0 text-muted-foreground"
        onClick={onSkip}
        aria-label="Skip rest"
      >
        Skip
      </Button>
      {restTargetSec !== null && (
        <Button
          size="sm"
          variant="ghost"
          className="relative shrink-0 tnum text-muted-foreground"
          onClick={() => onAdjust(REST_ADJUST_STEP_SEC)}
          aria-label={`Extend this rest by ${REST_ADJUST_STEP_SEC} seconds`}
        >
          +{REST_ADJUST_STEP_SEC}
        </Button>
      )}
    </div>
  )
}
