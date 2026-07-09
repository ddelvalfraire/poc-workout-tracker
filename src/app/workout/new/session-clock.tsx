'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Compact elapsed-time readout for the app header — the session clock lives
 * up there like a phone's status clock, not inside the scrolling workout
 * body. Ticks with the same mounted/hydration-safety pattern as
 * SessionStatus: renders nothing until mounted (the server HTML can't know
 * the elapsed time) and nothing when the span is implausible
 * (formatElapsed → null), where a running readout would only mislead.
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
    // Visually just the digits — the header has no room for a label, and the
    // ticking format already reads as "session time" at a glance.
    <span aria-label="Session time" className="font-display text-xl leading-none tnum">
      {elapsed}
    </span>
  )
}

/**
 * Glanceable rest count-up for the logger body: once a set has been checked
 * off, the time since that completion — the number a lifter actually watches
 * between sets. Runs in the display face at stat scale (the "glanceable
 * large numerals" mandate applies mid-session, not just on the summary
 * page). Elapsed session time moved to the header (HeaderClock); this row
 * now renders only while a rest is running and yields the space otherwise.
 *
 * Renders nothing until mounted — the first client render must match the
 * server HTML, which can't know the elapsed time.
 */
export function SessionStatus({
  restStartedAt,
}: {
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
  const rest = restStartedAt ? formatElapsed(now.getTime() - restStartedAt.getTime()) : null
  if (!rest) return null

  return (
    <div className="flex items-end justify-end gap-4 px-1">
      <Readout
        label="Rest"
        value={rest}
        labelId="session-rest"
        // Rest is the live between-sets state — the volt label marks it the
        // same way the resume banner's eyebrow marks "in progress".
        accent
        alignEnd
      />
    </div>
  )
}

function Readout({
  label,
  value,
  labelId,
  accent = false,
  alignEnd = false,
}: {
  label: string
  value: string
  labelId: string
  accent?: boolean
  alignEnd?: boolean
}) {
  return (
    <p className={cn('flex flex-col', alignEnd && 'items-end')}>
      <span
        id={labelId}
        className={cn(
          'text-[11px] font-semibold uppercase tracking-widest',
          accent ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span aria-labelledby={labelId} className="font-display text-3xl leading-none tnum">
        {value}
      </span>
    </p>
  )
}
