'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/format'

/**
 * Compact session clocks for the app header — elapsed time and, once a set
 * has been checked off, the rest count-up beside it. Both live up there like
 * a phone's status clock, in FIXED slots: when the rest readout used to sit
 * in the scrolling body, its first appearance (null → row) shoved the whole
 * page down mid-tap. The header absorbs that state change without layout
 * shift below.
 *
 * Ticks with a mounted/hydration-safety pattern: renders nothing until
 * mounted (the server HTML can't know the elapsed time) and nothing when the
 * span is implausible (formatElapsed → null), where a running readout would
 * only mislead.
 */
export function HeaderClock({
  startedAt,
  restStartedAt,
}: {
  startedAt: Date
  /** Set when the user checks off a set; null before the first completion. */
  restStartedAt: Date | null
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
  const rest = restStartedAt ? formatElapsed(now.getTime() - restStartedAt.getTime()) : null
  if (!elapsed && !rest) return null

  return (
    // Labels must INCLUDE the values: a bare aria-label would replace the
    // digits as the accessible name and hide the times from AT entirely.
    <span className="flex items-baseline gap-3">
      {rest && (
        // Rest is the live between-sets state — volt marks it the same way
        // the resume banner's eyebrow marks "in progress".
        <span aria-label={`Rest time ${rest}`} className="flex items-baseline gap-1">
          <span aria-hidden="true" className="text-[10px] font-semibold uppercase tracking-widest text-primary">
            Rest
          </span>
          <span aria-hidden="true" className="font-display text-xl leading-none tnum text-primary">
            {rest}
          </span>
        </span>
      )}
      {elapsed && (
        <span aria-label={`Session time ${elapsed}`} className="font-display text-xl leading-none tnum">
          <span aria-hidden="true">{elapsed}</span>
        </span>
      )}
    </span>
  )
}
