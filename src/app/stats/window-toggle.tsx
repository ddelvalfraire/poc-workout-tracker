'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { VolumeWindowMode } from '@/lib/volume-window'
import { useTranslations } from 'next-intl'

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

/** ARIA token values are part of the HTML vocabulary, never copy. */
const ARIA_CURRENT_TRUE = 'true'

/** The offset never changes mid-session — no store to subscribe to. */
function subscribeNever(): () => void {
  return () => {}
}

export function WindowToggle({ mode }: WindowToggleProps) {
  const t = useTranslations('WindowToggle')
  // Client-only value, hydration-safe: the server snapshot is null (href
  // omits tz; the page defaults it to 0), the client snapshot reads the real
  // offset. useSyncExternalStore is the sanctioned shape for this — reading
  // getTimezoneOffset during plain render would make the server-rendered
  // href mismatch the client's at hydration.
  const tz = useSyncExternalStore(
    subscribeNever,
    () => new Date().getTimezoneOffset(),
    () => null,
  )
  const calendarHref = tz === null ? '/stats?window=calendar' : `/stats?window=calendar&tz=${tz}`
  // Labels resolve at RENDER, keyed by the window value: a module-scope
  // label array is evaluated once, before any locale exists.
  // De-jargoned: the WINDOW mechanics (rolling vs Monday-anchored) live in
  // the module docs; the labels speak the lifter's calendar instead.
  const options: { href: string; value: VolumeWindowMode }[] = [
    { href: '/stats', value: 'rolling' },
    { href: calendarHref, value: 'calendar' },
  ]

  return (
    <div className="flex gap-2" role="group" aria-label={t('ariaLabel')}>
      {options.map((option) => (
        <Link
          key={option.value}
          href={option.href}
          replace
          aria-current={mode === option.value ? ARIA_CURRENT_TRUE : undefined}
          className={cn(
            'relative h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors before:absolute before:-inset-1',
            mode === option.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          <span className="flex h-full items-center">{t(`option.${option.value}`)}</span>
        </Link>
      ))}
    </div>
  )
}
