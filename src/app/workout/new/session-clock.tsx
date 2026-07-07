'use client'

import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
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
      <Timer aria-hidden="true" className="size-3.5" />
      <span aria-label="Session time">{label}</span>
    </p>
  )
}
