'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Glanceable live-status row for the logger: session elapsed time and, once a
 * set has been checked off, the rest count-up since that completion — the
 * number a lifter actually watches between sets. Both run in the display face
 * at stat scale (the "glanceable large numerals" mandate applies mid-session,
 * not just on the summary page).
 *
 * Renders nothing until mounted — the first client render must match the
 * server HTML, which can't know the elapsed time — and hides a clock whose
 * span is implausible (formatElapsed → null, e.g. editing a backdated
 * session), where a running readout would only mislead.
 */
export function SessionStatus({
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
    <div className="flex items-end justify-between gap-4 px-1">
      {elapsed && <Readout label="Elapsed" value={elapsed} labelId="session-elapsed" />}
      {rest && (
        <Readout
          label="Rest"
          value={rest}
          labelId="session-rest"
          // Rest is the live between-sets state — the volt label marks it the
          // same way the resume banner's eyebrow marks "in progress".
          accent
          alignEnd
        />
      )}
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
