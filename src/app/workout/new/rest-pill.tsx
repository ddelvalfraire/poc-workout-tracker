'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { formatElapsed } from '@/lib/format'
import { createRestEdgeDetector, REST_ADJUST_STEP_SEC } from '@/lib/rest-alert'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The unified rest pill — ONE bottom-anchored surface (Dynamic Island /
 * Live Activity direction) carrying the rest time, a depleting progress
 * fill, and the −15 · Skip · +15 controls together in the sticky bar
 * (session-clock keeps only the elapsed clock).
 *
 * The pill renders only while a rest period is running (the logger gates on
 * restStartedAt); it owns the ONE 1 s tick that drives digits, fill, and the
 * rest-over edge detection — no second interval anywhere.
 *
 * Two modes, same as the old header readout:
 * - No target: volt count-up digits, no fill (nothing to deplete), Skip only.
 * - With a target: a quiet countdown + a fill that drains with the remaining
 *   fraction; the digits flip to volt for the last REST_CLOSING_WINDOW_SEC
 *   seconds (the "wrap it up" moment), then at zero to "+overage" and the
 *   fill switches to the warning color — the "go" signal, styled like the
 *   offline hint because both mean "you're past where you should be", not
 *   "an error".
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

/** The countdown's final stretch: digits flip to volt for these last seconds
 *  before the overage/warning flip — the "wrap it up" color moment. */
export const REST_CLOSING_WINDOW_SEC = 10

/**
 * Whether the countdown sits in the last-10s volt window: >0s remaining
 * (overage owns ≤0 — warning wins there) and within the window. Count-up
 * mode (null/zero target) has no window at all.
 */
export function isRestClosing(remainingSec: number, targetSec: number | null): boolean {
  if (targetSec === null || targetSec <= 0) return false
  return remainingSec > 0 && remainingSec <= REST_CLOSING_WINDOW_SEC
}

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

/**
 * The readout's accessible name as a MESSAGE CHOICE plus its arguments —
 * never an assembled sentence. restReadout runs in a module, before any
 * request, so a string built here could never be translated; the wording
 * lives in the RestPill catalog and is resolved at render.
 */
export type RestReadoutLabel =
  | { key: 'countUp'; values: { time: string } }
  | { key: 'remaining'; values: { time: string; target: number } }
  | { key: 'over'; values: { time: string; target: number } }

/** What the pill's time area shows for one observation, or null to hide. */
export interface RestReadout {
  text: string
  label: RestReadoutLabel
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
    return { text, label: { key: 'countUp', values: { time: text } }, isOver: false }
  }
  const remainingSec = targetSec - Math.floor(restMs / 1_000)
  if (remainingSec > 0) {
    const text = formatElapsed(remainingSec * 1_000)
    if (!text) return null
    return {
      text,
      label: { key: 'remaining', values: { time: text, target: targetSec } },
      isOver: false,
    }
  }
  const text = formatElapsed(-remainingSec * 1_000)
  if (!text) return null
  return {
    text: `+${text}`,
    label: { key: 'over', values: { time: text, target: targetSec } },
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
  const t = useTranslations('RestPill')
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
  // Digit color ladder (color-only, #217): countdown digits sit quiet on
  // foreground, flip to volt for the last-10s window, then to warning on
  // overage (unchanged). Count-up mode keeps its volt digits — with no fill
  // there, the digits ARE the pill's one live volt element.
  const isClosing = isRestClosing(remainingSec, restTargetSec)
  const digitColor = readout.isOver
    ? 'text-warning'
    : restTargetSec === null || isClosing
      ? 'text-primary'
      : 'text-foreground'
  const eyebrowColor = readout.isOver
    ? 'text-warning'
    : restTargetSec === null || isClosing
      ? 'text-primary'
      : 'text-muted-foreground'

  return (
    // The frame carries NO overflow clip: the controls' hit-44-y insets must
    // reach past the 36px buttons, and a clipped hit area is silently lost.
    // The fill layer below clips itself to the frame's radius instead.
    <div className="relative mb-2 flex items-center gap-1 rounded-xl border border-border bg-card py-1 pl-1 pr-1.5">
      {/* Depleting fill: an absolutely-positioned layer scaled by the
          remaining fraction — scaleX from the left edge keeps the motion
          compositor-only (same pattern as the session-pulse hairline). The
          1 s linear transition smooths tick-to-tick under motion-safe;
          reduced motion gets stepped updates, no animated pulsing.
          Overage: full-width warning tint — the "go" state, not a drain. */}
      {fraction !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        >
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
        aria-label={t(`label.${readout.label.key}`, readout.label.values)}
        className="relative flex min-w-0 flex-1 items-baseline gap-1.5 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className={cn('text-[10px] font-semibold uppercase tracking-widest', eyebrowColor)}
        >
          {t('eyebrow')}
        </span>
        <span
          aria-hidden="true"
          className={cn('truncate font-display text-xl leading-none tnum', digitColor)}
        >
          {readout.text}
        </span>
      </button>
      {/* ±15 only makes sense against a countdown; a bare count-up gets Skip
          alone. The reversible adjusters group into ONE segmented control
          (#217) while Skip sits apart with the reversal treatment — the
          terminal, irreversible action must not read as a third ± sibling.
          `relative` lifts the hairline frame above the fill layer, matching
          the time button. */}
      {restTargetSec !== null && (
        <ButtonGroup className="relative w-auto shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="hit-44-y tnum text-muted-foreground"
            onClick={() => onAdjust(-REST_ADJUST_STEP_SEC)}
            aria-label={t('shortenAriaLabel', { seconds: REST_ADJUST_STEP_SEC })}
          >
            {t('shorten', { seconds: REST_ADJUST_STEP_SEC })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="hit-44-y tnum text-muted-foreground"
            onClick={() => onAdjust(REST_ADJUST_STEP_SEC)}
            aria-label={t('extendAriaLabel', { seconds: REST_ADJUST_STEP_SEC })}
          >
            {t('extend', { seconds: REST_ADJUST_STEP_SEC })}
          </Button>
        </ButtonGroup>
      )}
      <Button
        size="sm"
        variant="reversal"
        className="ml-1 hit-44-y shrink-0"
        onClick={onSkip}
        aria-label={t('skipAriaLabel')}
      >
        {t('skip')}
      </Button>
    </div>
  )
}
