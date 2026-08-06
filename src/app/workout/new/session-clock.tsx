'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/format'

/**
 * Compact session elapsed clock for the app header — it lives up there like
 * a phone's status clock, in a FIXED slot, glanceable without scrolling and
 * out of the workout body.
 *
 * Elapsed time ONLY: the rest readout that used to sit beside it moved into
 * the sticky bar's unified RestPill (rest-pill.tsx), which carries the
 * countdown, progress fill, controls, and the rest-over edge detection
 * together in one thumb-zone surface.
 *
 * Ticks with a mounted/hydration-safety pattern: renders nothing until
 * mounted (the server HTML can't know the elapsed time) and nothing when the
 * span is implausible (formatElapsed → null), where a running readout would
 * only mislead.
 */
export function HeaderClock({ startedAt }: { startedAt: Date }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync; interval drives later updates
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (!now) return null
  const elapsed = formatElapsed(now.getTime() - startedAt.getTime())
  if (!elapsed) return null

  return (
    // The label must INCLUDE the value: a bare aria-label would replace the
    // digits as the accessible name and hide the time from AT entirely.
    <span aria-label={`Session time ${elapsed}`} className="font-display text-xl leading-none tnum">
      <span aria-hidden="true">{elapsed}</span>
    </span>
  )
}
