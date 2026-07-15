'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { VolumeWindowMode } from '@/lib/volume-window'

/**
 * Rolling ⇄ calendar window toggle. A client island out of necessity: only
 * the client knows its timezone offset, and calendar weeks are LOCAL weeks —
 * the calendar link carries `tz=<getTimezoneOffset()>` so the server can
 * place Monday midnight correctly (lib/volume-window). The URL is the state;
 * rolling is the clean default (no params).
 */

interface WindowToggleProps {
  mode: VolumeWindowMode
}

export function WindowToggle({ mode }: WindowToggleProps) {
  // Read at render: the offset is stable for the session, and a stale value
  // only shifts week boundaries the way a real timezone change would.
  const tz = new Date().getTimezoneOffset()
  const options: { label: string; href: string; value: VolumeWindowMode }[] = [
    { label: 'Rolling 7d', href: '/stats', value: 'rolling' },
    { label: 'Calendar wk', href: `/stats?window=calendar&tz=${tz}`, value: 'calendar' },
  ]

  return (
    <div className="flex gap-2" role="group" aria-label="Week window">
      {options.map((option) => (
        <Link
          key={option.value}
          href={option.href}
          replace
          aria-current={mode === option.value ? 'true' : undefined}
          className={cn(
            'relative h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors before:absolute before:-inset-1',
            mode === option.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          <span className="flex h-full items-center">{option.label}</span>
        </Link>
      ))}
    </div>
  )
}
