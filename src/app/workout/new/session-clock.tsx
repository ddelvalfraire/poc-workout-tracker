'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/format'

/**
 * Compact session clocks for the app header — elapsed time and, once a set
 * has been checked off, the rest readout beside it. Both live up there like
 * a phone's status clock, in FIXED slots: when the rest readout used to sit
 * in the scrolling body, its first appearance (null → row) shoved the whole
 * page down mid-tap. The header absorbs that state change without layout
 * shift below.
 *
 * The rest readout has two modes:
 * - No target: the original volt count-up (how long have I been resting).
 * - With a target (per-set plan restSec or the session default): a volt
 *   COUNTDOWN of the remaining rest; at zero it flips to "+overage" in the
 *   warning color — the "go" signal, styled like the offline hint because
 *   both mean "you're past where you should be", not "something broke".
 * Either way it's a button: tapping opens the rest-target sheet (the logger
 * owns the dialog; this component only reports the tap).
 *
 * Ticks with a mounted/hydration-safety pattern: renders nothing until
 * mounted (the server HTML can't know the elapsed time) and nothing when the
 * span is implausible (formatElapsed → null), where a running readout would
 * only mislead.
 */
export function HeaderClock({
  startedAt,
  restStartedAt,
  restTargetSec,
  onRestClick,
}: {
  startedAt: Date
  /** Set when the user checks off a set; null before the first completion. */
  restStartedAt: Date | null
  /** The countdown target for the CURRENT rest period; null = count up. */
  restTargetSec: number | null
  /** Tap on the rest readout — the logger opens the rest-target sheet. */
  onRestClick: () => void
}) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync; interval drives later updates
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (!now) return null
  const elapsed = formatElapsed(now.getTime() - startedAt.getTime())
  const restMs = restStartedAt ? now.getTime() - restStartedAt.getTime() : null

  // One readout, three shapes. Countdown/overage reuse formatElapsed on the
  // REMAINING span, so the digit format (and the 6 h plausibility ceiling)
  // stays identical to the count-up — a session left open overnight goes
  // quiet instead of counting an absurd overage.
  let rest: { text: string; label: string; isOver: boolean } | null = null
  if (restMs !== null && restMs >= 0) {
    if (restTargetSec === null) {
      const text = formatElapsed(restMs)
      if (text) rest = { text, label: `Rest time ${text}. Set rest target`, isOver: false }
    } else {
      const remainingSec = restTargetSec - Math.floor(restMs / 1_000)
      if (remainingSec > 0) {
        const text = formatElapsed(remainingSec * 1_000)
        if (text) {
          rest = {
            text,
            label: `Rest ${text} remaining of ${restTargetSec} second target. Change rest target`,
            isOver: false,
          }
        }
      } else {
        const text = formatElapsed(-remainingSec * 1_000)
        if (text) {
          rest = {
            text: `+${text}`,
            label: `Rest ${text} over the ${restTargetSec} second target — go. Change rest target`,
            isOver: true,
          }
        }
      }
    }
  }
  if (!elapsed && !rest) return null

  return (
    // Labels must INCLUDE the values: a bare aria-label would replace the
    // digits as the accessible name and hide the times from AT entirely.
    <span className="flex items-baseline gap-3">
      {rest && (
        // Rest is the live between-sets state — volt marks it (the same way
        // the resume banner's eyebrow marks "in progress") until the target
        // is spent, then the warning color says "you're over, lift".
        <button
          type="button"
          onClick={onRestClick}
          aria-label={rest.label}
          // Text-sized readout + invisible inset = a full ~44px effective
          // target without a chunky header button (the plate-pill trick).
          className="relative flex items-baseline gap-1 rounded-md before:absolute before:-inset-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span
            aria-hidden="true"
            className={`text-[10px] font-semibold uppercase tracking-widest ${rest.isOver ? 'text-warning' : 'text-primary'}`}
          >
            Rest
          </span>
          <span
            aria-hidden="true"
            className={`font-display text-xl leading-none tnum ${rest.isOver ? 'text-warning' : 'text-primary'}`}
          >
            {rest.text}
          </span>
        </button>
      )}
      {elapsed && (
        <span aria-label={`Session time ${elapsed}`} className="font-display text-xl leading-none tnum">
          <span aria-hidden="true">{elapsed}</span>
        </span>
      )}
    </span>
  )
}
