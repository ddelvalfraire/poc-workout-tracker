'use client'

import { useSyncExternalStore } from 'react'
import { scheduleAnchor } from '@/lib/schedule-anchor'

/**
 * The hero eyebrow's text for a SCHEDULED next day: "Today · Week N",
 * "Tomorrow · Week N", or "Friday · Week N". Only the browser knows the
 * user's calendar day (the server renders in UTC — lib/local-day.ts), so the
 * anchor is computed after mount; SSR/hydration show the pre-schedule
 * "Up next · Week N", which the anchor replaces in the hydration frame.
 * Unscheduled days never mount this component — the parent renders the plain
 * literal so that path stays byte-identical to the pre-schedule markup.
 *
 * Same useSyncExternalStore mounted pattern as trained-today-gate.tsx.
 */
const subscribeNever = () => () => {}
const useMounted = () =>
  useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )

export function UpNextAnchor({ weekdays, week }: { weekdays: number[]; week: number }) {
  const mounted = useMounted()
  const anchor = mounted ? scheduleAnchor(weekdays, new Date()) : null
  return (
    <>
      {anchor ?? 'Up next'} · Week {week}
    </>
  )
}
