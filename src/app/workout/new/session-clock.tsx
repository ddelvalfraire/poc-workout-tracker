'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/format'

/**
 * Live elapsed-time readout for the logger, ticking once a second from
 * `startedAt`. Renders nothing until mounted — the first client render must
 * match the server HTML, which can't know the elapsed time — and nothing for
 * implausible spans (formatElapsed → null, e.g. editing a backdated session),
 * where a running clock would only mislead.
 */
export function SessionClock({ startedAt }: { startedAt: Date }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync; interval drives later updates
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1_000)
    return () => clearInterval(id)
  }, [])

  if (!now) return null
  const label = formatElapsed(now.getTime() - startedAt.getTime())
  if (!label) return null

  return (
    <p className="flex items-center gap-1.5 px-1 text-sm font-semibold tnum text-muted-foreground">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2.5M9 2h6" />
      </svg>
      <span aria-label="Session time">{label}</span>
    </p>
  )
}
